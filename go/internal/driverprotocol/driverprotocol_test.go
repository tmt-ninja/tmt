// Rust-to-Go test mapping (40 Rust #[test] functions in rust/crates/tmt-driver-protocol/src/):
//
//	lib.rs:
//	  op_names_round_trip_and_are_unique                                      -> TestOpNamesRoundTripAndAreUnique
//	  hook_path_ops_are_short_and_small                                       -> TestOpBoundsAndRuntimeMarking
//	  runtime_ops_are_short_small_and_marked                                  -> TestOpBoundsAndRuntimeMarking
//	wire.rs:
//	  the_envelope_and_probe_states_have_their_documented_shape               -> TestWireEnvelopeAndProbeStates
//	  unknown_members_are_ignored_both_ways                                   -> TestWireUnknownMembersIgnoredAndConditionalPublishAndAgentName
//	  conditional_publication_is_opt_in_and_old_requests_stay_unchanged       -> TestWireUnknownMembersIgnoredAndConditionalPublishAndAgentName
//	  a_pane_without_an_agent_name_reads_as_none                              -> TestWireUnknownMembersIgnoredAndConditionalPublishAndAgentName
//	grammar.rs:
//	  unsafe_declarations_are_refused                                         -> TestGrammarValidationAndLaunchTemplate
//	  a_launch_template_is_optional_and_validated_with_the_declaration        -> TestGrammarValidationAndLaunchTemplate
//	  the_declared_syntax_is_the_host_grammar                                 -> TestGrammarValidationAndLaunchTemplate
//	  text_rules                                                              -> TestGrammarValidationAndLaunchTemplate
//	runtime.rs:
//	  claims_can_be_disabled_without_changing_declared_operations             -> TestRuntimeDeclarationValidationClaimsAndHooks
//	  a_minimal_declaration_needs_only_locations_and_an_executable            -> TestRuntimeDeclarationValidationClaimsAndHooks
//	  unsafe_or_incoherent_declarations_are_refused                           -> TestRuntimeDeclarationValidationClaimsAndHooks
//	  claims_match_the_last_path_component_exactly                            -> TestRuntimeDeclarationValidationClaimsAndHooks
//	  hooks_decode_by_the_declared_pointers_and_values                        -> TestRuntimeDeclarationValidationClaimsAndHooks
//	  a_payload_core_cannot_read_changes_nothing                              -> TestRuntimeDeclarationValidationClaimsAndHooks
//	  pointers_follow_rfc_6901_escapes                                        -> TestRuntimeDeclarationValidationClaimsAndHooks
//	  paths_are_absolute_without_dot_components                               -> TestRuntimeDeclarationValidationClaimsAndHooks
//	decode.rs:
//	  a_focus_answer_may_name_the_previous_pane_and_an_empty_one_is_unknown   -> TestDecodeFocusAnswer
//	  agent_and_conditional_publish_answers_are_scoped_to_their_operations    -> TestAgentAndConditionalPublishErrorCodeScoping
//	  capabilities_decode_with_their_grammar                                  -> TestDecodeCapabilitiesAndRuntimeCapabilities
//	  runtime_capabilities_decode_with_their_declaration_and_kinds_stay_apart -> TestDecodeCapabilitiesAndRuntimeCapabilities
//	  runtime_answers_are_checked_against_the_declaration                     -> TestDecodeRuntimeAnswers
//	  a_snapshot_is_checked_pane_by_pane                                      -> TestDecodeSnapshotAndBoundsAndCallerServerTarget
//	  output_over_the_bound_or_not_one_envelope_fails                         -> TestDecodeSnapshotAndBoundsAndCallerServerTarget
//	  a_driver_error_is_its_answer_when_its_message_is_text                   -> TestDecodeSnapshotAndBoundsAndCallerServerTarget
//	  caller_server_and_target_answers_are_checked                            -> TestDecodeSnapshotAndBoundsAndCallerServerTarget
//	serve.rs:
//	  a_declared_operation_is_answered                                        -> TestServeDeclaredOpsAndErrorsAndOutputBound
//	  anything_else_gets_an_error_answer                                      -> TestServeDeclaredOpsAndErrorsAndOutputBound
//	  a_runtime_driver_answers_its_declared_ops_and_nothing_else              -> TestServeRuntimeAnswersDeclaredOpsOnly
//	  a_host_driver_never_answers_a_runtime_op                                -> TestServeDeclaredOpsAndErrorsAndOutputBound
//	  an_answer_over_its_bound_becomes_an_error                               -> TestServeDeclaredOpsAndErrorsAndOutputBound
//	conformance.rs:
//	  a_conforming_driver_has_no_findings                                     -> TestHostConformance
//	  each_broken_rule_is_found                                               -> TestHostConformance
//	  skills_only_driver_conforms_without_claiming_a_runtime                  -> TestRuntimeConformance
//	  a_conforming_runtime_driver_has_no_findings                             -> TestRuntimeConformance
//	  each_broken_runtime_rule_is_found                                       -> TestRuntimeConformance
//	  a_host_driver_is_no_runtime_driver                                      -> TestRuntimeConformance
//	  a_driver_without_valid_capabilities_stops_the_run                       -> TestHostConformance
package driverprotocol

