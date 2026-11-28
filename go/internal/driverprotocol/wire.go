package driverprotocol

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// unmarshalExact decodes a single JSON value from data into dst, rejecting trailing tokens.
func unmarshalExact(data []byte, dst any) error {
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := dec.Decode(dst); err != nil {
		return err
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		return fmt.Errorf("trailing characters after JSON value")
	}
	return nil
}

// requireFields checks that raw is a JSON object containing every required key.
// nonNullKeys must additionally not be JSON null.
func requireFields(raw []byte, required []string, nonNull []string) error {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(raw, &obj); err != nil {
		return err
	}
	if obj == nil {
		return fmt.Errorf("expected JSON object")
	}
	for _, key := range required {
		if _, ok := obj[key]; !ok {
			return fmt.Errorf("missing field %q", key)
		}
	}
	for _, key := range nonNull {
		val, ok := obj[key]
		if !ok {
			return fmt.Errorf("missing field %q", key)
		}
		if bytes.Equal(bytes.TrimSpace(val), []byte("null")) {
			return fmt.Errorf("field %q must not be null", key)
		}
	}
	return nil
}

// PaneIDSyntax declares a host's pane-ID prefix. A pane ID is prefix followed by 1-64 of [0-9a-z].
type PaneIDSyntax struct {
	Prefix string `json:"prefix"`
}

func (p *PaneIDSyntax) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"prefix"}); err != nil {
		return err
	}
	type alias PaneIDSyntax
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*p = PaneIDSyntax(a)
	return nil
}

// Capabilities is what a host driver answers to capabilities.
type Capabilities struct {
	Protocols          []uint32     `json:"protocols"`
	Kind               string       `json:"kind"`
	Name               string       `json:"name"`
	Version            string       `json:"version"`
	Ops                []string     `json:"ops"`
	PaneID             PaneIDSyntax `json:"paneId"`
	Target             *string      `json:"target"`
	CallerEnv          []string     `json:"callerEnv"`
	ConditionalPublish bool         `json:"conditionalPublish,omitempty"`
	Launch             *[]string    `json:"launch,omitempty"`
}

func (c *Capabilities) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"protocols", "kind", "name", "version", "ops", "paneId"}); err != nil {
		return err
	}
	type alias Capabilities
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*c = Capabilities(a)
	return nil
}

// Request wraps every driver request body with the remaining deadline in milliseconds.
type Request[T any] struct {
	DeadlineMs uint64
	Body       T
}

func (r Request[T]) MarshalJSON() ([]byte, error) {
	bodyBytes, err := json.Marshal(r.Body)
	if err != nil {
		return nil, err
	}
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(bodyBytes, &obj); err != nil {
		return nil, err
	}
	if obj == nil {
		obj = map[string]json.RawMessage{}
	}
	dlBytes, err := json.Marshal(r.DeadlineMs)
	if err != nil {
		return nil, err
	}
	obj["deadlineMs"] = dlBytes
	return json.Marshal(obj)
}

func (r *Request[T]) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"deadlineMs"}); err != nil {
		return err
	}
	var header struct {
		DeadlineMs uint64 `json:"deadlineMs"`
	}
	if err := json.Unmarshal(data, &header); err != nil {
		return err
	}
	var body T
	if err := json.Unmarshal(data, &body); err != nil {
		return err
	}
	r.DeadlineMs = header.DeadlineMs
	r.Body = body
	return nil
}

// Empty is an empty JSON object {}.
type Empty struct{}

func (e *Empty) UnmarshalJSON(data []byte) error {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(data, &obj); err != nil {
		return err
	}
	if obj == nil {
		return fmt.Errorf("expected JSON object")
	}
	return nil
}

// CallerRequest asks the driver which pane the caller's environment names.
type CallerRequest struct {
	Env map[string]string `json:"env"`
}

func (r *CallerRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"env"}); err != nil {
		return err
	}
	type alias CallerRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = CallerRequest(a)
	return nil
}

