package cli

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
)

func TestRoomRetainsRetiredUUIDWithoutResolvingItsName(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", t.TempDir()) // outside the data root (native-root guard)
	t.Setenv(flavor.EnvHome, world)
	app := application{caller: callerSelector{lookup: func(string) (string, bool) {
		t.Fatal("explicit room selector attempted caller or host discovery")
		return "", false
	}}}
	run := func(args ...string) roomDocument {
		t.Helper()
		var out, stderr bytes.Buffer
		if status := app.run(t.Context(), append(args, "--json"), &out, &stderr); status != 0 || stderr.Len() != 0 {
			t.Fatalf("%q exit %d stdout=%q stderr=%q", args, status, &out, &stderr)
		}
		var doc struct{ Room roomDocument }
		if err := json.Unmarshal(out.Bytes(), &doc); err != nil || !core.ValidUUID(string(doc.Room.ID)) {
			t.Fatalf("room document %q: %v", &out, err)
		}
		return doc.Room
	}
	original := run("room", "create", "Design")
	if original.Revision != 1 || original.MemberIDs == nil || len(original.MemberIDs) != 0 {
		t.Fatalf("created room = %+v", original)
	}
	var created, diagnostic bytes.Buffer
	if status := app.run(t.Context(), []string{"identity", "create", "Alice", "--json"}, &created, &diagnostic); status != 0 || diagnostic.Len() != 0 {
		t.Fatalf("identity create = %d, %q, %q", status, &created, &diagnostic)
	}
	joined := run("room", "join", string(original.ID), "--identity", "Alice")
	if joined.Revision != 2 || len(joined.MemberIDs) != 1 {
		t.Fatalf("joined room = %+v", joined)
	}
	retired := run("room", "retire", string(original.ID))
	want := joined
	want.Retired = true
	want.Revision++
	if !reflect.DeepEqual(retired, want) {
		t.Fatalf("retired room = %+v", retired)
	}
	for _, verb := range []string{"show", "rm"} {
		if got := run("room", verb, string(original.ID)); !reflect.DeepEqual(got, retired) {
			t.Fatalf("expected historical UUID replay = %+v, got %+v", retired, got)
		}
	}
	assertResponse(t, app, []string{"room", "list", "--json"}, 0, map[string]any{"rooms": []any{}})
	for _, args := range [][]string{
		{"room", "show", "Design", "--json"},
		{"room", "join", string(original.ID), "--identity", "Offline", "--json"},
		{"ls", "--room", string(original.ID), "--json"},
	} {
		selector := string(original.ID)
		if args[1] == "show" {
			selector = "Design"
		}
		assertResponse(t, app, args, 3, map[string]any{
			"error": map[string]any{"code": "ROOM_NOT_FOUND", "message": "Room '" + selector + "' was not found."},
		})
	}
	replacement := run("room", "create", "Design")
	if replacement.ID == original.ID || replacement.Revision != 1 || replacement.Retired {
		t.Fatalf("replacement room = %+v", replacement)
	}
	if got := run("room", "show", "Design"); !reflect.DeepEqual(got, replacement) {
		t.Fatalf("active name resolved to %+v", got)
	}

	var out, stderr bytes.Buffer
	status := app.run(t.Context(), []string{"room", "show", string(original.ID)}, &out, &stderr)
	if status != 0 || stderr.Len() != 0 ||
		!strings.HasPrefix(out.String(), "Design\n  state     retired\n  revision  3\n") ||
		!strings.Contains(out.String(), string(original.ID)) {
		t.Fatalf("retained room presentation = %d, %q, %q", status, &out, &stderr)
	}
}

func TestRoomListMatchesNativeStateSections(t *testing.T) {
	report := roomReport{rooms: []core.MeetingRoom{
		{Name: "zeta", ID: "11111111-aaaa", MemberIDs: []core.IdentityID{"member-0", "member-1"}},
		{Name: "old", ID: "22222222-bbbb", Retired: true},
		{Name: "alpha", ID: "33333333-cccc", MemberIDs: []core.IdentityID{"member-0"}},
	}}
	var out bytes.Buffer
	if err := report.Human(&out); err != nil {
		t.Fatal(err)
	}
	const want = "ACTIVE 2\n  alpha  1 member   33333333\n  zeta   2 members  11111111\n\nRETIRED 1\n  old    0 members  22222222\n"
	if out.String() != want {
		t.Fatalf("room list = %q; want %q", out.String(), want)
	}
}

