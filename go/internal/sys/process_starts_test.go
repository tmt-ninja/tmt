//go:build darwin || linux

package sys

import (
	"context"
	"os"
	"os/exec"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestNativeProcessStartsForLiveStoppedAndGone(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	current := os.Getpid()
	child := exec.CommandContext(ctx, "/bin/sleep", "60")
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_ = child.Process.Kill()
		_ = child.Wait()
	}()
	pid := child.Process.Pid
	if err := child.Process.Signal(unix.SIGSTOP); err != nil {
		t.Fatal(err)
	}
	var status unix.WaitStatus
	if stopped, err := unix.Wait4(pid, &status, unix.WUNTRACED, nil); err != nil || stopped != pid || status.Exited() || status.Signaled() {
		t.Fatalf("owned child did not stop: %d, %v, %v", stopped, status, err)
	}
	items, ok := ReadProcessStarts(ctx, []int{current, pid})
	if !ok || len(items) != 2 || items[0].Seconds == 0 || items[1].Seconds == 0 ||
		items[1].State != 'T' && items[1].State != 't' {
		t.Fatalf("native current/stopped = %+v, %v", items, ok)
	}
	if err := child.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = child.Wait()
	items, ok = ReadProcessStarts(ctx, []int{current, pid})
	if !ok || len(items) != 2 || items[0].Seconds == 0 || items[1].State != 'X' {
		t.Fatalf("native current/gone = %+v, %v", items, ok)
	}
	cancel()
	if items, ok = ReadProcessStarts(ctx, []int{current}); ok || items != nil {
		t.Fatalf("expired observation = %+v, %v", items, ok)
	}
}
