package driverprotocol

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"time"
)

// DriverOutput is what one driver invocation produced.
type DriverOutput struct {
	Stdout  []byte
	Elapsed time.Duration
}

// Fixture describes a live server a host driver can reach.
type Fixture struct {
	Socket string
}

// RuntimeFixture describes a nonexistent home and session ID for runtime conformance checks.
type RuntimeFixture struct {
	Home    string
	Session string
}

// Finding reports one way a driver broke the protocol contract.
type Finding struct {
	Check  string
	Detail string
}

// InvokeFunc invokes a driver with argv after the program name and stdin request bytes.
type InvokeFunc func(args []string, request []byte) DriverOutput

// Check runs every host-driver conformance check; empty slice means the driver conforms.
func Check(invoke InvokeFunc, fixture Fixture) []Finding {
	run := &conformanceRun{invoke: invoke}
	capsOut := run.call(OpCapabilities, nil)
	caps, grammar, derr := DecodeCapabilities(capsOut.Stdout)
	if derr != nil {
		run.found("capabilities", derr.Error())
		return run.findings
	}
	run.envelopeErrors()

	var declared, undeclared []Op
	for _, op := range AllOps {
		if op == OpCapabilities {
			continue
		}
		if slices.Contains(caps.Ops, op.String()) {
			declared = append(declared, op)
		} else {
			undeclared = append(undeclared, op)
		}
	}
	for _, op := range undeclared {
		run.expectCode(op, marshalRequest(Empty{}), ErrorUnsupported, "an undeclared op")
	}
	for _, op := range declared {
		run.expectCode(op, []byte("{"), ErrorBadRequest, "a request that isn't JSON")
		checkMissing(run, grammar, fixture, op)
	}
	return run.findings
}

// CheckRuntime runs every runtime-driver conformance check; empty slice means the driver conforms.
func CheckRuntime(invoke InvokeFunc, fixture RuntimeFixture) []Finding {
	run := &conformanceRun{invoke: invoke}
	capsOut := run.call(OpCapabilities, nil)
	_, decl, derr := DecodeRuntimeCapabilities(capsOut.Stdout)
	if derr != nil {
		run.found("capabilities", derr.Error())
		return run.findings
	}
	run.envelopeErrors()

	for _, op := range AllOps {
		if op == OpCapabilities {
			continue
		}
		if decl.Supports(op) {
			run.expectCode(op, []byte("{"), ErrorBadRequest, "a request that isn't JSON")
		} else {
			run.expectCode(op, marshalRequest(Empty{}), ErrorUnsupported, "an undeclared op")
		}
	}

	locVal, locErr, locOK := runAnswer[*RuntimeDeclaration, LocationsResponse](
		run, decl, LocationsRequest{Home: fixture.Home, Env: map[string]string{}},
	)
	var transcriptRoot *string
	if locOK {
		if locErr != nil {
			run.found(OpLocations.String(), fmt.Sprintf("a fixture home must have locations: %s", locErr.Message))
		} else {
			if !locVal.Within(fixture.Home) {
				run.found(OpLocations.String(), "skills must lie inside configDirs or be the shared skills root")
			}
			transcriptRoot = locVal.TranscriptRoot
		}
	}
	if decl.Supports(OpResume) {
		runAnswer[*RuntimeDeclaration, ResumeResponse](
			run, decl, ResumeRequest{Session: fixture.Session, Model: nil},
		)
	}
	if decl.Supports(OpUsage) && transcriptRoot != nil {
		missingPath := strings.TrimRight(*transcriptRoot, "/") + "/tmt-conformance-missing.jsonl"
		usageVal, usageErr, usageOK := runAnswer[*RuntimeDeclaration, UsageResponse](
			run, decl, UsageRequest{Session: fixture.Session, Transcript: missingPath},
		)
		if usageOK && usageErr == nil && usageVal.ContextTokens != nil {
			run.found(OpUsage.String(), fmt.Sprintf("a missing transcript shows no usage, got %d", *usageVal.ContextTokens))
		}
	}
	return run.findings
}

type conformanceRun struct {
	invoke   InvokeFunc
	findings []Finding
}

func marshalRequest[T any](body T) []byte {
	b, err := json.Marshal(Request[T]{DeadlineMs: 250, Body: body})
	if err != nil {
		panic(fmt.Sprintf("conformance request marshal failed: %v", err))
	}
	return b
}

func (r *conformanceRun) found(check, detail string) {
	r.findings = append(r.findings, Finding{Check: check, Detail: detail})
}

func (r *conformanceRun) call(op Op, req []byte) DriverOutput {
	out := r.invoke([]string{Subcommand, "1", op.String()}, req)
	deadline := op.Bounds().Deadline
	if out.Elapsed > deadline {
		r.found(op.String(), fmt.Sprintf("took %v, over its %v deadline", out.Elapsed, deadline))
	}
	return out
}

func runAnswer[D any, T Answer[D]](r *conformanceRun, decl D, body any) (T, *DriverError, bool) {
	var zero T
	op := zero.Op()
	out := r.call(op, marshalRequest(body))
	val, drvErr, decErr := Decode[D, T](decl, out.Stdout)
	if decErr != nil {
		r.found(op.String(), decErr.Error())
		return zero, nil, false
	}
	return val, drvErr, true
}

