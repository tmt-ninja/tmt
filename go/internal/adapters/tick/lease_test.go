package tick

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

func TestStatusAndExclusiveLease(t *testing.T) {
	root := home.Root{Dir: filepath.Join(t.TempDir(), "home")}
	const start = 100_000
	checkStatus(t, root, start, "stopped")
	if _, err := os.Stat(root.Dir); !os.IsNotExist(err) {
		t.Fatalf("status created state: %v", err)
	}

	lease, err := Acquire(root, "once", "test", nil, start)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = lease.Close() })
	current := checkStatus(t, root, start+1, "running")
	if current.Holder == nil || current.Holder.StartedAtMs != start || current.Holder.ExpiresAtMs != start+leaseMillis {
		t.Fatalf("clock holder = %+v", current.Holder)
	}
	checkStatus(t, root, start+leaseMillis, "unconfirmed")
	if other, err := Acquire(root, "run", "test", nil, start+leaseMillis); other != nil || err == nil {
		t.Fatalf("expired holder was preempted: %v, %v", other, err)
	} else {
		var busy *BusyError
		if !errors.As(err, &busy) || busy.Status.State != "unconfirmed" {
			t.Fatalf("contending clock = %v", err)
		}
	}

	if err := lease.Renew(start + leaseMillis); err != nil {
		t.Fatal(err)
	}
	renewed := checkStatus(t, root, start+leaseMillis, "running")
	if renewed.Holder.Token != current.Holder.Token || renewed.Holder.HeartbeatAtMs != start+leaseMillis {
		t.Fatalf("renew changed ownership: %+v", renewed.Holder)
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
	if stopped := checkStatus(t, root, start+leaseMillis+1, "stopped"); stopped.Holder != nil {
		t.Fatalf("close left holder = %+v", stopped.Holder)
	}
}

func TestStatusKeepsStaleEvidenceAndRejectsFutureHolder(t *testing.T) {
	root := home.Root{Dir: t.TempDir()}
	const start = 100_000
	lease, err := Acquire(root, "run", "test", nil, start)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a process exit that releases the kernel lock before the
	// advisory metadata is cleaned up.
	if err := errors.Join(lease.lock.Close(), lease.dir.close()); err != nil {
		t.Fatal(err)
	}
	reader, err := os.Open(filepath.Join(root.Dir, dirName, lockName))
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	if acquired, err := sys.TryLockShared(reader); err != nil || !acquired {
		t.Fatalf("shared observer lock = %t, %v", acquired, err)
	}
	stale := checkStatus(t, root, start+1, "stale")
	if err := reader.Close(); err != nil {
		t.Fatal(err)
	}
	if stale.Holder == nil || stale.Holder.Token != lease.holder.Token {
		t.Fatalf("stale evidence = %+v", stale.Holder)
	}

	record := filepath.Join(root.Dir, dirName, recordName)
	future := []byte(`{"schemaVersion":2}`)
	if err := os.WriteFile(record, future, 0600); err != nil {
		t.Fatal(err)
	}
	if next, err := Acquire(root, "once", "test", nil, start+2); next != nil || !errors.Is(err, ErrInvalid) {
		t.Fatalf("unknown holder = %v, %v", next, err)
	}
	if got, err := os.ReadFile(record); err != nil || string(got) != string(future) {
		t.Fatalf("invalid holder was overwritten: %q, %v", got, err)
	}
}

func checkStatus(t *testing.T, root home.Root, now uint64, state string) ClockStatus {
	t.Helper()
	status, err := Status(root, now)
	if err != nil || status.SchemaVersion != 1 || status.State != state {
		t.Fatalf("clock status = %+v, %v; want %s", status, err, state)
	}
	return status
}

func TestLeaseRefusesClockRecordSymlink(t *testing.T) {
	root := home.Root{Dir: t.TempDir()}
	lease, err := Acquire(root, "once", "test", nil, 100_000)
	if err != nil {
		t.Fatal(err)
	}
	if err := lease.Close(); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "holder.json")
	const content = "outside clock data"
	if err := os.WriteFile(outside, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root.Dir, dirName, recordName)); err != nil {
		t.Fatal(err)
	}
	if _, err := Status(root, 100_001); err == nil {
		t.Fatal("status accepted a symbolic clock record")
	}
	if next, err := Acquire(root, "once", "test", nil, 100_001); next != nil || err == nil {
		t.Fatalf("acquire accepted a symbolic clock record: %v, %v", next, err)
	}
	if got, err := os.ReadFile(outside); err != nil || string(got) != content {
		t.Fatalf("outside holder changed: %q, %v", got, err)
	}
}
