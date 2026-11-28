package tmux

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

type runFunc func(context.Context, ports.ProcessSpec) (ports.Bounded, error)

func (f runFunc) Run(ctx context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
	return f(ctx, spec)
}

func TestDeliverStopsAfterUncertainPasteOrSubmit(t *testing.T) {
	pane := ports.PaneRef{Server: "/tmp/unit-only-socket", PaneID: "%42"}
	unavailable := errors.New("transport unavailable")
	for _, tc := range []struct {
		fail string
		want ports.DeliveryOutcome
		ops  []string
	}{
		{"load-buffer", ports.DeliveryNotStarted, []string{"load-buffer", "delete-buffer"}},
		{"paste-buffer", ports.DeliveryUncertain, []string{"load-buffer", "paste-buffer", "delete-buffer"}},
		{"send-keys", ports.DeliveryUncertain, []string{"load-buffer", "paste-buffer", "send-keys"}},
	} {
		t.Run(tc.fail, func(t *testing.T) {
			var ops []string
			c := Client{Path: "/unit/tmux", Process: runFunc(func(_ context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
				if !slices.Equal(spec.Args[:3], []string{"-u", "-S", pane.Server}) {
					t.Fatalf("unscoped tmux argv: %q", spec.Args)
				}
				op := spec.Args[3]
				ops = append(ops, op)
				if op == "load-buffer" && string(spec.Stdin) != "hello！␛[201~\n" {
					t.Fatalf("paste input = %q", spec.Stdin)
				}
				if op == tc.fail {
					return ports.Bounded{}, unavailable
				}
				return ports.Bounded{}, nil
			})}
			outcome, err := c.Deliver(t.Context(), pane, ports.DeliveryInput{
				Text: "hello!\x1b[201~", Submit: []ports.KeyStep{{Key: "Enter"}, {Key: "Enter"}},
			})
			if outcome != tc.want || !errors.Is(err, unavailable) || !slices.Equal(ops, tc.ops) {
				t.Fatalf("Deliver = %v, %v, operations %v", outcome, err, ops)
			}
		})
	}
}

func TestDeliverPreSubmitDelay(t *testing.T) {
	pane := ports.PaneRef{Server: "/tmp/unit-only-socket", PaneID: "%42"}
	const delay = 10 * time.Millisecond
	for _, cancelAfterPaste := range []bool{false, true} {
		ctx, cancel := context.WithCancel(t.Context())
		var operations []string
		var pasted time.Time
		client := Client{Path: "/unit/tmux", Process: runFunc(func(_ context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
			operation := spec.Args[3]
			operations = append(operations, operation)
			switch operation {
			case "paste-buffer":
				pasted = time.Now()
				if cancelAfterPaste {
					cancel()
				}
			case "send-keys":
				if pasted.IsZero() || time.Since(pasted) < delay {
					t.Fatal("submit key preceded the configured delay after paste")
				}
			}
			return ports.Bounded{}, nil
		})}
		outcome, err := client.Deliver(ctx, pane, ports.DeliveryInput{Text: "hello", BeforeSubmit: delay})
		cancel()
		if cancelAfterPaste {
			if outcome != ports.DeliveryUncertain || !errors.Is(err, context.Canceled) ||
				!slices.Equal(operations, []string{"load-buffer", "paste-buffer"}) {
				t.Fatalf("canceled delivery = %v, %v, operations %v", outcome, err, operations)
			}
		} else if outcome != ports.DeliveryDelivered || err != nil ||
			!slices.Equal(operations, []string{"load-buffer", "paste-buffer", "send-keys"}) {
			t.Fatalf("delayed delivery = %v, %v, operations %v", outcome, err, operations)
		}
	}
}

func TestPrivateSocketCancelBeforeSubmitDoesNotReplay(t *testing.T) {
	server := tmuxtest.Start(t)
	path, err := exec.LookPath("tmux")
	if err != nil {
		t.Fatal(err)
	}
	pane := ports.PaneRef{Server: server.Socket, PaneID: strings.TrimSpace(
		server.Run("display-message", "-p", "-t", "=t:", "#{pane_id}"))}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	pasted := make(chan struct{})
	done := make(chan struct{})
	var operations []string
	var outcome ports.DeliveryOutcome
	var sendErr error
	runner := process.Runner{}
	client := Client{Path: path, Process: runFunc(func(ctx context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
		got, err := runner.Run(ctx, spec)
		op := spec.Args[3]
		operations = append(operations, op)
		if op == "paste-buffer" && err == nil && got.ExitCode == 0 {
			close(pasted)
		}
		return got, err
	})}
	go func() {
		outcome, sendErr = client.Deliver(ctx, pane, ports.DeliveryInput{Text: "do not submit", BeforeSubmit: time.Hour})
		close(done)
	}()
	select {
	case <-pasted:
		cancel()
	case <-done:
		t.Fatalf("paste did not complete: %v, %v", outcome, sendErr)
	case <-time.After(5 * time.Second):
		t.Fatal("private paste did not complete within the test budget")
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("canceled delivery did not return within the test budget")
	}
	if outcome != ports.DeliveryUncertain || !errors.Is(sendErr, context.Canceled) ||
		!slices.Equal(operations, []string{"load-buffer", "paste-buffer"}) {
		t.Fatalf("canceled private delivery = %v, %v, operations %v", outcome, sendErr, operations)
	}
}

