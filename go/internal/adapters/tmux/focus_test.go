//go:build darwin || linux

package tmux

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	goruntime "runtime"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

const focusFixture = "TMT_TEST_PRIVATE_FOCUS"

func TestPrivateFocusAndSwapExactInvokingClient(t *testing.T) {
	server := tmuxtest.Start(t)
	script, err := exec.LookPath("script")
	if err != nil {
		t.Skip("script is required to provide an isolated terminal client")
	}
	tmuxPath, err := exec.LookPath("tmux")
	if err != nil {
		t.Fatal(err)
	}
	testPath, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	result := filepath.Join(t.TempDir(), "focus-result")
	caller := strings.TrimSpace(server.Run("display-message", "-p", "-t", "=t:", "#{pane_id}"))
	neighbour := strings.TrimSpace(server.Run("split-window", "-h", "-d", "-P", "-F", "#{pane_id}", "-t", caller))
	target := strings.TrimSpace(server.Run("new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "=t:"))
	serverPID := strings.TrimSpace(server.Run("display-message", "-p", "-t", caller, "#{pid}"))

	// The program inside the invoking pane proves its own ancestry, then
	// waits for the second, tmux-attached fixture process to appear.
	args := []string{testPath, "-test.run=^TestPrivateFocusHelper$"}
	env := []string{focusFixture + "=1", "TMT_FOCUS_SOCKET=" + server.Socket,
		"TMT_FOCUS_TMUX=" + tmuxPath, "TMT_FOCUS_PID=" + serverPID, "TMT_FOCUS_CALLER=" + caller,
		"TMT_FOCUS_NEIGHBOUR=" + neighbour, "TMT_FOCUS_TARGET=" + target, "TMT_FOCUS_RESULT=" + result}
	childWords := []string{"env"}
	for _, value := range append(env, args...) {
		childWords = append(childWords, fixtureShellWord(value))
	}
	server.Run("respawn-pane", "-k", "-t", caller, strings.Join(childWords, " "))

	ctx, cancel := context.WithTimeout(t.Context(), 18*time.Second)
	defer cancel()
	clientArgs := []string{tmuxPath, "-u", "-S", server.Socket, "attach-session", "-t", "=t:"}
	var client *exec.Cmd
	if goruntime.GOOS == "darwin" {
		client = exec.CommandContext(ctx, script, append([]string{"-q", "/dev/null"}, clientArgs...)...)
	} else {
		for i, arg := range clientArgs {
			clientArgs[i] = fixtureShellWord(arg)
		}
		client = exec.CommandContext(ctx, script, "-q", "-c", strings.Join(clientArgs, " "), "/dev/null")
	}
	client.Env = append(tmuxtest.Env(), "TERM=xterm-256color")
	input, err := client.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer input.Close()
	client.Stdout, client.Stderr = io.Discard, io.Discard
	if err := client.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cancel()
		_ = client.Wait()
	}()

	timer := time.NewTicker(25 * time.Millisecond)
	defer timer.Stop()
	for {
		got, err := os.ReadFile(result)
		if err == nil {
			if string(got) != "ok" {
				t.Fatal(string(got))
			}
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("focus helper did not finish: %s", server.Run("capture-pane", "-p", "-t", caller))
		case <-timer.C:
		}
	}
}

func TestPrivateFocusHelper(t *testing.T) {
	if os.Getenv(focusFixture) != "1" {
		return
	}
	socket := os.Getenv("TMT_FOCUS_SOCKET")
	if !filepath.IsAbs(socket) || filepath.Base(socket) != "s" ||
		!strings.HasPrefix(filepath.Base(filepath.Dir(socket)), "tmtgo-tmux-") ||
		filepath.Clean(socket) == filepath.Clean(tmuxtest.HostDefaultSocket()) {
		t.Fatal("focus fixture requires its private tmuxtest socket")
	}
	result := os.Getenv("TMT_FOCUS_RESULT")
	run := func() error {
		pid, err := strconv.ParseUint(os.Getenv("TMT_FOCUS_PID"), 10, 31)
		if err != nil {
			return err
		}
		c := Client{Path: os.Getenv("TMT_FOCUS_TMUX"), Process: process.Runner{}}
		claim := TmuxCaller{Socket: socket, ServerPID: pid, PaneID: os.Getenv("TMT_FOCUS_CALLER")}
		want, neighbour := os.Getenv("TMT_FOCUS_TARGET"), os.Getenv("TMT_FOCUS_NEIGHBOUR")
		ctx, cancel := context.WithTimeout(t.Context(), 12*time.Second)
		defer cancel()
		var client ClientView
		tick := time.NewTicker(30 * time.Millisecond)
		defer tick.Stop()
		for {
			client, err = c.InvokerClient(ctx, claim)
			if err == nil {
				break
			}
			select {
			case <-ctx.Done():
				return fmt.Errorf("invoker proof: %w", err)
			case <-tick.C:
			}
		}
		keyJob := TmuxCaller{Socket: claim.Socket, ServerPID: claim.ServerPID, SessionID: client.SessionID}
		if view, err := c.InvokerClient(ctx, keyJob); err != nil || view != client {
			return fmt.Errorf("pane-less key job = %+v, %v", view, err)
		}
		readPane := func(id string) (PaneSnapshot, error) {
			panes, err := c.Discover(ctx, claim.Socket, id)
			if err != nil || len(panes.Candidates) != 1 {
				return PaneSnapshot{}, fmt.Errorf("pane %s: %v", id, err)
			}
			return panes.Candidates[0], nil
		}
		target, err := readPane(want)
		if err != nil {
			return err
		}
		stale := target
		stale.Process.StartIdentity = "ps-v1:Sat Jan 1 00:00:00 2000"
		if _, err := c.FocusPane(ctx, claim, client, stale); !errors.Is(err, ErrFocusChanged) {
			return fmt.Errorf("stale focus = %v", err)
		}
		beside, err := readPane(neighbour)
		if err != nil {
			return err
		}
		var mutations []string
		runner := c.Process
		c.Process = runFunc(func(ctx context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
			if spec.Path == c.Path {
				for _, arg := range spec.Args[3:] {
					if strings.HasPrefix(arg, "swap-pane") || strings.HasPrefix(arg, "select-") ||
						strings.HasPrefix(arg, "switch-client") || strings.HasPrefix(arg, "kill-") {
						mutations = append(mutations, arg)
					}
				}
			}
			return runner.Run(ctx, spec)
		})
		after, err := c.SwapInto(ctx, claim, client, target, SwapRight)
		if err != nil || after != (SwapResult{View: client, Target: want, Neighbour: neighbour}) {
			return fmt.Errorf("swap did not report its exact participating panes: %+v, %v", after, err)
		}
		exactSwap := "swap-pane -d -s " + want + " -t " + neighbour
		if len(mutations) != 1 || mutations[0] != exactSwap {
			return fmt.Errorf("swap actions = %v, want %q", mutations, exactSwap)
		}
		swapped, err := readPane(neighbour)
		if err != nil || swapped.WindowID != target.WindowID || swapped.PaneIndex != target.PaneIndex {
			return fmt.Errorf("neighbour did not move to expected location: %+v, %v", swapped, err)
		}
		moved, err := readPane(want)
		if err != nil || moved.WindowID != beside.WindowID || moved.PaneIndex != beside.PaneIndex {
			return fmt.Errorf("target did not move to expected location: %+v, %v", moved, err)
		}
		already, err := c.SwapInto(ctx, claim, client, moved, SwapRight)
		if err != nil || already != (SwapResult{View: client, Target: want, Neighbour: want, Already: true}) ||
			len(mutations) != 1 {
			return fmt.Errorf("already beside = %+v, %v; swap actions = %v", already, err, mutations)
		}
		unchanged, err := readPane(want)
		if err != nil || !samePaneSnapshot(unchanged, moved) || unchanged.PaneIndex != moved.PaneIndex {
			return fmt.Errorf("already-beside changed the target: %+v, %v", unchanged, err)
		}
		view, err := c.FocusPane(ctx, claim, client, swapped)
		if err != nil || view.PaneID != neighbour || view.Process != client.Process {
			return fmt.Errorf("focus = %+v, %v", view, err)
		}
		return nil
	}
	data := "ok"
	if err := run(); err != nil {
		data = err.Error()
	}
	pending := result + ".pending"
	if err := os.WriteFile(pending, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(pending, result); err != nil {
		t.Fatal(err)
	}
}

// Port of native a_key_binding_job_without_a_pane_uses_the_session_in_tmux,
// with the additional case that a second client in that session is ambiguous.
func TestKeyBindingJobUsesTheSessionInTmux(t *testing.T) {
	const socket = "/tmp/unit-only-socket"
	const other = "/dev/ttys001\t/dev/ttys001\t11\t$2\t@1\t%7\t" + socket + "\t100\n"
	const wanted = "/dev/ttys002\t/dev/ttys002\t12\t$9\t@2\t%4\t" + socket + "\t100\n"
	const second = "/dev/ttys003\t/dev/ttys003\t13\t$9\t@2\t%4\t" + socket + "\t100\n"
	for _, tc := range []struct {
		name, session, rows string
		serverPID           uint64
		tmuxCalls           int
		found               bool
	}{
		{"unique selected session", "$9", other + wanted, 100, 1, true},
		{"missing session claim", "", other + wanted, 100, 0, false},
		{"no client in session", "$9", other, 100, 1, false},
		{"several clients in session", "$9", other + wanted + second, 100, 1, false},
		{"wrong server pid", "$9", other + wanted, 101, 1, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var tmuxCalls, psCalls int
			c := Client{Path: "/unit/tmux", Process: runFunc(func(_ context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
				if spec.Path == "/bin/ps" {
					psCalls++
					return ports.Bounded{Stdout: []byte("Sat Jan 1 00:00:00 2000 S\n")}, nil
				}
				tmuxCalls++
				if len(spec.Args) < 4 || spec.Args[1] != "-S" || spec.Args[2] != socket || spec.Args[3] != "list-clients" {
					t.Fatalf("key job attempted a different tmux command: %v", spec.Args)
				}
				return ports.Bounded{Stdout: []byte(tc.rows)}, nil
			})}
			view, err := c.InvokerClient(t.Context(), TmuxCaller{Socket: socket, ServerPID: tc.serverPID, SessionID: tc.session})
			if tc.found {
				if err != nil || view.Name != "/dev/ttys002" || view.PaneID != "%4" || psCalls != 1 {
					t.Fatalf("key job view = %+v, %v, process calls %d", view, err, psCalls)
				}
			} else if !errors.Is(err, ErrInvokerClient) || psCalls != 0 {
				t.Fatalf("key job refusal = %+v, %v, process calls %d", view, err, psCalls)
			}
			if tmuxCalls != tc.tmuxCalls {
				t.Fatalf("tmux calls = %d, want %d", tmuxCalls, tc.tmuxCalls)
			}
		})
	}
}

func TestFocusRefusesASecondViewerInEitherAffectedSession(t *testing.T) {
	expected := ClientView{Socket: "/tmp/unit-only-socket", Name: "/dev/ttys001", SessionID: "$1",
		Process: core.ProcessIncarnation{PID: 123}}
	for _, session := range []string{"$1", "$2", "$3"} {
		c := Client{Path: "/unit/tmux", Process: runFunc(func(_ context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
			if spec.Args[3] != "list-clients" {
				t.Fatalf("unexpected tmux effect: %v", spec.Args)
			}
			rows := "$1\t/dev/ttys001\t123\n" + session + "\t/dev/ttys002\t456\n"
			return ports.Bounded{Stdout: []byte(rows)}, nil
		})}
		err := c.verifyUnsharedFocus(t.Context(), expected, "$2")
		if session == "$3" && err != nil || session != "$3" && !errors.Is(err, ErrInvokerClient) {
			t.Errorf("second client in %s: %v", session, err)
		}
	}
}

func fixtureShellWord(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