import (
	"encoding/json"
	"maps"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/hostgrammar"
)

func strPtr(s string) *string { return &s }

func herdrLike() Capabilities {
	return Capabilities{
		Protocols: []uint32{1},
		Kind:      "host",
		Name:      "herdr",
		Version:   "0.1.0",
		Ops:       []string{"snapshot"},
		PaneID:    PaneIDSyntax{Prefix: "term_"},
		Target:    strPtr("w{n}:p{n}"),
		CallerEnv: []string{"HERDR_PANE_ID", "HERDR_SOCKET_PATH"},
	}
}

func claudeLike() RuntimeCapabilities {
	return RuntimeCapabilities{
		Protocols:   []uint32{1},
		Kind:        "runtime",
		Name:        "kimi",
		Version:     "0.1.0",
		Ops:         []string{"locations", "resume", "usage"},
		Executables: []string{"kimi", "kimi-cli"},
		Claims:      true,
		Env:         []string{"KIMI_HOME"},
		SessionEnv:  strPtr("KIMI_SESSION_ID"),
		Hooks: &Hooks{
			Format: "sessionHooksJson",
			Fields: HookFields{
				Event:      "/hook_event_name",
				Session:    "/session_id",
				Model:      strPtr("/model"),
				Transcript: strPtr("/transcript_path"),
				Turn:       strPtr("/turn_id"),
			},
			Events: []HookEventDeclaration{
				{
					Name:   "SessionStart",
					Effect: HookEffectStart,
					By:     strPtr("/source"),
					Values: map[string]Transition{
						"startup": TransitionStarted,
						"resume":  TransitionResumed,
						"clear":   TransitionCleared,
						"compact": TransitionCompacted,
						"fork":    TransitionForked,
					},
				},
				{
					Name:   "SessionEnd",
					Effect: HookEffectEnd,
					By:     strPtr("/reason"),
					Values: map[string]Transition{
						"clear":  TransitionCleared,
						"resume": TransitionResumed,
						"logout": TransitionEnded,
					},
				},
				{Name: "UserPromptSubmit", Effect: HookEffectWorking},
				{Name: "Stop", Effect: HookEffectIdle},
			},
		},
	}
}

func TestOpNamesRoundTripAndAreUnique(t *testing.T) {
	seen := make(map[string]struct{}, len(AllOps))
	for _, op := range AllOps {
		parsed, ok := ParseOp(op.String())
		if !ok || parsed != op {
			t.Errorf("ParseOp(%q) = (%q, %v), want (%q, true)", op.String(), parsed, ok, op)
		}
		seen[op.String()] = struct{}{}
	}
	if len(seen) != len(AllOps) {
		t.Errorf("unique op names = %d, want %d", len(seen), len(AllOps))
	}
	if _, ok := ParseOp("status"); ok {
		t.Errorf("ParseOp(status) succeeded; status is core's, not an op")
	}
}

func TestOpBoundsAndRuntimeMarking(t *testing.T) {
	for _, op := range []Op{OpCaller, OpServer, OpPublish, OpClear} {
		b := op.Bounds()
		if b.Deadline != time.Second || b.MaxOutputBytes != 4096 {
			t.Errorf("%s bounds = %+v, want 1s/4096", op, b)
		}
	}
	if got := OpSnapshot.Bounds().MaxOutputBytes; got != 1024*1024 {
		t.Errorf("snapshot max output = %d, want 1MiB", got)
	}
	if b := OpNameAgent.Bounds(); b.Deadline != 2*time.Second || b.MaxOutputBytes != 4096 || OpNameAgent.IsRuntime() {
		t.Errorf("name-agent bounds/runtime unexpected: %+v", b)
	}
	for _, op := range AllOps {
		wantRuntime := op == OpLocations || op == OpResume || op == OpUsage
		if op.IsRuntime() != wantRuntime {
			t.Errorf("%s IsRuntime() = %v, want %v", op, op.IsRuntime(), wantRuntime)
		}
		if wantRuntime {
			if b := op.Bounds(); b.Deadline != time.Second || b.MaxOutputBytes != 4096 {
				t.Errorf("runtime op %s bounds = %+v, want 1s/4096", op, b)
			}
		}
	}
}

