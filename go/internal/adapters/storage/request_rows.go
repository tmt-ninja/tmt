package storage

import (
	"errors"
	"fmt"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type requestRows struct{ records }
type responseRows struct{ records }

const routeColumns = "route_kind, host, server_id, socket_path, server_pid, server_start_time, pane_id, pane_pid"

type routeRow struct {
	kind core.RequestRouteKind
	host *string
	id   *string
	sock *string
	pid  *uint64
	time *string
	pane *string
	ppid *uint64
}

func (r *routeRow) targets() []any {
	return []any{&r.kind, &r.host, &r.id, &r.sock, &r.pid, &r.time, &r.pane, &r.ppid}
}

func (r routeRow) route(recipient *core.IdentityID) (core.RequestRoute, error) {
	switch r.kind {
	case core.RequestRouteInbox:
		if recipient == nil || *recipient == "" {
			return core.RequestRoute{}, errors.New("stored inbox route has no recipient")
		}
		return core.RequestRoute{Kind: r.kind, Recipient: recipient}, nil
	case core.RequestRoutePane:
		if r.id == nil || r.sock == nil || r.time == nil || r.pane == nil || r.pid == nil || r.ppid == nil ||
			!safeTime(*r.pid) || !safeTime(*r.ppid) {
			return core.RequestRoute{}, errors.New("invalid stored pane route")
		}
		host := "tmux" // Historical rows predate the host column.
		if r.host != nil {
			host = *r.host
		}
		return core.RequestRoute{Kind: r.kind, Pane: &core.RequestEndpoint{
			Server: core.ServerEvidence{Host: host, ID: *r.id, Socket: *r.sock, PID: *r.pid, StartTime: *r.time},
			PaneID: *r.pane, PanePID: *r.ppid,
		}}, nil
	default:
		// NOT PORTED (#6938): remote request routes and response reads.
		return core.RequestRoute{}, fmt.Errorf("unsupported stored request route %q", r.kind)
	}
}

func routeValues(route core.RequestRoute) ([]any, error) {
	switch route.Kind {
	case core.RequestRouteInbox:
		if route.Pane != nil || route.Recipient == nil || *route.Recipient == "" {
			return nil, errors.New("invalid inbox route")
		}
		return []any{route.Kind, nil, nil, nil, nil, nil, nil, nil}, nil
	case core.RequestRoutePane:
		if route.Pane == nil || route.Recipient != nil {
			return nil, errors.New("invalid pane route")
		}
		p := route.Pane
		return []any{route.Kind, p.Server.Host, p.Server.ID, p.Server.Socket, p.Server.PID,
			p.Server.StartTime, p.PaneID, p.PanePID}, nil
	default:
		return nil, fmt.Errorf("unsupported request route %q", route.Kind)
	}
}

const attemptColumns = `attempt_id, request_id, request_kind, COALESCE(origin, 'unknown'),
	originator_kind, originator_identity_id, recipient_identity_id, wait_active, status, cadence_reserved,
	prepared_at_ms, sending_at_ms, settled_at_ms, wait_released_at_ms, response_submitted_at_ms,
	expires_at_ms, retention_days, retention_expires_at_ms, withdrawn_at_ms, withdrawal_reason, ` + routeColumns

func readAttempt(row scanner) (*core.RequestAttempt, error) {
	var a core.RequestAttempt
	var route routeRow
	var withdrawnAt *uint64
	var reason *string
	targets := []any{&a.AttemptID, &a.RequestID, &a.Kind, &a.Origin,
		&a.Originator.Kind, &a.Originator.IdentityID, &a.Recipient, &a.WaitActive, &a.Status, &a.CadenceReserved,
		&a.PreparedAtMs, &a.SendingAtMs, &a.SettledAtMs, &a.WaitReleasedAtMs, &a.ResponseSubmittedAtMs,
		&a.ExpiresAtMs, &a.RetentionDays, &a.RetentionExpiresAtMs, &withdrawnAt, &reason}
	if err := row.Scan(append(targets, route.targets()...)...); err != nil {
		return nil, err
	}
	for _, ms := range []uint64{a.PreparedAtMs, a.ExpiresAtMs, a.RetentionDays, a.RetentionExpiresAtMs} {
		if !core.ValidJSSafeInteger(ms) {
			return nil, errors.New("invalid stored attempt timestamp or retention")
		}
	}
	for _, ms := range []*uint64{a.SendingAtMs, a.SettledAtMs, a.WaitReleasedAtMs, a.ResponseSubmittedAtMs, withdrawnAt} {
		if ms != nil && !core.ValidJSSafeInteger(*ms) {
			return nil, errors.New("invalid stored attempt timestamp")
		}
	}
	if withdrawnAt != nil && reason != nil {
		a.Withdrawal = &core.Withdrawal{WithdrawnAtMs: *withdrawnAt, Reason: *reason}
	}
	decoded, err := route.route(a.Recipient)
	if err != nil {
		return nil, err
	}
	a.Route = decoded
	return &a, nil
}

func (r requestRows) FindByID(id core.RequestID) (*core.RequestAttempt, error) {
	return optional(readAttempt(r.one("SELECT "+attemptColumns+" FROM request_attempts WHERE request_id = ?", id)))
}

func (r requestRows) FindByAttemptID(id core.AttemptID) (*core.RequestAttempt, error) {
	return optional(readAttempt(r.one("SELECT "+attemptColumns+" FROM request_attempts WHERE attempt_id = ?", id)))
}

func (r requestRows) Insert(a core.RequestAttempt, prompt string) error {
	values, err := routeValues(a.Route)
	if err != nil {
		return err
	}
	if a.Route.Kind == core.RequestRouteInbox && (a.Recipient == nil || *a.Recipient != *a.Route.Recipient) {
		return errors.New("attempt recipient does not match inbox route")
	}
	promptExpires, ok := core.RetentionDeadline(a.PreparedAtMs, a.RetentionDays)
	if !ok {
		return errors.New("invalid original prompt deadline")
	}
	var origin any
	if a.Origin != core.RequestOriginUnknown && a.Origin != "" {
		origin = a.Origin
	}
	metadata := []any{a.AttemptID, a.RequestID, a.Kind, origin, a.Originator.Kind, a.Originator.IdentityID, a.Recipient,
		a.WaitActive, a.Status, a.CadenceReserved, a.PreparedAtMs, a.ExpiresAtMs, a.RetentionDays,
		a.RetentionExpiresAtMs, prompt, len(prompt), promptExpires}
	_, err = r.exec(`INSERT INTO request_attempts (
		attempt_id, request_id, request_kind, origin, originator_kind, originator_identity_id, recipient_identity_id,
		wait_active, status, cadence_reserved, prepared_at_ms, expires_at_ms, retention_days,
		retention_expires_at_ms, message_text, message_bytes, message_expires_at_ms, inject_preamble, `+routeColumns+`
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?)`, append(metadata, values...)...)
	return err
}

func (r requestRows) UpdateState(plan core.AttemptTransition) (bool, error) {
	result, err := r.exec(`UPDATE request_attempts SET status = ?1, cadence_reserved = ?2,
		sending_at_ms = CASE WHEN ?1 = 'sending' THEN ?3 ELSE sending_at_ms END,
		settled_at_ms = CASE WHEN ?1 IN ('sent', 'queued', 'uncertain', 'definitely_failed') THEN ?3 ELSE settled_at_ms END,
		retention_expires_at_ms = MAX(retention_expires_at_ms, COALESCE(?4, retention_expires_at_ms)),
		wait_released_at_ms = CASE WHEN ?5 AND wait_active = 1 THEN ?3 ELSE wait_released_at_ms END,
		wait_active = CASE WHEN ?5 THEN 0 ELSE wait_active END
		WHERE attempt_id = ?6 AND status = ?7`, plan.To, plan.CadenceReserved, plan.AtMs, plan.RetentionExpiresAtMs,
		plan.ReleaseWait, plan.AttemptID, plan.From)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count == 1, err
}

func (r requestRows) ReleaseWait(id core.AttemptID, nowMs uint64) error {
	_, err := r.exec(`UPDATE request_attempts SET wait_active = 0, wait_released_at_ms = ?
		WHERE attempt_id = ? AND wait_active = 1`, nowMs, id)
	return err
}

func (r responseRows) FindByRequest(id core.RequestID) (*core.FinalResponse, error) {
	row := r.one(`SELECT request_id, attempt_id, body, body_bytes, submitted_at_ms, response_expires_at_ms,
		route_recipient_identity_id, `+routeColumns+" FROM request_responses WHERE request_id = ?", id)
	return optional(readFinal(row))
}

func readFinal(row scanner) (*core.FinalResponse, error) {
	var f core.FinalResponse
	var recipient *core.IdentityID
	var route routeRow
	targets := []any{&f.RequestID, &f.AttemptID, &f.Body, &f.BodyBytes, &f.SubmittedAtMs, &f.ResponseExpiresAtMs, &recipient}
	if err := row.Scan(append(targets, route.targets()...)...); err != nil {
		return nil, err
	}
	if !core.ValidJSSafeInteger(f.BodyBytes) || !safeTime(f.SubmittedAtMs) || !core.ValidJSSafeInteger(f.ResponseExpiresAtMs) {
		return nil, errors.New("invalid stored final response metadata")
	}
	decoded, err := route.route(recipient)
	if err != nil {
		return nil, err
	}
	f.Route = decoded
	return &f, nil
}

func (r responseRows) Insert(final core.FinalResponse) error {
	values, err := routeValues(final.Route)
	if err != nil {
		return err
	}
	metadata := []any{final.RequestID, final.AttemptID, final.Body, final.BodyBytes, final.SubmittedAtMs,
		final.ResponseExpiresAtMs, final.Route.Recipient}
	_, err = r.exec(`INSERT INTO request_responses (
		request_id, attempt_id, body, body_bytes, submitted_at_ms, response_expires_at_ms,
		route_recipient_identity_id, `+routeColumns+`) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		append(metadata, values...)...)
	return err
}
