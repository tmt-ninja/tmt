package storage

import (
	"context"
	"errors"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

var _ ports.DigestStore = (*Storage)(nil)
var errDigestEvidence = errors.New("invalid stored Digest evidence")

const digestChecklistColumns = "id,identity_id,attempt_token,through_sequence,state,created_at_ms,projection,sealed_count,summary_urgent_count,opportunity"
const digestScope = `i.identity_id=?1 AND i.checklist_id IS ?2 AND a.retention_expires_at_ms>?3 AND i.sequence>?4`

func digestFailure(code string, status int) *core.RequestFailure {
	return requestFailure(code, "Digest operation refused; inspect the current policy or checklist before retrying.", status)
}

func digestInvalid() *core.RequestFailure { return digestFailure("DIGEST_INPUT_INVALID", 1) }

func digestIdentity(r records, id core.IdentityID) (*core.Identity, error) {
	if !core.ValidUUID(string(id)) {
		return nil, digestInvalid()
	}
	identity, err := r.Identities().FindByID(id)
	if err == nil && identity == nil {
		return nil, digestFailure("DIGEST_IDENTITY_UNAVAILABLE", 3)
	}
	return identity, err
}

func digestIsUser(r records, id core.IdentityID) (bool, error) {
	var user bool
	err := r.one(`SELECT EXISTS(SELECT 1 FROM identity_metadata m JOIN identities i ON i.id=m.identity_id
		WHERE m.identity_id=? AND m.key='user' AND m.value='true' AND i.retired_at_ms IS NULL)`, id).Scan(&user)
	return user, err
}

func digestPolicy(r records, id core.IdentityID) (*core.DigestPolicy, error) {
	p := core.DigestPolicy{IdentityID: id}
	err := r.one("SELECT owner_identity_id,setter_identity_id,revision,until_ms,max_hold_ms FROM focus_policies WHERE identity_id=?", id).
		Scan(&p.OwnerID, &p.SetterID, &p.Revision, &p.UntilMs, &p.MaxHoldMs)
	return optional(&p, err)
}

type digestChecklistRow struct {
	core.DigestChecklist
	sealed, urgent *uint64
	opportunity    *core.DigestOpportunity
}

func (c *digestChecklistRow) fields() []any {
	return []any{&c.ID, &c.IdentityID, &c.AttemptToken, &c.ThroughSequence, &c.State, &c.CreatedAtMs,
		&c.Projection, &c.sealed, &c.urgent, &c.opportunity}
}

func (c *digestChecklistRow) validate() error {
	if !c.State.Valid() || !c.Projection.Valid() || c.opportunity != nil && !c.opportunity.Valid() ||
		!safeTime(c.ThroughSequence) || !safeTime(c.CreatedAtMs) || c.sealed != nil && !safeTime(*c.sealed) {
		return errDigestEvidence
	}
	if c.Projection == core.DigestProjectionIncomingSummary {
		if c.sealed == nil || c.urgent == nil || *c.urgent > *c.sealed {
			return errDigestEvidence
		}
		c.Summary = &core.DigestSummaryCounts{IncomingCount: *c.sealed, UrgentCount: *c.urgent}
	} else if c.urgent != nil {
		return errDigestEvidence
	}
	return nil
}

func readDigestChecklist(r records, where string, args ...any) (*digestChecklistRow, error) {
	var c digestChecklistRow
	fields := c.fields()
	err := r.one("SELECT "+digestChecklistColumns+" FROM focus_checklists WHERE "+where, args...).Scan(fields...)
	if err == nil {
		err = c.validate()
	}
	return optional(&c, err)
}

func activeDigest(r records, id core.IdentityID) (*digestChecklistRow, error) {
	return readDigestChecklist(r, "identity_id=? AND state='claimed'", id)
}

func exactDigest(r records, id core.IdentityID, checklist core.DigestChecklistID) (*digestChecklistRow, error) {
	c, err := readDigestChecklist(r, "id=?", checklist)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, digestFailure("DIGEST_STATE_INVALID", 5)
	}
	if c.IdentityID != id {
		return nil, digestFailure("DIGEST_ATTEMPT_MISMATCH", 5)
	}
	return c, nil
}

func digestInventory(r records, id core.IdentityID, batch *core.DigestChecklistID, after, now uint64) (core.DigestDue, error) {
	var d core.DigestDue
	err := r.one("SELECT COUNT(*),COALESCE(MAX(i.sequence),0) FROM focus_items i JOIN request_attempts a USING(request_id) WHERE "+digestScope,
		id, batch, now, after).Scan(&d.HeldCount, &d.ThroughSequence)
	return d, err
}

