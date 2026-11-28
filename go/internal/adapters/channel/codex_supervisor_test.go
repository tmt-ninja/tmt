//go:build darwin || linux

package channel

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

func TestCodexSupervisorEOFKeepsEnrollmentAndWithdrawalRetiresIt(t *testing.T) {
	for _, withdraw := range []bool{false, true} {
		t.Run(fmt.Sprintf("withdraw=%v", withdraw), func(t *testing.T) {
			root := home.Root{Dir: t.TempDir()}
			supervisor := startSupervisorFixture(t, root)
			rec := supervisor.lease.record
			endpoint := supervisor.lease.endpointProcess
			if err := supervisor.stop(withdraw); err != nil {
				t.Fatal(err)
			}
			assertSupervisorCleanup(t, root, rec.Generation, endpoint, withdraw)
		})
	}
}

func TestCodexSupervisorReapsOnAbruptLauncherDeath(t *testing.T) {
	root := home.Root{Dir: t.TempDir()}
	path, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), 20*time.Second)
	defer cancel()
	launcher := exec.CommandContext(ctx, path, "-test.run=^TestCodexLauncherFixtureProcess$")
	launcher.Env = append(os.Environ(), "TMT_GO_CODEX_FIXTURE_LAUNCHER="+root.Dir)
	stdout, err := launcher.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	launcher.Stderr = os.Stderr
	if err := launcher.Start(); err != nil {
		t.Fatal(err)
	}
	reaped := false
	defer func() {
		if !reaped {
			_ = launcher.Process.Kill()
			_ = launcher.Wait()
		}
	}()
	type ready struct {
		Generation string
		Endpoint   processRecord
	}
	line, err := bufio.NewReader(stdout).ReadBytes('\n')
	var observed ready
	if err != nil || json.Unmarshal(line, &observed) != nil || !core.ValidUUID(observed.Generation) ||
		!observed.Endpoint.incarnation().Valid() {
		t.Fatalf("launcher fixture did not publish readiness: %q, %v", line, err)
	}
	if err := launcher.Process.Kill(); err != nil {
		t.Fatal(err)
	}
	_ = launcher.Wait()
	reaped = true

	// Observe the separate helper's cleanup. No launcher code ran after kill.
	tick := time.NewTicker(20 * time.Millisecond)
	defer tick.Stop()
	generation := filepath.Join(ClaudeDirectory(root), codexDirectory, observed.Generation)
	for {
		if _, err := os.Lstat(generation); errors.Is(err, fs.ErrNotExist) {
			break
		}
		select {
		case <-ctx.Done():
			t.Fatal("launcher death left the app-server generation behind")
		case <-tick.C:
		}
	}
	assertSupervisorCleanup(t, root, observed.Generation, observed.Endpoint, false)
}

func assertSupervisorCleanup(t *testing.T, root home.Root, generation string, endpoint processRecord, withdrawn bool) {
	t.Helper()
	observer := runtime.Observer{Process: process.Runner{}}
	if state := processState(t.Context(), observer, endpoint); state != runtime.Gone {
		t.Fatalf("owned endpoint was not reaped: %v", state)
	}
	if _, err := os.Lstat(filepath.Join(ClaudeDirectory(root), codexDirectory, generation)); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("generation still present: %v", err)
	}
	dir, err := openCodexDir(root, false)
	if err != nil {
		t.Fatal(err)
	}
	defer dir.close()
	record, err := dir.readCodex(testBinding)
	if err != nil || (record == nil) != withdrawn || record != nil && record.Generation != generation {
		t.Fatalf("record after supervisor exit = %+v, %v", record, err)
	}
}

func startSupervisorFixture(t *testing.T, root home.Root) *codexSupervisor {
	t.Helper()
	fixture := fixtureEnrollment(t)
	fixture.Root = root
	fixture.Binding.Server.ID = "40000000-0000-4000-8000-000000000001"
	fixture.Probe.Server = fixture.Binding.Server
	marker := fixture.Binding.Marker(fixture.Identity)
	fixture.Probe.Panes[0].Marker = &marker
	runner := process.Runner{}
	observer := runtime.Observer{Process: runner}
	owner, err := observer.Observe(t.Context(), os.Getpid())
	if err != nil || owner.State != runtime.Alive {
		t.Fatalf("launcher fixture owner = %+v, %v", owner, err)
	}
	command := fixtureOwnedCodexEndpoint(t, root.Dir, "fresh")
	plan, err := PlanCodexLaunch(command, root.Dir, "")
	if err != nil {
		t.Fatal(err)
	}
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	wrapper := filepath.Join(root.Dir, "supervisor-fixture")
	quoted := "'" + strings.ReplaceAll(binary, "'", "'\\''") + "'"
	script := "#!/bin/sh\nexec " + quoted + " -test.run='^TestCodexSupervisorFixtureProcess$' -- \"$@\"\n"
	if err := os.WriteFile(wrapper, []byte(script), 0700); err != nil {
		t.Fatal(err)
	}
	supervisor, err := startCodexSupervisor(t.Context(), runner, codexEnrollment{
		root: root, identity: fixture.Identity, binding: fixture.Binding, probe: fixture.Probe,
		owner: core.ProcessIncarnation{PID: uint64(os.Getpid()), StartIdentity: owner.Incarnation.Start},
		plan:  plan, build: "fixture",
	}, wrapper)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = supervisor.stop(false) })
	if supervisor.lease.server != nil || supervisor.lease.endpointProcess.PID == uint64(supervisor.process.Pid) {
		t.Fatal("launcher obtained the worker's app-server handle or wrong process proof")
	}
	return supervisor
}

func TestCodexSupervisorFixtureProcess(t *testing.T) {
	start := slices.Index(os.Args, "__channel-server")
	if start < 0 {
		return
	}
	root := home.Root{Dir: os.Getenv(home.EnvHome)}
	req, err := ParseCodexServeRequest(root, os.Args[start+1:], "fixture")
	if err == nil {
		err = ServeCodexSupervisor(t.Context(), req, process.Runner{}, os.Stdin, os.Stdout)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	os.Exit(0)
}

func TestCodexLauncherFixtureProcess(t *testing.T) {
	root := home.Root{Dir: os.Getenv("TMT_GO_CODEX_FIXTURE_LAUNCHER")}
	if root.Dir == "" {
		return
	}
	supervisor := startSupervisorFixture(t, root)
	if err := json.NewEncoder(os.Stdout).Encode(map[string]any{
		"generation": supervisor.lease.record.Generation, "endpoint": supervisor.lease.endpointProcess,
	}); err != nil {
		t.Fatal(err)
	}
	<-t.Context().Done()
}
