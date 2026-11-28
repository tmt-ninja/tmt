package codex

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func npmShimFixture(t *testing.T) (executable, script, manifest string) {
	t.Helper()
	root := t.TempDir()
	bin := filepath.Join(root, "node_modules", "@openai", "codex", "bin")
	if err := os.MkdirAll(bin, 0700); err != nil {
		t.Fatal(err)
	}
	script = filepath.Join(bin, "codex.js")
	if err := os.WriteFile(script, []byte("#!/usr/bin/env node\n"), 0700); err != nil {
		t.Fatal(err)
	}
	manifest = filepath.Join(filepath.Dir(bin), "package.json")
	writePermissionFixture(t, manifest, `{"name":"@openai/codex","bin":{"codex":"bin/codex.js"}}`)
	executable = filepath.Join(root, "codex")
	if err := os.Symlink(script, executable); err != nil {
		t.Fatal(err)
	}
	return executable, script, manifest
}

func TestNpmSelectedPackageAndRunningScriptMustAgree(t *testing.T) {
	executable, script, manifest := npmShimFixture(t)
	selected, err := InspectNpmLauncher(ports.ProcessSpec{Path: executable})
	if err != nil || selected == nil {
		t.Fatalf("npm shim = %+v, %v", selected, err)
	}
	if !selected.unchanged() || !selected.matchesArguments("/usr/bin/node "+script+" --no-daemon") ||
		selected.matchesArguments("node /other/codex.js") || selected.matchesArguments("arbitrary "+script) {
		t.Fatal("selected package and running script did not require exact evidence")
	}
	writePermissionFixture(t, manifest, `{"name":"other","bin":{"codex":"bin/codex.js"}}`)
	if selected.unchanged() {
		t.Fatal("replacement manifest did not invalidate selection")
	}
	if selected, err := InspectNpmLauncher(ports.ProcessSpec{Path: executable}); selected != nil || err == nil {
		t.Fatalf("foreign package = %+v, %v", selected, err)
	}
}

func TestNpmDirectLaunchRemainsDistinctFromUnprovedShim(t *testing.T) {
	executable, script, manifest := npmShimFixture(t)
	if err := os.Remove(executable); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(executable, []byte("native fixture"), 0700); err != nil {
		t.Fatal(err)
	}
	if got, err := InspectNpmLauncher(ports.ProcessSpec{Path: executable}); got != nil || err != nil {
		t.Fatalf("direct fixture = %+v, %v", got, err)
	}
	if err := os.Remove(executable); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(script, executable); err != nil {
		t.Fatal(err)
	}
	writePermissionFixture(t, manifest, `{"name":"@openai/codex","bin":{"codex":"wrong.js"}}`)
	if got, err := InspectNpmLauncher(ports.ProcessSpec{Path: executable}); got != nil || err == nil {
		t.Fatalf("unproved shim was treated as direct executable: %+v, %v", got, err)
	}
}
