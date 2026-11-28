//go:build darwin || linux

package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestBindingCommandsUseOnlyGoMetadataOnPrivateTmux(t *testing.T) {
	server := tmuxtest.Start(t)
	pane := strings.TrimSpace(server.Run("display-message", "-p", "#{pane_id}"))
	target := strings.TrimSpace(server.Run("display-message", "-p", "#{session_name}:#{window_index}.#{pane_index}"))
	pid := strings.TrimSpace(server.Run("display-message", "-p", "#{pid}"))
	const nativePane = `{"version":1,"native":"untouched"}`
	const nativeServer = "47056d21-31b6-4f04-af6b-5b48ee610513"
	server.Run("set-option", "-p", "-t", pane, otherFlavorTMUXOption("agent"), nativePane)
	server.Run("set-option", "-s", otherFlavorTMUXOption("server-id"), nativeServer)

	lookup := func(key string) (string, bool) {
		value, present := map[string]string{
			"TMUX": server.Socket + "," + pid + ",0", "TMUX_PANE": pane,
		}[key]
		return value, present
	}
	store := bindingCommandStore(t)
	cli := newBindingCLI(store, lookup)
	if cli.host == nil {
		t.Fatal("private tmux host unavailable")
	}
	run := func(args ...string) map[string]any {
		t.Helper()
		inv, failure := parse(append(args, "--json"))
		if failure != nil {
			t.Fatalf("parse %v: %+v", args, failure)
		}
		report := cli.run(t.Context(), inv)
		if report.ExitStatus() != 0 {
			t.Fatalf("command %v: %+v", args, report.JSON())
		}
		return bindingTestJSON(t, report)
	}
	if got := run("whoami"); got["bound"] != false || got["pane"] != pane || got["session"] != nil {
		t.Fatalf("unbound caller = %+v", got)
	}
	bound := run("add", target, "Example")
	if bound["bound"] != true || bound["pane"] != pane || bound["lifetime"] != "temporary" {
		t.Fatalf("add = %+v", bound)
	}
	id := bound["id"]
	if got := run("name", "--save", "example"); got["id"] != id || got["lifetime"] != "saved" {
		t.Fatalf("same pane promotion = %+v", got)
	}
	if got := run("whoami"); got["id"] != id || got["interfaceKind"] != "container" || got["bound"] != true {
		t.Fatalf("bound caller = %+v", got)
	}
	if got := run("ls", "EXAMPLE"); got["presence"] != "active" || got["address"] != "tmux:"+pane {
		t.Fatalf("named listing = %+v", got)
	}
	if got := run("ls", pane); got["identity"].(map[string]any)["id"] != id {
		t.Fatalf("pane listing = %+v", got)
	}
	if got := run("ls", "--here"); len(got["identities"].([]any)) != 1 {
		t.Fatalf("session listing = %+v", got)
	}
	if got := run("ls", "--temp"); len(got["identities"].([]any)) != 0 {
		t.Fatalf("temporary filter = %+v", got)
	}
	moved := run("mv", "example", "Renamed")
	if moved["previousName"] != "Example" || moved["renamed"] != true ||
		moved["identity"].(map[string]any)["id"] != id || moved["pane"].(map[string]any)["updated"] != true {
		t.Fatalf("mv = %+v", moved)
	}
	inv, failure := parse([]string{"rm", "renamed"})
	if failure != nil {
		t.Fatal(failure)
	}
	report := cli.run(t.Context(), inv)
	if failure, ok := report.(*output.Failure); !ok || failure.Code != "CONFIRMATION_REQUIRED" || report.ExitStatus() != 5 {
		t.Fatalf("saved removal confirmation = %+v", report.JSON())
	}
	if got := run("rm", "--force", "renamed"); got["removed"] != true || got["identity"].(map[string]any)["id"] != id {
		t.Fatalf("rm = %+v", got)
	}
	if got := run("whoami"); got["bound"] != false {
		t.Fatalf("caller was still bound: %+v", got)
	}
	if option := server.Run("show-options", "-pqv", "-t", pane, tmux.AgentOption); option != "" {
		t.Fatalf("Go marker was not cleared: %q", option)
	}
	if option := server.Run("show-options", "-pv", "-t", pane, otherFlavorTMUXOption("agent")); option != nativePane+"\n" {
		t.Fatalf("native pane metadata changed: %q", option)
	}
	if option := server.Run("show-options", "-sv", otherFlavorTMUXOption("server-id")); option != nativeServer+"\n" {
		t.Fatalf("native server ID changed: %q", option)
	}

	automatic, err := core.ValidateName("claude-auto")
	if err != nil {
		t.Fatal(err)
	}
	claimed, refusal := cli.bind(t.Context(), ports.PaneRef{Server: server.Socket, PaneID: pane},
		0, bindingSelection{name: automatic, autoNamed: true})
	if refusal != nil || claimed.identity == nil || !claimed.identity.AutoNamed {
		t.Fatalf("automatic binding = %+v, %v", claimed, refusal)
	}
	named := run("name", "--save", "Ready")
	if named["id"] != string(claimed.identity.ID) || named["name"] != "Ready" || named["lifetime"] != "saved" {
		t.Fatalf("name replaced the auto-named identity: %+v", named)
	}
}

