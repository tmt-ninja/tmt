package storage

import (
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func handOverDigestContinuation(t *testing.T, store *Storage, id core.DigestChecklistID, token core.DigestAttemptToken, state core.DigestState) {
	t.Helper()
	if _, err := store.db.ExecContext(t.Context(), `INSERT INTO focus_checklists
		(id,identity_id,attempt_token,through_sequence,state,created_at_ms,opportunity,sealed_count,settled_at_ms)
		VALUES (?,?,?,1,?,1000,'turn_boundary',1,1000)`, id, bindingOwnerID, token, state); err != nil {
		t.Fatal(err)
	}
}

func assertDigestContinuation(t *testing.T, store *Storage, wantOpen bool) {
	t.Helper()
	var open bool
	if err := store.db.QueryRowContext(t.Context(),
		"SELECT EXISTS(SELECT 1 FROM focus_checklists WHERE "+openDigestContinuation+")", bindingOwnerID).
		Scan(&open); err != nil || open != wantOpen {
		t.Fatalf("open Stop continuation = %t, %v, want %t", open, err, wantOpen)
	}
}

func currentDigestBinding(t *testing.T, store *Storage) core.Binding {
	t.Helper()
	var binding *core.Binding
	err := store.Read(t.Context(), func(tx ports.StoreTx) error {
		var err error
		binding, err = tx.Bindings().FindByIdentity(bindingOwnerID)
		return err
	})
	if err != nil || binding == nil {
		t.Fatalf("current binding = %+v, %v", binding, err)
	}
	return *binding
}

// Ports the replacement and detach assertions of the native
// a_stop_continuation_ends_with_the_provider_run_that_started_it.
func TestDigestContinuationEndsWithBindingReplacementOrDetach(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	binding := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	if _, err := store.db.ExecContext(t.Context(), `UPDATE bindings SET runtime_state='running',last_transition='started',
		runtime_pid=500,runtime_start_identity='start-a',observed_provider_session_id='session-a'
		WHERE id=?`, binding.ID); err != nil {
		t.Fatal(err)
	}
	binding = currentDigestBinding(t, store)
	handOverDigestContinuation(t, store, digestTestChecklist, digestTestToken, core.DigestStateDelivered)
	assertDigestContinuation(t, store, true)

	reservation := reservationFixture(bindingID2, bindingOwnerID, "%2")
	reservation.OldBindingID = &binding.ID
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		ok, err := tx.Bindings().Reserve(reservation, &binding)
		requireBindingChange(t, ok, err, true)
		ok, err = tx.Bindings().Detach(binding, 2050)
		requireBindingChange(t, ok, err, false)
		return nil
	})
	assertDigestContinuation(t, store, true)
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		replacement, err := tx.Bindings().Activate(reservation, &binding, 2100)
		if err != nil || replacement == nil || replacement.ID != bindingID2 {
			t.Fatalf("binding replacement = %+v, %v", replacement, err)
		}
		binding = *replacement
		return nil
	})
	assertDigestContinuation(t, store, false)

	handOverDigestContinuation(t, store, digestTestNext, digestTestNextToken, core.DigestStateDelivered)
	assertDigestContinuation(t, store, true)
	writeBindingTest(t, store, func(tx ports.StoreTx) error {
		ok, err := tx.Bindings().Detach(binding, 2200)
		requireBindingChange(t, ok, err, true)
		return nil
	})
	assertDigestContinuation(t, store, false)
	for _, test := range []struct {
		id        core.DigestChecklistID
		confirmed uint64
	}{
		{digestTestChecklist, 2100},
		{digestTestNext, 2200},
	} {
		var actual uint64
		if err := store.db.QueryRowContext(t.Context(), "SELECT confirmed_at_ms FROM focus_checklists WHERE id=?", test.id).
			Scan(&actual); err != nil || actual != test.confirmed {
			t.Fatalf("continuation %s confirmation = %d, %v", test.id, actual, err)
		}
	}
}
