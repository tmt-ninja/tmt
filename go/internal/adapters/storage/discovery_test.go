package storage

import (
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

func TestReadDiscoveryLeavesMissingHomeAbsent(t *testing.T) {
	root := testRoot(t)
	page, err := ReadDiscovery(t.Context(), root, "tmux", "/tmp/fixture.sock")
	if err != nil || page.Entries == nil || len(page.Entries) != 0 || page.Truncated {
		t.Fatalf("discovery of missing home = %+v, %v", page, err)
	}
	if _, err := os.Lstat(root.Dir); !os.IsNotExist(err) {
		t.Fatalf("missing home stat = %v", err)
	}
}

func TestReadDiscoveryPreservesOwnershipAndFiltersHostSocket(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	first := publishBindingFixture(t, store, reservationFixture(bindingID1, bindingOwnerID, "%1"))
	old := reservationFixture(bindingID2, bindingOtherID, "%1")
	old.Target.Server.ID = "old-server"
	second := publishBindingFixture(t, store, old)
	root := home.Root{Dir: filepath.Dir(store.path), Database: store.path}
	disk, err := os.ReadFile(root.Database)
	if err != nil {
		t.Fatal(err)
	}
	wal, err := os.ReadFile(root.Database + "-wal")
	if err != nil {
		t.Fatal(err)
	}
	page, err := ReadDiscovery(t.Context(), root, first.Server.Host, first.Server.Socket)
	if err != nil || page.Truncated || len(page.Entries) != 2 {
		t.Fatalf("discovery = %+v, %v", page, err)
	}
	bindings := map[core.IdentityID]DiscoveryEntry{}
	for _, entry := range page.Entries {
		bindings[entry.Identity.ID] = entry
	}
	for _, want := range []struct {
		binding core.Binding
		name    string
	}{{first, "Alice"}, {second, "Bob"}} {
		got := bindings[want.binding.IdentityID]
		if !reflect.DeepEqual(got.Binding, want.binding) || string(got.Identity.Name) != want.name {
			t.Fatalf("discovery entry = %+v, want %s and %+v", got, want.name, want.binding)
		}
	}
	for _, target := range [][2]string{{"herdr", first.Server.Socket}, {first.Server.Host, "/tmp/other.sock"}} {
		page, err := ReadDiscovery(t.Context(), root, target[0], target[1])
		if err != nil || len(page.Entries) != 0 || page.Truncated {
			t.Fatalf("discovery on %v = %+v, %v", target, page, err)
		}
	}
	assertFootprintFile(t, root.Database, disk)
	assertFootprintFile(t, root.Database+"-wal", wal)
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	page, err = ReadDiscovery(t.Context(), root, first.Server.Host, first.Server.Socket)
	if err != nil || page.Truncated || len(page.Entries) != 2 {
		t.Fatalf("discovery without WAL = %+v, %v", page, err)
	}
	for _, suffix := range []string{"-wal", "-shm", "-journal"} {
		if _, err := os.Lstat(root.Database + suffix); !os.IsNotExist(err) {
			t.Fatalf("read-only discovery created %s or could not inspect it: %v", suffix, err)
		}
	}
}

func TestReadDiscoveryAppliesNativeCapAndRequiresCurrentSchema(t *testing.T) {
	parallelStorageFixture(t)
	store := testStorage(t)
	root := home.Root{Dir: filepath.Dir(store.path), Database: store.path}
	ctx := t.Context()
	const socket = "/tmp/fixture.sock"
	if err := store.transact(ctx, false, func(r records) error {
		for n := 0; n <= discoveryEntryLimit+1; n++ {
			id := fmt.Sprintf("f54672ae-5a6f-4d3b-92a6-%012d", n)
			name := fmt.Sprintf("worker-%03d", n)
			identity := core.Identity{ID: core.IdentityID(id), Name: core.Name(name), CanonicalName: name, Lifetime: core.LifetimeSaved}
			if err := r.Identities().Insert(identity, 1000); err != nil {
				return err
			}
			if _, err := r.exec(`INSERT INTO bindings
				(id, identity_id, transport, socket_path, server_id, server_pid, server_start_time,
				 pane_id, pane_pid, bound_at, last_verified_at)
				VALUES (?, ?, 'tmux', ?, 'server', 456, 'server-start', ?, 789, '1000', '1000')`,
				id, id, socket, fmt.Sprintf("%%%03d", n)); err != nil {
				return err
			}
			if n == 0 {
				if _, err := r.exec("UPDATE identities SET retired_at_ms=2000 WHERE id=?", id); err != nil {
					return err
				}
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	page, err := ReadDiscovery(ctx, root, "tmux", socket)
	if err != nil || !page.Truncated || len(page.Entries) != discoveryEntryLimit {
		t.Fatalf("discovery cap: %d entries, truncated %t, error %v", len(page.Entries), page.Truncated, err)
	}
	for n, entry := range page.Entries {
		if want := fmt.Sprintf("%%%03d", n+1); entry.Binding.PaneID != want {
			t.Fatalf("discovery entry %d pane = %s, want %s", n, entry.Binding.PaneID, want)
		}
	}
	if err := store.transact(ctx, false, func(r records) error {
		_, err := r.exec("INSERT INTO _migrations (version, name, applied_at) VALUES (?, 'future', '1000')", SchemaVersion+1)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadDiscovery(ctx, root, "tmux", socket); err == nil {
		t.Fatal("discovery accepted future schema")
	}
}
