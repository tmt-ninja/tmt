//go:build darwin || linux

package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/delivery"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestDirectPaneTalkUsesDurableReceipt(t *testing.T) {
	world, bin := t.TempDir(), t.TempDir()
	t.Setenv(home.EnvHome, filepath.Join(world, "state"))
	binary, codex := filepath.Join(bin, flavor.Binary), filepath.Join(bin, "codex")
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	for _, build := range [][2]string{{binary, "../../cmd/tmt-go"}, {codex, "../../test/fixtures/fakeprovider"}} {
		if got, err := privateFixtureBuild(ctx, build[0], build[1]).CombinedOutput(); err != nil {
			t.Fatalf("build %s: %v %s", build[1], err, got)
		}
	}
	t.Setenv("HOME", world)
	server := tmuxtest.Start(t)
	for _, provider := range []string{"claude", "gemini"} {
		if err := os.WriteFile(filepath.Join(bin, provider), []byte("#!/bin/sh\nexit 97\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	guard := `set -eu
PATH="$1:/usr/bin:/bin"
HOME="$2"
CODEX_HOME="$2/fake-codex-home"
CLAUDE_CONFIG_DIR="$2/fake-claude-home"
GEMINI_CLI_HOME="$2/fake-gemini-home"
export PATH HOME CODEX_HOME CLAUDE_CONFIG_DIR GEMINI_CLI_HOME
for provider in claude codex gemini; do
  expected="$1/$provider"
  if [ "$(command -v "$provider")" != "$expected" ] || [ ! -f "$expected" ] || [ ! -x "$expected" ] || [ -L "$expected" ]; then
    exit 98
  fi
done
/bin/stty -echo
exec "$1/codex"`
	args := []string{"/usr/bin/env", "HOME=" + world, home.EnvHome + "=" + os.Getenv(home.EnvHome),
		"TMT_EXECUTABLE=" + binary, "/bin/sh", "-c", guard, "fixture", bin, world}
	for i, arg := range args {
		args[i] = core.CommandWord(arg)
	}

	type document struct {
		Status        string
		RequestID     core.RequestID
		Pane          string
		Identity      *output.TargetIdentity
		Response      string
		BodyBytes     uint64
		SubmittedAtMs uint64
	}
	for _, detach := range []bool{false, true} {
		t.Run("detach_"+strconv.FormatBool(detach), func(t *testing.T) {
			pane := strings.TrimSpace(server.Run("new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "t:",
				strings.Join(args, " ")))
			waitForPrivateFake(t, ctx, func() (bool, error) {
				return strings.Contains(server.Run("capture-pane", "-p", "-t", pane), "Ask Codex to do anything"), nil
			})
			contextText := strings.TrimSpace(server.Run("display-message", "-p", "-t", pane, "#{socket_path},#{pid},#{session_id}"))
			comma := strings.LastIndexByte(contextText, ',')
			if comma < 0 || comma+2 >= len(contextText) || contextText[comma+1] != '$' {
				t.Fatalf("unexpected private tmux context")
			}
			contextText = contextText[:comma+1] + contextText[comma+2:]
			call := func(args ...string) (int, []byte) {
				t.Helper()
				cmd := exec.CommandContext(ctx, binary, args...)
				cmd.Env = append(tmuxtest.Env(), "TMUX="+contextText)
				data, err := cmd.CombinedOutput()
				if err == nil {
					return 0, data
				}
				var exit *exec.ExitError
				if !errors.As(err, &exit) {
					t.Fatalf("call %q: %v", args, err)
				}
				return exit.ExitCode(), data
			}
			const prompt = "  verify 日本語🙂 ; literal\t  \nsecond line  "
			const body = "ack: " + prompt
			selector := pane
			options := []string{"--timeout", "8"}
			if detach {
				options = []string{"--detach"}
				selector = strings.TrimSpace(server.Run("display-message", "-p", "-t", pane, "#{session_name}:#{window_index}.#{pane_index}"))
			}
			status, raw := call(append([]string{"talk", selector, prompt, "--no-preamble", "--json"}, options...)...)
			var talk document
			if status != 0 || json.Unmarshal(raw, &talk) != nil || talk.RequestID == "" ||
				talk.Pane != pane || talk.Identity != nil {
				t.Fatalf("unbound pane talk: exit=%d output=%s", status, raw)
			}
			if detach && talk.Status != "sent" || !detach && (talk.Status != "completed" || talk.Response != body ||
				talk.BodyBytes != uint64(len(body)) || talk.SubmittedAtMs == 0) {
				t.Fatalf("unexpected talk status or exact body: %+v", talk)
			}
			var result document
			waitForPrivateFake(t, ctx, func() (bool, error) {
				status, raw := call("result", string(talk.RequestID), "--json")
				if status == 3 {
					return false, nil
				}
				if status != 0 {
					return false, fmt.Errorf("result exit=%d output=%s", status, raw)
				}
				return true, json.Unmarshal(raw, &result)
			})
			if result.Status != "completed" || result.RequestID != talk.RequestID || result.Response != body ||
				result.BodyBytes != uint64(len(body)) || result.SubmittedAtMs == 0 ||
				!detach && result.SubmittedAtMs != talk.SubmittedAtMs {
				t.Fatalf("fresh result was not the same durable reply: %+v", result)
			}
		})
	}
}

func TestDirectPaneTalkRefusesReplacementBeforePaste(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	server := tmuxtest.Start(t)
	pane := strings.TrimSpace(server.Run("new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "t:", "cat"))
	pid := strings.TrimSpace(server.Run("display-message", "-p", "-t", pane, "#{pid}"))
	claim := server.Socket + "," + pid + ",0"
	state := t.TempDir()
	root := home.Root{Dir: state, Database: filepath.Join(state, home.DatabaseName), Config: filepath.Join(state, "config.json")}
	app := systemApplication()
	app.caller.lookup = func(key string) (string, bool) {
		switch key {
		case "TMUX":
			return claim, true
		case "TMUX_PANE":
			return pane, true
		default:
			return "", false
		}
	}
	deliver := app.live.deliver
	calls := 0
	app.live.deliver = func(ctx context.Context, root home.Root, target delivery.PasteTarget, input ports.DeliveryInput) (ports.DeliveryOutcome, error) {
		calls++
		if target.Binding != nil || target.Unbound == nil || target.Pane.PaneID != pane {
			t.Fatalf("expected frozen unbound target, got %+v", target)
		}
		old := target.Unbound.Process.PID
		server.Run("respawn-pane", "-k", "-t", pane, "cat")
		fresh := strings.TrimSpace(server.Run("display-message", "-p", "-t", pane, "#{pane_pid}"))
		if fresh == "" || fresh == strconv.FormatUint(old, 10) {
			t.Fatal("fixture did not replace the pane process")
		}
		return deliver(ctx, root, target, input)
	}
	const prompt = "must never reach replacement fixture"
	inv, failure := parse([]string{"talk", pane, prompt, "--detach", "--json"})
	if failure != nil {
		t.Fatal(failure)
	}
	report, ok := app.runRequest(t.Context(), root, inv).(*output.Failure)
	if !ok || calls != 1 || report.Code != "DELIVERY_PREPARATION_FAILED" ||
		report.Request == nil || report.Request.RequestID == "" || report.Request.DeliveryState != "not_delivered" {
		t.Fatalf("changed endpoint was not refused cleanly: calls=%d, report=%+v", calls, report)
	}
	if strings.Contains(server.Run("capture-pane", "-p", "-t", pane), prompt) {
		t.Fatal("replacement process received pane input")
	}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Read(t.Context(), func(tx ports.StoreTx) error {
		req, err := tx.Requests().FindByID(core.RequestID(report.Request.RequestID))
		if err == nil && (req == nil || req.Status != core.AttemptDefinitelyFailed || req.ResponseSubmittedAtMs != nil ||
			req.Route.Kind != core.RequestRoutePane || req.Route.Pane == nil || req.Route.Pane.PaneID != pane) {
			t.Errorf("replacement settlement: %+v", req)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
}
