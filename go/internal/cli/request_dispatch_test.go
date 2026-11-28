package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestMainUsesRealRequestStoreAcrossInvocations(t *testing.T) {
	t.Setenv("TMT_GO_HOME", t.TempDir())
	ctx := t.Context()
	root, err := home.Resolve(os.LookupEnv, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	clock := wallClock{}
	from := core.Identity{ID: "11111111-0000-4000-8000-000000000000", Name: "Lead", CanonicalName: "lead", Lifetime: core.LifetimeSaved}
	to := core.Identity{ID: "22222222-0000-4000-8000-000000000000", Name: "Worker", CanonicalName: "worker", Lifetime: core.LifetimeSaved}
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		if err := tx.Identities().Insert(from, uint64(clock.NowMs())); err != nil {
			return err
		}
		return tx.Identities().Insert(to, uint64(clock.NowMs()))
	}); err != nil {
		t.Fatal(err)
	}
	const id = "req_33333333-0000-4000-8000-000000000000"
	prepared, err := storage.NewRequestService(store, clock).Enqueue(ctx, core.PrepareRequest{
		RequestID: id, AttemptID: "44444444-0000-4000-8000-000000000000",
		Kind: core.RequestKindRequest, Origin: core.RequestOriginPerson,
		Route:      core.RequestRoute{Kind: core.RequestRouteInbox, Recipient: &to.ID},
		Originator: core.Originator{Kind: core.OriginatorExplicit, IdentityID: &from.ID},
		Recipient:  &to.ID, Message: "Inspect durable work", ExpiresAtMs: uint64(clock.NowMs()) + 60_000,
		RetentionDays: core.DefaultRetentionDays,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	run := func(status int, args ...string) map[string]any {
		t.Helper()
		var stdout, stderr bytes.Buffer
		args = append(args, "--json")
		if got := Main(args, &stdout, &stderr); got != status || stderr.Len() != 0 {
			t.Fatalf("%v: exit = %d, want %d, stdout = %q, stderr = %q", args, got, status, &stdout, &stderr)
		}
		var value map[string]any
		if err := json.Unmarshal(stdout.Bytes(), &value); err != nil {
			t.Fatalf("%v: stdout = %q: %v", args, &stdout, err)
		}
		return value
	}
	inbox := run(0, "inbox", "--identity", string(to.ID))
	items, ok := inbox["items"].([]any)
	if !ok || len(items) != 1 || items[0].(map[string]any)["requestId"] != id {
		t.Fatalf("inbox = %+v", inbox)
	}
	show := run(0, "x", "show", id, "--incoming", "--identity", "Worker")
	detail, ok := show["exchange"].(map[string]any)
	if !ok || detail["requestId"] != id {
		t.Fatalf("incoming exchange = %+v", show)
	}
	reply, ok := detail["reply"].(map[string]any)
	if !ok || reply["receipt"] != string(prepared.Receipt) {
		t.Fatal("the incoming exchange did not provide the enrolled receipt")
	}
	const body = "exact reply ☃\r\n"
	ack := run(0, "reply", id, "--receipt", string(prepared.Receipt), "--message", body)
	final := run(0, "result", "33333333")
	if ack["status"] != "submitted" || ack["requestId"] != id ||
		final["status"] != "completed" || final["requestId"] != id || final["response"] != body ||
		final["bodyBytes"] != float64(len(body)) || final["submittedAtMs"] != ack["submittedAtMs"] {
		t.Fatalf("reply = %+v, result = %+v", ack, final)
	}
	conflict := run(5, "reply", id, "--receipt", string(prepared.Receipt), "--message", "different")
	if fault, ok := conflict["error"].(map[string]any); !ok || fault["code"] != "RESPONSE_CONFLICT" {
		t.Fatalf("conflicting final = %v", conflict)
	}
}

func TestMainRejectsMalformedReceiptBeforeCreatingDatabase(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TMT_GO_HOME", dir)
	var stdout, stderr bytes.Buffer
	if code := Main([]string{"reply", "req_1", "--receipt", "invalid", "--message", "body", "--json"}, &stdout, &stderr); code != 1 ||
		stderr.Len() != 0 || !bytes.Contains(stdout.Bytes(), []byte("RESPONSE_RECEIPT_INVALID")) {
		t.Fatalf("exit = %d, stdout = %q, stderr = %q", code, &stdout, &stderr)
	}
	if _, err := os.Stat(filepath.Join(dir, home.DatabaseName)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("database exists after invalid receipt or could not be checked: %v", err)
	}
}