// CallerPane is the pane the caller's environment names.
type CallerPane struct {
	ID       string `json:"id"`
	Socket   string `json:"socket"`
	ShellPID uint64 `json:"shellPid"`
}

func (p *CallerPane) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"id", "socket", "shellPid"}); err != nil {
		return err
	}
	type alias CallerPane
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*p = CallerPane(a)
	return nil
}

// CallerResponse answers caller.
type CallerResponse struct {
	Pane *CallerPane `json:"pane"`
}

func (r *CallerResponse) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, []string{"pane"}, nil); err != nil {
		return err
	}
	type alias CallerResponse
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = CallerResponse(a)
	return nil
}

// ServerRequest asks about a running host server.
type ServerRequest struct {
	Socket *string `json:"socket"`
}

func (r *ServerRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, []string{"socket"}, nil); err != nil {
		return err
	}
	type alias ServerRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = ServerRequest(a)
	return nil
}

// ServerIncarnation identifies one running host server.
type ServerIncarnation struct {
	Socket    string `json:"socket"`
	PID       uint64 `json:"pid"`
	StartTime string `json:"startTime"`
}

func (s *ServerIncarnation) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"socket", "pid", "startTime"}); err != nil {
		return err
	}
	type alias ServerIncarnation
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*s = ServerIncarnation(a)
	return nil
}

// ServerResponse answers server.
type ServerResponse struct {
	Server *ServerIncarnation `json:"server"`
}

func (r *ServerResponse) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, []string{"server"}, nil); err != nil {
		return err
	}
	type alias ServerResponse
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = ServerResponse(a)
	return nil
}

// ResolveTargetRequest resolves a user target to a pane ID.
type ResolveTargetRequest struct {
	Socket string `json:"socket"`
	Target string `json:"target"`
}

func (r *ResolveTargetRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"socket", "target"}); err != nil {
		return err
	}
	type alias ResolveTargetRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = ResolveTargetRequest(a)
	return nil
}

// ResolveTargetResponse answers resolve-target.
type ResolveTargetResponse struct {
	PaneID *string `json:"paneId"`
}

func (r *ResolveTargetResponse) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, []string{"paneId"}, nil); err != nil {
		return err
	}
	type alias ResolveTargetResponse
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = ResolveTargetResponse(a)
	return nil
}

// SnapshotRequest asks for all panes or a subset of panes.
type SnapshotRequest struct {
	Socket string    `json:"socket"`
	Panes  *[]string `json:"panes"`
}

func (r *SnapshotRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, []string{"panes"}, []string{"socket"}); err != nil {
		return err
	}
	type alias SnapshotRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = SnapshotRequest(a)
	return nil
}

// SnapshotResponse answers snapshot.
type SnapshotResponse struct {
	Panes []Pane `json:"panes"`
}

func (r *SnapshotResponse) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"panes"}); err != nil {
		return err
	}
	type alias SnapshotResponse
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = SnapshotResponse(a)
	return nil
}

// Pane is one pane as the host reports it.
type Pane struct {
	ID            string  `json:"id"`
	Target        *string `json:"target"`
	Cwd           *string `json:"cwd"`
	Command       string  `json:"command"`
	PanePID       uint64  `json:"panePid"`
	SuggestedName *string `json:"suggestedName"`
	AgentName     *string `json:"agentName,omitempty"`
	OpenedByTMT   bool    `json:"openedByTmt,omitempty"`
	Marker        *Marker `json:"marker"`
}

func (p *Pane) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, []string{"target", "cwd", "suggestedName", "marker"}, []string{"id", "command", "panePid"}); err != nil {
		return err
	}
	type alias Pane
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*p = Pane(a)
	return nil
}

// Marker is what core stores on a bound pane so any process can see the binding.
type Marker struct {
	Name          string `json:"name"`
	CanonicalName string `json:"canonicalName"`
	IdentityID    string `json:"identityId"`
	BindingID     string `json:"bindingId"`
	ServerID      string `json:"serverId"`
	PanePID       uint64 `json:"panePid"`
}

