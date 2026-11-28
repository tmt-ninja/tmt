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
	pane, err := host.Launch(ctx, ports.LaunchSpec{
		Server: server.Socket, Session: "t", Window: "fake-provider", Dir: rootDir,
		Command: ports.ProcessSpec{
			Path: "/bin/sh",
			Args: []string{"-c", `/bin/stty -echo && "$1" run --save Worker "$2"; printf '%s\n' "$?" > "$3"`, "fixture", binary, fake, exitFile},
			Env:  []string{"TMT_GO_HOME=" + rootDir, "PATH=" + os.Getenv("PATH")},
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
	waitForPrivateFake(t, ctx, func() (bool, error) {
		ready := false
		err := store.Read(ctx, func(tx ports.StoreTx) error {
			identity, err := core.FindIdentityByName(tx.Identities(), "Worker")
			if err != nil || identity == nil {
				return err
			}
			binding, err := tx.Bindings().FindByIdentity(identity.ID)
			if err == nil && binding != nil {
				ready = binding.Session.RuntimeState == "running" && binding.Session.Runtime != nil &&
					binding.Session.ProviderSessionID == nil && binding.Server.Socket == pane.Server && binding.PaneID == pane.PaneID
			}
			return err
		})
		return ready, err
	})

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

	waitForPrivateFake(t, ctx, func() (bool, error) {
		status, err := os.ReadFile(exitFile)
		if errors.Is(err, os.ErrNotExist) || err == nil && !strings.HasSuffix(string(status), "\n") {
			return false, nil
		}
		if err == nil && string(status) != "0\n" {
			t.Fatalf("foreground run exited with %q", status)
		}
		return err == nil, err
	})
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
