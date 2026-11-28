//go:build darwin || linux

package cli

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestUnbindDetachesSavedAndRetiresTemporaryOnPrivateTmux(t *testing.T) {
	server := tmuxtest.Start(t)
	pane := strings.TrimSpace(server.Run("display-message", "-p", "#{pane_id}"))
	pid := strings.TrimSpace(server.Run("display-message", "-p", "#{pid}"))
	const nativeMarker = "native-marker-to-preserve"
	server.Run("set-option", "-p", "-t", pane, "@tmt.agent", nativeMarker)
	claims := map[string]string{"TMUX": server.Socket + "," + pid + ",0", "TMUX_PANE": pane}
	lookup := func(key string) (string, bool) {
		v, ok := claims[key]
		return v, ok
	}
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv("TMT_GO_HOME", filepath.Join(world, "data"))
	app := application{store: bindingCommandStore(t), caller: callerSelector{lookup: lookup}}
	run := func(status int, args ...string) map[string]any {
		t.Helper()
		var stdout, stderr bytes.Buffer
		if got := app.run(t.Context(), append(args, "--json"), &stdout, &stderr); got != status || stderr.Len() != 0 {
			t.Fatalf("%q exit %d: %q, %q", args, got, &stdout, &stderr)
		}
		var doc map[string]any
		if err := json.Unmarshal(stdout.Bytes(), &doc); err != nil {
			t.Fatalf("%q: %v", &stdout, err)
		}
		return doc
	}
	if got := run(1, "unbind")["error"].(map[string]any)["code"]; got != "UNBOUND_PANE" {
		t.Fatalf("unbound pane: %v", got)
	}
	if got := server.Run("show-options", "-sqv", tmux.ServerIDOption); got != "" {
		t.Fatalf("unbind created Go server metadata: %q", got)
	}
	for _, life := range []core.Lifetime{core.LifetimeSaved, core.LifetimeTemporary} {
		args := []string{"name", string(life)}
		if life == core.LifetimeSaved {
			args = append(args, "--save")
		}
		bound := run(0, args...)
		id := bound["id"].(string)
		out := run(0, "unbind")
		if out["unbound"] != true || out["id"] != id || out["pane"] != pane || out["lifetime"] != string(life) ||
			out["retired"] != (life == core.LifetimeTemporary) {
			t.Fatalf("unbind: %v", out)
		}
		if goMarker := server.Run("show-options", "-pqv", "-t", pane, tmux.AgentOption); goMarker != "" {
			t.Fatalf("own marker not cleared: %q", goMarker)
		}
		if original := server.Run("show-options", "-pqv", "-t", pane, "@tmt.agent"); strings.TrimSpace(original) != nativeMarker {
			t.Fatalf("native pane marker changed: %q", original)
		}
		if life == core.LifetimeSaved {
			if got := run(0, "ls", id); got["presence"] != "offline" {
				t.Fatalf("saved identity was not kept offline: %v", got)
			}
		} else if got := run(5, "identity", "show", id, "--expect-name", string(life))["error"].(map[string]any)["code"]; got != "IDENTITY_CHANGED" {
			t.Fatalf("temporary identity was not retired: %v", got)
		}
	}
	claims["TMUX"] = server.Socket + ",1,0"
	if got := run(3, "unbind")["error"].(map[string]any)["code"]; got != "PANE_NOT_FOUND" {
		t.Fatalf("mismatched server claim: %v", got)
	}
}
