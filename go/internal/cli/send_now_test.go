//go:build darwin || linux

package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/delivery"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

func TestSendNowUncertainPasteIsNeverRepeated(t *testing.T) {
	server := tmuxtest.Start(t)
	pane := strings.TrimSpace(server.Run("display-message", "-p", "#{pane_id}"))
	pid := strings.TrimSpace(server.Run("display-message", "-p", "-t", pane, "#{pid}"))
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv(home.EnvHome, filepath.Join(world, "go"))
	t.Setenv("TMUX", server.Socket+","+pid+",0")
	t.Setenv("TMUX_PANE", pane)
	root, err := home.Resolve(os.LookupEnv, world)
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
	app := systemApplication()
	app.store = store
	app.requests = storage.NewRequestService(store, wallClock{})
	var pasted []ports.DeliveryInput
	app.live = liveTalkHost{
		driver: func(context.Context, core.Identity, core.Binding, core.EndpointProbe) (ports.Driver, error) {
			return codex.Driver{}, nil
		},
		capture: func(_ context.Context, target ports.PaneRef, _ ports.CaptureOpts) (ports.Screen, error) {
			return ports.Screen{Pane: target, Text: "› Ask Codex to do anything\n← for agents · ? for shortcuts"}, nil
		},
		deliver: func(_ context.Context, found home.Root, target delivery.PasteTarget, input ports.DeliveryInput) (ports.DeliveryOutcome, error) {
			if found.Dir != root.Dir || target.Pane != (ports.PaneRef{Server: server.Socket, PaneID: pane}) || target.Binding == nil ||
				target.Binding.IdentityID != target.Identity.ID || target.Identity.Name != "Worker" {
				t.Fatalf("send-now attempted the wrong endpoint: %+v", target)
			}
			pasted = append(pasted, input)
			if len(pasted) == 1 {
				return ports.DeliveryNotStarted, context.Canceled
			}
			return ports.DeliveryUncertain, context.Canceled
		},
	}
	run := func(status int, args ...string) []byte {
		t.Helper()
		var stdout, stderr bytes.Buffer
		if got := app.run(t.Context(), append(args, "--json"), &stdout, &stderr); got != status || stderr.Len() != 0 {
			t.Fatalf("%q exit %d: stdout %q stderr %q", args, got, &stdout, &stderr)
		}
		return stdout.Bytes()
	}
	for _, name := range []string{"Sender", "Worker", "Other"} {
		run(0, "identity", "create", name)
	}
	run(0, "config", "set", "--global", "pasteEnterDelayMs", "32")
	const message = "verify café ; literal"
	var queued struct{ RequestID core.RequestID }
	if err := json.Unmarshal(run(0, "talk", "Worker", message, "--identity", "Sender", "--detach"), &queued); err != nil || queued.RequestID == "" {
		t.Fatalf("queued = %+v, %v", queued, err)
	}
	checkError := func(raw []byte, code string) {
		t.Helper()
		var report struct{ Error struct{ Code string } }
		if err := json.Unmarshal(raw, &report); err != nil || report.Error.Code != code {
			t.Fatalf("send-now expected %s, got %s (%v)", code, raw, err)
		}
	}
	checkError(run(1, "send-now", string(queued.RequestID), "--identity", "Other"), "SEND_NOW_NOT_ALLOWED")
	run(0, "name", "Worker", "--save")
	checkError(run(1, "send-now", string(queued.RequestID)[:13], "--identity", "Sender"), "SEND_NOW_UNREACHABLE")
	if len(pasted) != 1 {
		t.Fatalf("definitely-unsent wake was automatically replayed: %d calls", len(pasted))
	}
	checkError(run(1, "send-now", string(queued.RequestID), "--identity", "Sender"), "DELIVERY_UNCERTAIN")
	checkError(run(1, "send-now", string(queued.RequestID), "--identity", "Sender"), "SEND_NOW_UNCONFIRMED")
	if len(pasted) != 2 {
		t.Fatalf("unexpected attempt after the uncertain wake: %d calls", len(pasted))
	}
	input := pasted[0]
	requestLine := fmt.Sprintf("tmt-go reply %s --receipt ", queued.RequestID)
	if pasted[1].Text != input.Text || pasted[1].BeforeSubmit != input.BeforeSubmit ||
		input.BeforeSubmit != 32*time.Millisecond || !strings.HasPrefix(input.Text, message+"\n\n") ||
		!strings.Contains(input.Text, `<tmt-reply from="Sender">`) || !strings.Contains(input.Text, requestLine) {
		t.Fatalf("send-now lost the original frame or configured delay: %d ms", input.BeforeSubmit.Milliseconds())
	}
}

func TestSendNowReportsNativeOutput(t *testing.T) {
	const request core.RequestID = "req_313af9b2-81c9-4fe9-af9a-f9ad56524e6f"
	for _, fixture := range []struct {
		json          bool
		status, state string
		want          string
	}{
		{true, "already", "delivered", `{"status":"already","requestId":"` + string(request) + `","state":"delivered"}` + "\n"},
		{true, "sent", "delivered", `{"status":"sent","requestId":"` + string(request) + `","state":"delivered"}` + "\n"},
		{false, "already", "delivered", "✓ It already reached the agent, or is on its way; it was not sent again\n"},
		{false, "sent", "delivered", "✓ Sent now\n"},
	} {
		var stdout, stderr bytes.Buffer
		report := sendNowReport{Status: fixture.status, RequestID: request, State: fixture.state}
		if status := publish(&stdout, &stderr, report, fixture.json); status != 0 || stdout.String() != fixture.want || stderr.Len() != 0 {
			t.Fatalf("send-now %s: exit %d stdout %q stderr %q", fixture.status, status, &stdout, &stderr)
		}
	}
	for _, fixture := range []struct{ code, message, suggestion string }{
		{"SEND_NOW_UNREACHABLE", "Could not send now: the agent could not be reached", "Nothing was typed; retry 'tmt-go send-now " + string(request) + "' after it continues."},
		{"DELIVERY_UNCERTAIN", "It may have been sent. Delivery is not confirmed, so do not send it again.", "Inspect with 'tmt-go result " + string(request) + "'."},
	} {
		failure := sendNowUntyped(request, fixture.code)
		if failure.Code != fixture.code || failure.Message != fixture.message || failure.Suggestion != fixture.suggestion || failure.Status != 1 {
			t.Fatalf("send-now failure: %+v", failure)
		}
	}
}
