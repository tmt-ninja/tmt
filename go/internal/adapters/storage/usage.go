package storage

import (
	"context"
	"database/sql"
	"encoding/json/v2"
	"errors"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const (
	usageFineWidth       = 5000
	usageFineRetention   = 2 * 60 * 60 * 1000
	usageFineMaxWindow   = 60 * 60 * 1000
	usageRollupWidth     = 300000
	usageRollupRetention = 32 * core.RetentionDayMs
	usageMaxBuckets      = 720
	usageMaxWakeTurns    = 1000
)

var _ ports.UsageStore = (*Storage)(nil)
var errUsageQuery = errors.New("invalid consumption history query")
var errUsageEvidence = errors.New("invalid consumption history evidence")

func (s *Storage) ConsumptionHistory(ctx context.Context, query core.ConsumptionHistoryQuery) (core.ConsumptionHistoryPage, error) {
	page, err := usageHistoryBounds(query)
	if err != nil {
		return core.ConsumptionHistoryPage{}, err
	}
	err = s.transact(ctx, true, func(r records) error {
		for _, id := range query.IdentityIDs {
			history, err := readConsumptionIdentity(r, id, query, page)
			if err != nil {
				return err
			}
			page.Identities = append(page.Identities, history)
		}
		return nil
	})
	if err != nil {
		return core.ConsumptionHistoryPage{}, err
	}
	return page, nil
}

func usageHistoryBounds(q core.ConsumptionHistoryQuery) (core.ConsumptionHistoryPage, error) {
	if !core.ValidJSSafeInteger(q.NowMs) || q.MaxBuckets == 0 || q.MaxBuckets > usageMaxBuckets {
		return core.ConsumptionHistoryPage{}, errUsageQuery
	}
	through := q.NowMs / usageFineWidth * usageFineWidth
	if q.ThroughMs != nil {
		through = *q.ThroughMs
		if through > q.NowMs || through%usageFineWidth != 0 {
			return core.ConsumptionHistoryPage{}, errUsageQuery
		}
	}
	for _, window := range q.WindowsMs {
		resolution := usageResolution(window)
		if window == 0 || window > usageRollupRetention || window%resolution != 0 {
			return core.ConsumptionHistoryPage{}, errUsageQuery
		}
	}
	return core.ConsumptionHistoryPage{AsOfMs: q.NowMs, ThroughMs: through, ResolutionMs: usageFineWidth,
		RetainedFromMs: subtractUsageMs(through, usageFineRetention), Identities: make([]core.ConsumptionIdentity, 0, len(q.IdentityIDs))}, nil
}

func usageResolution(window uint64) uint64 {
	if window <= usageFineMaxWindow {
		return usageFineWidth
	}
	return usageRollupWidth
}

func subtractUsageMs(ms, delta uint64) uint64 { return ms - min(ms, delta) }

func readConsumptionIdentity(r records, id core.IdentityID, q core.ConsumptionHistoryQuery, page core.ConsumptionHistoryPage) (core.ConsumptionIdentity, error) {
	history := core.ConsumptionIdentity{ID: id}
	var retired bool
	err := r.one("SELECT retired_at_ms IS NOT NULL FROM identities WHERE id=?", id).Scan(&retired)
	if errors.Is(err, sql.ErrNoRows) || err == nil && retired && !q.IncludeRetired {
		return history, nil
	}
	if err != nil {
		return history, err
	}
	history.Found, history.Retired = true, retired

	fine, err := readUsageBuckets(r, id, page.RetainedFromMs, page.ThroughMs, false)
	if err != nil {
		return history, err
	}
	if err := selectClosedUsageSeed(&history, fine); err != nil {
		return history, err
	}
	if !history.Reporting {
		cause, err := usageCause(r, id, page.RetainedFromMs)
		if err != nil {
			return history, err
		}
		history.Cause = &cause
	}

	rollupThrough := page.ThroughMs / usageRollupWidth * usageRollupWidth
	var longest uint64
	for _, window := range q.WindowsMs {
		if window > usageFineMaxWindow {
			longest = max(longest, window)
		}
	}
	var rollup []storedUsageBucket
	var rollupAvailable *uint64
	if longest > 0 {
		rollup, err = readUsageBuckets(r, id, subtractUsageMs(rollupThrough, longest), rollupThrough, true)
		if err != nil {
			return history, err
		}
		for _, row := range rollup {
			if row.sampled != nil {
				rollupAvailable = &row.FromMs
				break
			}
		}
	}
	history.Windows = make([]core.ConsumptionWindow, 0, len(q.WindowsMs))
	for _, window := range q.WindowsMs {
		rows, through := fine, page.ThroughMs
		width := usageResolution(window)
		if width == usageRollupWidth {
			rows, through = rollup, rollupThrough
		}
		view, err := projectUsageWindow(rows, window, through, width, q.MaxBuckets)
		if err != nil {
			return history, err
		}
		if width == usageRollupWidth {
			retained := subtractUsageMs(through, usageRollupRetention)
			if rollupAvailable != nil {
				retained = max(retained, *rollupAvailable)
			}
			view.ResolutionMs, view.AvailableFromMs, view.RetainedFromMs = &width, rollupAvailable, &retained
		}
		history.Windows = append(history.Windows, view)
	}
	return history, nil
}

func selectClosedUsageSeed(identity *core.ConsumptionIdentity, rows []storedUsageBucket) error {
	var last *storedUsageBucket
	for i := range rows {
		row := &rows[i]
		if row.snapshot != nil {
			identity.Reporting = true
			if row.sampled != nil && (identity.AvailableFromMs == nil || *row.sampled < *identity.AvailableFromMs) {
				identity.AvailableFromMs = row.sampled
			}
		}
		if row.sampled != nil {
			last = row
		}
	}
	// A more recent sampled row without a seed must not fall back to an older
	// session's cumulative counters.
	if last == nil || last.snapshot == nil {
		return nil
	}
	var latest core.ConsumptionLatest
	if err := decodeUsageJSON(last.snapshot, &latest); err != nil {
		return err
	}
	if !validConsumptionReading(&latest) {
		return errUsageEvidence
	}
	identity.LastSampleAtMs, identity.Latest = last.sampled, &latest
	return nil
}

func usageCause(r records, id core.IdentityID, retained uint64) (core.ConsumptionCause, error) {
	binding, err := r.Bindings().FindByIdentity(id)
	if err != nil {
		return "", err
	}
	switch {
	case binding == nil:
		return core.ConsumptionNoBinding, nil
	case binding.Session.RuntimeState != "running" || binding.Session.ProviderSessionID == nil:
		return core.ConsumptionNoAgent, nil
	case binding.Session.LaunchOwner == nil:
		return core.ConsumptionNoSampler, nil
	case binding.Session.Runtime == nil:
		return core.ConsumptionNotSampled, nil
	}
	var raw []byte
	err = r.one(`SELECT CASE WHEN json_valid(driver_state) THEN json_extract(driver_state,'$.activity') END FROM identity_session_preferences
		WHERE identity_id=? AND provider_session_id=? AND driver_state_version BETWEEN 3 AND 6`,
		id, *binding.Session.ProviderSessionID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return core.ConsumptionNotSampled, nil
	}
	if err != nil {
		return "", err
	}
	var activity launchActivity
	if len(raw) > 0 && json.Unmarshal(raw, &activity, json.RejectUnknownMembers(true)) == nil &&
		(activity.State == "working" || activity.State == "waiting" || activity.State == "idle") && activity.Session == *binding.Session.ProviderSessionID &&
		activity.PID == binding.Session.Runtime.PID && activity.Start == binding.Session.Runtime.StartIdentity &&
		safeTime(activity.LastActivityMs) && activity.SinceMs > 0 && activity.SinceMs <= activity.LastActivityMs &&
		activity.LastActivityMs < retained {
		return core.ConsumptionIdle, nil
	}
	return core.ConsumptionNotSampled, nil
}

func (s *Storage) RetiredWithRollup(ctx context.Context, q core.RetiredRollupQuery) (core.RetiredRollupPage, error) {
	if q.FromMs > q.NowMs || !core.ValidJSSafeInteger(q.NowMs) || !core.ValidJSSafeInteger(q.Limit) {
		return core.RetiredRollupPage{}, errUsageQuery
	}
	through := q.NowMs / usageRollupWidth * usageRollupWidth
	from := subtractUsageMs(q.FromMs, usageRollupWidth)
	retained := subtractUsageMs(through, usageRollupRetention)
	var page core.RetiredRollupPage
	err := s.transact(ctx, true, func(r records) error {
		var err error
		page.IdentityIDs, err = scanRows(r, `SELECT id FROM identities i WHERE retired_at_ms IS NOT NULL AND EXISTS(
			SELECT 1 FROM consumption_tier5m rollup WHERE rollup.identity_id=i.id AND rollup.from_ms>? AND rollup.from_ms>=?)
			ORDER BY id LIMIT ?`, func(row scanner) (core.IdentityID, error) {
			var id core.IdentityID
			err := row.Scan(&id)
			return id, err
		}, from, retained, q.Limit+1)
		return err
	})
	if err != nil {
		return core.RetiredRollupPage{}, err
	}
	if uint64(len(page.IdentityIDs)) > q.Limit {
		page.More = true
		page.IdentityIDs = page.IdentityIDs[:q.Limit]
	}
	return page, nil
}

func (s *Storage) WakeTurns(ctx context.Context, q core.WakeTurnQuery) (core.WakeTurnPage, error) {
	if q.FromMs > q.ThroughMs || !core.ValidJSSafeInteger(q.ThroughMs) || q.Limit == 0 || q.Limit > usageMaxWakeTurns {
		return core.WakeTurnPage{}, errUsageQuery
	}
	ids, err := json.Marshal(q.IdentityIDs)
	if err != nil {
		return core.WakeTurnPage{}, err
	}
	page := core.WakeTurnPage{FromMs: q.FromMs, ThroughMs: q.ThroughMs}
	err = s.transact(ctx, true, func(r records) error {
		page.Turns, err = scanRows(r, `SELECT w.identity_id,w.started_ms,w.ended_ms,w.input_tokens,w.output_tokens,w.cached_input_tokens,w.models,w.measured,
			(SELECT json_group_array(t.request_id) FROM request_turns t JOIN request_attempts a ON a.request_id=t.request_id
			WHERE a.recipient_identity_id=w.identity_id AND t.started_ms=w.started_ms)
			FROM wake_turns w WHERE w.ended_ms BETWEEN ?1 AND ?2
			AND (json_array_length(?3)=0 OR w.identity_id IN (SELECT value FROM json_each(?3)))
			ORDER BY w.ended_ms,w.identity_id LIMIT ?4`, decodeWakeTurn, q.FromMs, q.ThroughMs, string(ids), q.Limit+1)
		return err
	})
	if err != nil {
		return core.WakeTurnPage{}, err
	}
	if uint64(len(page.Turns)) > q.Limit {
		page.More = true
		page.Turns = page.Turns[:q.Limit]
	}
	return page, nil
}

func decodeWakeTurn(row scanner) (core.WakeTurn, error) {
	var turn core.WakeTurn
	var input, output, cached *uint64
	var models, requests []byte
	err := row.Scan(&turn.IdentityID, &turn.StartedAtMs, &turn.EndedAtMs, &input, &output, &cached, &models, &turn.Measured, &requests)
	if err != nil {
		return turn, err
	}
	if !safeTime(turn.StartedAtMs) || !safeTime(turn.EndedAtMs) || turn.EndedAtMs < turn.StartedAtMs ||
		(input == nil) != (output == nil) || (input == nil) != (cached == nil) {
		return turn, errUsageEvidence
	}
	if input != nil {
		turn.Tokens = &core.UsageTokens{InputTokens: *input, OutputTokens: *output, CachedInputTokens: *cached}
		if !validUsageTokens(*turn.Tokens) {
			return turn, errUsageEvidence
		}
	}
	if err := decodeUsageJSON(requests, &turn.RequestIDs); err != nil {
		return turn, err
	}
	if len(models) > 0 {
		if err := decodeUsageJSON(models, &turn.ByModel); err != nil {
			return turn, err
		}
	}
	return turn, nil
}