func TestPrivateSocketLaunchCaptureAndDeliver(t *testing.T) {
	server := tmuxtest.Start(t)
	path, err := exec.LookPath("tmux")
	if err != nil {
		t.Fatal(err)
	}
	c := Client{Path: path, Process: process.Runner{}}
	root := t.TempDir()
	dir := filepath.Join(root, "quoted ' \\ \t name")
	if err := os.Mkdir(dir, 0700); err != nil {
		t.Fatal(err)
	}
	physicalDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		t.Fatal(err)
	}
	artifact := filepath.Join(dir, "received")
	// Read two lines: the message from the literal paste, then a literal
	// submit step ended by Enter. Record them separately with echo disabled.
	command := ports.ProcessSpec{
		Path: "/bin/sh",
		Args: []string{"-c", `/bin/stty -echo; printf 'ready\n'; IFS= read -r first; IFS= read -r second; printf '%s|%s|%s|%s\n' "$first" "$second" "$LAUNCH_VALUE" "$TMUX_PANE" > "$1"; exec /bin/sleep 30`, "fixture", artifact},
		Env:  []string{"LAUNCH_VALUE=quote ' ; $(unexpected);", "TMUX_PANE=wrong"},
	}
	if _, err := c.Launch(t.Context(), ports.LaunchSpec{
		Server: server.Socket, Session: "missing", Command: command,
	}); err == nil {
		t.Fatal("launch succeeded with an absent exact session")
	}
	pane, err := c.Launch(t.Context(), ports.LaunchSpec{
		Server: server.Socket, Session: "t", Window: "fixture", Dir: dir, Command: command,
	})
	if err != nil {
		t.Fatal(err)
	}
	await(t, func(ctx context.Context) bool {
		screen, err := c.Capture(ctx, pane, ports.CaptureOpts{Escape: true})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(screen.Text, "ready") {
			return false
		}
		if screen.Pane != pane || screen.Lines <= 0 || screen.Cols != 120 {
			t.Fatalf("fixture screen geometry: %+v", screen)
		}
		// Launch can return before the child changes directory or execs.
		// The fixture prints readiness after the shell starts in its cwd.
		panes, err := c.Panes(ctx, server.Socket)
		if err != nil {
			t.Fatal(err)
		}
		index := slices.IndexFunc(panes, func(item ports.PaneEvidence) bool { return item.Pane == pane })
		if index == -1 {
			t.Fatalf("launch pane %v not found in evidence: %+v", pane, panes)
		}
		got := panes[index]
		if got.Session != "t" || got.Window != "1" || got.PID <= 0 ||
			got.CurrentDir != physicalDir || !got.Active ||
			!slices.Contains([]string{"sh", "dash", "bash"}, got.Command) {
			t.Fatalf("launch evidence after fixture readiness: %+v", got)
		}
		return true
	})
	if outcome, err := c.Deliver(t.Context(), pane, ports.DeliveryInput{
		Text: "literal '! $HOME", Submit: []ports.KeyStep{{Literal: ";"}, {Key: "Enter"}},
	}); err != nil || outcome != ports.DeliveryDelivered {
		t.Fatalf("Deliver = %v, %v", outcome, err)
	}
	await(t, func(context.Context) bool {
		got, err := os.ReadFile(artifact)
		return err == nil && string(got) == "literal '！ $HOME|;|quote ' ; $(unexpected);|"+pane.PaneID+"\n"
	})
	server.Run("new-session", "-d", "-s", "linked")
	server.Run("link-window", "-s", "=t:fixture", "-t", "=linked:1")
	linked, err := c.Panes(t.Context(), server.Socket)
	if err != nil {
		t.Fatal(err)
	}
	if len(linked) != 3 {
		t.Fatalf("linked pane counted more than once: %+v", linked)
	}
}

func await(t *testing.T, ready func(context.Context) bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for !ready(ctx) {
		select {
		case <-tick.C:
		case <-ctx.Done():
			t.Fatal("private tmux fixture did not reach readiness")
		}
	}
}