func TestRoomGrammarMatchesNative(t *testing.T) {
	opID := "11111111-1111-4111-8111-111111111111"
	for _, action := range []string{"send", "broadcast"} {
		args := []string{"room", action, "Design", "hello", "--identity", "Alice", "--operation-id", opID}
		inv, failure := parse(args)
		if failure != nil || !reflect.DeepEqual(inv.path, args[:2]) || !reflect.DeepEqual(inv.operands, args[2:4]) ||
			inv.options["identity"] != "Alice" || inv.options["operation-id"] != opID {
			t.Fatalf("%q parsed as %+v, failure=%+v", args, inv, failure)
		}
	}
	for _, args := range [][]string{
		{"room"}, {"room", "join"}, {"room", "ls", "--identity", "Alice"},
		{"room", "create", "Design", "--force"}, {"ls", "Alice", "--room", "Design"},
		{"room", "send", "Design"}, {"room", "broadcast", "Design", "hello", "--timeout", "1s"},
		{"room", "send", "Design", "hello", "--inbox"},
	} {
		if _, failure := parse(args); failure == nil || failure.Code != "USAGE_ERROR" {
			t.Fatalf("%q gave failure %+v, want USAGE_ERROR", args, failure)
		}
	}
}

func TestRoomDispatchRetainsReceiptAndRoomScope(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", filepath.Join(world, "home"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(world, "config"))
	t.Setenv("TMT_HOME", filepath.Join(world, "native"))
	t.Setenv(flavor.EnvHome, filepath.Join(world, "state"))
	t.Chdir(world)
	app := application{caller: callerSelector{lookup: func(string) (string, bool) {
		t.Fatal("explicit Room sender attempted caller or host discovery")
		return "", false
	}}}
	run := func(want int, args ...string) []byte {
		t.Helper()
		var out, diagnostic bytes.Buffer
		if status := app.run(t.Context(), append(args, "--json"), &out, &diagnostic); status != want || diagnostic.Len() != 0 {
			t.Fatalf("%q exit %d stdout=%q stderr=%q", args, status, &out, &diagnostic)
		}
		return out.Bytes()
	}
	for _, name := range []string{"Alice", "Bob"} {
		run(0, "identity", "create", name)
	}
	var created struct{ Room roomDocument }
	if err := json.Unmarshal(run(0, "room", "create", "Design"), &created); err != nil {
		t.Fatal(err)
	}
	run(0, "room", "join", string(created.Room.ID), "--identity", "Alice")
	const operation = "11111111-1111-4111-8111-111111111111"
	first := run(0, "room", "send", "Design", "exact café", "--identity", "Bob", "--operation-id", operation)
	repeat := run(0, "room", "send", "Design", "exact café", "--identity", "Bob", "--operation-id", operation)
	if !bytes.Equal(first, repeat) {
		t.Fatalf("receipt changed on replay: %s vs %s", first, repeat)
	}
	conflict := run(1, "room", "send", "Design", "changed", "--identity", "Bob", "--operation-id", operation)
	if !bytes.Contains(conflict, []byte("DISPATCH_IDEMPOTENCY_CONFLICT")) || !bytes.Contains(conflict, []byte("Retain operation ID "+operation)) {
		t.Fatalf("changed composition did not return recoverable conflict: %s", conflict)
	}
	for _, tc := range []struct {
		raw          []byte
		announcement bool
	}{
		{raw: first},
		{raw: run(0, "room", "broadcast", "Design", "notice", "--identity", "Bob"), announcement: true},
	} {
		var receipt core.DispatchReceipt
		if err := json.Unmarshal(tc.raw, &receipt); err != nil || !receipt.Valid() || len(receipt.Items) != 1 ||
			receipt.Items[0].Acceptance != core.DispatchQueued {
			t.Fatalf("invalid room receipt %s: %v", tc.raw, err)
		}
		var shown exchangeShowReport
		detail := run(0, "x", "show", string(receipt.Items[0].RequestID), "--incoming", "--identity", "Alice")
		if err := json.Unmarshal(detail, &shown); err != nil || shown.Exchange.RoomID == nil ||
			*shown.Exchange.RoomID != created.Room.ID {
			t.Fatalf("exchange lost room scope: %s, %v", detail, err)
		}
		if tc.announcement && (shown.Exchange.Final.Status != core.FinalNotRequired || shown.Exchange.Reply != nil) {
			t.Fatalf("announcement accepted a reply: %s", detail)
		}
	}
	run(0, "room", "rm", string(created.Room.ID))
	listen := []string{"x", "listen", "--identity", "Alice", "--room", string(created.Room.ID), "--timeout", "100ms", "--debounce", "1ms"}
	for i := 0; i < 2; i++ {
		var result listenReport
		raw := run(0, listen...)
		if err := json.Unmarshal(raw, &result); err != nil || result.Reason != "messages" || len(result.Items) != 2 {
			t.Fatalf("retired room still has two incoming items: %s, %v", raw, err)
		}
		for _, item := range result.Items {
			if item.RoomID == nil || *item.RoomID != created.Room.ID || item.Acknowledged ||
				item.Sender == nil || item.Sender.Name != "Bob" || item.Recipient == nil || item.Recipient.Name != "Alice" {
				t.Fatalf("unexpected incoming item: %+v", item)
			}
		}
	}

}
