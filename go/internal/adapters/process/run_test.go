package process

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func shell(script string) ports.ProcessSpec {
	return ports.ProcessSpec{
		Path: "/bin/sh", Args: []string{"-c", script}, Timeout: 30 * time.Second, MaxOut: 64,
	}
}

func TestRunReturnsLiteralBytesAndCompletedStatus(t *testing.T) {
	spec := shell("umask 077; /bin/cat; printf diagnostic >&2; exit 7")
	spec.Stdin = []byte{0, 'a', 255}
	got, err := (Runner{}).Run(t.Context(), spec)
	if err != nil || got.ExitCode != 7 || !bytes.Equal(got.Stdout, spec.Stdin) || string(got.Stderr) != "diagnostic" {
		t.Fatalf("Run = %+v, %v", got, err)
	}
}

func TestRunChildEnvironment(t *testing.T) {
	t.Setenv("TMT_GO_PROCESS_TEST", "parent")
	spec := shell(`printf '%s|%s' "$TMT_GO_PROCESS_TEST" "$1"`)
	spec.Args = append(spec.Args, "label", "literal ' quote")
	spec.Env = []string{"TMT_GO_PROCESS_TEST=child"}
	got, err := (Runner{}).Run(t.Context(), spec)
	if err != nil || string(got.Stdout) != "child|literal ' quote" || os.Getenv("TMT_GO_PROCESS_TEST") != "parent" {
		t.Fatalf("Run = %+v, %v", got, err)
	}
	spec.Env = nil
	got, err = (Runner{}).Run(t.Context(), spec)
	if err != nil || string(got.Stdout) != "|literal ' quote" {
		t.Fatalf("Run with empty environment = %+v, %v", got, err)
	}
}

func TestRunCapsEachStream(t *testing.T) {
	spec := shell("printf 1234; printf 5678 >&2")
	spec.MaxOut = 4
	got, err := (Runner{}).Run(t.Context(), spec)
	if err != nil || string(got.Stdout) != "1234" || string(got.Stderr) != "5678" {
		t.Fatalf("exact caps: Run = %+v, %v", got, err)
	}
	for _, tc := range []struct {
		name   string
		script string
		stream string
	}{
		{"stdout", "printf note >&2; printf 12345", "stdout"},
		{"stderr", "printf note; printf 12345 >&2", "stderr"},
		{"unbounded stderr", "exec /usr/bin/yes >&2", "stderr"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			spec.Args[1] = tc.script
			got, err := (Runner{}).Run(t.Context(), spec)
			// Rust's OutputLimit returns the failed stream and no completed
			// output on either stream, even when the other stayed in bounds.
			want := tc.stream + ": " + ErrOutputLimit.Error()
			if !errors.Is(err, ErrOutputLimit) || err.Error() != want {
				t.Fatalf("Run error = %v, want %s", err, want)
			}
			if !got.Truncated || got.Stdout != nil || got.Stderr != nil {
				t.Fatalf("Run returned a partial capture: %+v", got)
			}
		})
	}
	spec.MaxOut = 0
	spec.Args[1] = ":"
	if got, err := (Runner{}).Run(t.Context(), spec); err != nil || got.ExitCode != 0 {
		t.Fatalf("zero cap on empty streams: Run = %+v, %v", got, err)
	}
}

func TestRunMovesInputAndBothOutputsConcurrently(t *testing.T) {
	const size = 256 * 1024
	spec := shell("/usr/bin/head -c 262144 /dev/zero; /usr/bin/head -c 262144 /dev/zero >&2; /bin/cat")
	spec.Stdin = bytes.Repeat([]byte{'i'}, size)
	spec.MaxOut = 2 * size
	got, err := (Runner{}).Run(t.Context(), spec)
	if err != nil || got.ExitCode != 0 || len(got.Stdout) != 2*size || len(got.Stderr) != size ||
		!bytes.Equal(got.Stdout[size:], spec.Stdin) {
		t.Fatalf("Run returned %d stdout bytes, %d stderr bytes, exit %d, %v", len(got.Stdout), len(got.Stderr), got.ExitCode, err)
	}
}

func TestRunDeadlineCoversWaitAndOpenDescendantPipes(t *testing.T) {
	for _, script := range []string{
		"echo ready > marker; exec 1>&- 2>&-; exec /bin/sleep 30",
		"echo ready > marker; /bin/sleep 30 & exit 0",
	} {
		spec := shell(script)
		spec.Dir = t.TempDir()
		spec.Timeout = time.Second
		got, err := (Runner{}).Run(t.Context(), spec)
		if err != context.DeadlineExceeded || len(got.Stdout)+len(got.Stderr) != 0 {
			t.Fatalf("%q: Run = %+v, %v", script, got, err)
		}
		if data, err := os.ReadFile(filepath.Join(spec.Dir, "marker")); err != nil || string(data) != "ready\n" {
			t.Fatalf("%q: child readiness = %q, %v", script, data, err)
		}
	}
}

func TestRunCanceledBeforeStart(t *testing.T) {
	spec := shell("echo started > marker")
	spec.Dir = t.TempDir()
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := (Runner{}).Run(ctx, spec); !errors.Is(err, context.Canceled) {
		t.Fatalf("Run returned %v", err)
	}
	if _, err := os.Stat(filepath.Join(spec.Dir, "marker")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("child marker stat returned %v", err)
	}
}