func TestWireEnvelopeAndProbeStates(t *testing.T) {
	okResp := Response[ClearResponse]{Ok: &ClearResponse{Cleared: true}}
	raw, err := json.Marshal(okResp)
	if err != nil || string(raw) != `{"ok":{"cleared":true}}` {
		t.Fatalf("ok envelope = %s (err=%v)", raw, err)
	}
	errResp := Response[Empty]{Error: NewDriverError(ErrorNotFound, "pane closed")}
	raw, err = json.Marshal(errResp)
	if err != nil || string(raw) != `{"error":{"code":"not_found","message":"pane closed"}}` {
		t.Fatalf("error envelope = %s (err=%v)", raw, err)
	}
	dead, err := json.Marshal(ProbeResponse{State: ProbeStateDead})
	if err != nil || string(dead) != `{"state":"dead"}` {
		t.Fatalf("dead probe = %s (err=%v)", dead, err)
	}
	req := Request[ClearRequest]{
		DeadlineMs: 250,
		Body:       ClearRequest{Socket: "/s", PaneID: "term_1", BindingID: "b"},
	}
	raw, err = json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal request map: %v", err)
	}
	if m["deadlineMs"] != float64(250) || m["socket"] != "/s" || m["paneId"] != "term_1" || m["bindingId"] != "b" {
		t.Errorf("flattened request = %v", m)
	}
}

func TestWireUnknownMembersIgnoredAndConditionalPublishAndAgentName(t *testing.T) {
	var req Request[ServerRequest]
	if err := json.Unmarshal([]byte(`{"deadlineMs":1,"socket":null,"later":1}`), &req); err != nil {
		t.Fatalf("unmarshal server request with unknown member: %v", err)
	}
	if req.Body.Socket != nil {
		t.Errorf("expected nil socket")
	}
	var resp Response[ClearResponse]
	if err := json.Unmarshal([]byte(`{"ok":{"cleared":false,"later":true}}`), &resp); err != nil {
		t.Fatalf("unmarshal clear response with unknown member: %v", err)
	}
	if resp.Ok == nil || resp.Ok.Cleared {
		t.Errorf("unexpected clear response: %+v", resp)
	}

	// Conditional publish opt-in.
	legacyJSON := `{"protocols":[1],"kind":"host","name":"test","version":"1","ops":["publish"],"paneId":{"prefix":"term_"}}`
	var caps Capabilities
	if err := json.Unmarshal([]byte(legacyJSON), &caps); err != nil {
		t.Fatalf("unmarshal legacy caps: %v", err)
	}
	if caps.ConditionalPublish {
		t.Errorf("expected ConditionalPublish=false")
	}
	written, _ := json.Marshal(caps)
	if strings.Contains(string(written), "conditionalPublish") {
		t.Errorf("conditionalPublish should be omitted when false: %s", written)
	}
	var pubReq PublishRequest
	pubReq = PublishRequest{
		Socket: "/s", PaneID: "term_1", PanePID: 1,
		Marker: Marker{Name: "A", CanonicalName: "a", IdentityID: "i", BindingID: "b", ServerID: "s", PanePID: 1},
	}
	written, _ = json.Marshal(pubReq)
	if strings.Contains(string(written), "expectedBindingId") {
		t.Errorf("expectedBindingId should be omitted when nil: %s", written)
	}
	emptyStr := ""
	pubReq.ExpectedBindingID = &emptyStr
	written, _ = json.Marshal(pubReq)
	if !strings.Contains(string(written), `"expectedBindingId":""`) {
		t.Errorf("expected empty string expectedBindingId: %s", written)
	}

	// Pane without agentName reads as nil and serializes without agentName.
	for _, rawPane := range []string{
		`{"id":"term_1","target":null,"cwd":null,"command":"sh","panePid":7,"suggestedName":null,"marker":null}`,
		`{"id":"term_1","target":null,"cwd":null,"command":"sh","panePid":7,"suggestedName":null,"agentName":null,"marker":null}`,
	} {
		var p Pane
		if err := json.Unmarshal([]byte(rawPane), &p); err != nil {
			t.Fatalf("unmarshal pane: %v", err)
		}
		if p.AgentName != nil {
			t.Errorf("expected nil AgentName")
		}
		out, _ := json.Marshal(p)
		if strings.Contains(string(out), "agentName") {
			t.Errorf("agentName should be omitted: %s", out)
		}
	}

	// NameAgentRequest set vs clear.
	clearJSON := `{"deadlineMs":250,"socket":"/s","paneId":"term_1","panePid":7,"bindingId":"b","name":null,"expected":"ann"}`
	var na Request[NameAgentRequest]
	if err := json.Unmarshal([]byte(clearJSON), &na); err != nil {
		t.Fatalf("unmarshal clear NameAgentRequest: %v", err)
	}
	if na.Body.Name != nil || na.Body.Expected == nil || *na.Body.Expected != "ann" {
		t.Errorf("unexpected clear NameAgentRequest: %+v", na)
	}
}

