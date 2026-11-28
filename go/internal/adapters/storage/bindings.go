package storage

import (
	"errors"
	"strings"
	"unicode"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type bindingRows struct{ records }

const bindingColumns = `b.id, b.identity_id, b.transport, b.server_id, b.socket_path, b.server_pid,
	b.server_start_time, b.pane_id, b.pane_pid, b.pane_incarnation, b.runtime_state, b.last_transition,
	b.runtime_pid, b.runtime_start_identity, b.observed_provider_session_id, b.launch_owner_pid,
	b.launch_owner_start_identity, b.runtime_start_refusal, b.plain_program`

const activeBindings = " FROM bindings b JOIN identities i ON i.id = b.identity_id WHERE i.retired_at_ms IS NULL"

func readBinding(row scanner) (*core.Binding, error) {
	var b core.Binding
	var runtimePID, ownerPID *uint64
	var runtimeStart, ownerStart *string
	session := &b.Session
	if err := row.Scan(&b.ID, &b.IdentityID, &b.Server.Host, &b.Server.ID, &b.Server.Socket, &b.Server.PID,
		&b.Server.StartTime, &b.PaneID, &b.PanePID, &b.PaneIncarnation, &session.RuntimeState, &session.LastTransition,
		&runtimePID, &runtimeStart, &session.ProviderSessionID, &ownerPID, &ownerStart,
		&session.StartRefusal, &session.PlainProgram); err != nil {
		return nil, err
	}
	if !safeTime(b.Server.PID) || !safeTime(b.PanePID) ||
		(b.PaneIncarnation != nil && !validStart(*b.PaneIncarnation)) {
		return nil, errors.New("invalid stored binding process evidence")
	}
	var err error
	session.Runtime, err = readIncarnation(runtimePID, runtimeStart)
	if err != nil {
		return nil, err
	}
	session.LaunchOwner, err = readIncarnation(ownerPID, ownerStart)
	if err != nil {
		return nil, err
	}
	return &b, nil
}

func readIncarnation(pid *uint64, start *string) (*core.ProcessIncarnation, error) {
	if pid == nil && start == nil {
		return nil, nil
	}
	if pid == nil || start == nil || !safeTime(*pid) || !validStart(*start) {
		return nil, errors.New("invalid stored process incarnation")
	}
	return &core.ProcessIncarnation{PID: *pid, StartIdentity: *start}, nil
}

func validStart(value string) bool {
	return len(value) > 0 && len(value) <= 256 && strings.TrimSpace(value) != "" && !strings.ContainsFunc(value, unicode.IsControl)
}

func (r bindingRows) FindByIdentity(id core.IdentityID) (*core.Binding, error) {
	return optional(readBinding(r.one("SELECT "+bindingColumns+activeBindings+" AND b.identity_id = ?", id)))
}

func (r bindingRows) FindByEndpoint(key core.EndpointKey) (*core.Binding, error) {
	return optional(readBinding(r.one("SELECT "+bindingColumns+activeBindings+
		" AND b.transport = ? AND b.server_id = ? AND b.pane_id = ?", key.Host, key.ServerID, key.PaneID)))
}

func (r bindingRows) List() ([]core.Binding, error) {
	rows, err := r.query("SELECT " + bindingColumns + activeBindings + " ORDER BY i.canonical_name COLLATE BINARY")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	bindings := []core.Binding{}
	for rows.Next() {
		binding, err := readBinding(rows)
		if err != nil {
			return nil, err
		}
		bindings = append(bindings, *binding)
	}
	return bindings, rows.Err()
}
