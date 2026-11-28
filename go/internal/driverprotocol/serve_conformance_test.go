package driverprotocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
	"time"
)

type fakeHostHandler struct {
	BaseHandler
	panes int
}

func (f *fakeHostHandler) Capabilities() Capabilities {
	c := herdrLike()
	c.Ops = []string{"snapshot", "clear"}
	return c
}

func (f *fakeHostHandler) Snapshot(Request[SnapshotRequest]) (SnapshotResponse, *DriverError) {
	cwd := strings.Repeat("/", 4000)
	panes := make([]Pane, f.panes)
	for i := range f.panes {
		panes[i] = Pane{
			ID:      fmt.Sprintf("term_%d", i),
			Cwd:     &cwd,
			Command: "sh",
			PanePID: 1,
		}
	}
	return SnapshotResponse{Panes: panes}, nil
}

func (f *fakeHostHandler) Clear(req Request[ClearRequest]) (ClearResponse, *DriverError) {
	return ClearResponse{Cleared: req.Body.PaneID == "term_1"}, nil
}

func runHostServe(t *testing.T, args []string, input []byte, panes int) (int, map[string]any) {
	t.Helper()
	var out bytes.Buffer
	status := Serve(args, bytes.NewReader(input), &out, &fakeHostHandler{panes: panes})
	var doc map[string]any
	if err := json.Unmarshal(out.Bytes(), &doc); err != nil {
		t.Fatalf("Serve output not valid JSON (%q): %v", out.String(), err)
	}
	return status, doc
}

func TestServeDeclaredOpsAndErrorsAndOutputBound(t *testing.T) {
	clearReq := []byte(`{"deadlineMs":300,"socket":"/s","paneId":"term_1","bindingId":"b"}`)
	status, doc := runHostServe(t, []string{"__tmt-driver", "1", "clear"}, clearReq, 0)
	if status != 0 || doc["ok"].(map[string]any)["cleared"] != true {
		t.Fatalf("clear failed: status=%d doc=%v", status, doc)
	}
	status, doc = runHostServe(t, []string{"__tmt-driver", "1", "capabilities"}, nil, 0)
	if status != 0 || doc["ok"].(map[string]any)["name"] != "herdr" {
		t.Fatalf("capabilities failed: status=%d doc=%v", status, doc)
	}

	errCases := []struct {
		label      string
		args       []string
		input      []byte
		wantStatus int
		wantCode   string
	}{
		{"undeclared", []string{"__tmt-driver", "1", "input"}, []byte(`{}`), 0, "unsupported"},
		{"unknown op", []string{"__tmt-driver", "1", "status"}, []byte(`{}`), 0, "unsupported"},
		{"wrong protocol", []string{"__tmt-driver", "2", "clear"}, clearReq, 2, "bad_request"},
		{"wrong subcmd", []string{"__tmt-hooks", "1", "clear"}, clearReq, 2, "bad_request"},
		{"bad json", []string{"__tmt-driver", "1", "clear"}, []byte(`{`), 0, "bad_request"},
		{"missing member", []string{"__tmt-driver", "1", "clear"}, []byte(`{"deadlineMs":1}`), 0, "bad_request"},
		{"oversize req", []string{"__tmt-driver", "1", "clear"}, []byte(strings.Repeat(" ", MaxRequestBytes+1)), 0, "bad_request"},
		{"runtime op on host", []string{"__tmt-driver", "1", "resume"}, []byte(`{"deadlineMs":1,"session":"s","model":null}`), 0, "unsupported"},
	}
	for _, tc := range errCases {
		st, d := runHostServe(t, tc.args, tc.input, 0)
		gotCode := d["error"].(map[string]any)["code"]
		if st != tc.wantStatus || gotCode != tc.wantCode {
			t.Errorf("%s: got (%d, %v), want (%d, %s)", tc.label, st, gotCode, tc.wantStatus, tc.wantCode)
		}
	}

	snapReq := []byte(`{"deadlineMs":2000,"socket":"/s","panes":null}`)
	_, fits := runHostServe(t, []string{"__tmt-driver", "1", "snapshot"}, snapReq, 10)
	if len(fits["ok"].(map[string]any)["panes"].([]any)) != 10 {
		t.Errorf("10-pane snapshot failed: %v", fits)
	}
	_, over := runHostServe(t, []string{"__tmt-driver", "1", "snapshot"}, snapReq, 300)
	if over["error"].(map[string]any)["code"] != "failed" {
		t.Errorf("oversize snapshot should return failed: %v", over)
	}
}

