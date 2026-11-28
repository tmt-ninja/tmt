package driverprotocol

import (
	"encoding/json"
	"strings"
	"testing"
)

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("json.Marshal failed: %v", err)
	}
	return b
}

func herdrGrammar(t *testing.T) *Grammar {
	t.Helper()
	c := herdrLike()
	g, err := GrammarFromCapabilities(&c)
	if err != nil {
		t.Fatalf("GrammarFromCapabilities failed: %v", err)
	}
	return g
}

func samplePaneMap(id string) map[string]any {
	return map[string]any{
		"id": id, "target": "w1:p2", "cwd": "/src", "command": "claude",
		"panePid": 42, "suggestedName": nil,
		"marker": map[string]any{
			"name": "Ann", "canonicalName": "ann",
			"identityId": "0f8fad5b-d9cb-469f-a165-70867728950e",
			"bindingId":  "1f8fad5b-d9cb-469f-a165-70867728950e",
			"serverId":   "2f8fad5b-d9cb-469f-a165-70867728950e",
			"panePid":    42,
		},
	}
}

func TestDecodeFocusAnswer(t *testing.T) {
	g := herdrGrammar(t)
	val, drvErr, decErr := Decode[*Grammar, FocusResponse](g, []byte(`{"ok":{}}`))
	if decErr != nil || drvErr != nil || val.Previous != nil {
		t.Fatalf("empty focus: val=%+v drvErr=%v decErr=%v", val, drvErr, decErr)
	}
	val, drvErr, decErr = Decode[*Grammar, FocusResponse](g, []byte(`{"ok":{"previous":"term_a1"}}`))
	if decErr != nil || drvErr != nil || val.Previous == nil || *val.Previous != "term_a1" {
		t.Fatalf("named focus: val=%+v drvErr=%v decErr=%v", val, drvErr, decErr)
	}
	_, _, decErr = Decode[*Grammar, FocusResponse](g, []byte(`{"ok":{"previous":"w1:p1"}}`))
	if decErr == nil || decErr.Kind != DecodeInvalid || decErr.Op != OpFocus {
		t.Fatalf("invalid focus previous: got %+v", decErr)
	}
	drvErr, decErr = DecodeDone(OpFocus, []byte(`{"ok":{"previous":"term_a1"}}`))
	if drvErr != nil || decErr != nil {
		t.Fatalf("DecodeDone(focus) with previous failed: drvErr=%v decErr=%v", drvErr, decErr)
	}
}

func TestAgentAndConditionalPublishErrorCodeScoping(t *testing.T) {
	accepted := func(op Op, code string) bool {
		_, decErr := DecodeDone(op, mustJSON(t, map[string]any{
			"error": map[string]any{"code": code, "message": "agent"},
		}))
		return decErr == nil
	}
	cases := []struct {
		code      string
		prompt    bool
		nameAgent bool
		publish   bool
	}{
		{"no_agent", true, true, false},
		{"not_ready", true, true, false},
		{"blocked", true, false, false},
		{"refused", false, true, true},
	}
	for _, tc := range cases {
		if got := accepted(OpPrompt, tc.code); got != tc.prompt {
			t.Errorf("%s on prompt = %v, want %v", tc.code, got, tc.prompt)
		}
		if got := accepted(OpNameAgent, tc.code); got != tc.nameAgent {
			t.Errorf("%s on name-agent = %v, want %v", tc.code, got, tc.nameAgent)
		}
		if got := accepted(OpPublish, tc.code); got != tc.publish {
			t.Errorf("%s on publish = %v, want %v", tc.code, got, tc.publish)
		}
		for _, op := range []Op{OpInput, OpClear, OpSnapshot} {
			if accepted(op, tc.code) {
				t.Errorf("%s should not be accepted on %s", tc.code, op)
			}
		}
	}
	for _, code := range []string{"invalid_name", "name_taken", "foreign_name"} {
		if accepted(OpNameAgent, code) {
			t.Errorf("retired code %s should be rejected", code)
		}
	}
	drvErr, decErr := DecodeDone(OpInput, []byte(`{"error":{"code":"failed","message":"x"}}`))
	if decErr != nil || drvErr == nil || drvErr.Code != ErrorFailed {
		t.Errorf("expected failed DriverError, got drv=%v dec=%v", drvErr, decErr)
	}
	drvErr, decErr = DecodeDone(OpNameAgent, []byte(`{"ok":{}}`))
	if drvErr != nil || decErr != nil {
		t.Errorf("expected ok on NameAgent, got drv=%v dec=%v", drvErr, decErr)
	}
}