func (r *conformanceRun) expectCode(op Op, req []byte, want ErrorCode, label string) {
	out := r.call(op, req)
	drvErr, decErr := DecodeDone(op, out.Stdout)
	if decErr != nil || drvErr == nil || drvErr.Code != want {
		r.found(op.String(), fmt.Sprintf("%s must answer %s, got err=%v decode=%v", label, want, drvErr, decErr))
	}
}

func (r *conformanceRun) envelopeErrors() {
	cases := []struct {
		args  []string
		label string
	}{
		{[]string{Subcommand, "0", "snapshot"}, "an unspoken protocol"},
		{[]string{Subcommand, "1", "status"}, "an unknown op"},
		{[]string{Subcommand}, "a missing op"},
	}
	for _, tc := range cases {
		out := r.invoke(tc.args, []byte("{}"))
		drvErr, decErr := DecodeDone(OpSnapshot, out.Stdout)
		if decErr != nil || drvErr == nil {
			r.found("envelope", fmt.Sprintf("%s must print one error answer", tc.label))
		}
	}
}

func checkMissing(run *conformanceRun, grammar *Grammar, fixture Fixture, op Op) {
	pane := grammar.PaneIDPrefix() + "zzzzzzzzzzzz"
	socket := fixture.Socket
	notFound := func(body any) {
		run.expectCode(op, marshalRequest(body), ErrorNotFound, "a missing pane")
	}

	switch op {
	case OpCapabilities, OpLocations, OpResume, OpUsage:
	case OpCaller:
		val, drvErr, ok := runAnswer[*Grammar, CallerResponse](run, grammar, CallerRequest{Env: map[string]string{}})
		if ok && drvErr == nil && val.Pane != nil {
			run.found(op.String(), "an empty environment names no pane")
		}
	case OpServer:
		s := socket
		_, drvErr, ok := runAnswer[*Grammar, ServerResponse](run, grammar, ServerRequest{Socket: &s})
		if ok && drvErr != nil {
			run.found(op.String(), fmt.Sprintf("the fixture's server: %s", drvErr.Message))
		}
	case OpResolveTarget:
		target, hasTarget := grammar.TargetNumbered("999999999")
		if !hasTarget {
			return
		}
		val, drvErr, ok := runAnswer[*Grammar, ResolveTargetResponse](run, grammar, ResolveTargetRequest{
			Socket: socket, Target: target,
		})
		if ok && (drvErr != nil || val.PaneID != nil) {
			run.found(op.String(), fmt.Sprintf("an unused target resolves to none, got val=%+v err=%v", val, drvErr))
		}
	case OpSnapshot:
		_, allErr, allOK := runAnswer[*Grammar, SnapshotResponse](run, grammar, SnapshotRequest{
			Socket: socket, Panes: nil,
		})
		if allOK && allErr != nil {
			run.found(op.String(), fmt.Sprintf("every pane: %s", allErr.Message))
		}
		missingPanes := []string{pane}
		val, drvErr, ok := runAnswer[*Grammar, SnapshotResponse](run, grammar, SnapshotRequest{
			Socket: socket, Panes: &missingPanes,
		})
		if ok && (drvErr != nil || len(val.Panes) != 0) {
			run.found(op.String(), fmt.Sprintf("a missing pane lists nothing, got val=%+v err=%v", val, drvErr))
		}
	case OpProbe:
		val, drvErr, ok := runAnswer[*Grammar, ProbeResponse](run, grammar, ProbeRequest{
			Server: ServerIncarnation{Socket: socket, PID: (1 << 53) - 1, StartTime: "never"},
			Panes:  []string{pane},
		})
		if ok {
			if drvErr != nil {
				run.found(op.String(), fmt.Sprintf("answer dead or unknown: %s", drvErr.Message))
			} else if val.State == ProbeStateLive {
				run.found(op.String(), "a server that never ran is not live")
			}
		}
	case OpClear:
		val, drvErr, ok := runAnswer[*Grammar, ClearResponse](run, grammar, ClearRequest{
			Socket: socket, PaneID: pane, BindingID: "00000000-0000-4000-8000-000000000000",
		})
		if ok && (drvErr != nil || val.Cleared) {
			run.found(op.String(), fmt.Sprintf("nothing to clear on a missing pane, got val=%+v err=%v", val, drvErr))
		}
	case OpPublish:
		notFound(PublishRequest{
			Socket: socket, PaneID: pane, PanePID: 1,
			Marker: Marker{
				Name: "Conformance", CanonicalName: "conformance",
				IdentityID: "00000000-0000-4000-8000-000000000001",
				BindingID:  "00000000-0000-4000-8000-000000000002",
				ServerID:   "00000000-0000-4000-8000-000000000003",
				PanePID:    1,
			},
		})
	case OpCapture:
		for _, lines := range []uint32{10, 0} {
			notFound(CaptureRequest{Socket: socket, PaneID: pane, Lines: lines})
		}
	case OpInput:
		notFound(InputRequest{Socket: socket, PaneID: pane, Text: "conformance", Enter: false})
	case OpPrompt:
		notFound(PromptRequest{Socket: socket, PaneID: pane, Text: "conformance"})
	case OpFocus:
		notFound(FocusRequest{Socket: socket, PaneID: pane})
	case OpClose:
		notFound(CloseRequest{Socket: socket, PaneID: pane, PanePID: 1})
	case OpNameAgent:
		name := "conformance"
		notFound(NameAgentRequest{
			Socket: socket, PaneID: pane, PanePID: 1,
			BindingID: "00000000-0000-4000-8000-000000000002",
			Name:      &name,
		})
	}
}
