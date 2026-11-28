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
		after, err := c.SwapInto(ctx, claim, client, target, SwapRight)
		if err != nil || after != client {
			return fmt.Errorf("swap changed invoking client or failed: %+v, %v", after, err)
		}
		swapped, err := readPane(neighbour)
		if err != nil || swapped.WindowID != target.WindowID {
			return fmt.Errorf("neighbour did not move to expected window: %+v, %v", swapped, err)
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

func fixtureShellWord(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\\''") + "'"
}