func digestPolicyView(r records, id core.IdentityID, now uint64) (core.DigestPolicyView, error) {
	view := core.DigestPolicyView{IdentityID: id, ObservedAtMs: now}
	var err error
	view.Policy, err = digestPolicy(r, id)
	if err != nil {
		return view, err
	}
	pending, err := digestInventory(r, id, nil, 0, now)
	if err != nil {
		return view, err
	}
	view.HeldCount = pending.HeldCount
	active, err := activeDigest(r, id)
	if err != nil || active == nil {
		return view, err
	}
	view.ActiveChecklist = &active.DigestChecklist
	inFlight, err := digestInventory(r, id, &active.ID, 0, now)
	view.HeldCount += inFlight.HeldCount
	return view, err
}

func digestBatch[T any](s *Storage, ctx context.Context, q core.DigestIdentityQuery, read func(records, *core.Identity) (T, error)) ([]T, error) {
	if !safeTime(q.NowMs) || len(q.IdentityIDs) == 0 || len(q.IdentityIDs) > 256 {
		return nil, digestInvalid()
	}
	out := make([]T, 0, len(q.IdentityIDs))
	err := s.transact(ctx, true, func(r records) error {
		for _, id := range q.IdentityIDs {
			identity, err := digestIdentity(r, id)
			if err != nil {
				return err
			}
			item, err := read(r, identity)
			if err != nil {
				return err
			}
			out = append(out, item)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Storage) ReadPolicies(ctx context.Context, q core.DigestIdentityQuery) ([]core.DigestPolicyView, error) {
	return digestBatch(s, ctx, q, func(r records, i *core.Identity) (core.DigestPolicyView, error) {
		return digestPolicyView(r, i.ID, q.NowMs)
	})
}

func (s *Storage) WritePolicy(ctx context.Context, p core.DigestPolicyWrite) (core.DigestPolicyView, error) {
	if !safeTime(p.NowMs) || !core.ValidJSSafeInteger(p.UntilMs) || p.UntilMs != 0 && p.UntilMs <= p.NowMs ||
		p.MaxHoldMs != nil && (p.UntilMs == 0 || !safeTime(*p.MaxHoldMs)) {
		return core.DigestPolicyView{}, digestInvalid()
	}
	var view core.DigestPolicyView
	err := s.transact(ctx, false, func(r records) error {
		for _, id := range []core.IdentityID{p.IdentityID, p.OwnerID, p.SetterID} {
			if _, err := digestIdentity(r, id); err != nil {
				return err
			}
		}
		old, err := digestPolicy(r, p.IdentityID)
		if err != nil {
			return err
		}
		var revision uint64
		if old != nil {
			revision = old.Revision
		}
		if revision != p.ExpectedRevision {
			return digestFailure("DIGEST_REVISION_CONFLICT", 5)
		}
		if revision >= core.MaxJSSafeInteger {
			return digestFailure("REQUEST_REVISION_EXHAUSTED", 5)
		}
		_, err = r.exec(`INSERT INTO focus_policies(identity_id,owner_identity_id,setter_identity_id,revision,until_ms,max_hold_ms)
			VALUES(?,?,?,?,?,?) ON CONFLICT(identity_id) DO UPDATE SET owner_identity_id=excluded.owner_identity_id,
			setter_identity_id=excluded.setter_identity_id,revision=excluded.revision,until_ms=excluded.until_ms,max_hold_ms=excluded.max_hold_ms`,
			p.IdentityID, p.OwnerID, p.SetterID, revision+1, p.UntilMs, p.MaxHoldMs)
		if err != nil {
			return err
		}
		view, err = digestPolicyView(r, p.IdentityID, p.NowMs)
		return err
	})
	if err != nil {
		return core.DigestPolicyView{}, err
	}
	return view, nil
}

func (s *Storage) MarkDue(ctx context.Context, q core.DigestDueQuery) (core.DigestDue, error) {
	if !safeTime(q.NowMs) {
		return core.DigestDue{}, digestInvalid()
	}
	var due core.DigestDue
	err := s.transact(ctx, false, func(r records) error {
		if _, err := digestIdentity(r, q.IdentityID); err != nil {
			return err
		}
		var err error
		due, err = digestInventory(r, q.IdentityID, nil, 0, q.NowMs)
		if err != nil || due.HeldCount == 0 {
			return err
		}
		_, err = r.exec(`INSERT INTO digest_counters(identity_id,due_through_sequence) VALUES(?,?)
			ON CONFLICT(identity_id) DO UPDATE SET due_through_sequence=MAX(due_through_sequence,excluded.due_through_sequence)`,
			q.IdentityID, due.ThroughSequence)
		return err
	})
	if err != nil {
		return core.DigestDue{}, err
	}
	return due, nil
}

func digestCounters(r records, id core.IdentityID) (through, delivered uint64, err error) {
	err = r.one("SELECT due_through_sequence,delivered_digests FROM digest_counters WHERE identity_id=?", id).Scan(&through, &delivered)
	if isNoRows(err) {
		err = nil
	}
	return
}