func TestDecodeCapabilitiesAndRuntimeCapabilities(t *testing.T) {
	caps, g, derr := DecodeCapabilities(mustJSON(t, map[string]any{"ok": herdrLike()}))
	if derr != nil || caps.Name != "herdr" || !g.IsPaneID("term_1") {
		t.Fatalf("DecodeCapabilities failed: caps=%+v derr=%v", caps, derr)
	}
	other := herdrLike()
	other.Protocols = []uint32{2}
	_, _, derr = DecodeCapabilities(mustJSON(t, map[string]any{"ok": other}))
	if derr == nil || derr.Kind != DecodeProtocol {
		t.Errorf("expected DecodeProtocol, got %+v", derr)
	}
	rt := herdrLike()
	rt.Kind = "runtime"
	if _, _, derr := DecodeCapabilities(mustJSON(t, map[string]any{"ok": rt})); derr == nil {
		t.Errorf("runtime kind accepted by DecodeCapabilities")
	}
	if _, _, derr := DecodeCapabilities([]byte(`{"error":{"code":"failed","message":"no"}}`)); derr == nil {
		t.Errorf("error accepted by DecodeCapabilities")
	}

	rcaps, rdecl, derr := DecodeRuntimeCapabilities(mustJSON(t, map[string]any{"ok": claudeLike()}))
	if derr != nil || rcaps.Name != "kimi" || rdecl.Name() != "kimi" {
		t.Fatalf("DecodeRuntimeCapabilities failed: %+v %v", rcaps, derr)
	}
	if _, _, derr := DecodeCapabilities(mustJSON(t, map[string]any{"ok": claudeLike()})); derr == nil {
		t.Errorf("runtime caps accepted as host caps")
	}
	if _, _, derr := DecodeRuntimeCapabilities(mustJSON(t, map[string]any{"ok": herdrLike()})); derr == nil {
		t.Errorf("host caps accepted as runtime caps")
	}
	badExec := claudeLike()
	badExec.Executables = []string{"/bin/sh"}
	_, _, derr = DecodeRuntimeCapabilities(mustJSON(t, map[string]any{"ok": badExec}))
	if derr == nil || derr.Kind != DecodeGrammar {
		t.Errorf("expected DecodeGrammar, got %+v", derr)
	}
}

