package cli

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestRunBindsAndPreparesProviderBeforeForegroundLaunch(t *testing.T) {
	server := tmuxtest.Start(t)
	root := t.TempDir()
	t.Setenv(flavor.EnvHome, root)
	provider := filepath.Join(t.TempDir(), "codex")
	if err := os.WriteFile(provider, []byte("#!/bin/sh\nexit 99\n"), 0700); err != nil {
		t.Fatal(err)
	}
	pane := strings.TrimSpace(server.Run("display-message", "-p", "#{pane_id}"))
	pid := strings.TrimSpace(server.Run("display-message", "-p", "-t", pane, "#{pid}"))
	const nativeMarker = "native marker must survive"
	server.Run("set-option", "-p", "-t", pane, otherFlavorTMUXOption("agent"), nativeMarker)
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
	var launched bool
	app.launch = func(ctx context.Context, found home.Root, store ports.Store, entry bindingEntry, plan runPlan, _, _ io.Writer) int {
		launched = true
		if found.Dir != root || entry.identity.Name != "Worker" || entry.identity.Lifetime != core.LifetimeSaved ||
			entry.binding.PaneID != pane || entry.binding.Server.Socket != server.Socket || plan.provider != "codex" ||
			plan.command.Path != provider || !strings.Contains(strings.Join(plan.command.Args, " "), "--model provider-owned") {
			t.Fatalf("foreground launch received %+v, %+v, %+v", found, entry, plan)
		}
		if err := store.Read(ctx, func(tx ports.StoreTx) error {
			binding, err := tx.Bindings().FindByIdentity(entry.identity.ID)
			if err == nil && (binding == nil || binding.ID != entry.binding.ID) {
				return errors.New("foreground launch did not receive a committed binding")
			}
			return err
		}); err != nil {
			t.Fatal(err)
		}
		if native := server.Run("show-options", "-p", "-v", "-t", pane, otherFlavorTMUXOption("agent")); native != nativeMarker+"\n" {
			t.Fatalf("native pane marker changed: %q", native)
		}
		return 7
	}
	var stdout, stderr bytes.Buffer
	if status := app.run(t.Context(), []string{"run", "--save", "Worker", provider, "--model", "provider-owned"}, &stdout, &stderr); status != 7 ||
		!launched || stderr.Len() != 0 {
		t.Fatalf("run exit=%d launched=%t stdout=%q stderr=%q", status, launched, &stdout, &stderr)
	}
}
