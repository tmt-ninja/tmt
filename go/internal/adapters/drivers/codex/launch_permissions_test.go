package codex

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestCodexManagedGrantTracksExplicitModesAndPromptBoundaries(t *testing.T) {
	for _, tc := range []struct {
		args []string
		mode sandboxMode
		keep bool
	}{
		{nil, sandboxWorkspaceWrite, true},
		{nil, sandboxUnknown, true},
		{nil, sandboxReadOnly, false},
		{nil, sandboxFullAccess, false},
		{[]string{"-p", "custom"}, sandboxUnknown, true},
		{[]string{"-c", `sandbox_mode="read-only"`}, sandboxReadOnly, true},
		{[]string{"--config=permissions.default=custom"}, sandboxReadOnly, true},
		{[]string{"-s", "read-only"}, sandboxWorkspaceWrite, false},
		{[]string{"--sandbox=workspace-write"}, sandboxReadOnly, true},
		{[]string{"-sread-only"}, sandboxWorkspaceWrite, false},
		{[]string{"--sandbox=danger-full-access"}, sandboxWorkspaceWrite, false},
		{[]string{"-s", "read-only", "-s", "workspace-write"}, sandboxReadOnly, true},
		{[]string{"--approve-for-me"}, sandboxReadOnly, true},
		{[]string{"--dangerously-bypass-approvals-and-sandbox"}, sandboxWorkspaceWrite, false},
		{[]string{"-m", "--sandbox=read-only"}, sandboxWorkspaceWrite, true},
		{[]string{"--", "-s", "read-only"}, sandboxWorkspaceWrite, true},
		{[]string{"a prompt", "-s", "read-only"}, sandboxWorkspaceWrite, true},
		{[]string{"--add-dir", "--sandbox=read-only"}, sandboxWorkspaceWrite, true},
		{[]string{"resume", "-s", "read-only", "session"}, sandboxWorkspaceWrite, false},
	} {
		if got := keepStateGrant(tc.args, func(*string) sandboxMode { return tc.mode }); got != tc.keep {
			t.Errorf("state grant for %q with mode %v = %t, want %t", tc.args, tc.mode, got, tc.keep)
		}
	}
}

func TestCodexManagedGrantReadsPrivateSettingsAndSelectedProfile(t *testing.T) {
	dir := t.TempDir()
	home := filepath.Join(dir, "replayed")
	if err := os.Mkdir(home, 0700); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(home, "config.toml")
	command := ports.ProcessSpec{Path: filepath.Join(dir, "codex"), Dir: dir,
		Env: []string{"HOME=" + dir, "CODEX_HOME=replayed"}}
	if got := PrepareManagedLaunch(command, "/state", false); !slices.Equal(got.Args, []string{"--no-daemon", "--add-dir", "/state"}) {
		t.Fatalf("missing settings argv = %q", got.Args)
	}
	if _, err := os.Stat(config); !os.IsNotExist(err) {
		t.Fatalf("preparation created settings: %v", err)
	}
	for _, tc := range []struct {
		config string
		grant  bool
	}{
		{"", true},
		{"[projects.\"/work\"]\ntrust_level = \"trusted\"\n", true},
		{"[projects.\"/work\"]\ntrust_level = \"untrusted\"\n", true},
		{"approval_policy = \"never\"\n", true},
		{"sandbox_mode = \"workspace-write\"\napproval_policy = \"on-request\"\n", true},
		{"sandbox_mode = \"read-only\"\n", false},
		{"sandbox_mode = \"future-mode\"\n", true},
		{"sandbox_mode = 42\n", true},
		{"not valid TOML {", true},
		{"[permissions]\ndefault = \"custom\"\n", true},
	} {
		writePermissionFixture(t, config, tc.config)
		got := PrepareManagedLaunch(command, "/state", false)
		if slices.Contains(got.Args, "--add-dir") != tc.grant {
			t.Errorf("config %q produced argv %q, grant wanted %t", tc.config, got.Args, tc.grant)
		}
		if data, err := os.ReadFile(config); err != nil || string(data) != tc.config {
			t.Fatalf("settings changed: %q, %v", data, err)
		}
	}

	writePermissionFixture(t, config, "sandbox_mode=\"workspace-write\"\n[profiles.reader]\nsandbox_mode=\"read-only\"\n")
	command.Args = []string{"-p", "reader"}
	if got := PrepareManagedLaunch(command, "/state", false); slices.Contains(got.Args, "--add-dir") {
		t.Fatalf("embedded reader profile received a write directory: %q", got.Args)
	}
	command.Args = []string{"-p", "missing"}
	if got := PrepareManagedLaunch(command, "/state", false); !slices.Contains(got.Args, "--add-dir") {
		t.Fatalf("missing profile dropped the ordinary grant: %q", got.Args)
	}
	command.Args = []string{"-p", "reader"}
	profile := filepath.Join(home, "reader.config.toml")
	const sibling = "sandbox_mode=\"workspace-write\"\n"
	writePermissionFixture(t, profile, sibling)
	if got := PrepareManagedLaunch(command, "/state", false); !slices.Contains(got.Args, "--add-dir") {
		t.Fatalf("sibling profile did not supersede the embedded profile: %q", got.Args)
	}
	if data, err := os.ReadFile(profile); err != nil || string(data) != sibling {
		t.Fatalf("profile changed: %q, %v", data, err)
	}

	if err := os.Remove(config); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(config, 0700); err != nil {
		t.Fatal(err)
	}
	command.Args = nil
	if got := PrepareManagedLaunch(command, "/state", false); !slices.Contains(got.Args, "--add-dir") {
		t.Fatalf("unreadable settings dropped the ordinary grant: %q", got.Args)
	}
}

