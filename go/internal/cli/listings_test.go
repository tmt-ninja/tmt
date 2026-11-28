package cli

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
)

func TestListingsReadOnlyAndKeepPATHSeparateFromApproval(t *testing.T) {
	world := t.TempDir()
	root := filepath.Join(world, "root")
	first, second := filepath.Join(world, "first"), filepath.Join(world, "second")
	for _, directory := range []string{first, second} {
		if err := os.Mkdir(directory, 0700); err != nil {
			t.Fatal(err)
		}
		// The body would create a marker if listing ever ran the executable.
		if err := os.WriteFile(filepath.Join(directory, "tmt-ops"), []byte("#!/bin/sh\n: > "+core.CommandWord(filepath.Join(world, "executed"))+"\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("HOME", world)
	t.Setenv(flavor.EnvHome, root)
	t.Setenv("PATH", strings.Join([]string{first, second, first}, string(os.PathListSeparator)))
	t.Setenv("TMUX", "")
	t.Setenv("TMUX_PANE", "")
	t.Setenv("TMT_PTY_PANE", "")
	t.Setenv("TMT_PTY_SOCKET", "")
	run := func(target any, args ...string) {
		t.Helper()
		var out, stderr bytes.Buffer
		if status := (application{}).run(t.Context(), append(args, "--json"), &out, &stderr); status != 0 || stderr.Len() != 0 {
			t.Fatalf("%q exit %d: %q, %q", args, status, &out, &stderr)
		}
		if err := json.Unmarshal(out.Bytes(), target); err != nil {
			t.Fatalf("%q: %v", &out, err)
		}
	}
	var extensions extensionListReport
	run(&extensions, "extension", "ls")
	if len(extensions.Extensions) != 4 {
		t.Fatalf("inventory: %+v", extensions)
	}
	ops := extensions.Extensions[0]
	if ops.Installed || !ops.Missing || !slices.Equal(ops.ShadowedBy, []string{filepath.Join(first, "tmt-ops"), filepath.Join(second, "tmt-ops")}) {
		t.Fatalf("ops: %+v", ops)
	}
	var drivers struct{ Drivers []any }
	run(&drivers, "driver", "list")
	if drivers.Drivers == nil || len(drivers.Drivers) != 0 {
		t.Fatalf("drivers: %+v", drivers)
	}
	var hosts hostListReport
	run(&hosts, "host", "templates")
	if len(hosts.Hosts) != 2 || hosts.Hosts[0].Host != "tmux" || hosts.CallerHost != nil ||
		strings.Contains(strings.Join(hosts.Hosts[0].Launch.Argv, " "), "@tmt.") {
		t.Fatalf("hosts: %+v", hosts)
	}
	t.Setenv("TMUX", "/invalid/advisory.sock,1,0")
	run(&hosts, "host", "templates")
	if hosts.CallerHost == nil || *hosts.CallerHost != "tmux" {
		t.Fatalf("advisory host: %+v", hosts)
	}
	for _, path := range []string{root, filepath.Join(world, "executed")} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Fatalf("listing made a change at %s: %v", path, err)
		}
	}
}