func bindingCommandStore(t *testing.T) *storage.Storage {
	t.Helper()
	user := t.TempDir()
	root, err := home.Resolve(func(key string) (string, bool) {
		if key == home.EnvHome {
			return filepath.Join(user, "go"), true
		}
		return "", false
	}, user)
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	return store
}

func bindingTestJSON(t *testing.T, report output.Report) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(report.JSON())
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(fmt.Errorf("parse binding output: %w", err))
	}
	return decoded
}

// The alternate namespace remains untouched by both flavors.
func otherFlavorTMUXOption(name string) string {
	if flavor.NativeCompatible {
		return "@tmt-go." + name
	}
	return "@tmt." + name
}

func TestListHerePinsCallerSessionAndServerBeforeOpeningStorage(t *testing.T) {
	server := tmuxtest.Start(t)
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv(flavor.EnvHome, filepath.Join(world, "state"))
	pane := strings.TrimSpace(server.Run("display-message", "-p", "#{pane_id}"))
	peer := strings.TrimSpace(server.Run("new-session", "-d", "-s", "separate", "-P", "-F", "#{pane_id}", "cat"))
	pid := strings.TrimSpace(server.Run("display-message", "-p", "#{pid}"))

	app := systemApplication()
	claim := server.Socket + "," + pid + ",0"
	app.caller.lookup = func(key string) (string, bool) {
		switch key {
		case "TMUX":
			return claim, true
		case "TMUX_PANE":
			return pane, true
		}
		return "", false
	}
	run := func(status int, args ...string) string {
		t.Helper()
		var out, stderr bytes.Buffer
		if got := app.run(t.Context(), append(args, "--json"), &out, &stderr); got != status || stderr.Len() != 0 {
			t.Fatalf("%q exit %d, stdout=%q stderr=%q", args, got, &out, &stderr)
		}
		return out.String()
	}
	run(0, "add", pane, "Here")
	run(0, "add", peer, "Elsewhere")
	var rows struct{ Identities []struct{ Name string } }
	if data := run(0, "ls", "--here"); json.Unmarshal([]byte(data), &rows) != nil ||
		len(rows.Identities) != 1 || rows.Identities[0].Name != "Here" {
		t.Fatalf("here list = %s", data)
	}

	fresh := filepath.Join(world, "must-not-open")
	t.Setenv(flavor.EnvHome, fresh)
	actualPID, err := strconv.Atoi(pid)
	if err != nil {
		t.Fatal(err)
	}
	claim = server.Socket + "," + strconv.Itoa(actualPID+1) + ",0"
	if data := run(3, "ls", "--here"); !strings.Contains(data, "PANE_NOT_FOUND") {
		t.Fatalf("stale caller claim = %s", data)
	}
	if _, err := os.Stat(fresh); !os.IsNotExist(err) {
		t.Fatalf("unverified caller opened storage: %v", err)
	}
}
