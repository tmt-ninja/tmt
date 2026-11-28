//go:build darwin || linux

package fixtures_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestFakeProviderSubmitsCorrelatedReply(t *testing.T) {
	server := tmuxtest.Start(t)
	root := t.TempDir()
	// The executable name is visible in the process table. A shell-only
	// wrapper or an argv alias would not prove a Codex process.
	fake := filepath.Join(root, "codex")
	buildCtx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	build := exec.CommandContext(buildCtx, "go", "build", "-o", fake, "./fakeprovider")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build fake provider: %v\n%s", err, out)
	}
	log := filepath.Join(root, "reply-argv")
	cli := filepath.Join(root, "tmt-go")
	// Verify the provider actually invokes the callback, not merely that its
	// terminal echoed the request. CLI durable storage has its own tests.
	recorder := "#!/bin/sh\nprintf '%s\\0' \"$TMT_GO_HOME\" \"$@\" > \"$TMT_FAKE_REPLY_LOG\"\n"
	if err := os.WriteFile(cli, []byte(recorder), 0700); err != nil {
		t.Fatal(err)
	}
	path, err := exec.LookPath("tmux")
	if err != nil {
		t.Fatal(err)
	}
	host := tmux.Client{Process: process.Runner{}, Path: path}
	driver := codex.Driver{}
	pane, err := host.Launch(t.Context(), ports.LaunchSpec{
		Server: server.Socket, Session: "t", Window: "fake-provider", Dir: root,
		Command: ports.ProcessSpec{
			Path: "/bin/sh",
			Args: []string{"-c", `/bin/stty -echo && exec "$1"`, "fixture", fake},
			Env:  []string{"TMT_GO_HOME=" + root, "TMT_EXECUTABLE=" + cli, "TMT_FAKE_REPLY_LOG=" + log},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	await(t, func(ctx context.Context) bool {
		screen, err := host.Capture(ctx, pane, ports.CaptureOpts{})
		if err != nil {
			t.Fatal(err)
		}
		return driver.Classify(screen) == ports.DriverIdle
	})
	if _, err := host.EnsureServerID(t.Context(), pane.Server); err != nil {
		t.Fatal(err)
	}
	probe, err := host.ProbeBinding(t.Context(), pane)
	if err != nil || len(probe.Panes) != 1 || probe.Panes[0].Incarnation == nil {
		t.Fatalf("fake pane evidence = %+v, %v", probe, err)
	}
	identity := core.Identity{ID: "fixture", Name: "fixture", CanonicalName: "fixture"}
	observed := probe.Panes[0]
	binding := core.Binding{ID: "fixture-binding", IdentityID: identity.ID, Server: probe.Server,
		PaneID: pane.PaneID, PanePID: observed.PID, PaneIncarnation: observed.Incarnation,
		Session: core.BindingSessionState{RuntimeState: "running", Runtime: &core.ProcessIncarnation{
			PID: observed.PID, StartIdentity: *observed.Incarnation,
		}},
	}
	if published, err := host.PublishBinding(t.Context(), binding, identity); err != nil || !published {
		t.Fatalf("publish fake binding = %t, %v", published, err)
	}
	probe, err = host.ProbeBinding(t.Context(), pane)
	if err != nil {
		t.Fatal(err)
	}
	observer := runtime.Observer{Process: process.Runner{}}
	starting := binding
	starting.Session = core.BindingSessionState{RuntimeState: "unknown"}
	if ok, err := observer.ProveLaunchChild(t.Context(), identity, starting, probe, *binding.Session.Runtime, core.DriverCodex); err != nil || !ok {
		t.Fatalf("startup child proof = %t, %v", ok, err)
	}
	if ok, err := observer.ProveLaunchChild(t.Context(), identity, starting, probe, *binding.Session.Runtime, core.DriverClaude); err != nil || ok {
		t.Fatalf("startup accepted a different driver = %t, %v", ok, err)
	}

	main, err := observer.ProveBoundMain(t.Context(), identity, binding, probe)
	if err != nil || main.Name != "codex" || uint64(main.Incarnation.PID) != observed.PID ||
		main.Incarnation.Start != *observed.Incarnation {
		t.Fatalf("fake foreground = %+v, %v", main, err)
	}
	stale := binding
	stale.Session.Runtime = &core.ProcessIncarnation{PID: observed.PID, StartIdentity: "ps-v1:Sat Jan 1 00:00:00 2000"}
	if got, err := observer.ProveBoundMain(t.Context(), identity, stale, probe); err != nil || got.Name != "" {
		t.Fatalf("stale fake foreground = %+v, %v", got, err)
	}

	const req = "req_3fa85f64-5717-4562-b3fc-2c963f66afa6"
	const receipt = "v2_test_receipt"
	prompt := "check!\n\n<tmt-reply from=\"fixture\">\ntmt-go reply " + req + " --receipt " + receipt +
		" --message <text>\n</tmt-reply>\nSubmit the response."
	outcome, err := host.Deliver(t.Context(), pane, ports.DeliveryInput{Text: prompt, Submit: driver.SubmitPlan(prompt)})
	if err != nil || outcome != ports.DeliveryDelivered {
		t.Fatalf("Deliver = %v, %v", outcome, err)
	}
	await(t, func(context.Context) bool {
		data, err := os.ReadFile(log)
		if err != nil || len(data) == 0 || data[len(data)-1] != 0 {
			return false
		}
		argv := strings.Split(string(data[:len(data)-1]), "\x00")
		if len(argv) != 6 {
			return false
		}
		if !slices.Equal(argv, []string{root, "reply", req, "--receipt", receipt, "--message=ack: check！"}) {
			t.Fatalf("reply callback args = %q", argv)
		}
		return true
	})
}

func await(t *testing.T, probe func(context.Context) bool) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for !probe(ctx) {
		select {
		case <-ctx.Done():
			t.Fatal("private fake provider did not reach the expected state")
		case <-tick.C:
		}
	}
}