type fakeRuntimeHandler struct {
	BaseRuntimeHandler
}

func (fakeRuntimeHandler) Capabilities() RuntimeCapabilities {
	c := claudeLike()
	c.Ops = []string{"locations", "resume"}
	return c
}

func (fakeRuntimeHandler) Locations(req Request[LocationsRequest]) (LocationsResponse, *DriverError) {
	return LocationsResponse{
		ConfigDirs: []string{req.Body.Home + "/.kimi"},
		Skills:     req.Body.Home + "/.kimi/skills",
	}, nil
}

func (fakeRuntimeHandler) Resume(req Request[ResumeRequest]) (ResumeResponse, *DriverError) {
	return ResumeResponse{Argv: []string{"kimi", "--resume", req.Body.Session}}, nil
}

func TestServeRuntimeAnswersDeclaredOpsOnly(t *testing.T) {
	run := func(args []string, input []byte) (int, map[string]any) {
		var out bytes.Buffer
		st := ServeRuntime(args, bytes.NewReader(input), &out, fakeRuntimeHandler{})
		var doc map[string]any
		if err := json.Unmarshal(out.Bytes(), &doc); err != nil {
			t.Fatalf("ServeRuntime output not JSON: %v", err)
		}
		return st, doc
	}
	st, doc := run([]string{"__tmt-driver", "1", "resume"}, []byte(`{"deadlineMs":1000,"session":"s-1","model":null}`))
	if st != 0 || len(doc["ok"].(map[string]any)["argv"].([]any)) != 3 {
		t.Fatalf("resume failed: %d %v", st, doc)
	}
	for _, op := range []string{"usage", "snapshot", "input"} {
		st, doc := run([]string{"__tmt-driver", "1", op}, []byte(`{}`))
		if st != 0 || doc["error"].(map[string]any)["code"] != "unsupported" {
			t.Errorf("%s: got (%d, %v), want (0, unsupported)", op, st, doc)
		}
	}
	st, doc = run([]string{"__tmt-driver", "1", "locations"}, []byte(`{`))
	if st != 0 || doc["error"].(map[string]any)["code"] != "bad_request" {
		t.Errorf("bad locations json: got (%d, %v)", st, doc)
	}
	st, _ = run([]string{"__tmt-driver", "2", "locations"}, []byte(`{}`))
	if st != 2 {
		t.Errorf("wrong protocol status = %d, want 2", st)
	}
}

type noPanesHost struct {
	BaseHandler
	clearsAnything    bool
	publishesAnywhere bool
	namesAnywhere     bool
	closesAnything    bool
}