func TestGrammarValidationAndLaunchTemplate(t *testing.T) {
	badEdits := []struct {
		label string
		edit  func(*Capabilities)
	}{
		{"uppercase name", func(c *Capabilities) { c.Name = "Herdr" }},
		{"digit name", func(c *Capabilities) { c.Name = "9lives" }},
		{"long name", func(c *Capabilities) { c.Name = strings.Repeat("a", 33) }},
		{"prefix no sep", func(c *Capabilities) { c.PaneID.Prefix = "term" }},
		{"prefix %", func(c *Capabilities) { c.PaneID.Prefix = "%_" }},
		{"prefix leading _", func(c *Capabilities) { c.PaneID.Prefix = "_x_" }},
		{"target no letter", func(c *Capabilities) { c.Target = strPtr("{n}.{n}") }},
		{"target adjacent n", func(c *Capabilities) { c.Target = strPtr("w{n}{n}") }},
		{"target no n", func(c *Capabilities) { c.Target = strPtr("pane") }},
		{"target dot", func(c *Capabilities) { c.Target = strPtr("w{n}.p{n}") }},
		{"callerEnv TMT_", func(c *Capabilities) { c.CallerEnv = []string{"TMT_IDENTITY"} }},
		{"callerEnv lower", func(c *Capabilities) { c.CallerEnv = []string{"lower"} }},
		{"callerEnv 5", func(c *Capabilities) { c.CallerEnv = []string{"A", "B", "C", "D", "E"} }},
		{"launch 1 word", func(c *Capabilities) { l := []string{"herdr"}; c.Launch = &l }},
		{"launch no cmd", func(c *Capabilities) { l := []string{"herdr", "{session}"}; c.Launch = &l }},
		{"launch embedded", func(c *Capabilities) { l := []string{"herdr", "--label={session}", "{command}"}; c.Launch = &l }},
	}
	for _, tc := range badEdits {
		c := herdrLike()
		tc.edit(&c)
		if _, err := GrammarFromCapabilities(&c); err == nil {
			t.Errorf("%s: GrammarFromCapabilities succeeded, want error", tc.label)
		}
	}

	c := herdrLike()
	c.Target = nil
	if _, err := GrammarFromCapabilities(&c); err != nil {
		t.Errorf("untargeted grammar failed: %v", err)
	}

	c = herdrLike()
	g, err := GrammarFromCapabilities(&c)
	if err != nil {
		t.Fatalf("herdr grammar failed: %v", err)
	}
	if g.Launch() != nil {
		t.Errorf("expected nil launch")
	}
	wantHost, _ := hostgrammar.New("herdr", "term_", strPtr("w{n}:p{n}"))
	if g.Host().Name() != wantHost.Name() || g.Host().PaneIDPrefix() != wantHost.PaneIDPrefix() {
		t.Errorf("Host() mismatch")
	}
	l := []string{"herdr", "tab", "create", "--label", "{session}", "--", "{command}"}
	c.Launch = &l
	g2, err := GrammarFromCapabilities(&c)
	if err != nil || g2.Launch() == nil || g2.Launch().Argv()[4] != "{session}" {
		t.Errorf("launch template failed: g2=%+v err=%v", g2, err)
	}

	otherCaps := herdrLike()
	otherCaps.Name = "other"
	otherG, _ := GrammarFromCapabilities(&otherCaps)
	if _, hit := g.Conflict(otherG); !hit {
		t.Errorf("expected conflict on same prefix")
	}

	if !plain("zsh", 8) || plain("a\x1b[2J", 64) || plain("toolong", 3) {
		t.Errorf("plain() rule failed")
	}
	if !validSocket("/tmp/h.sock") || validSocket("tmp/h.sock") || validSocket("/") {
		t.Errorf("validSocket() rule failed")
	}
	if !validPID(1) || validPID(0) || validPID(1<<53) {
		t.Errorf("validPID() rule failed")
	}
	if !uuidShaped("0f8fad5b-d9cb-469f-a165-70867728950e") || uuidShaped("0F8FAD5B-d9cb-469f-a165-70867728950e") {
		t.Errorf("uuidShaped() rule failed")
	}
}

