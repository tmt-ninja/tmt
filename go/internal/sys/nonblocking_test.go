//go:build darwin || linux

package sys

import (
	"errors"
	"os"
	"testing"

	"golang.org/x/sys/unix"
)

func TestNonblockingHandoffRestoresOriginalStatusFlags(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	flags := func() int {
		t.Helper()
		var value int
		if err := controlFile(writer, func(fd int) error {
			var err error
			value, err = unix.FcntlInt(uintptr(fd), unix.F_GETFL, 0)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		return value
	}
	before := flags()
	stopped := errors.New("stop handoff")
	if err := WithNonblockingFile(writer, func() error {
		if current := flags(); current != before|unix.O_NONBLOCK {
			t.Fatalf("temporary status flags = %x, want %x", current, before|unix.O_NONBLOCK)
		}
		return stopped
	}); !errors.Is(err, stopped) || flags() != before {
		t.Fatalf("restored flags = %x, want %x; error %v", flags(), before, err)
	}
}
