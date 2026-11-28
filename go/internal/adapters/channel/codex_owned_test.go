//go:build darwin || linux

package channel

import (
	"context"
	"errors"
	"io/fs"
	"net/netip"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const fakeCodexListener = "printf 'listening on: ws://127.0.0.1:49000\n' >&2\nexec /bin/sleep 30\n"

func TestOwnedCodexAppServerUsesPrivateGenerationAndReaps(t *testing.T) {
	root, plan := codexFixturePlan(t, fakeCodexListener)
	observer := runtime.Observer{Process: process.Runner{}}
	generation := launchGeneration()
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	server, err := startOwnedCodex(ctx, root, generation, plan, observer)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.stop() })
	path := filepath.Join(ClaudeDirectory(root), codexDirectory, generation)
	if server.process.PID != uint64(server.child.Pid) || server.endpoint.address != netip.MustParseAddrPort("127.0.0.1:49000") {
		t.Fatal("startup did not return the owned child and its announced address")
	}
	for _, tc := range []struct {
		path string
		mode os.FileMode
	}{
		{path, 0700}, {filepath.Join(path, codexCapabilityFile), 0600}, {filepath.Join(path, codexServerLog), 0600},
	} {
		info, err := os.Lstat(tc.path)
		if err != nil || info.Mode().Perm() != tc.mode {
			t.Fatalf("entry %s mode: %v, %v", filepath.Base(tc.path), info, err)
		}
	}
	token, err := os.ReadFile(filepath.Join(path, codexCapabilityFile))
	if err != nil || !validCodexToken(string(token)) || string(token) != server.endpoint.token {
		t.Fatal("wrong capability in private file")
	}
	if err := server.stop(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(path); !errors.Is(err, fs.ErrNotExist) {
		t.Fatalf("generation still present: %v", err)
	}
	if state := processState(t.Context(), observer, server.process); state != runtime.Gone {
		t.Fatalf("app-server did not end: %v", state)
	}
	if err := server.stop(); err != nil {
		t.Fatal(err)
	}
}

func TestOwnedCodexStartupFailureCleansOnlyItsGeneration(t *testing.T) {
	for _, tc := range []struct {
		name, script string
		missing      bool
	}{
		{"timeout", "exec /bin/sleep 30\n", false},
		{"oversized", "/usr/bin/head -c 65537 /dev/zero >&2\nexec /bin/sleep 30\n", false},
		{"spawn refused", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root, plan := codexFixturePlan(t, tc.script)
			if tc.missing {
				plan.selected.Path = filepath.Join(root.Dir, "missing-codex")
			}
			generation := launchGeneration()
			ctx, cancel := context.WithTimeout(t.Context(), 400*time.Millisecond)
			defer cancel()
			observer := runtime.Observer{Process: process.Runner{}}
			server, err := startOwnedCodex(ctx, root, generation, plan, observer)
			if server != nil || !errors.Is(err, errCodexStartup) || errors.Is(err, errCodexCleanup) {
				t.Fatalf("startup = %t, %v", server != nil, err)
			}
			if _, err := os.Lstat(filepath.Join(ClaudeDirectory(root), codexDirectory, generation)); !errors.Is(err, fs.ErrNotExist) {
				t.Fatalf("failed startup retained files: %v", err)
			}
		})
	}
}

func TestOwnedCodexCleanupPreservesReplacementFile(t *testing.T) {
	root, plan := codexFixturePlan(t, fakeCodexListener)
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	observer := runtime.Observer{Process: process.Runner{}}
	server, err := startOwnedCodex(ctx, root, launchGeneration(), plan, observer)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.stop() })
	path := filepath.Join(server.files.path, codexCapabilityFile)
	if err := os.Rename(path, path+".old"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("replacement"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := server.stop(); !errors.Is(err, errCodexCleanup) {
		t.Fatalf("cleanup reported a replaced file removed: %v", err)
	}
	content, err := os.ReadFile(path)
	if err != nil || string(content) != "replacement" {
		t.Fatalf("replacement was modified: %v", err)
	}
	if state := processState(t.Context(), observer, server.process); state != runtime.Gone {
		t.Fatalf("app-server did not end: %v", state)
	}
}

func TestCodexAnnouncementRequiresCompleteLoopbackAddress(t *testing.T) {
	for _, line := range []string{
		"listening on: ws://127.0.0.1:49000",
		"listening on: ws://127.0.0.1:0\n",
		"listening on: ws://0.0.0.0:49000\n",
		"listening on: ws://remote:49000\n",
		"listening on: ws://[::1]:49000\n",
	} {
		if _, ok := announcedCodexAddress([]byte(line)); ok {
			t.Errorf("accepted announcement %q", line)
		}
	}
	if got, ok := announcedCodexAddress([]byte("note\n  listening on: ws://127.0.0.1:49000\n")); !ok ||
		got != netip.MustParseAddrPort("127.0.0.1:49000") {
		t.Fatalf("loopback announcement = %v, %t", got, ok)
	}
}

func codexFixturePlan(t *testing.T, script string) (home.Root, CodexPlan) {
	t.Helper()
	root := home.Root{Dir: t.TempDir()}
	path := filepath.Join(root.Dir, "fake-codex")
	if err := os.WriteFile(path, []byte("#!/bin/sh\n"+script), 0700); err != nil {
		t.Fatal(err)
	}
	plan, err := PlanCodexLaunch(ports.ProcessSpec{Path: path}, root.Dir, "")
	if err != nil {
		t.Fatal(err)
	}
	return root, plan
}

func TestCodexEnrollmentDeadlineUsesSuppliedAbsoluteBudget(t *testing.T) {
	requested := time.Now().Add(codexStartupBudget)
	if got := codexDeadline(t.Context(), requested); !got.Equal(requested) {
		t.Fatalf("enrollment deadline = %v, want %v", got, requested)
	}
}
