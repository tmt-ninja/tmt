//go:build darwin || linux

package sys

import (
	"io/fs"
	"os"
	"syscall"
	"testing"
)

type statFileInfo struct {
	fs.FileInfo
	stat any
}

func (f statFileInfo) Sys() any { return f.stat }

func TestFileOwnedByEffectiveUser(t *testing.T) {
	info, err := os.Lstat(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if !FileOwnedByEffectiveUser(info) {
		t.Fatal("the test directory does not match the effective user")
	}
	for _, unknown := range []fs.FileInfo{
		nil,
		statFileInfo{stat: nil},
		statFileInfo{stat: (*syscall.Stat_t)(nil)},
		statFileInfo{stat: &syscall.Stat_t{Uid: uint32(os.Geteuid()) ^ 1}},
	} {
		if FileOwnedByEffectiveUser(unknown) {
			t.Fatalf("admitted absent or foreign ownership for %T", unknown)
		}
	}
}