func TestRuntimeDeclarationValidationClaimsAndHooks(t *testing.T) {
	caps := claudeLike()
	decl, err := NewRuntimeDeclaration(&caps)
	if err != nil {
		t.Fatalf("NewRuntimeDeclaration failed: %v", err)
	}
	if !decl.Claims("/bin/kimi") {
		t.Errorf("expected Claims(/bin/kimi)=true")
	}
	caps.Claims = false
	declNoClaims, err := NewRuntimeDeclaration(&caps)
	if err != nil {
		t.Fatalf("NewRuntimeDeclaration(claims=false) failed: %v", err)
	}
	if declNoClaims.Claims("/bin/kimi") || !declNoClaims.Supports(OpResume) {
		t.Errorf("claims=false should disable claiming without disabling ops")
	}

	// Minimal declaration with omitted claims defaults to true.
	var minimal RuntimeCapabilities
	if err := json.Unmarshal([]byte(`{"protocols":[1],"kind":"runtime","name":"pi","version":"1","ops":["locations","later-op"],"executables":["pi"]}`), &minimal); err != nil {
		t.Fatalf("unmarshal minimal: %v", err)
	}
	if !minimal.Claims {
		t.Errorf("omitted claims must default to true")
	}
	minDecl, err := NewRuntimeDeclaration(&minimal)
	if err != nil {
		t.Fatalf("NewRuntimeDeclaration(minimal) failed: %v", err)
	}
	if !minDecl.Supports(OpLocations) || minDecl.Supports(OpResume) || minDecl.SessionEnv() != nil {
		t.Errorf("minimal declaration mismatch")
	}
	if _, ok := minDecl.DecodeHook([]byte(`{"hook_event_name":"Stop"}`)); ok {
		t.Errorf("minimal declaration without hooks must ignore hook payload")
	}

	// Unsafe/incoherent runtime declarations refused.
	badCases := []struct {
		label string
		edit  func(*RuntimeCapabilities)
	}{
		{"name", func(c *RuntimeCapabilities) { c.Name = "Kimi" }},
		{"no locations", func(c *RuntimeCapabilities) { c.Ops = []string{"resume"} }},
		{"no executable", func(c *RuntimeCapabilities) { c.Executables = nil }},
		{"a path", func(c *RuntimeCapabilities) { c.Executables = []string{"/bin/kimi"} }},
		{"a shell word", func(c *RuntimeCapabilities) { c.Executables = []string{"kimi;rm"} }},
		{"twice", func(c *RuntimeCapabilities) { c.Executables = []string{"kimi", "kimi"} }},
		{"five", func(c *RuntimeCapabilities) { c.Executables = []string{"a", "b", "c", "d", "e"} }},
		{"env", func(c *RuntimeCapabilities) { c.Env = []string{"TMT_IDENTITY"} }},
		{"session env", func(c *RuntimeCapabilities) { c.SessionEnv = strPtr("lower") }},
		{"format", func(c *RuntimeCapabilities) { c.Hooks.Format = "toml" }},
		{"pointer", func(c *RuntimeCapabilities) { c.Hooks.Fields.Session = "session_id" }},
		{"escape", func(c *RuntimeCapabilities) { c.Hooks.Fields.Event = "/a~2b" }},
		{"working with values", func(c *RuntimeCapabilities) { c.Hooks.Events[2].By = strPtr("/source") }},
		{"start without by", func(c *RuntimeCapabilities) { c.Hooks.Events[0].By = nil }},
		{"end cannot start", func(c *RuntimeCapabilities) {
			c.Hooks.Events[1].Values = maps.Clone(c.Hooks.Events[1].Values)
			c.Hooks.Events[1].Values["startup"] = TransitionStarted
		}},
		{"usage without turn ends", func(c *RuntimeCapabilities) {
			c.Hooks.Events = slices.DeleteFunc(slices.Clone(c.Hooks.Events), func(e HookEventDeclaration) bool {
				return e.Effect == HookEffectIdle
			})
		}},
		{"duplicate event", func(c *RuntimeCapabilities) {
			c.Hooks.Events = append(slices.Clone(c.Hooks.Events), c.Hooks.Events[3])
		}},
	}
	for _, tc := range badCases {
		c := claudeLike()
		tc.edit(&c)
		if _, err := NewRuntimeDeclaration(&c); err == nil {
			t.Errorf("%s: NewRuntimeDeclaration succeeded, want error", tc.label)
		}
	}

	// Claims matching.
	for _, cmd := range []string{"kimi", "/usr/local/bin/kimi", "kimi-cli"} {
		if !decl.Claims(cmd) {
			t.Errorf("Claims(%q) = false, want true", cmd)
		}
	}
	for _, cmd := range []string{"kimix", "/opt/kimi/bin/claude", "", "Kimi"} {
		if decl.Claims(cmd) {
			t.Errorf("Claims(%q) = true, want false", cmd)
		}
	}

	// Hook decoding.
	obs, ok := decl.DecodeHook([]byte(`{"hook_event_name":"SessionStart","session_id":"s-1","source":"resume","model":"kimi-k2","transcript_path":"/t/s-1.jsonl"}`))
	if !ok || obs.Event != "SessionStart" || obs.Effect != HookEffectStart || obs.Transition == nil || *obs.Transition != TransitionResumed ||
		obs.Session != "s-1" || obs.Model == nil || *obs.Model != "kimi-k2" || obs.Transcript == nil || *obs.Transcript != "/t/s-1.jsonl" || obs.Turn != nil {
		t.Fatalf("unexpected SessionStart observation: %+v (ok=%v)", obs, ok)
	}
	idle, ok := decl.DecodeHook([]byte(`{"hook_event_name":"Stop","session_id":"s-1","turn_id":"t-9","transcript_path":"relative.jsonl","model":"bad\u0007"}`))
	if !ok || idle.Effect != HookEffectIdle || idle.Transition != nil || idle.Turn == nil || *idle.Turn != "t-9" || idle.Transcript != nil || idle.Model != nil {
		t.Fatalf("unexpected Stop observation: %+v (ok=%v)", idle, ok)
	}

	// Ignored hook payloads.
	for _, raw := range []string{
		`{"hook_event_name":"Notification","session_id":"s"}`,
		`{"hook_event_name":"Stop"}`,
		`{"hook_event_name":"Stop","session_id":" "}`,
		`{"hook_event_name":"Stop","session_id":7}`,
		`{"hook_event_name":"SessionEnd","session_id":"s","reason":"crash"}`,
		`{"hook_event_name":"SessionStart","session_id":"s"}`,
		`["Stop"]`,
		`{`,
	} {
		if _, ok := decl.DecodeHook([]byte(raw)); ok {
			t.Errorf("DecodeHook(%s) succeeded, want ignored", raw)
		}
	}
	bigPayload := `{"hook_event_name":"Stop","session_id":"s","pad":"` + strings.Repeat("x", MaxHookPayloadBytes) + `"}`
	if _, ok := decl.DecodeHook([]byte(bigPayload)); ok {
		t.Errorf("DecodeHook(>64KiB) succeeded, want ignored")
	}

	// RFC 6901 escapes (~0 and ~1).
	escCaps := claudeLike()
	escCaps.Hooks.Fields = HookFields{
		Event: "/hook~1event", Session: "/ids/session~0id", Transcript: strPtr("/transcript"),
	}
	escDecl, err := NewRuntimeDeclaration(&escCaps)
	if err != nil {
		t.Fatalf("NewRuntimeDeclaration(escapes) failed: %v", err)
	}
	escObs, ok := escDecl.DecodeHook([]byte(`{"hook/event":"Stop","ids":{"session~id":"s-2"}}`))
	if !ok || escObs.Session != "s-2" {
		t.Errorf("RFC 6901 escape decode failed: %+v (ok=%v)", escObs, ok)
	}

	// absolutePath checks.
	if !absolutePath("/Users/ann/.kimi/sessions") {
		t.Errorf("valid absolutePath rejected")
	}
	for _, p := range []string{"relative", "/", "/a/../b", "/a/./b", "/a\x1bb", "/" + strings.Repeat("a", pathMax)} {
		if absolutePath(p) {
			t.Errorf("absolutePath(%q) = true, want false", p)
		}
	}
}