func (m *Marker) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"name", "canonicalName", "identityId", "bindingId", "serverId", "panePid"}); err != nil {
		return err
	}
	type alias Marker
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*m = Marker(a)
	return nil
}

// ProbeRequest probes a server incarnation and a list of panes.
type ProbeRequest struct {
	Server ServerIncarnation `json:"server"`
	Panes  []string          `json:"panes"`
}

func (r *ProbeRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"server", "panes"}); err != nil {
		return err
	}
	type alias ProbeRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = ProbeRequest(a)
	return nil
}

// ProbeState is the tagged state of a ProbeResponse.
type ProbeState string

const (
	ProbeStateLive    ProbeState = "live"
	ProbeStateDead    ProbeState = "dead"
	ProbeStateUnknown ProbeState = "unknown"
)

// ProbeResponse answers probe.
type ProbeResponse struct {
	State ProbeState `json:"state"`
	Panes []Pane     `json:"panes,omitempty"`
}

func (r ProbeResponse) MarshalJSON() ([]byte, error) {
	switch r.State {
	case ProbeStateLive:
		panes := r.Panes
		if panes == nil {
			panes = []Pane{}
		}
		return json.Marshal(struct {
			State ProbeState `json:"state"`
			Panes []Pane     `json:"panes"`
		}{State: ProbeStateLive, Panes: panes})
	case ProbeStateDead, ProbeStateUnknown:
		return json.Marshal(struct {
			State ProbeState `json:"state"`
		}{State: r.State})
	default:
		return nil, fmt.Errorf("invalid probe state %q", r.State)
	}
}

func (r *ProbeResponse) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"state"}); err != nil {
		return err
	}
	var head struct {
		State ProbeState `json:"state"`
	}
	if err := json.Unmarshal(data, &head); err != nil {
		return err
	}
	switch head.State {
	case ProbeStateLive:
		if err := requireFields(data, nil, []string{"panes"}); err != nil {
			return err
		}
		var live struct {
			Panes []Pane `json:"panes"`
		}
		if err := json.Unmarshal(data, &live); err != nil {
			return err
		}
		*r = ProbeResponse{State: ProbeStateLive, Panes: live.Panes}
		return nil
	case ProbeStateDead, ProbeStateUnknown:
		*r = ProbeResponse{State: head.State}
		return nil
	default:
		return fmt.Errorf("unknown probe state %q", head.State)
	}
}

// PublishRequest stores a binding marker on a pane.
type PublishRequest struct {
	Socket            string  `json:"socket"`
	PaneID            string  `json:"paneId"`
	PanePID           uint64  `json:"panePid"`
	ExpectedBindingID *string `json:"expectedBindingId,omitempty"`
	Marker            Marker  `json:"marker"`
}

func (r *PublishRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"socket", "paneId", "panePid", "marker"}); err != nil {
		return err
	}
	type alias PublishRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = PublishRequest(a)
	return nil
}

// ClearRequest clears a binding marker if it matches bindingId.
type ClearRequest struct {
	Socket    string `json:"socket"`
	PaneID    string `json:"paneId"`
	BindingID string `json:"bindingId"`
}

func (r *ClearRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"socket", "paneId", "bindingId"}); err != nil {
		return err
	}
	type alias ClearRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = ClearRequest(a)
	return nil
}

// ClearResponse answers clear.
type ClearResponse struct {
	Cleared bool `json:"cleared"`
}

func (r *ClearResponse) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"cleared"}); err != nil {
		return err
	}
	type alias ClearResponse
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = ClearResponse(a)
	return nil
}

// CaptureRequest captures visible screen (lines == 0) or tail lines of a pane.
type CaptureRequest struct {
	Socket string `json:"socket"`
	PaneID string `json:"paneId"`
	Lines  uint32 `json:"lines"`
}

func (r *CaptureRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"socket", "paneId", "lines"}); err != nil {
		return err
	}
	type alias CaptureRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = CaptureRequest(a)
	return nil
}

