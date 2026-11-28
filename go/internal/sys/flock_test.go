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

func TestTryLockSharedAllowsReadersAndExcludesWriter(t *testing.T) {
	path := filepath.Join(t.TempDir(), "clock.lock")
	writer, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()

	var readers []*os.File
	for index := 1; index <= 2; index++ {
		reader, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		defer reader.Close()
		readers = append(readers, reader)
		if ok, err := TryLockShared(reader); !ok || err != nil {
			t.Fatalf("reader %d acquisition = %t, %v", index, ok, err)
		}
		if ok, err := TryLockExclusive(writer); ok || err != nil {
			t.Fatalf("writer while %d readers hold the lock = %t, %v", index, ok, err)
		}
	}
	if err := readers[1].Close(); err != nil {
		t.Fatal(err)
	}
	if ok, err := TryLockExclusive(writer); ok || err != nil {
		t.Fatalf("writer after a reader closes = %t, %v", ok, err)
	}
	if err := readers[0].Close(); err != nil {
		t.Fatal(err)
	}
	if ok, err := TryLockExclusive(writer); !ok || err != nil {
		t.Fatalf("writer after both readers close = %t, %v", ok, err)
	}
	reader, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	if ok, err := TryLockShared(reader); ok || err != nil {
		t.Fatalf("reader while writer holds the lock = %t, %v", ok, err)
	}
}
