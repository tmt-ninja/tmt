//go:build darwin || linux

package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
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
	t.Setenv("PATH", bin+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("TMUX", "")
	t.Setenv("TMUX_PANE", "")
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
	pane, err := host.Launch(ctx, ports.LaunchSpec{
		Server: server.Socket, Session: "t", Window: "fake-provider", Dir: rootDir,
		Command: ports.ProcessSpec{
			Path: "/bin/sh",
			Args: []string{"-c", `/bin/stty -echo && exec "$1"`, "fixture", fake},
			Env:  []string{"TMT_GO_HOME=" + rootDir, "TMT_EXECUTABLE=" + binary},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	waitForPrivateFake(t, ctx, func() (bool, error) {
		screen, err := host.Capture(ctx, pane, ports.CaptureOpts{})
		return (codex.Driver{}).Classify(screen) == ports.DriverIdle, err
	})
	if _, err := host.EnsureServerID(ctx, pane.Server); err != nil {
		t.Fatal(err)
	}
	probe, err := host.ProbeBinding(ctx, pane)
	if err != nil || probe.State != core.EndpointProbeLive || len(probe.Panes) != 1 || probe.Panes[0].Incarnation == nil {
		t.Fatalf("private probe = %+v, error = %v", probe, err)
	}
	records, recipient, _ := requestIdentitiesFixture()
	evidence := probe.Panes[0]
	binding := core.Binding{
		ID: "private-fixture-binding", IdentityID: recipient.ID, PaneID: pane.PaneID,
		PanePID: evidence.PID, PaneIncarnation: evidence.Incarnation, Server: probe.Server,
		Session: core.BindingSessionState{RuntimeState: "running", Runtime: &core.ProcessIncarnation{
			PID: evidence.PID, StartIdentity: *evidence.Incarnation,
		}},
	}
	if ok, err := host.PublishBinding(ctx, binding, *recipient); err != nil || !ok {
		t.Fatalf("publish private fixture binding = %t, %v", ok, err)
	}

	root, err := home.Resolve(os.LookupEnv, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	clock := wallClock{}
	store, err := storage.Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		return tx.Identities().Insert(*recipient, uint64(clock.NowMs()))
	}); err != nil {
		t.Fatal(err)
	}
	app := systemApplication()
	// Seed only the binding read here. The real request store accepts the
	// reply from a different process and the caller reads the durable final.
	app.store = callerTestStore{tx: callerTestTx{
		identityTxFake: identityTxFake{records: records.records}, bindings: callerBindingRepo{row: binding},
	}}
	app.requests = storage.NewRequestService(store, clock)
	var stdout, stderr bytes.Buffer
	if status := app.run(ctx, []string{"talk", "Worker", "verify", "--timeout", "8s", "--json"}, &stdout, &stderr); status != 0 || stderr.Len() != 0 {
		t.Fatalf("talk exit = %d, stdout = %q, stderr = %q", status, &stdout, &stderr)
	}
	var talk struct {
		RequestID core.RequestID
		Status    string
		Pane      string
		Response  string
	}
	if err := json.Unmarshal(stdout.Bytes(), &talk); err != nil || talk.RequestID == "" ||
		talk.Status != "completed" || talk.Pane != pane.PaneID || talk.Response != "ack: verify" {
		t.Fatalf("talk output = %q, error = %v", &stdout, err)
	}
	fresh := exec.CommandContext(ctx, binary, "result", string(talk.RequestID), "--json")
	fresh.Env = tmuxtest.Env()
	out, err := fresh.CombinedOutput()
	var result struct {
		RequestID core.RequestID
		Status    string
		Response  string
	}
	if decodeErr := json.Unmarshal(out, &result); err != nil || decodeErr != nil ||
		result.RequestID != talk.RequestID || result.Status != "completed" || result.Response != talk.Response {
		t.Fatalf("fresh result = %q, error = %v, decode = %v", out, err, decodeErr)
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
			t.Fatalf("private fake provider did not reach its composer: %v", ctx.Err())
		case <-ticker.C:
		}
	}
}