// CaptureResponse answers capture.
type CaptureResponse struct {
	Text string `json:"text"`
}

func (r *CaptureResponse) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"text"}); err != nil {
		return err
	}
	type alias CaptureResponse
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = CaptureResponse(a)
	return nil
}

// InputRequest pastes text literally and optionally presses Enter.
type InputRequest struct {
	Socket string `json:"socket"`
	PaneID string `json:"paneId"`
	Text   string `json:"text"`
	Enter  bool   `json:"enter"`
}

func (r *InputRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"socket", "paneId", "text", "enter"}); err != nil {
		return err
	}
	type alias InputRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = InputRequest(a)
	return nil
}

// PromptRequest hands text to the agent recognized in the pane.
type PromptRequest struct {
	Socket string `json:"socket"`
	PaneID string `json:"paneId"`
	Text   string `json:"text"`
}

func (r *PromptRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"socket", "paneId", "text"}); err != nil {
		return err
	}
	type alias PromptRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = PromptRequest(a)
	return nil
}

// FocusRequest focuses a pane.
type FocusRequest struct {
	Socket string `json:"socket"`
	PaneID string `json:"paneId"`
}

func (r *FocusRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"socket", "paneId"}); err != nil {
		return err
	}
	type alias FocusRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = FocusRequest(a)
	return nil
}

// FocusResponse answers focus with the optional previously focused pane ID.
type FocusResponse struct {
	Previous *string `json:"previous,omitempty"`
}

func (r *FocusResponse) UnmarshalJSON(data []byte) error {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(data, &obj); err != nil {
		return err
	}
	if obj == nil {
		return fmt.Errorf("expected JSON object")
	}
	type alias FocusResponse
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = FocusResponse(a)
	return nil
}

// CloseRequest closes a TMT-opened pane while it still runs panePid.
type CloseRequest struct {
	Socket  string `json:"socket"`
	PaneID  string `json:"paneId"`
	PanePID uint64 `json:"panePid"`
}

func (r *CloseRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"socket", "paneId", "panePid"}); err != nil {
		return err
	}
	type alias CloseRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = CloseRequest(a)
	return nil
}

// NameAgentRequest sets or clears an agent's host-recognized name.
type NameAgentRequest struct {
	Socket    string  `json:"socket"`
	PaneID    string  `json:"paneId"`
	PanePID   uint64  `json:"panePid"`
	BindingID string  `json:"bindingId"`
	Name      *string `json:"name"`
	Expected  *string `json:"expected,omitempty"`
}

func (r *NameAgentRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, []string{"name"}, []string{"socket", "paneId", "panePid", "bindingId"}); err != nil {
		return err
	}
	type alias NameAgentRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = NameAgentRequest(a)
	return nil
}

// RuntimeCapabilities is what a runtime driver answers to capabilities.
type RuntimeCapabilities struct {
	Protocols   []uint32 `json:"protocols"`
	Kind        string   `json:"kind"`
	Name        string   `json:"name"`
	Version     string   `json:"version"`
	Ops         []string `json:"ops"`
	Executables []string `json:"executables"`
	Claims      bool     `json:"claims"`
	Env         []string `json:"env"`
	SessionEnv  *string  `json:"sessionEnv"`
	Hooks       *Hooks   `json:"hooks"`
}

func (c *RuntimeCapabilities) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"protocols", "kind", "name", "version", "ops", "executables"}); err != nil {
		return err
	}
	type alias RuntimeCapabilities
	a := alias{Claims: true}
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*c = RuntimeCapabilities(a)
	return nil
}

// Hooks declares where a provider hook payload holds each value and what each event means.
type Hooks struct {
	Format string                 `json:"format"`
	Fields HookFields             `json:"fields"`
	Events []HookEventDeclaration `json:"events"`
}

func (h *Hooks) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"format", "fields", "events"}); err != nil {
		return err
	}
	type alias Hooks
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*h = Hooks(a)
	return nil
}

