//go:build darwin || linux

package sys

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTryLockExclusiveContentionAndClose(t *testing.T) {
	path := filepath.Join(t.TempDir(), "settings.lock")
	open := func() *os.File {
		t.Helper()
		file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = file.Close() })
		return file
	}
	first, second := open(), open()
	if ok, err := TryLockExclusive(first); !ok || err != nil {
		t.Fatalf("first acquisition = %t, %v", ok, err)
	}
	if ok, err := TryLockExclusive(second); ok || err != nil {
		t.Fatalf("contended acquisition = %t, %v", ok, err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	if ok, err := TryLockExclusive(first); ok || err == nil {
		t.Fatalf("closed file acquisition = %t, %v", ok, err)
	}
	if ok, err := TryLockExclusive(second); !ok || err != nil {
		t.Fatalf("acquisition after close = %t, %v", ok, err)
	}
}