func (h *noPanesHost) Capabilities() Capabilities {
	c := herdrLike()
	c.Ops = []string{
		"capabilities", "caller", "server", "resolve-target", "snapshot",
		"probe", "publish", "clear", "capture", "focus", "close", "name-agent",
	}
	return c
}
func (h *noPanesHost) Caller(Request[CallerRequest]) (CallerResponse, *DriverError) {
	return CallerResponse{}, nil
}
func (h *noPanesHost) Server(req Request[ServerRequest]) (ServerResponse, *DriverError) {
	if req.Body.Socket == nil {
		return ServerResponse{}, nil
	}
	return ServerResponse{Server: &ServerIncarnation{Socket: *req.Body.Socket, PID: 10, StartTime: "t"}}, nil
}
func (h *noPanesHost) ResolveTarget(Request[ResolveTargetRequest]) (ResolveTargetResponse, *DriverError) {
	return ResolveTargetResponse{}, nil
}
func (h *noPanesHost) Snapshot(Request[SnapshotRequest]) (SnapshotResponse, *DriverError) {
	return SnapshotResponse{Panes: []Pane{}}, nil
}
func (h *noPanesHost) Probe(Request[ProbeRequest]) (ProbeResponse, *DriverError) {
	return ProbeResponse{State: ProbeStateDead}, nil
}
func (h *noPanesHost) Publish(Request[PublishRequest]) *DriverError {
	if h.publishesAnywhere {
		return nil
	}
	return NewDriverError(ErrorNotFound, "no such pane")
}
func (h *noPanesHost) Clear(Request[ClearRequest]) (ClearResponse, *DriverError) {
	return ClearResponse{Cleared: h.clearsAnything}, nil
}
func (h *noPanesHost) Capture(Request[CaptureRequest]) (CaptureResponse, *DriverError) {
	return CaptureResponse{}, NewDriverError(ErrorNotFound, "no such pane")
}
func (h *noPanesHost) Focus(Request[FocusRequest]) (FocusResponse, *DriverError) {
	return FocusResponse{}, NewDriverError(ErrorNotFound, "no such pane")
}
func (h *noPanesHost) Close(Request[CloseRequest]) *DriverError {
	if h.closesAnything {
		return nil
	}
	return NewDriverError(ErrorNotFound, "no such pane")
}
func (h *noPanesHost) NameAgent(Request[NameAgentRequest]) *DriverError {
	if h.namesAnywhere {
		return nil
	}
	return NewDriverError(ErrorNotFound, "no such pane")
}

func hostConformanceFindings(h *noPanesHost, slowOp Op, slowExtra time.Duration) []Finding {
	return Check(func(args []string, req []byte) DriverOutput {
		var out bytes.Buffer
		Serve(args, bytes.NewReader(req), &out, h)
		var extra time.Duration
		if len(args) >= 3 && args[2] == slowOp.String() {
			extra = slowExtra
		}
		return DriverOutput{Stdout: out.Bytes(), Elapsed: extra}
	}, Fixture{Socket: "/tmp/conformance.sock"})
}

func TestHostConformance(t *testing.T) {
	if found := hostConformanceFindings(&noPanesHost{}, "", 0); len(found) != 0 {
		t.Fatalf("conforming host had findings: %+v", found)
	}
	cases := []struct {
		host *noPanesHost
		want string
	}{
		{&noPanesHost{clearsAnything: true}, "clear"},
		{&noPanesHost{publishesAnywhere: true}, "publish"},
		{&noPanesHost{namesAnywhere: true}, "name-agent"},
		{&noPanesHost{closesAnything: true}, "close"},
	}
	for _, tc := range cases {
		found := hostConformanceFindings(tc.host, "", 0)
		if len(found) != 1 || found[0].Check != tc.want {
			t.Errorf("want finding %q, got %+v", tc.want, found)
		}
	}
	slow := hostConformanceFindings(&noPanesHost{}, OpSnapshot, 2001*time.Millisecond)
	if len(slow) == 0 || slices.ContainsFunc(slow, func(f Finding) bool { return f.Check != "snapshot" }) {
		t.Errorf("slow snapshot findings = %+v", slow)
	}
	badCaps := Check(func(_ []string, _ []byte) DriverOutput {
		return DriverOutput{Stdout: []byte("not json")}
	}, Fixture{Socket: "/s"})
	if len(badCaps) != 1 || badCaps[0].Check != "capabilities" {
		t.Errorf("bad caps should stop run: %+v", badCaps)
	}
}

type conformanceAgent struct {
	BaseRuntimeHandler
	resumesThroughShell    bool
	readsMissingTranscript bool
	forgetsTranscriptRoot  bool
	installsSkillsAnywhere bool
	skillsOnly             bool
}