func TestDecodeRuntimeAnswers(t *testing.T) {
	caps := claudeLike()
	decl, err := NewRuntimeDeclaration(&caps)
	if err != nil {
		t.Fatalf("NewRuntimeDeclaration failed: %v", err)
	}
	goodLoc := map[string]any{
		"configDirs": []string{"/h/.kimi"}, "skills": "/h/.kimi/skills",
		"hookSettings": "/h/.kimi/settings.json", "transcriptRoot": "/h/.kimi/sessions",
	}
	if _, drvErr, decErr := Decode[*RuntimeDeclaration, LocationsResponse](decl, mustJSON(t, map[string]any{"ok": goodLoc})); drvErr != nil || decErr != nil {
		t.Fatalf("good locations failed: drv=%v dec=%v", drvErr, decErr)
	}
	badLocFields := []struct {
		field string
		val   any
	}{
		{"configDirs", []string{}},
		{"configDirs", []string{"/a", "/b", "/c", "/d", "/e"}},
		{"skills", "relative"},
		{"skills", "/h/../etc"},
		{"hookSettings", nil},
		{"hookSettings", "/h/.bashrc"},
		{"hookSettings", "/h/.kimi"},
		{"hookSettings", "/h/.kimix/settings.json"},
		{"transcriptRoot", nil},
	}
	for _, tc := range badLocFields {
		m := map[string]any{
			"configDirs": []string{"/h/.kimi"}, "skills": "/h/.kimi/skills",
			"hookSettings": "/h/.kimi/settings.json", "transcriptRoot": "/h/.kimi/sessions",
		}
		m[tc.field] = tc.val
		if _, _, decErr := Decode[*RuntimeDeclaration, LocationsResponse](decl, mustJSON(t, map[string]any{"ok": m})); decErr == nil {
			t.Errorf("locations with bad %s=%v accepted", tc.field, tc.val)
		}
	}
	for _, p := range []string{"/h/.kimi/skills", "/h/.agents/skills"} {
		loc := LocationsResponse{ConfigDirs: []string{"/h/.kimi"}, Skills: p}
		if !loc.Within("/h") {
			t.Errorf("Within(%q) = false, want true", p)
		}
	}
	for _, p := range []string{"/h/.ssh", "/h/.agents", "/other/.agents/skills", "/h/.kimi"} {
		loc := LocationsResponse{ConfigDirs: []string{"/h/.kimi"}, Skills: p}
		if loc.Within("/h") {
			t.Errorf("Within(%q) = true, want false", p)
		}
	}

	// Resume answers.
	for _, argv := range [][]string{{"kimi", "--resume", "s-1"}, {"kimi-cli"}} {
		if _, drvErr, decErr := Decode[*RuntimeDeclaration, ResumeResponse](decl, mustJSON(t, map[string]any{"ok": map[string]any{"argv": argv}})); drvErr != nil || decErr != nil {
			t.Errorf("resume %v failed: drv=%v dec=%v", argv, drvErr, decErr)
		}
	}
	tooLongArgv := make([]string, 65)
	for i := range tooLongArgv {
		tooLongArgv[i] = "kimi"
	}
	for _, argv := range [][]string{{}, {"/usr/bin/kimi"}, {"sh", "-c", "kimi"}, {"kimi", "a\x00b"}, tooLongArgv} {
		if _, _, decErr := Decode[*RuntimeDeclaration, ResumeResponse](decl, mustJSON(t, map[string]any{"ok": map[string]any{"argv": argv}})); decErr == nil {
			t.Errorf("bad resume argv %v accepted", argv)
		}
	}

	// Usage answers.
	for _, tok := range []any{nil, 1200} {
		if _, drvErr, decErr := Decode[*RuntimeDeclaration, UsageResponse](decl, mustJSON(t, map[string]any{"ok": map[string]any{"contextTokens": tok}})); drvErr != nil || decErr != nil {
			t.Errorf("usage %v failed: drv=%v dec=%v", tok, drvErr, decErr)
		}
	}
	if _, _, decErr := Decode[*RuntimeDeclaration, UsageResponse](decl, mustJSON(t, map[string]any{"ok": map[string]any{"contextTokens": uint64(1) << 53}})); decErr == nil {
		t.Errorf("out-of-range contextTokens accepted")
	}
}

