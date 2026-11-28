package storage

import (
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestDigestIdleBindingRequiresExactIdleAndNoOpenContinuation(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	ctx := t.Context()
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	seedDigestRequest(t, store, 1, false)
	if _, err := store.db.ExecContext(ctx, `UPDATE bindings SET runtime_state='running',last_transition='started',
		runtime_pid=601,runtime_start_identity='runtime',launch_owner_pid=600,launch_owner_start_identity='owner',
		observed_provider_session_id='session' WHERE id=?`, binding.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO identity_session_preferences
		(identity_id,preferred_harness,remembered_harness,runtime_mode,provider_session_id,driver_state_version,driver_state)
		VALUES (?,'claude','claude','default','session',3,
		'{"activity":{"session":"session","pid":601,"start":"runtime","state":"idle","turn":null,"sinceMs":10000,"lastActivityMs":10000}}')`,
		bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	idle, err := store.DigestIdleBinding(ctx, bindingOwnerID)
	if err != nil || idle == nil || idle.Driver != core.DriverClaude || idle.ProviderSession != "session" ||
		idle.Expected.ID != binding.ID || idle.Expected.Session.Runtime == nil || idle.Expected.Session.Runtime.PID != 601 {
		t.Fatalf("idle launch = %+v, %v", idle, err)
	}
	for _, id := range []core.IdentityID{"unknown-identity", bindingOtherID} {
		if got, err := store.DigestIdleBinding(ctx, id); err != nil || got != nil {
			t.Fatalf("unbound or missing identity = %+v, %v", got, err)
		}
	}
	for _, change := range []struct{ field, rejected, restored string }{
		{"driver_state_version", "7", "3"},
		{"provider_session_id", "'different-session'", "'session'"},
		{"driver_state", "json_set(driver_state,'$.activity.state','working')", "json_set(driver_state,'$.activity.state','idle')"},
	} {
		if _, err := store.db.ExecContext(ctx, "UPDATE identity_session_preferences SET "+change.field+"="+change.rejected+" WHERE identity_id=?", bindingOwnerID); err != nil {
			t.Fatal(err)
		}
		if got, err := store.DigestIdleBinding(ctx, bindingOwnerID); err != nil || got != nil {
			t.Fatalf("ineligible %s = %+v, %v", change.field, got, err)
		}
		if _, err := store.db.ExecContext(ctx, "UPDATE identity_session_preferences SET "+change.field+"="+change.restored+" WHERE identity_id=?", bindingOwnerID); err != nil {
			t.Fatal(err)
		}
	}

	claim := core.DigestClaim{IdentityID: bindingOwnerID, ChecklistID: digestTestChecklist, AttemptToken: digestTestToken,
		Opportunity: core.DigestOpportunityTurnBoundary, Kind: core.DigestProjectionFull, NowMs: 12000, Launch: idle}
	if got, err := store.Claim(ctx, claim); err != nil || got == nil {
		t.Fatalf("turn-boundary claim = %+v, %v", got, err)
	}
	settle := core.DigestSettlement{IdentityID: claim.IdentityID, ChecklistID: claim.ChecklistID, AttemptToken: claim.AttemptToken,
		Outcome: core.DigestStateUncertain, NowMs: 12100}
	if changed, err := store.Settle(ctx, settle); err != nil || !changed {
		t.Fatalf("settle continuation = %v, %v", changed, err)
	}
	if got, err := store.DigestIdleBinding(ctx, bindingOwnerID); err != nil || got != nil {
		t.Fatalf("open continuation admitted an idle launch: %+v, %v", got, err)
	}

	end := ports.LaunchEnd{Expected: idle.Expected, Owner: *idle.Expected.Session.LaunchOwner,
		Runtime: *idle.Expected.Session.Runtime, ObservedAtMs: 12200}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		wrong := end
		wrong.Runtime.PID++
		ok, err := tx.Bindings().EndLaunch(wrong)
		requireBindingChange(t, ok, err, false)
		return nil
	})
	var confirmed *uint64
	if err := store.db.QueryRowContext(ctx, "SELECT confirmed_at_ms FROM focus_checklists WHERE id=?", claim.ChecklistID).Scan(&confirmed); err != nil || confirmed != nil {
		t.Fatalf("superseded runtime confirmed continuation: %v, %v", confirmed, err)
	}
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		ok, err := tx.Bindings().EndLaunch(end)
		requireBindingChange(t, ok, err, true)
		return nil
	})
	if err := store.db.QueryRowContext(ctx, "SELECT confirmed_at_ms FROM focus_checklists WHERE id=?", claim.ChecklistID).Scan(&confirmed); err != nil ||
		confirmed == nil || *confirmed != end.ObservedAtMs {
		t.Fatalf("exact launch end did not confirm continuation: %v, %v", confirmed, err)
	}
}