func (a *conformanceAgent) Capabilities() RuntimeCapabilities {
	c := claudeLike()
	c.Claims = !a.skillsOnly
	return c
}
func (a *conformanceAgent) Locations(req Request[LocationsRequest]) (LocationsResponse, *DriverError) {
	home := req.Body.Home
	skills := home + "/.kimi/skills"
	if a.installsSkillsAnywhere {
		skills = home + "/.ssh"
	}
	var root *string
	if !a.forgetsTranscriptRoot {
		r := home + "/.kimi/sessions"
		root = &r
	}
	return LocationsResponse{
		ConfigDirs:     []string{home + "/.kimi"},
		Skills:         skills,
		HookSettings:   strPtr(home + "/.kimi/settings.json"),
		TranscriptRoot: root,
	}, nil
}
func (a *conformanceAgent) Resume(req Request[ResumeRequest]) (ResumeResponse, *DriverError) {
	if a.resumesThroughShell {
		return ResumeResponse{Argv: []string{"sh", "-c", "kimi -r " + req.Body.Session}}, nil
	}
	return ResumeResponse{Argv: []string{"kimi", "-r", req.Body.Session}}, nil
}
func (a *conformanceAgent) Usage(Request[UsageRequest]) (UsageResponse, *DriverError) {
	if a.readsMissingTranscript {
		n := uint64(9)
		return UsageResponse{ContextTokens: &n}, nil
	}
	return UsageResponse{}, nil
}

func runtimeConformanceFindings(a *conformanceAgent, slowOp Op, slowExtra time.Duration) []Finding {
	return CheckRuntime(func(args []string, req []byte) DriverOutput {
		var out bytes.Buffer
		ServeRuntime(args, bytes.NewReader(req), &out, a)
		var extra time.Duration
		if len(args) >= 3 && args[2] == slowOp.String() {
			extra = slowExtra
		}
		return DriverOutput{Stdout: out.Bytes(), Elapsed: extra}
	}, RuntimeFixture{Home: "/nonexistent/home", Session: "conformance-session"})
}

func TestRuntimeConformance(t *testing.T) {
	if found := runtimeConformanceFindings(&conformanceAgent{}, "", 0); len(found) != 0 {
		t.Fatalf("conforming runtime had findings: %+v", found)
	}
	if found := runtimeConformanceFindings(&conformanceAgent{skillsOnly: true}, "", 0); len(found) != 0 {
		t.Fatalf("skills-only runtime had findings: %+v", found)
	}
	cases := []struct {
		agent *conformanceAgent
		want  string
	}{
		{&conformanceAgent{resumesThroughShell: true}, "resume"},
		{&conformanceAgent{readsMissingTranscript: true}, "usage"},
		{&conformanceAgent{forgetsTranscriptRoot: true}, "locations"},
		{&conformanceAgent{installsSkillsAnywhere: true}, "locations"},
	}
	for _, tc := range cases {
		found := runtimeConformanceFindings(tc.agent, "", 0)
		if len(found) != 1 || found[0].Check != tc.want {
			t.Errorf("want finding %q, got %+v", tc.want, found)
		}
	}
	slow := runtimeConformanceFindings(&conformanceAgent{}, OpResume, 1001*time.Millisecond)
	if len(slow) == 0 || slices.ContainsFunc(slow, func(f Finding) bool { return f.Check != "resume" }) {
		t.Errorf("slow resume findings = %+v", slow)
	}

	// Host driver rejected by CheckRuntime.
	host := &noPanesHost{}
	hostAsRuntime := CheckRuntime(func(args []string, req []byte) DriverOutput {
		var out bytes.Buffer
		Serve(args, bytes.NewReader(req), &out, host)
		return DriverOutput{Stdout: out.Bytes()}
	}, RuntimeFixture{Home: "/h", Session: "s"})
	if len(hostAsRuntime) != 1 || hostAsRuntime[0].Check != "capabilities" {
		t.Errorf("host driver should fail runtime capabilities: %+v", hostAsRuntime)
	}
}