// HookFields holds RFC 6901 JSON Pointers into a hook payload.
type HookFields struct {
	Event      string  `json:"event"`
	Session    string  `json:"session"`
	Model      *string `json:"model"`
	Transcript *string `json:"transcript"`
	Turn       *string `json:"turn"`
}

func (f *HookFields) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"event", "session"}); err != nil {
		return err
	}
	type alias HookFields
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*f = HookFields(a)
	return nil
}

// HookEffect is the lifecycle effect of a declared hook event.
type HookEffect string

const (
	HookEffectStart   HookEffect = "start"
	HookEffectEnd     HookEffect = "end"
	HookEffectWorking HookEffect = "working"
	HookEffectIdle    HookEffect = "idle"
)

func (e *HookEffect) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	switch HookEffect(s) {
	case HookEffectStart, HookEffectEnd, HookEffectWorking, HookEffectIdle:
		*e = HookEffect(s)
		return nil
	default:
		return fmt.Errorf("unknown hook effect %q", s)
	}
}

// Transition describes how a session changed for a start or end hook event.
type Transition string

const (
	TransitionStarted   Transition = "started"
	TransitionResumed   Transition = "resumed"
	TransitionCleared   Transition = "cleared"
	TransitionCompacted Transition = "compacted"
	TransitionForked    Transition = "forked"
	TransitionEnded     Transition = "ended"
)

func (t *Transition) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	switch Transition(s) {
	case TransitionStarted, TransitionResumed, TransitionCleared, TransitionCompacted, TransitionForked, TransitionEnded:
		*t = Transition(s)
		return nil
	default:
		return fmt.Errorf("unknown transition %q", s)
	}
}

// HookEventDeclaration maps a hook event name to its effect and optional transition mapping.
type HookEventDeclaration struct {
	Name   string                `json:"name"`
	Effect HookEffect            `json:"effect"`
	By     *string               `json:"by"`
	Values map[string]Transition `json:"values"`
}

func (d *HookEventDeclaration) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"name", "effect"}); err != nil {
		return err
	}
	type alias HookEventDeclaration
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*d = HookEventDeclaration(a)
	return nil
}

// LocationsRequest asks a runtime driver for its config, skills, hooks, and transcript paths.
type LocationsRequest struct {
	Home string            `json:"home"`
	Env  map[string]string `json:"env"`
}

func (r *LocationsRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"home", "env"}); err != nil {
		return err
	}
	type alias LocationsRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = LocationsRequest(a)
	return nil
}

// LocationsResponse answers locations with absolute paths.
type LocationsResponse struct {
	ConfigDirs     []string `json:"configDirs"`
	Skills         string   `json:"skills"`
	HookSettings   *string  `json:"hookSettings"`
	TranscriptRoot *string  `json:"transcriptRoot"`
}

func (r *LocationsResponse) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, []string{"hookSettings", "transcriptRoot"}, []string{"configDirs", "skills"}); err != nil {
		return err
	}
	type alias LocationsResponse
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = LocationsResponse(a)
	return nil
}

// ResumeRequest asks a runtime driver for the argv to resume a provider session.
type ResumeRequest struct {
	Session string  `json:"session"`
	Model   *string `json:"model"`
}

func (r *ResumeRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, []string{"model"}, []string{"session"}); err != nil {
		return err
	}
	type alias ResumeRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = ResumeRequest(a)
	return nil
}

// ResumeResponse answers resume with the direct argv to execute.
type ResumeResponse struct {
	Argv []string `json:"argv"`
}

func (r *ResumeResponse) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"argv"}); err != nil {
		return err
	}
	type alias ResumeResponse
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = ResumeResponse(a)
	return nil
}

// UsageRequest asks a runtime driver for context usage from a verified transcript path.
type UsageRequest struct {
	Session    string `json:"session"`
	Transcript string `json:"transcript"`
}

func (r *UsageRequest) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"session", "transcript"}); err != nil {
		return err
	}
	type alias UsageRequest
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = UsageRequest(a)
	return nil
}