func TestCodexManagedFreshResumeAndUnmanagedInvocations(t *testing.T) {
	dir := t.TempDir()
	command := ports.ProcessSpec{Path: filepath.Join(dir, "codex"), Dir: dir,
		Env: []string{"CODEX_HOME=" + dir}}
	for _, tc := range []struct {
		args, want []string
		exact      bool
	}{
		{[]string{"-m", "model"}, []string{"--no-daemon", "--add-dir", "/state", "-m", "model"}, false},
		{[]string{"resume", "session", "--no-daemon"}, []string{"resume", "--add-dir", "/state", "session", "--no-daemon"}, true},
		{[]string{"--remote", "ws://localhost"}, []string{"--remote", "ws://localhost"}, false},
		{[]string{"app-server"}, []string{"app-server"}, false},
		{[]string{"--", "--remote"}, []string{"--no-daemon", "--add-dir", "/state", "--", "--remote"}, false},
		{[]string{"--add-dir", "/state"}, []string{"--no-daemon", "--add-dir", "/state"}, false},
		{[]string{"--add-dir", "/user-root"}, []string{"--no-daemon", "--add-dir", "/state", "--add-dir", "/user-root"}, false},
	} {
		command.Args = slices.Clone(tc.args)
		prepared := PrepareManagedLaunch(command, "/state", tc.exact)
		if !slices.Equal(prepared.Args, tc.want) || !slices.Equal(command.Args, tc.args) {
			t.Errorf("prepare %q = %q, input %q, want %q", tc.args, prepared.Args, command.Args, tc.want)
		}
	}
	writePermissionFixture(t, filepath.Join(dir, "config.toml"), "sandbox_mode = \"read-only\"\n")
	command.Args = []string{"resume", "session", "--no-daemon"}
	if got := PrepareManagedLaunch(command, "/state", true); !slices.Equal(got.Args, command.Args) {
		t.Fatalf("read-only exact resume changed provider args: %q", got.Args)
	}
	command.Path = filepath.Join(dir, "wrapper")
	if got := PrepareManagedLaunch(command, "/state", true); !slices.Equal(got.Args, []string{"resume", "--add-dir", "/state", "session", "--no-daemon"}) {
		t.Fatalf("wrapper treated the caller's default as policy evidence: %q", got.Args)
	}
}

func writePermissionFixture(t *testing.T, path, text string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
}
