package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestCheckCapturesExplicitPrivatePaneWithPositionalLinePrecedence(t *testing.T) {
	server := tmuxtest.Start(t)
	t.Setenv(flavor.EnvHome, t.TempDir())
	pane := strings.TrimSpace(server.Run("new-window", "-d", "-P", "-F", "#{pane_id}", "-t", "t:",
		"/bin/sh", "-c", `printf 'private-capture-marker\n'; read -r ignored`))
	pid := strings.TrimSpace(server.Run("display-message", "-p", "-t", pane, "#{pid}"))
	app := systemApplication()
	app.caller.lookup = func(key string) (string, bool) {
		switch key {
		case "TMUX":
			return server.Socket + "," + pid + ",0", true
		case "TMUX_PANE":
			return pane, true
		}
		return "", false
	}
	// Use the captured marker from this private shell as the exact expected
	// payload, after the host reports the complete output.
	var screenText string
	waitForPrivateFake(t, t.Context(), func() (bool, error) {
		screen, err := app.live.capture(t.Context(), ports.PaneRef{Server: server.Socket, PaneID: pane}, ports.CaptureOpts{})
		screenText = screen.Text
		return strings.HasPrefix(screen.Text, "private-capture-marker\n"), err
	})
	assertResponse(t, app, []string{"check", pane, "0", "--lines", "8", "--json"}, 0, map[string]any{
		"target": pane, "pane": pane, "lines": float64(0), "output": screenText,
	})
	assertResponse(t, app, []string{"read", pane, "--capture-only", "--lines=0", "--json"}, 0, map[string]any{
		"target": pane, "pane": pane, "lines": float64(0), "output": screenText,
	})
}

func TestCheckRejectsMismatchedPinnedNameBeforeProbe(t *testing.T) {
	t.Setenv(flavor.EnvHome, t.TempDir())
	store, me, _ := requestIdentitiesFixture()
	app := application{
		store: callerTestStore{tx: callerTestTx{identityTxFake: identityTxFake{records: store.records}}},
		caller: callerSelector{probe: func(context.Context, ports.PaneRef) (core.EndpointProbe, error) {
			t.Fatal("mismatched pin probed a host")
			return core.EndpointProbe{}, nil
		}},
	}
	assertResponse(t, app, []string{"check", string(me.ID), "--capture-only", "--expect-name", "Old", "--json"}, 5, map[string]any{
		"error": map[string]any{"code": "IDENTITY_CHANGED", "message": "The identity " + string(me.ID) + " is now named 'Worker', not 'Old'."},
	})
}

func TestCheckPinsCaptureToActiveUUIDBeforeHostAccess(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv(flavor.EnvHome, filepath.Join(world, "state"))
	app := application{
		caller: callerSelector{probe: func(context.Context, ports.PaneRef) (core.EndpointProbe, error) {
			t.Fatal("inactive or changed pin probed a host")
			return core.EndpointProbe{}, nil
		}},
	}
	run := func(status int, args ...string) map[string]any {
		t.Helper()
		var out, diagnostic bytes.Buffer
		if got := app.run(t.Context(), append(args, "--json"), &out, &diagnostic); got != status || diagnostic.Len() != 0 {
			t.Fatalf("%q exit %d, want %d: %s %s", args, got, status, &out, &diagnostic)
		}
		var result map[string]any
		if err := json.Unmarshal(out.Bytes(), &result); err != nil {
			t.Fatalf("%q: %v", out.String(), err)
		}
		return result
	}
	original := run(0, "identity", "create", "Alice")
	id := original["identity"].(map[string]any)["id"].(string)
	pin := func(expected string, status int, code, message string) {
		t.Helper()
		assertResponse(t, app, []string{"read", id, "--capture-only", "--expect-name", expected, "--lines=0", "--json"}, status, map[string]any{
			"error": map[string]any{"code": code, "message": message},
		})
	}
	pin("aLiCe", 3, "NAME_NOT_FOUND", "Identity '"+id+"' is not active.")
	run(0, "mv", "Alice", "Reviewer")
	run(0, "identity", "create", "Alice")
	pin("Alice", 5, "IDENTITY_CHANGED", "The identity "+id+" is now named 'Reviewer', not 'Alice'.")
	run(0, "rm", "--force", "Reviewer")
	pin("Reviewer", 5, "IDENTITY_CHANGED", "The identity "+id+" has been retired.")
	missing := "12345678-abcd-4abc-abcd-987654321098"
	assertResponse(t, app, []string{"check", missing, "--capture-only", "--expect-name", "Alice", "--json"}, 3, map[string]any{
		"error": map[string]any{"code": "NAME_NOT_FOUND", "message": "Identity '" + missing + "' was not found."},
	})
}

func TestCheckExplicitLinesStillValidatesConfigBeforeStorage(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv(flavor.EnvHome, world)
	config := filepath.Join(world, "config.json")
	before := []byte(`{"defaults":{"captureLines":"12junk"}}`)
	if err := os.WriteFile(config, before, 0600); err != nil {
		t.Fatal(err)
	}
	assertResponse(t, application{}, []string{"check", "%14", "--lines=0", "--json"}, 1, map[string]any{
		"error": map[string]any{"code": "CONFIG_ERROR", "message": "Could not read capture settings."},
	})
	if data, err := os.ReadFile(config); err != nil || !bytes.Equal(data, before) {
		t.Fatalf("config = %q, %v", data, err)
	}
	if _, err := os.Stat(filepath.Join(world, flavor.DatabaseName)); !os.IsNotExist(err) {
		t.Fatalf("invalid config touched the database: %v", err)
	}
}
