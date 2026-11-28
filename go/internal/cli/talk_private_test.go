//go:build darwin || linux

package cli

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestLiveTalkGetsDurableReplyFromPrivateFakeProvider(t *testing.T) {
	server := tmuxtest.Start(t)
	rootDir := t.TempDir()
	bin := t.TempDir()
	t.Setenv("TMT_GO_HOME", rootDir)
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	fake, binary := filepath.Join(bin, "codex"), filepath.Join(bin, "tmt-go")
	for _, build := range []struct{ destination, source string }{
		{fake, "../../test/fixtures/fakeprovider"},
		{binary, "../../cmd/tmt-go"},
	} {
		cmd := exec.CommandContext(ctx, "go", "build", "-o", build.destination, build.source)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("build %s: %v\n%s", build.source, err, out)
		}
	}

	host, err := newTmuxClient()
	if err != nil {
		t.Fatal(err)
	}
	exitFile := filepath.Join(bin, "run-exit")
	secondExit := filepath.Join(bin, "second-run-exit")
	pane, err := host.Launch(ctx, ports.LaunchSpec{
		Server: server.Socket, Session: "t", Window: "fake-provider", Dir: rootDir,
		Command: ports.ProcessSpec{
			Path: "/bin/sh",
			Args: []string{"-c", `/bin/stty -echo || exit
"$1" run --save Worker "$2"
printf '%s\n' "$?" > "$3"
IFS= read -r ignored || exit
"$1" run --save Worker "$2"
printf '%s\n' "$?" > "$4"
IFS= read -r ignored`, "fixture", binary, fake, exitFile, secondExit},
			Env: []string{"TMT_GO_HOME=" + rootDir, "PATH=" + os.Getenv("PATH")},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	waitForPrivateFake(t, ctx, func() (bool, error) {
		screen, err := host.Capture(ctx, pane, ports.CaptureOpts{})
		return (codex.Driver{}).Classify(screen) == ports.DriverIdle, err
	})

	root, err := home.Resolve(os.LookupEnv, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	waitForState := func(state string) core.Binding {
		t.Helper()
		var seen core.Binding
		waitForPrivateFake(t, ctx, func() (bool, error) {
			err := store.Read(ctx, func(tx ports.StoreTx) error {
				identity, err := core.FindIdentityByName(tx.Identities(), "Worker")
				if err != nil || identity == nil {
					return err
				}
				binding, err := tx.Bindings().FindByIdentity(identity.ID)
				if err == nil && binding != nil {
					seen = *binding
				}
				return err
			})
			return seen.Session.RuntimeState == state && seen.Session.Runtime != nil &&
				seen.Session.ProviderSessionID == nil && seen.Server.Socket == pane.Server && seen.PaneID == pane.PaneID, err
		})
		return seen
	}
	first := waitForState("running")
	command := func(args ...string) []byte {
		t.Helper()
		cmd := exec.CommandContext(ctx, binary, args...)
		cmd.Env = tmuxtest.Env()
		out, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%v: %v\n%s", args, err, out)
		}
		return out
	}
	talkJSON := command("talk", "Worker", "verify", "--timeout", "8s", "--json")
	var talk struct {
		RequestID core.RequestID
		Status    string
		Pane      string
		Response  string
	}
	if err := json.Unmarshal(talkJSON, &talk); err != nil || talk.RequestID == "" ||
		talk.Status != "completed" || talk.Pane != pane.PaneID || talk.Response != "ack: verify" {
		t.Fatalf("talk output = %q, error = %v", talkJSON, err)
	}
	resultJSON := command("result", string(talk.RequestID), "--json")
	var result struct {
		RequestID core.RequestID
		Status    string
		Response  string
	}
	if err := json.Unmarshal(resultJSON, &result); err != nil ||
		result.RequestID != talk.RequestID || result.Status != "completed" || result.Response != talk.Response {
		t.Fatalf("fresh result = %q, decode = %v", resultJSON, err)
	}

	waitForExit := func(path string, normal bool) {
		t.Helper()
		waitForPrivateFake(t, ctx, func() (bool, error) {
			status, err := os.ReadFile(path)
			if errors.Is(err, os.ErrNotExist) || err == nil && !strings.HasSuffix(string(status), "\n") {
				return false, nil
			}
			if err == nil && (string(status) == "0\n") != normal {
				t.Fatalf("foreground run exited with %q", status)
			}
			return err == nil, err
		})
	}
	waitForExit(exitFile, true)
	afterReply := waitForState("ended")
	if afterReply.ID != first.ID || *afterReply.Session.Runtime != *first.Session.Runtime {
		t.Fatal("foreground exit did not settle the exact original binding")
	}

	server.Run("send-keys", "-t", pane.PaneID, "Enter")
	second := waitForState("running")
	if second.ID != first.ID || *second.Session.Runtime == *first.Session.Runtime {
		t.Fatal("second run did not reuse the binding for a fresh runtime")
	}
	stoppedJSON := command("stop", "Worker", "--json")
	var stopped struct {
		Identity struct{ ID core.IdentityID }
		Outcome  string
	}
	if err := json.Unmarshal(stoppedJSON, &stopped); err != nil || stopped.Outcome != "stopped" || stopped.Identity.ID != first.IdentityID {
		t.Fatalf("stop output = %q, decode = %v", stoppedJSON, err)
	}
	waitForExit(secondExit, false)
	afterStop := waitForState("ended")
	if afterStop.ID != second.ID || *afterStop.Session.Runtime != *second.Session.Runtime {
		t.Fatal("stop did not preserve and settle the second binding")
	}
	if output := strings.TrimSpace(server.Run("display-message", "-p", "-t", pane.PaneID, "#{pane_id}")); output != pane.PaneID {
		t.Fatalf("the verified stop changed its pane: %q", output)
	}
}

func waitForPrivateFake(t *testing.T, ctx context.Context, probe func() (bool, error)) {
	t.Helper()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		ready, err := probe()
		if err != nil {
			t.Fatal(err)
		}
		if ready {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("private pane did not reach the expected state: %v", ctx.Err())
		case <-ticker.C:
		}
	}
}
