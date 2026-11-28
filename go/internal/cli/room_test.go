package cli

import (
	"bytes"
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
)

func TestRoomRetainsRetiredUUIDWithoutResolvingItsName(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", world)
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
