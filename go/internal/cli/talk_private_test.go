//go:build darwin || linux

package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestLiveTalkGetsDurableReplyFromPrivateFakeProvider(t *testing.T) {
	server := tmuxtest.Start(t)
	rootDir := t.TempDir()
	bin := t.TempDir()
	t.Setenv(flavor.EnvHome, rootDir)
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	fake, binary := filepath.Join(bin, "codex"), filepath.Join(bin, flavor.Binary)
	for _, build := range []struct{ destination, source string }{
		{fake, "../../test/fixtures/fakeprovider"},
		{binary, "../../cmd/tmt-go"},
	} {
		cmd := privateFixtureBuild(ctx, build.destination, build.source)
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
			Env: []string{flavor.EnvHome + "=" + rootDir, "PATH=" + os.Getenv("PATH")},
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
	waitForState := func(name string, pane ports.PaneRef, state string) core.Binding {
		t.Helper()
		var seen core.Binding
		waitForPrivateFake(t, ctx, func() (bool, error) {
			err := store.Read(ctx, func(tx ports.StoreTx) error {
				identity, err := core.FindIdentityByName(tx.Identities(), name)
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
	first := waitForState("Worker", pane, "running")
	invoke := func(expected int, env []string, args ...string) []byte {
		t.Helper()
		cmd := exec.CommandContext(ctx, binary, args...)
		cmd.Env = env
		out, err := cmd.CombinedOutput()
		status := 0
		if err != nil {
			var exited *exec.ExitError
			if !errors.As(err, &exited) {
				t.Fatalf("%v: %v\n%s", args, err, out)
			}
			status = exited.ExitCode()
		}
		if status != expected {
			t.Fatalf("%v: exit %d, want %d\n%s", args, status, expected, out)
		}
		return out
	}
	commandStatus := func(expected int, args ...string) []byte {
		t.Helper()
		return invoke(expected, tmuxtest.Env(), args...)
	}
	command := func(args ...string) []byte { return commandStatus(0, args...) }
	codexDir := filepath.Join(root.Dir, "channels", "codex")
	if err := os.MkdirAll(codexDir, 0700); err != nil {
		t.Fatal(err)
	}
	record := filepath.Join(codexDir, string(first.ID)+".json")
	if err := os.WriteFile(record, []byte("{"), 0600); err != nil {
		t.Fatal(err)
	}
	const fencedContent = "message blocked by channel fence"
	refused := commandStatus(1, "talk", "Worker", fencedContent, "--timeout", "8s", "--json")
	var refusal struct {
		Error struct{ Code string }
	}
	if err := json.Unmarshal(refused, &refusal); err != nil || refusal.Error.Code != "DELIVERY_PREPARATION_FAILED" {
		t.Fatalf("fenced talk output = %q, error = %v", refused, err)
	}
	observed, err := host.Capture(ctx, pane, ports.CaptureOpts{})
	if err != nil || strings.Contains(observed.Text, fencedContent) {
		t.Fatalf("fenced talk reached the private pane: %v", err)
	}
	if err := os.Remove(record); err != nil {
		t.Fatal(err)
	}
	directEnv := append(tmuxtest.Env(), fmt.Sprintf("TMUX=%s,%d,0", server.Socket, first.Server.PID))
	talkJSON := invoke(0, directEnv, "talk", pane.PaneID, "verify", "--timeout", "8s", "--json")
	var talk struct {
		RequestID core.RequestID
		Status    string
		Pane      string
		Response  string
		Identity  *struct{ Name string }
	}
	if err := json.Unmarshal(talkJSON, &talk); err != nil || talk.RequestID == "" ||
		talk.Status != "completed" || talk.Pane != pane.PaneID || talk.Response != "ack: verify" ||
		talk.Identity == nil || talk.Identity.Name != "Worker" {
		t.Fatalf("talk output = %q, error = %v", talkJSON, err)
	}
	if err := store.Read(ctx, func(tx ports.StoreTx) error {
		attempt, err := tx.Requests().FindByID(talk.RequestID)
		if err == nil && (attempt == nil || attempt.Route.Kind != core.RequestRouteInbox ||
			attempt.Route.Recipient == nil || *attempt.Route.Recipient != first.IdentityID) {
			t.Errorf("verified bound pane did not use the inbox route: %+v", attempt)
		}
		return err
	}); err != nil {
		t.Fatal(err)
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
	afterReply := waitForState("Worker", pane, "ended")
	if afterReply.ID != first.ID || *afterReply.Session.Runtime != *first.Session.Runtime {
		t.Fatal("foreground exit did not settle the exact original binding")
	}

	server.Run("send-keys", "-t", pane.PaneID, "Enter")
	second := waitForState("Worker", pane, "running")
	if second.ID != first.ID || *second.Session.Runtime == *first.Session.Runtime {
		t.Fatal("second run did not reuse the binding for a fresh runtime")
	}
	keptJSON := commandStatus(1, "stop", "Worker", "--close", "--json")
	var kept struct {
		Error struct{ Code string }
	}
	if err := json.Unmarshal(keptJSON, &kept); err != nil || kept.Error.Code != "PANE_NOT_CLOSED" {
		t.Fatalf("user pane close output = %q, decode = %v", keptJSON, err)
	}
	waitForExit(secondExit, false)
	afterStop := waitForState("Worker", pane, "ended")
	if afterStop.ID != second.ID || *afterStop.Session.Runtime != *second.Session.Runtime {
		t.Fatal("stop did not preserve and settle the second binding")
	}
	if out := command("stop", "Worker", "--json"); !strings.Contains(string(out), `"outcome":"already_ended"`) {
		t.Fatalf("plain stop after the refusal = %q", out)
	}
	if output := strings.TrimSpace(server.Run("display-message", "-p", "-t", pane.PaneID, "#{pane_id}")); output != pane.PaneID {
		t.Fatalf("the verified stop changed its pane: %q", output)
	}
	owned := core.Identity{
		ID: "9759f9ee-46a8-46e8-8b6e-294531382aca", Name: "Owned", CanonicalName: "owned", Lifetime: core.LifetimeSaved,
	}
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		return tx.Identities().Insert(owned, uint64(wallClock{}.NowMs()))
	}); err != nil {
		t.Fatal(err)
	}
	ownedPane, err := host.LaunchOwned(ctx, ports.LaunchSpec{
		Server: server.Socket, Session: "t", Window: "go-owned-provider", Dir: rootDir,
		Command: ports.ProcessSpec{
			Path: "/bin/sh",
			Args: []string{"-c", `/bin/stty -echo || exit
"$1" run --save Owned "$2"
IFS= read -r ignored`, "fixture", binary, fake},
			Env: []string{flavor.EnvHome + "=" + rootDir, "PATH=" + os.Getenv("PATH")},
		},
	}, owned)
	if err != nil {
		t.Fatal(err)
	}
	ownedRunning := waitForState("Owned", ownedPane, "running")
	stoppedJSON := command("stop", "Owned", "--close", "--json")
	var stopped struct {
		Identity struct{ ID core.IdentityID }
		Outcome  string
		Pane     string
	}
	if err := json.Unmarshal(stoppedJSON, &stopped); err != nil || stopped.Outcome != "stopped" ||
		stopped.Pane != "closed" || stopped.Identity.ID != owned.ID {
		t.Fatalf("Go-owned pane close output = %q, decode = %v", stoppedJSON, err)
	}
	ownedEnded := waitForState("Owned", ownedPane, "ended")
	if ownedEnded.ID != ownedRunning.ID || *ownedEnded.Session.Runtime != *ownedRunning.Session.Runtime {
		t.Fatal("closing the Go-owned pane did not keep and settle the exact binding")
	}
	panes, err := host.Panes(ctx, server.Socket)
	if err != nil {
		t.Fatal(err)
	}
	var userPaneKept bool
	for _, observed := range panes {
		if observed.Pane == ownedPane {
			t.Fatalf("Go-owned pane %s still exists", ownedPane.PaneID)
		}
		userPaneKept = userPaneKept || observed.Pane == pane
	}
	if !userPaneKept {
		t.Fatal("closing the Go-owned pane disturbed the user pane")
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

func privateFixtureBuild(ctx context.Context, path, pkg string) *exec.Cmd {
	args := []string{"build"}
	if flavor.NativeCompatible {
		args = append(args, "-tags=nativecompat")
	}
	return exec.CommandContext(ctx, "go", append(args, "-o", path, pkg)...)
}

func TestRoomTalkRefusesAnUnidentifiedPaneWithoutPreparing(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", filepath.Join(world, "home"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(world, "config"))
	t.Setenv("TMT_HOME", filepath.Join(world, "native"))
	t.Setenv(flavor.EnvHome, filepath.Join(world, "state"))
	t.Chdir(world)
	server := tmuxtest.Start(t)
	pane := strings.TrimSpace(server.Run("display-message", "-p", "#{pane_id}"))
	pid := strings.TrimSpace(server.Run("display-message", "-p", "-t", pane, "#{pid}"))
	app := systemApplication()
	app.caller.lookup = func(key string) (string, bool) {
		switch key {
		case "TMUX":
			return server.Socket + "," + pid + ",0", true
		case "TMUX_PANE":
			return pane, true
		default:
			return os.LookupEnv(key)
		}
	}
	run := func(want int, args ...string) []byte {
		t.Helper()
		var out, errOut bytes.Buffer
		if code := app.run(t.Context(), append(args, "--json"), &out, &errOut); code != want || errOut.Len() != 0 {
			t.Fatalf("%q exit=%d stdout=%q stderr=%q", args, code, &out, &errOut)
		}
		return out.Bytes()
	}
	run(0, "identity", "create", "Alice")
	run(0, "room", "create", "Design")
	refused := run(1, "talk", pane, "must not be sent", "--room", "Design", "--identity", "Alice", "--detach")
	var failure struct {
		Error     struct{ Code string }
		RequestID core.RequestID
	}
	if err := json.Unmarshal(refused, &failure); err != nil || failure.Error.Code != "ROOM_RECIPIENT_NOT_MEMBER" || failure.RequestID == "" {
		t.Fatalf("unexpected room refusal %q: %v", refused, err)
	}
	if marker := server.Run("show-options", "-s", "-q", "-v", tmux.ServerIDOption); strings.TrimSpace(marker) != "" {
		t.Fatalf("refused room talk initialized a server ID: %q", marker)
	}
	root, err := home.Resolve(os.LookupEnv, filepath.Join(world, "home"))
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Read(t.Context(), func(tx ports.StoreTx) error {
		attempt, err := tx.Requests().FindByID(failure.RequestID)
		if err == nil && attempt != nil {
			t.Fatal("refused room talk stored a request")
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
}
