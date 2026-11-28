//go:build darwin || linux

package cli

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestPrivateClaudeStopPublishesAndClosesExactContinuation(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	server := tmuxtest.Start(t)
	world, config, bin := t.TempDir(), t.TempDir(), t.TempDir()
	t.Setenv(flavor.EnvHome, world)
	t.Setenv("CLAUDE_CONFIG_DIR", config)
	launcher, fake := filepath.Join(bin, flavor.Binary), filepath.Join(bin, "claude")
	for _, build := range [][2]string{{launcher, "../../cmd/tmt-go"}, {fake, "../../test/fixtures/fakeclaude"}} {
		if output, err := privateFixtureBuild(ctx, build[0], build[1]).CombinedOutput(); err != nil {
			t.Fatalf("build fixture: %v %s", err, output)
		}
	}
	fakeSettings, err := json.Marshal(map[string]any{"hooks": map[string]any{"Stop": []any{map[string]any{"hooks": []any{
		map[string]any{"type": "command", "command": "'" + strings.ReplaceAll(launcher, "'", "'\\''") + "' __hook claude", "timeout": 3},
	}}}}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(config, "settings.json"), fakeSettings, 0600); err != nil {
		t.Fatal(err)
	}
	host, err := newTmuxClient()
	if err != nil {
		t.Fatal(err)
	}
	pane, err := host.Launch(ctx, ports.LaunchSpec{Server: server.Socket, Session: "t", Window: "claude-stop", Dir: world,
		Command: ports.ProcessSpec{Path: "/bin/sh", Args: []string{"-c", `/bin/stty -echo && "$1" run --save Worker "$2"; IFS= read -r keep`, "fixture", launcher, fake},
			Env: []string{flavor.EnvHome + "=" + world, "PATH=" + os.Getenv("PATH"), "CLAUDE_CONFIG_DIR=" + config, "TMT_FAKE_CLAUDE=" + bin}}})
	if err != nil {
		t.Fatal(err)
	}
	waitForPrivateFake(t, ctx, func() (bool, error) {
		_, err := os.Stat(filepath.Join(bin, "ready"))
		if os.IsNotExist(err) {
			return false, nil
		}
		return err == nil, err
	})
	root, err := home.Resolve(os.LookupEnv, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	readStage := func(name string) string {
		t.Helper()
		server.Run("send-keys", "-t", pane.PaneID, "-l", name)
		server.Run("send-keys", "-t", pane.PaneID, "Enter")
		var data []byte
		waitForPrivateFake(t, ctx, func() (bool, error) {
			raw, err := os.ReadFile(filepath.Join(bin, name))
			if os.IsNotExist(err) {
				return false, nil
			}
			data = raw
			return err == nil, err
		})
		return string(data)
	}
	var worker core.IdentityID
	waitForPrivateFake(t, ctx, func() (bool, error) {
		err := store.Read(ctx, func(tx ports.StoreTx) error {
			identity, err := tx.Identities().FindByCanonicalName("worker")
			if err != nil || identity == nil {
				return err
			}
			binding, err := tx.Bindings().FindByIdentity(identity.ID)
			if err == nil && binding != nil && binding.Session.RuntimeState == "running" && binding.Session.ProviderSessionID == nil {
				worker = identity.ID
			}
			return err
		})
		return worker != "", err
	})
	// Hold the fake provider's real startup hook until foreground admission
	// has recorded its exact runtime with no provider session.
	if raw := readStage("startup"); raw != "" {
		t.Fatalf("startup emitted provider output: %q", raw)
	}
	waitForPrivateFake(t, ctx, func() (bool, error) {
		var admitted bool
		err := store.Read(ctx, func(tx ports.StoreTx) error {
			binding, err := tx.Bindings().FindByIdentity(worker)
			admitted = err == nil && binding != nil && binding.Session.RuntimeState == "running" &&
				binding.Session.ProviderSessionID != nil && *binding.Session.ProviderSessionID == "55555555-5555-4555-8555-555555555555"
			return err
		})
		return admitted, err
	})
	db, err := sql.Open("sqlite", root.Database)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := hookNowMs()
	sender := core.IdentityID("11111111-1111-4111-8111-111111111111")
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		return tx.Identities().Insert(core.Identity{ID: sender, Name: "Sender", CanonicalName: "sender", Lifetime: core.LifetimeSaved}, now)
	}); err != nil {
		t.Fatal(err)
	}
	request := core.RequestID("req_22222222-2222-4222-8222-222222222222")
	service := storage.NewRequestService(store, wallClock{})
	_, err = service.Enqueue(ctx, core.PrepareRequest{
		RequestID: request, AttemptID: "33333333-3333-4333-8333-333333333333", Kind: core.RequestKindRequest,
		Origin: core.RequestOriginPerson, Originator: core.Originator{Kind: core.OriginatorExplicit, IdentityID: &sender},
		Route: core.RequestRoute{Kind: core.RequestRouteInbox, Recipient: &worker}, Recipient: &worker,
		Message: "Private pending Digest item", ExpiresAtMs: now + 60000, RetentionDays: 1, Wait: true,
	})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := db.ExecContext(ctx, "INSERT INTO request_delivery_policies(request_id,urgent,kind,automatic,mode) VALUES (?,0,'review',1,'request')", request); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "INSERT INTO focus_items(identity_id,request_id,kind,source,created_at_ms,context_tokens_at_arrival,context_observed_at_ms,phase_at_arrival) VALUES (?,?,'review','incoming',?,0,?,'working')", worker, request, now, now); err != nil {
		t.Fatal(err)
	}
	if _, err := store.WritePolicy(ctx, core.DigestPolicyWrite{IdentityID: worker, OwnerID: sender, SetterID: sender, UntilMs: now + 60000, NowMs: now}); err != nil {
		t.Fatal(err)
	}

	raw := readStage("digest")
	var output struct{ Decision, Reason string }
	if err := json.Unmarshal([]byte(raw), &output); err != nil || output.Decision != "block" ||
		!strings.Contains(output.Reason, "Private pending Digest item") {
		t.Fatalf("provider handoff = %q, %v", raw, err)
	}
	var checklistID, state string
	var confirmed *uint64
	if err := db.QueryRowContext(ctx, "SELECT id,state,confirmed_at_ms FROM focus_checklists WHERE identity_id=?", worker).Scan(&checklistID, &state, &confirmed); err != nil || state != "delivered" || confirmed != nil {
		t.Fatalf("settlement = %q, confirmed = %v, %v", state, confirmed, err)
	}
	if raw := readStage("continued"); raw != "" {
		t.Fatalf("continued Stop produced recursive output %q", raw)
	}
	if err := db.QueryRowContext(ctx, "SELECT confirmed_at_ms FROM focus_checklists WHERE identity_id=? AND id=?", worker, checklistID).Scan(&confirmed); err != nil || confirmed == nil {
		t.Fatalf("continued Stop did not confirm the exact checklist: %v, %v", confirmed, err)
	}
	var before, after, checklists int
	if err := db.QueryRowContext(ctx, "SELECT COALESCE(SUM(text='before digest'),0), COALESCE(SUM(text='after digest'),0), (SELECT COUNT(*) FROM focus_checklists WHERE identity_id=?1) FROM recent_responses WHERE identity_id=?1", worker).Scan(&before, &after, &checklists); err != nil || before != 1 || after != 1 || checklists != 1 {
		t.Fatalf("retained before=%d after=%d checklists=%d err=%v", before, after, checklists, err)
	}
	server.Run("send-keys", "-t", pane.PaneID, "-l", "exit")
	server.Run("send-keys", "-t", pane.PaneID, "Enter")
	waitForPrivateFake(t, ctx, func() (bool, error) {
		var ended bool
		err := store.Read(ctx, func(tx ports.StoreTx) error {
			binding, err := tx.Bindings().FindByIdentity(worker)
			ended = err == nil && binding != nil && binding.Session.RuntimeState == "ended" &&
				binding.Session.ProviderSessionID != nil && *binding.Session.ProviderSessionID == "55555555-5555-4555-8555-555555555555"
			return err
		})
		return ended, err
	})

}