// UsageResponse answers usage.
type UsageResponse struct {
	ContextTokens *uint64 `json:"contextTokens"`
}

func (r *UsageResponse) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, []string{"contextTokens"}, nil); err != nil {
		return err
	}
	type alias UsageResponse
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*r = UsageResponse(a)
	return nil
}

// ErrorCode is a structured driver error code.
type ErrorCode string

const (
	ErrorUnsupported ErrorCode = "unsupported"
	ErrorBadRequest  ErrorCode = "bad_request"
	ErrorUnavailable ErrorCode = "unavailable"
	ErrorNotFound    ErrorCode = "not_found"
	ErrorFailed      ErrorCode = "failed"
	ErrorNoAgent     ErrorCode = "no_agent"
	ErrorBlocked     ErrorCode = "blocked"
	ErrorNotReady    ErrorCode = "not_ready"
	ErrorRefused     ErrorCode = "refused"
)

func (c *ErrorCode) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	switch ErrorCode(s) {
	case ErrorUnsupported, ErrorBadRequest, ErrorUnavailable, ErrorNotFound,
		ErrorFailed, ErrorNoAgent, ErrorBlocked, ErrorNotReady, ErrorRefused:
		*c = ErrorCode(s)
		return nil
	default:
		return fmt.Errorf("unknown error code %q", s)
	}
}

// Answers reports whether this error code may answer op.
func (c ErrorCode) Answers(op Op) bool {
	switch c {
	case ErrorNoAgent, ErrorNotReady:
		return op == OpPrompt || op == OpNameAgent
	case ErrorBlocked:
		return op == OpPrompt
	case ErrorRefused:
		return op == OpNameAgent || op == OpPublish
	case ErrorUnsupported, ErrorBadRequest, ErrorUnavailable, ErrorNotFound, ErrorFailed:
		return true
	default:
		return false
	}
}

// DriverError is a driver's structured error response.
type DriverError struct {
	Code    ErrorCode `json:"code"`
	Message string    `json:"message"`
}

// NewDriverError constructs a DriverError.
func NewDriverError(code ErrorCode, message string) *DriverError {
	return &DriverError{Code: code, Message: message}
}

func (e *DriverError) Error() string {
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

func (e *DriverError) UnmarshalJSON(data []byte) error {
	if err := requireFields(data, nil, []string{"code", "message"}); err != nil {
		return err
	}
	type alias DriverError
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*e = DriverError(a)
	return nil
}

// Response is the top-level driver envelope: exactly one of {"ok": ...} or {"error": ...}.
type Response[T any] struct {
	Ok    *T
	Error *DriverError
}

func (r Response[T]) MarshalJSON() ([]byte, error) {
	if r.Ok != nil && r.Error != nil {
		return nil, fmt.Errorf("response cannot contain both ok and error")
	}
	if r.Ok != nil {
		return json.Marshal(struct {
			Ok *T `json:"ok"`
		}{Ok: r.Ok})
	}
	if r.Error != nil {
		return json.Marshal(struct {
			Error *DriverError `json:"error"`
		}{Error: r.Error})
	}
	return nil, fmt.Errorf("response must contain ok or error")
}

func (r *Response[T]) UnmarshalJSON(data []byte) error {
	var obj map[string]json.RawMessage
	if err := json.Unmarshal(data, &obj); err != nil {
		return err
	}
	if len(obj) != 1 {
		return fmt.Errorf("response envelope must contain exactly one of ok or error")
	}
	if rawOk, hasOk := obj["ok"]; hasOk {
		var val T
		if err := json.Unmarshal(rawOk, &val); err != nil {
			return err
		}
		*r = Response[T]{Ok: &val}
		return nil
	}
	if rawErr, hasErr := obj["error"]; hasErr {
		var derr DriverError
		if err := json.Unmarshal(rawErr, &derr); err != nil {
			return err
		}
		*r = Response[T]{Error: &derr}
		return nil
	}
	return fmt.Errorf("response envelope must contain ok or error")
}
