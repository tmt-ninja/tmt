package cli

import (
	"context"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestCheckCapturesExplicitPrivatePaneWithPositionalLinePrecedence(t *testing.T) {
	server := tmuxtest.Start(t)
	t.Setenv("TMT_GO_HOME", t.TempDir())
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
}

func TestCheckRejectsMismatchedPinnedNameBeforeProbe(t *testing.T) {
	t.Setenv("TMT_GO_HOME", t.TempDir())
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
