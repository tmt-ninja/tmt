//go:build darwin || linux

package sys

import (
	"io"
	"os"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestStdioReadinessAndTransferPreserveFlags(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reader.Close() })
	t.Cleanup(func() { _ = writer.Close() })
	flags := func(file *os.File) int {
		t.Helper()
		var out int
		if err := controlFile(file, func(fd int) error {
			var err error
			out, err = unix.FcntlInt(uintptr(fd), unix.F_GETFL, 0)
			return err
		}); err != nil {
			t.Fatal(err)
		}
		return out
	}
	// Darwin marks a pipe as written in F_GETFL after its first write.
	// Establish that kernel state with ordinary Go I/O before comparing flags.
	if _, err := writer.WriteString("x"); err != nil {
		t.Fatal(err)
	}
	var initial [1]byte
	if _, err := io.ReadFull(reader, initial[:]); err != nil {
		t.Fatal(err)
	}
	beforeRead, beforeWrite := flags(reader), flags(writer)
	if terminal, err := StdioTerminal(reader); terminal || err != nil {
		t.Fatalf("terminal probe = %t, %v", terminal, err)
	}
	if ready, err := StdioReady(reader, false, 0); ready || err != nil {
		t.Fatalf("empty read readiness = %t, %v", ready, err)
	}
	if ready, err := StdioReady(writer, true, time.Second); !ready || err != nil {
		t.Fatalf("write readiness = %t, %v", ready, err)
	}
	if n, retry, err := StdioWrite(writer, []byte("ok")); n != 2 || retry || err != nil {
		t.Fatalf("write = %d, %t, %v", n, retry, err)
	}
	if ready, err := StdioReady(reader, false, time.Second); !ready || err != nil {
		t.Fatalf("data read readiness = %t, %v", ready, err)
	}
	var buf [2]byte
	if n, retry, err := StdioRead(reader, buf[:]); n != 2 || retry || err != nil || string(buf[:]) != "ok" {
		t.Fatalf("read = %d, %t, %v, bytes %q", n, retry, err, buf[:])
	}
	if afterRead, afterWrite := flags(reader), flags(writer); afterRead != beforeRead || afterWrite != beforeWrite {
		t.Fatalf("stdio flags changed: read %#x -> %#x, write %#x -> %#x", beforeRead, afterRead, beforeWrite, afterWrite)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if ready, err := StdioReady(reader, false, time.Second); !ready || err != nil {
		t.Fatalf("EOF readiness = %t, %v", ready, err)
	}
	if n, retry, err := StdioRead(reader, buf[:]); n != 0 || retry || err != nil {
		t.Fatalf("EOF read = %d, %t, %v", n, retry, err)
	}
}

func TestStdioNonblockingReadSignalsRetry(t *testing.T) {
	fds := make([]int, 2)
	if err := unix.Pipe(fds); err != nil {
		t.Fatal(err)
	}
	defer unix.Close(fds[1])
	if err := unix.SetNonblock(fds[0], true); err != nil {
		_ = unix.Close(fds[0])
		t.Fatal(err)
	}
	reader := os.NewFile(uintptr(fds[0]), "nonblocking fixture")
	defer reader.Close()
	if n, retry, err := StdioRead(reader, make([]byte, 1)); n != 0 || !retry || err != nil {
		t.Fatalf("nonblocking read = %d, %t, %v", n, retry, err)
	}
}
