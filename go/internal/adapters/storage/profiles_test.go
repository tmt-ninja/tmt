package storage

import (
	"errors"
	"reflect"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestProfileRowsNormalizeAndRequireAnActiveIdentity(t *testing.T) {
	store, err := Open(t.Context(), testRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	identity := core.Identity{
		ID: "50ad5982-645d-4e57-b1d1-09f8b81ae28a", Name: "Worker", CanonicalName: "worker", Lifetime: core.LifetimeSaved,
	}
	const nowMs = 1785356400789
	want := core.TextProfile{IdentityID: identity.ID, Content: "\ufefffirst\nsecond", UpdatedAtMs: nowMs}
	if err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		if err := tx.Identities().Insert(identity, nowMs); err != nil {
			return err
		}
		profiles := tx.Profiles()
		// Exactly one leading BOM is removed and line endings are normalized.
		got, err := profiles.Put(core.ProfileRole, identity.ID, "\ufeff\ufefffirst\r\nsecond", nowMs)
		if err != nil || got == nil || *got != want {
			t.Fatalf("put: %+v, %v", got, err)
		}
		if _, err := profiles.Put(core.ProfileRole, identity.ID, " ", nowMs+1); !errors.Is(err, core.ErrProfileEmpty) {
			t.Fatalf("invalid put: %v", err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(t.Context(), func(tx ports.StoreTx) error {
		got, err := tx.Profiles().Get(core.ProfileRole, identity.ID)
		if err != nil || got == nil || *got != want {
			t.Fatalf("get: %+v, %v", got, err)
		}
		list, err := tx.Profiles().List(core.ProfileRole)
		if err != nil || !reflect.DeepEqual(list, []core.TextProfile{want}) {
			t.Fatalf("list: %+v, %v", list, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		member, err := tx.Identities().FindByID(identity.ID)
		if err != nil || member == nil {
			t.Fatalf("active identity: %+v, %v", member, err)
		}
		retired, err := tx.Identities().Retire(*member, nil, false, nowMs+1)
		if err != nil || !retired {
			t.Fatalf("retire: %t, %v", retired, err)
		}
		profiles := tx.Profiles()
		got, err := profiles.Put(core.ProfileRole, identity.ID, "must not replace", nowMs+2)
		if err != nil || got != nil {
			t.Fatalf("retired put: %+v, %v", got, err)
		}
		removed, err := profiles.Remove(core.ProfileRole, identity.ID)
		if err != nil || removed {
			t.Fatalf("retired remove: %t, %v", removed, err)
		}
		got, err = profiles.Get(core.ProfileRole, identity.ID)
		if err != nil || got != nil {
			t.Fatalf("retired get: %+v, %v", got, err)
		}
		list, err := profiles.List(core.ProfileRole)
		if err != nil || len(list) != 0 {
			t.Fatalf("retired list: %+v, %v", list, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var content string
	if err := store.db.QueryRowContext(t.Context(), "SELECT content FROM role_profiles WHERE identity_id = ?", identity.ID).Scan(&content); err != nil || content != want.Content {
		t.Fatalf("durable retired profile: %q, %v", content, err)
	}
}