func TestDecodeSnapshotAndBoundsAndCallerServerTarget(t *testing.T) {
	g := herdrGrammar(t)
	good := mustJSON(t, map[string]any{"ok": map[string]any{"panes": []any{samplePaneMap("term_1"), samplePaneMap("term_2")}}})
	snap, drvErr, decErr := Decode[*Grammar, SnapshotResponse](g, good)
	if decErr != nil || drvErr != nil || len(snap.Panes) != 2 {
		t.Fatalf("good snapshot failed: snap=%+v drv=%v dec=%v", snap, drvErr, decErr)
	}
	both := []string{"term_1", "term_2"}
	one := []string{"term_1"}
	if !snap.Within(&both) || snap.Within(&one) || !snap.Within(nil) {
		t.Errorf("SnapshotResponse.Within mismatch")
	}

	badPaneEdits := []struct {
		label string
		edit  func(map[string]any)
	}{
		{"bad id", func(p map[string]any) { p["id"] = "%1" }},
		{"bad target 1.2", func(p map[string]any) { p["target"] = "1.2" }},
		{"bad target lower", func(p map[string]any) { p["target"] = "w1:p2e" }},
		{"relative cwd", func(p map[string]any) { p["cwd"] = "relative" }},
		{"esc command", func(p map[string]any) { p["command"] = "cl\x1baude" }},
		{"zero pid", func(p map[string]any) { p["panePid"] = 0 }},
		{"bad marker uuid", func(p map[string]any) { p["marker"].(map[string]any)["bindingId"] = "not-a-uuid" }},
		{"empty marker name", func(p map[string]any) { p["marker"].(map[string]any)["name"] = "" }},
		{"empty agentName", func(p map[string]any) { p["agentName"] = "" }},
		{"esc agentName", func(p map[string]any) { p["agentName"] = "re\x1bviewer" }},
	}
	for _, tc := range badPaneEdits {
		p := samplePaneMap("term_1")
		tc.edit(p)
		_, _, derr := Decode[*Grammar, SnapshotResponse](g, mustJSON(t, map[string]any{"ok": map[string]any{"panes": []any{p}}}))
		if derr == nil || derr.Kind != DecodeInvalid || derr.Op != OpSnapshot {
			t.Errorf("%s: expected DecodeInvalid, got %+v", tc.label, derr)
		}
	}
	twice := mustJSON(t, map[string]any{"ok": map[string]any{"panes": []any{samplePaneMap("term_1"), samplePaneMap("term_1")}}})
	if _, _, derr := Decode[*Grammar, SnapshotResponse](g, twice); derr == nil {
		t.Errorf("duplicate pane ID accepted")
	}

	// Output over bound or malformed envelope.
	big := []byte(strings.Repeat(" ", 4097))
	_, _, derr := Decode[*Grammar, ClearResponse](g, big)
	if derr == nil || derr.Kind != DecodeTooLarge || derr.Op != OpClear || derr.Limit != 4096 {
		t.Errorf("expected DecodeTooLarge(4096), got %+v", derr)
	}
	for _, badOut := range []string{
		`cleared`,
		`{"ok":{"cleared":true}} {"ok":{}}`,
		`{"ok":{"cleared":true},"error":{"code":"failed","message":""}}`,
		`{"ok":{}}`,
	} {
		_, _, derr := Decode[*Grammar, ClearResponse](g, []byte(badOut))
		if derr == nil || derr.Kind != DecodeJSON {
			t.Errorf("bad envelope %s: expected DecodeJSON, got %+v", badOut, derr)
		}
	}

	// Noisy driver error message rejected.
	noisy := mustJSON(t, map[string]any{"error": map[string]any{"code": "failed", "message": "\x1b]52;c;x\x07"}})
	if _, _, derr := Decode[*Grammar, ClearResponse](g, noisy); derr == nil {
		t.Errorf("control chars in error message accepted")
	}

	// Caller, server, target, probe.
	if _, _, derr := Decode[*Grammar, CallerResponse](g, []byte(`{"ok":{"pane":null}}`)); derr != nil {
		t.Errorf("null caller pane failed: %v", derr)
	}
	if _, _, derr := Decode[*Grammar, CallerResponse](g, []byte(`{"ok":{"pane":{"id":"term_1","socket":"/h.sock","shellPid":7}}}`)); derr != nil {
		t.Errorf("valid caller pane failed: %v", derr)
	}
	if _, _, derr := Decode[*Grammar, CallerResponse](g, []byte(`{"ok":{"pane":{"id":"term_1","socket":"h.sock","shellPid":7}}}`)); derr == nil {
		t.Errorf("relative caller socket accepted")
	}
	if _, _, derr := Decode[*Grammar, ServerResponse](g, []byte(`{"ok":{"server":{"socket":"/h","pid":9,"startTime":"Mon 10:00"}}}`)); derr != nil {
		t.Errorf("valid server failed: %v", derr)
	}
	if _, _, derr := Decode[*Grammar, ServerResponse](g, []byte(`{"ok":{"server":{"socket":"/h","pid":9,"startTime":""}}}`)); derr == nil {
		t.Errorf("empty server startTime accepted")
	}
	if _, _, derr := Decode[*Grammar, ResolveTargetResponse](g, []byte(`{"ok":{"paneId":"term_5"}}`)); derr != nil {
		t.Errorf("valid resolved paneId failed: %v", derr)
	}
	if _, _, derr := Decode[*Grammar, ResolveTargetResponse](g, []byte(`{"ok":{"paneId":"w1:p1"}}`)); derr == nil {
		t.Errorf("invalid resolved paneId accepted")
	}
	probe, _, derr := Decode[*Grammar, ProbeResponse](g, mustJSON(t, map[string]any{"ok": map[string]any{"state": "live", "panes": []any{samplePaneMap("term_1")}}}))
	if derr != nil || !probe.Within([]string{"term_1"}) || probe.Within(nil) {
		t.Errorf("probe Within mismatch: probe=%+v derr=%v", probe, derr)
	}
}
