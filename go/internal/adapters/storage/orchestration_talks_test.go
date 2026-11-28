package storage

import (
	"errors"
	"fmt"
	"slices"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func enqueueTalkFixture(t *testing.T, service *RequestService, clock *requestClock, serial uint64, from, to core.IdentityID) core.RequestID {
	t.Helper()
	id := core.RequestID(fmt.Sprintf("req_124e89b1-aa16-4b25-b8e3-%012d", serial))
	in := inboxRequest(id)
	in.Originator.IdentityID, in.Recipient, in.Route.Recipient = &from, &to, &to
	in.Wait, in.ExpiresAtMs = false, uint64(clock.ms)+core.RequestMinExpiryMs
	if _, err := service.Enqueue(t.Context(), in); err != nil {
		t.Fatal(err)
	}
	return id
}

func TestReadTalkFactsKeepsPairWindowAndBoundsHeldEvidence(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	ctx := t.Context()
	clock := &requestClock{ms: 10_000}
	service := NewRequestService(store, clock)
	alice, bob := bindingOwnerID, bindingOtherID
	first, second := min(alice, bob), max(alice, bob)
	enqueueTalkFixture(t, service, clock, 1, bob, alice)
	clock.ms = 20_000
	enqueueTalkFixture(t, service, clock, 2, bob, alice)
	var held []core.RequestID
	for n := uint64(0); n < 21; n++ {
		clock.ms = 22_000 + int64(n)
		id := enqueueTalkFixture(t, service, clock, 10+n, bob, alice)
		held = append(held, id)
		editResumeFixture(t, store, "INSERT INTO orchestration_talk_holds(request_id,from_id,to_id,held_ms) VALUES (?,?,?,?)",
			id, bob, alice, clock.ms)
	}
	const observed uint64 = 30_000
	editResumeFixture(t, store, "UPDATE request_attempts SET expires_at_ms=? WHERE request_id IN (SELECT request_id FROM orchestration_talk_holds)", observed)
	editResumeFixture(t, store, "UPDATE request_attempts SET expires_at_ms=? WHERE request_id=?", observed+1, held[20])
	clock.ms = 23_000
	enqueueTalkFixture(t, service, clock, 40, bob, alice)
	clock.ms = 25_000
	enqueueTalkFixture(t, service, clock, 41, alice, bob)
	editResumeFixture(t, store, "INSERT INTO orchestration_settings VALUES (1,7,'UTC')")
	editResumeFixture(t, store, "INSERT INTO orchestration_leads(identity_id) VALUES (?)", alice)
	editResumeFixture(t, store, "INSERT INTO orchestration_talk_resumes(first_id,second_id,resumed_ms) VALUES (?,?,15000)", first, second)
	cursor := roomFixtureCursor(t, store)

	member := "  ＡＬＩ "
	q := core.OrchTalkFactsQuery{Mode: core.OrchTalkFactsTalks, ObservedAtMs: observed, MemberQuery: &member}
	page, err := store.ReadTalkFacts(ctx, q)
	if err != nil || page.Policy.Revision != 7 || len(page.Policy.Identities) != 2 ||
		!slices.Equal(page.SelectedIDs, []core.IdentityID{alice}) || len(page.Pairs) != 1 {
		t.Fatalf("talk facts = %+v, %v", page, err)
	}
	pair := page.Pairs[0]
	if pair.FirstID != first || pair.SecondID != second || pair.Count != 2 || pair.WindowStartMs != 15_000 ||
		pair.LastAtMs == nil || *pair.LastAtMs != 25_000 || pair.HeldCount != 21 || len(pair.Held) != 20 || !pair.HasLiveHold {
		t.Fatalf("talk pair = %+v", pair)
	}
	for i, item := range pair.Held {
		if item.RequestID != held[i] || item.FromID != bob || item.ToID != alice || item.ExpiresAtMs != observed {
			t.Fatalf("held row %d = %+v", i, item)
		}
	}
	q.Mode = core.OrchTalkFactsRoutesNow
	page, err = store.ReadTalkFacts(ctx, q)
	if err != nil || len(page.Pairs) != 0 {
		t.Fatalf("route requires both selected members = %+v, %v", page, err)
	}
	q.MemberQuery = nil
	page, err = store.ReadTalkFacts(ctx, q)
	if err != nil || len(page.Pairs) != 1 || page.Pairs[0].Count != 2 || page.Pairs[0].LastAtMs != nil ||
		page.Pairs[0].HeldCount != 0 || len(page.Pairs[0].Held) != 0 {
		t.Fatalf("present route count-only = %+v, %v", page, err)
	}
	q.Mode = core.OrchTalkFactsRoutesAt
	page, err = store.ReadTalkFacts(ctx, q)
	if err != nil || len(page.Pairs) != 0 || len(page.SelectedIDs) != 2 {
		t.Fatalf("historical route policy only = %+v, %v", page, err)
	}
	if after := roomFixtureCursor(t, store); after != cursor {
		t.Fatalf("talk facts changed cursor: %d to %d", cursor, after)
	}
}

func TestReadTalkFactsPreservesNativeMemberOverflowEvidence(t *testing.T) {
	parallelStorageFixture(t)
	store := testStorage(t)
	ctx := t.Context()
	memberID := func(n int) core.IdentityID {
		return core.IdentityID(fmt.Sprintf("517880b2-4526-4064-a0ed-%012d", n))
	}
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		for n := 0; n <= orchSnapshotMemberLimit; n++ {
			name := fmt.Sprintf("Member-%03d", n)
			if err := tx.Identities().Insert(core.Identity{ID: memberID(n), Name: core.Name(name),
				CanonicalName: core.NormalizeName(name), Lifetime: core.LifetimeSaved}, 1000); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	q := core.OrchTalkFactsQuery{Mode: core.OrchTalkFactsTalks, ObservedAtMs: 10_000}
	page, err := store.ReadTalkFacts(ctx, q)
	if err != nil || len(page.Policy.Identities) != 257 || len(page.SelectedIDs) != 257 || len(page.Pairs) != 0 {
		t.Fatalf("over-limit inventory with no talk pairs: %d/%d, pairs=%v, %v",
			len(page.Policy.Identities), len(page.SelectedIDs), page.Pairs, err)
	}
	q.Mode = core.OrchTalkFactsRoutesNow
	missing := "not-present"
	q.MemberQuery = &missing
	page, err = store.ReadTalkFacts(ctx, q)
	if err != nil || len(page.Policy.Identities) != 257 || len(page.SelectedIDs) != 0 || len(page.Pairs) != 0 {
		t.Fatalf("empty routes selection at overflow: %d/%d, %v", len(page.Policy.Identities), len(page.SelectedIDs), err)
	}
	member := "member-000"
	q.MemberQuery = &member
	page, err = store.ReadTalkFacts(ctx, q)
	if err != nil || !slices.Equal(page.SelectedIDs, []core.IdentityID{memberID(0)}) || len(page.Policy.Identities) != 257 {
		t.Fatalf("filtered routes overflow evidence = %v of %d, %v", page.SelectedIDs, len(page.Policy.Identities), err)
	}
	if _, err := core.ResolveOrchEffective(page.Policy, memberID(0), q.ObservedAtMs, nil); !errors.Is(err, core.ErrOrchLimit) {
		t.Fatalf("selected route must evaluate against the full cap: %v", err)
	}
	clock := &requestClock{ms: int64(q.ObservedAtMs)}
	service := NewRequestService(store, clock)
	enqueueTalkFixture(t, service, clock, 1, memberID(0), memberID(1))
	q.Mode = core.OrchTalkFactsTalks
	page, err = store.ReadTalkFacts(ctx, q)
	if err != nil || len(page.Policy.Identities) != 257 || len(page.Pairs) != 1 ||
		page.Pairs[0].FirstID != memberID(0) || page.Pairs[0].SecondID != memberID(1) {
		t.Fatalf("selected talk must retain overflow pair evidence: %+v, %v", page.Pairs, err)
	}
}
