package storage

import (
	"errors"
	"fmt"
	"reflect"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestMetadataApplyConflictIsAtomicAndFiltersAreConjunctive(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	ctx := t.Context()
	active, other := bindingOwnerID, bindingOtherID
	ok, busy, red, blue := "ready", "Busy", "red", "blue"
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		r := tx.Identities()
		first, err := r.ApplyMetadata(active, []core.MetadataChange{{Key: "state", Value: &ok}, {Key: "group", Value: &red}})
		if err != nil || !first.Changed {
			t.Fatalf("initial metadata: %+v %v", first, err)
		}
		second, err := r.ApplyMetadata(other, []core.MetadataChange{{Key: "state", Value: &busy}, {Key: "group", Value: &red}})
		if err != nil || !second.Changed {
			t.Fatalf("other metadata: %+v %v", second, err)
		}
		conflict, err := r.ApplyMetadata(active, []core.MetadataChange{
			{Key: "state", Expect: core.MetadataExpectation{Mode: core.MetadataAbsent}, Value: &busy},
			{Key: "new", Expect: core.MetadataExpectation{Mode: core.MetadataExact, Value: ok}, Value: &busy},
			{Key: "group", Value: &blue},
		})
		if err != nil || conflict.Changed || !reflect.DeepEqual(conflict.Conflicts, map[string]*string{"state": &ok, "new": nil}) {
			t.Fatalf("conflicts: %+v %v", conflict, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx ports.StoreTx) error {
		r := tx.Identities()
		current, err := r.ReadMetadata(active)
		if err != nil || !reflect.DeepEqual(current, map[string]string{"state": ok, "group": red}) {
			t.Fatalf("conflict changed rows: %v %v", current, err)
		}
		matches, err := r.ListMatchingMetadata([]core.MetadataFilter{{Key: "group", Value: &red}, {Key: "state"}, {Key: "state", Value: &busy}})
		if err != nil || len(matches) != 1 || matches[0].ID != other {
			t.Fatalf("combined filters: %+v %v", matches, err)
		}
		lower := "busy"
		matches, err = r.ListMatchingMetadata([]core.MetadataFilter{{Key: "state", Value: &lower}})
		if err != nil || len(matches) != 0 {
			t.Fatalf("filter folded case: %+v %v", matches, err)
		}
		matches, err = r.ListMatchingMetadata([]core.MetadataFilter{{Key: "group", Value: &red}, {Key: "group", Value: &blue}})
		if err != nil || len(matches) != 0 {
			t.Fatalf("repeated key became OR: %+v %v", matches, err)
		}
		matches, err = r.ListMatchingMetadata([]core.MetadataFilter{{Key: "group", Value: &red}})
		if err != nil || len(matches) != 2 || matches[0].CanonicalName >= matches[1].CanonicalName {
			t.Fatalf("canonical order: %+v %v", matches, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestMetadataApplyCapAndFailedMutationRollBack(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	ctx := t.Context()
	id := bindingOwnerID
	value := "fixture"
	batch := make([]core.MetadataChange, core.MaxMetadataEntries)
	for i := range batch {
		batch[i] = core.MetadataChange{Key: fmt.Sprintf("key.%02d", i), Value: &value}
	}
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		_, err := tx.Identities().ApplyMetadata(id, batch)
		return err
	}); err != nil {
		t.Fatal(err)
	}

	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		r := tx.Identities()
		if got, err := r.ApplyMetadata(id, []core.MetadataChange{{Key: "overflow", Value: &value}, {Key: "key.00", Value: &value}}); got.Changed || !errors.Is(err, core.ErrMetadataEntryLimit) {
			t.Fatalf("entry cap: %+v %v", got, err)
		}
		if got, err := r.ApplyMetadata(id, []core.MetadataChange{{Key: "replacement", Value: &value}, {Key: "key.00", Value: nil}}); err != nil || !got.Changed {
			t.Fatalf("atomic add/removal at cap: %+v %v", got, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `CREATE TRIGGER reject_metadata_test BEFORE UPDATE ON identity_metadata
		WHEN NEW.key='key.02' BEGIN SELECT RAISE(ABORT,'fixture error'); END`); err != nil {
		t.Fatal(err)
	}
	changed := "not committed"
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		_, err := tx.Identities().ApplyMetadata(id, []core.MetadataChange{{Key: "key.01", Value: &changed}, {Key: "key.02", Value: &changed}})
		return err
	}); err == nil {
		t.Fatal("failed batch committed")
	}
	if err := store.Read(ctx, func(tx ports.StoreTx) error {
		metadata, err := tx.Identities().ReadMetadata(id)
		if err != nil || len(metadata) != core.MaxMetadataEntries || metadata["key.00"] != "" ||
			metadata["overflow"] != "" || metadata["replacement"] != value || metadata["key.01"] != value || metadata["key.02"] != value {
			t.Fatalf("final metadata: %v %v", metadata, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestIdentityStatusRetainsStaleEvidenceAndSeparatesRetirement(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	ctx := t.Context()
	id := bindingOwnerID
	mood := "steady"
	status, err := core.NewIdentityStatus("Reading Go source", &mood, 10000, 1000)
	if err != nil || !status.Stale(9999) || status.Stale(10000) || !status.Stale(11000) {
		t.Fatalf("status time boundaries: %+v %v", status, err)
	}
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		r := tx.Identities()
		if absent, err := r.ReadStatus(id); err != nil || absent != nil {
			t.Fatalf("absent status: %+v %v", absent, err)
		}
		if meta, err := r.ReadMetadata(id); err != nil || meta == nil || len(meta) != 0 {
			t.Fatalf("absent metadata: %v %v", meta, err)
		}
		return r.PutStatus(id, status)
	}); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := store.Read(ctx, func(tx ports.StoreTx) error {
			got, err := tx.Identities().ReadStatus(id)
			if err != nil || !reflect.DeepEqual(got, &status) || !got.Stale(11000) {
				t.Fatalf("stale status: %+v %v", got, err)
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		r := tx.Identities()
		removed, err := r.RemoveStatus(id)
		if err != nil || !removed {
			t.Fatalf("status removal: %t %v", removed, err)
		}
		removed, err = r.RemoveStatus(id)
		if err != nil || removed {
			t.Fatalf("absent removal: %t %v", removed, err)
		}
		return r.PutStatus(id, status)
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE identities SET retired_at_ms=13000 WHERE id=?", id); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		r := tx.Identities()
		retired, err := r.IsRetired(id)
		if err != nil || !retired {
			t.Fatalf("exact retired UUID: %t %v", retired, err)
		}
		if active, err := r.FindByID(id); err != nil || active != nil {
			t.Fatalf("retired in active lookup: %+v %v", active, err)
		}
		if got, err := r.IsRetired("missing"); err != nil || got {
			t.Fatalf("missing is not retired: %t %v", got, err)
		}
		if _, err := r.ReadStatus(id); !errors.Is(err, core.ErrIdentityInactive) {
			t.Fatalf("status for retired: %v", err)
		}
		if err := r.PutStatus(id, status); !errors.Is(err, core.ErrIdentityInactive) {
			t.Fatalf("write for retired: %v", err)
		}
		if _, err := r.RemoveStatus(id); !errors.Is(err, core.ErrIdentityInactive) {
			t.Fatalf("clear for retired: %v", err)
		}
		if _, err := r.ReadMetadata(id); !errors.Is(err, core.ErrIdentityInactive) {
			t.Fatalf("metadata for retired: %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestMetadataAndStatusRejectInvalidInputsBeforeWriting(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	ctx := t.Context()
	id := bindingOwnerID
	valid := "value"
	invalid := "contains\x00control"
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		r := tx.Identities()
		for _, test := range []struct {
			changes []core.MetadataChange
			want    error
		}{
			{[]core.MetadataChange{{Key: "Upper", Value: &valid}}, core.ErrMetadataKey},
			{[]core.MetadataChange{{Key: "lower", Value: &invalid}}, core.ErrMetadataValue},
			{[]core.MetadataChange{{Key: "same", Value: &valid}, {Key: "same"}}, core.ErrMetadataChanges},
			{[]core.MetadataChange{{Key: "lower", Expect: core.MetadataExpectation{Mode: 255}, Value: &valid}}, core.ErrMetadataChanges},
		} {
			if result, err := r.ApplyMetadata(id, test.changes); result.Changed || !errors.Is(err, test.want) {
				t.Fatalf("invalid metadata: %+v %v", result, err)
			}
		}
		if err := r.PutStatus(id, core.IdentityStatus{Activity: "working", Mood: &invalid, UpdatedAtMs: 10000, ExpiresAtMs: 11000}); !errors.Is(err, core.ErrStatusMood) {
			t.Fatalf("invalid mood = %v", err)
		}
		if err := r.PutStatus(id, core.IdentityStatus{Activity: "working", UpdatedAtMs: 10000, ExpiresAtMs: 10999}); !errors.Is(err, core.ErrStatusClock) {
			t.Fatalf("invalid ttl = %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"identity_metadata", "identity_status"} {
		if got := snapshotRequestTestTable(t, store.db, table); len(got) != 0 {
			t.Fatalf("invalid input wrote %s: %v", table, got)
		}
	}
}
