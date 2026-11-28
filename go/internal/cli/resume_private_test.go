//go:build darwin || linux

package cli

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestResumeForegroundUsesSavedCodexSession(t *testing.T) {
	t.Run("direct", func(t *testing.T) { testResumeForeground(t, false) })
	t.Run("saved exec wrapper", func(t *testing.T) { testResumeForeground(t, true) })
}

func testResumeForeground(t *testing.T, replay bool) {
	server := tmuxtest.Start(t)
	world := t.TempDir()
	t.Setenv(home.EnvHome, filepath.Join(world, "state"))
	binary := filepath.Join(world, flavor.Binary)
	fakeBin := filepath.Join(world, "bin")
	if err := os.Mkdir(fakeBin, 0700); err != nil {
		t.Fatal(err)
	}
	fake := filepath.Join(fakeBin, "codex")
	for _, provider := range []string{"claude", "gemini"} {
		if err := os.WriteFile(filepath.Join(fakeBin, provider), []byte("#!/bin/sh\nexit 97\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	for _, spec := range [][2]string{{binary, "../../cmd/tmt-go"}, {fake, "../../test/fixtures/fakeprovider"}} {
		cmd := privateFixtureBuild(ctx, spec[0], spec[1])
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("build %s: %v %q", spec[1], err, output)
		}
	}
	tmuxExecutable, err := exec.LookPath("tmux")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(tmuxExecutable, filepath.Join(fakeBin, "tmux")); err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", world)
	root, err := home.Resolve(os.LookupEnv, world)
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	const identity core.IdentityID = "da3c6d1e-f088-4e0e-a839-7b126d4eb840"
	const session = "ed3e0815-19b0-468f-897d-c4217150d2df"
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		return tx.Identities().Insert(core.Identity{ID: identity, Name: "Worker", CanonicalName: "worker", Lifetime: core.LifetimeSaved}, 1000)
	}); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", root.Database)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO identity_session_preferences (identity_id,preferred_harness,remembered_harness,runtime_mode,provider_session_id,channel)
 VALUES(?,'codex','codex','embedded',?,0)`, identity, session); err != nil {
		t.Fatal(err)
	}
	wrapperRecord := filepath.Join(world, "wrapper-argv")
	if replay {
		wrapper := filepath.Join(world, "saved-wrapper")
		// The saved launcher can only execute the exact Go fixture built
		// above. It never resolves a provider through the host PATH.
		script := "#!/bin/sh\nprintf '%s\\n' \"$@\" > " + core.CommandWord(wrapperRecord) +
			" || exit\nexec " + core.CommandWord(fake) + " \"$@\"\n"
		if err := os.WriteFile(wrapper, []byte(script), 0700); err != nil {
			t.Fatal(err)
		}
		preset, err := json.Marshal(map[string]any{
			"executable": wrapper, "model": "fixture-model", "effort": nil, "env": map[string]string{},
			"binding": "d092a9fe-c775-455d-9217-135450d5061a", "owner_pid": 42,
			"owner_start": "ps-v1:Sat Jan 1 00:00:00 2000", "harness": "codex", "session": session,
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO identity_metadata(identity_id,key,value) VALUES(?,'resume.launch',?)`,
			identity, string(preset)); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	host, err := newTmuxClient()
	if err != nil {
		t.Fatal(err)
	}
	statusPath := filepath.Join(world, "status")
	diagnostics := filepath.Join(world, "diagnostic")
	pane, err := host.Launch(ctx, ports.LaunchSpec{Server: server.Socket, Session: "t", Window: "resume-provider", Dir: world,
		Command: ports.ProcessSpec{Path: "/bin/sh", Args: []string{"-c", `PATH="$5:/usr/bin:/bin"
HOME="$6"
CODEX_HOME="$6/fake-codex-home"
CLAUDE_CONFIG_DIR="$6/fake-claude-home"
GEMINI_CLI_HOME="$6/fake-gemini-home"
export PATH HOME CODEX_HOME CLAUDE_CONFIG_DIR GEMINI_CLI_HOME
for provider in claude codex gemini; do
  expected="$5/$provider"
  if [ "$(command -v "$provider")" != "$expected" ] || [ ! -f "$expected" ] || [ ! -x "$expected" ] || [ -L "$expected" ]; then
    printf 'fixture executable check failed for %s\n' "$provider" > "$4"
    printf '98\n' > "$3"
    exit 98
  fi
done
/bin/stty -echo || exit
"$1" resume -- "$2" 2>"$4"
printf '%s\n' "$?" > "$3"
IFS= read -r ignored`, "fixture", binary, string(identity), statusPath, diagnostics, fakeBin, world},
			Env: []string{"HOME=" + world, home.EnvHome + "=" + root.Dir, "PATH=" + fakeBin + ":/usr/bin:/bin"}}})
	if err != nil {
		t.Fatal(err)
	}
	var active core.Binding
	waitForPrivateFake(t, ctx, func() (bool, error) {
		err := store.Read(ctx, func(tx ports.StoreTx) error {
			snapshot, err := tx.Bindings().ReadResume(identity)
			if err == nil && snapshot != nil && snapshot.PriorBinding != nil && snapshot.Selected != nil && snapshot.Selected.ProviderSession == session {
				active = *snapshot.PriorBinding
			}
			return err
		})
		if active.Session.RuntimeState != "running" {
			if exit, readErr := os.ReadFile(statusPath); readErr == nil {
				message, _ := os.ReadFile(diagnostics)
				t.Fatalf("resume exited before runtime admission: %q %q", exit, message)
			}
		}
		return active.Session.RuntimeState == "running" && active.Session.Runtime != nil && active.PaneID == pane.PaneID, err
	})
	if replay {
		args, err := os.ReadFile(wrapperRecord)
		if err != nil || string(args) != "resume\n-m\nfixture-model\n"+session+"\n--no-daemon\n" {
			t.Fatalf("saved wrapper did not receive the replay command: %q, %v", args, err)
		}
	}
	waitForPrivateFake(t, ctx, func() (bool, error) {
		screen, err := host.Capture(ctx, pane, ports.CaptureOpts{})
		return (codex.Driver{}).Classify(screen) == ports.DriverIdle, err
	})
	cmd := exec.CommandContext(ctx, binary, "talk", "Worker", "verify exact resume", "--timeout", "5", "--json")
	cmd.Env = append(tmuxtest.Env(), "HOME="+world, home.EnvHome+"="+root.Dir)
	out, err := cmd.CombinedOutput()
	var reply struct{ Status, Response string }
	if err != nil || json.Unmarshal(out, &reply) != nil || reply.Status != "completed" || reply.Response != "ack: verify exact resume" {
		screen, _ := host.Capture(ctx, pane, ports.CaptureOpts{})
		t.Fatalf("talk after resumed run: %v %q, private pane %q", err, out, screen.Text)
	}
	waitForPrivateFake(t, ctx, func() (bool, error) {
		exit, err := os.ReadFile(statusPath)
		if os.IsNotExist(err) {
			return false, nil
		}
		return string(exit) == "0\n", err
	})
	var ended *core.ResumeSnapshot
	if err := store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		ended, err = tx.Bindings().ReadResume(identity)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if ended == nil || ended.PriorBinding == nil || ended.Selected == nil || ended.Selected.ProviderSession != session ||
		ended.PriorBinding.ID != active.ID || ended.PriorBinding.Session.RuntimeState != "ended" {
		t.Fatalf("resume did not preserve session and settle recorded foreground: %+v", ended)
	}
}
