package driverprotocol

import (
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/hostgrammar"
)

const (
	executablesMax = 4
	executableMax  = 64
	eventsMax      = 8
	eventNameMax   = 64
	valuesMax      = 16
	valueMax       = 64
	pointerMax     = 128
	sessionMax     = 256
	modelMax       = 256
	pathMax        = 1024

	sessionHooksJSON = "sessionHooksJson"
)

// RuntimeDeclaration is a runtime driver's validated declaration.
type RuntimeDeclaration struct {
	name        string
	ops         map[Op]struct{}
	executables []string
	claims      bool
	env         []string
	sessionEnv  *string
	hooks       *Hooks
}

// HookObservation is what one provider hook reported, decoded from its payload.
type HookObservation struct {
	Event      string
	Effect     HookEffect
	Transition *Transition
	Session    string
	Model      *string
	Transcript *string
	Turn       *string
}

// NewRuntimeDeclaration validates everything in capabilities except protocol, kind, and version,
// which DecodeRuntimeCapabilities checks for every driver kind.
func NewRuntimeDeclaration(capabilities *RuntimeCapabilities) (*RuntimeDeclaration, error) {
	if !hostgrammar.ValidName(capabilities.Name) {
		return nil, hostgrammar.NewGrammarError("name must be [a-z][a-z0-9-]{0,31}")
	}
	ops := make(map[Op]struct{})
	for _, name := range capabilities.Ops {
		if op, ok := ParseOp(name); ok && op.IsRuntime() {
			ops[op] = struct{}{}
		}
	}
	if _, ok := ops[OpLocations]; !ok {
		return nil, hostgrammar.NewGrammarError("ops must list locations")
	}
	if err := checkExecutables(capabilities.Executables); err != nil {
		return nil, err
	}
	if len(capabilities.Env) > 4 {
		return nil, hostgrammar.NewGrammarError("env names at most 4 variables")
	}
	for _, variable := range capabilities.Env {
		if !validEnvName(variable) {
			return nil, hostgrammar.NewGrammarError(fmt.Sprintf(
				"%q must be [A-Z][A-Z0-9_]* and not TMT_*", variable,
			))
		}
	}
	if capabilities.SessionEnv != nil && !validEnvName(*capabilities.SessionEnv) {
		return nil, hostgrammar.NewGrammarError(fmt.Sprintf(
			"%q must be [A-Z][A-Z0-9_]* and not TMT_*", *capabilities.SessionEnv,
		))
	}
	if capabilities.Hooks != nil {
		if err := checkHooks(capabilities.Hooks); err != nil {
			return nil, err
		}
	}
	if _, hasUsage := ops[OpUsage]; hasUsage {
		reportsTurns := false
		if capabilities.Hooks != nil && capabilities.Hooks.Fields.Transcript != nil {
			for _, ev := range capabilities.Hooks.Events {
				if ev.Effect == HookEffectIdle {
					reportsTurns = true
					break
				}
			}
		}
		if !reportsTurns {
			return nil, hostgrammar.NewGrammarError("usage needs hooks with an idle event and a transcript field")
		}
	}
	var sessionEnvCopy *string
	if capabilities.SessionEnv != nil {
		s := *capabilities.SessionEnv
		sessionEnvCopy = &s
	}
	return &RuntimeDeclaration{
		name:        capabilities.Name,
		ops:         ops,
		executables: slices.Clone(capabilities.Executables),
		claims:      capabilities.Claims,
		env:         slices.Clone(capabilities.Env),
		sessionEnv:  sessionEnvCopy,
		hooks:       cloneHooks(capabilities.Hooks),
	}, nil
}

func cloneHooks(h *Hooks) *Hooks {
	if h == nil {
		return nil
	}
	clonePtr := func(p *string) *string {
		if p == nil {
			return nil
		}
		s := *p
		return &s
	}
	events := make([]HookEventDeclaration, len(h.Events))
	for i, ev := range h.Events {
		events[i] = HookEventDeclaration{
			Name:   ev.Name,
			Effect: ev.Effect,
			By:     clonePtr(ev.By),
			Values: maps.Clone(ev.Values),
		}
	}
	return &Hooks{
		Format: h.Format,
		Fields: HookFields{
			Event:      h.Fields.Event,
			Session:    h.Fields.Session,
			Model:      clonePtr(h.Fields.Model),
			Transcript: clonePtr(h.Fields.Transcript),
			Turn:       clonePtr(h.Fields.Turn),
		},
		Events: events,
	}
}

// Name returns the runtime driver's name.
func (d *RuntimeDeclaration) Name() string { return d.name }

// Supports reports whether the driver implements a runtime operation.
func (d *RuntimeDeclaration) Supports(op Op) bool {
	_, ok := d.ops[op]
	return ok
}

// Executables returns a copy of the declared executable names.
func (d *RuntimeDeclaration) Executables() []string { return slices.Clone(d.executables) }

// Env returns a copy of the environment variable names locations reads.
func (d *RuntimeDeclaration) Env() []string { return slices.Clone(d.env) }

// SessionEnv returns the optional environment variable holding the provider session ID.
func (d *RuntimeDeclaration) SessionEnv() *string {
	if d.sessionEnv == nil {
		return nil
	}
	s := *d.sessionEnv
	return &s
}

// Hooks returns a copy of the declared hooks, or nil if none were declared.
func (d *RuntimeDeclaration) Hooks() *Hooks { return cloneHooks(d.hooks) }

// Claims reports whether command's last path component is a declared executable
// and claiming is enabled. Pure: no process or file is consulted.
func (d *RuntimeDeclaration) Claims(command string) bool {
	if !d.claims {
		return false
	}
	base := command
	if idx := strings.LastIndexByte(command, '/'); idx >= 0 {
		base = command[idx+1:]
	}
	return slices.Contains(d.executables, base)
}

// DecodeHook decodes one provider hook's payload. Returns (nil, false) when core ignores it
// and changes nothing: no hooks declared, payload over bound or not a JSON object, no event
// matches, or a required value is missing or invalid. An invalid optional value reads as nil.
func (d *RuntimeDeclaration) DecodeHook(payload []byte) (*HookObservation, bool) {
	if d.hooks == nil || len(payload) > MaxHookPayloadBytes {
		return nil, false
	}
	var doc any
	if err := unmarshalExact(payload, &doc); err != nil {
		return nil, false
	}
	obj, ok := doc.(map[string]any)
	if !ok || obj == nil {
		return nil, false
	}
	textAt := func(ptr string) (string, bool) {
		val, found := jsonPointer(obj, ptr)
		if !found {
			return "", false
		}
		s, ok := val.(string)
		return s, ok
	}
	name, ok := textAt(d.hooks.Fields.Event)
	if !ok {
		return nil, false
	}
	var matched *HookEventDeclaration
	for i := range d.hooks.Events {
		if d.hooks.Events[i].Name == name {
			matched = &d.hooks.Events[i]
			break
		}
	}
	if matched == nil {
		return nil, false
	}
	session, ok := textAt(d.hooks.Fields.Session)
	if !ok || !sessionID(session) {
		return nil, false
	}
	var transition *Transition
	switch matched.Effect {
	case HookEffectStart, HookEffectEnd:
		if matched.By == nil {
			return nil, false
		}
		byVal, ok := textAt(*matched.By)
		if !ok {
			return nil, false
		}
		tr, ok := matched.Values[byVal]
		if !ok {
			return nil, false
		}
		transition = &tr
	case HookEffectWorking, HookEffectIdle:
	}

	optional := func(ptr *string, valid func(string) bool) *string {
		if ptr == nil {
			return nil
		}
		val, ok := textAt(*ptr)
		if !ok || !valid(val) {
			return nil
		}
		return &val
	}

	return &HookObservation{
		Event:      matched.Name,
		Effect:     matched.Effect,
		Transition: transition,
		Session:    session,
		Model: optional(d.hooks.Fields.Model, func(v string) bool {
			return len(v) > 0 && plain(v, modelMax)
		}),
		Transcript: optional(d.hooks.Fields.Transcript, absolutePath),
		Turn:       optional(d.hooks.Fields.Turn, sessionID),
	}, true
}

func sessionID(value string) bool {
	return len(strings.TrimSpace(value)) > 0 && plain(value, sessionMax)
}

func absolutePath(value string) bool {
	if !strings.HasPrefix(value, "/") || len(value) <= 1 || !plain(value, pathMax) {
		return false
	}
	for _, component := range strings.Split(value, "/") {
		if component == "." || component == ".." {
			return false
		}
	}
	return true
}

func checkExecutables(executables []string) error {
	if len(executables) < 1 || len(executables) > executablesMax {
		return hostgrammar.NewGrammarError("executables names 1 to 4 commands")
	}
	seen := make(map[string]struct{}, len(executables))
	for _, executable := range executables {
		if !validExecutable(executable) {
			return hostgrammar.NewGrammarError(fmt.Sprintf(
				"executable %q must be 1-64 of [a-z0-9._-], starting with a letter or digit",
				executable,
			))
		}
		if _, dup := seen[executable]; dup {
			return hostgrammar.NewGrammarError(fmt.Sprintf("executable %q is listed twice", executable))
		}
		seen[executable] = struct{}{}
	}
	return nil
}

func validExecutable(s string) bool {
	if len(s) < 1 || len(s) > executableMax {
		return false
	}
	c0 := s[0]
	if !((c0 >= 'a' && c0 <= 'z') || (c0 >= '0' && c0 <= '9')) {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == '-') {
			return false
		}
	}
	return true
}

func checkHooks(hooks *Hooks) error {
	if hooks.Format != sessionHooksJSON {
		return hostgrammar.NewGrammarError("hooks.format must be sessionHooksJson")
	}
	ptrs := []string{hooks.Fields.Event, hooks.Fields.Session}
	for _, opt := range []*string{hooks.Fields.Model, hooks.Fields.Transcript, hooks.Fields.Turn} {
		if opt != nil {
			ptrs = append(ptrs, *opt)
		}
	}
	for _, ptr := range ptrs {
		if err := checkPointer(ptr); err != nil {
			return err
		}
	}
	if len(hooks.Events) < 1 || len(hooks.Events) > eventsMax {
		return hostgrammar.NewGrammarError("hooks declare 1 to 8 events")
	}
	names := make(map[string]struct{}, len(hooks.Events))
	for i := range hooks.Events {
		ev := &hooks.Events[i]
		if err := checkEvent(ev); err != nil {
			return err
		}
		if _, dup := names[ev.Name]; dup {
			return hostgrammar.NewGrammarError(fmt.Sprintf("hook event %q is declared twice", ev.Name))
		}
		names[ev.Name] = struct{}{}
	}
	return nil
}

func checkEvent(event *HookEventDeclaration) error {
	if !validEventName(event.Name) {
		return hostgrammar.NewGrammarError(fmt.Sprintf(
			"hook event name %q must be 1-64 of [A-Za-z0-9_]", event.Name,
		))
	}
	var allowed []Transition
	switch event.Effect {
	case HookEffectStart:
		allowed = []Transition{
			TransitionStarted, TransitionResumed, TransitionCleared,
			TransitionCompacted, TransitionForked,
		}
	case HookEffectEnd:
		allowed = []Transition{TransitionCleared, TransitionResumed, TransitionEnded}
	case HookEffectWorking, HookEffectIdle:
		if event.By != nil || len(event.Values) > 0 {
			return hostgrammar.NewGrammarError(fmt.Sprintf("hook event %q takes no by or values", event.Name))
		}
		return nil
	default:
		return hostgrammar.NewGrammarError(fmt.Sprintf("hook event %q has unknown effect", event.Name))
	}
	if event.By == nil {
		return hostgrammar.NewGrammarError(fmt.Sprintf("hook event %q needs by and values", event.Name))
	}
	if err := checkPointer(*event.By); err != nil {
		return err
	}
	if len(event.Values) < 1 || len(event.Values) > valuesMax {
		return hostgrammar.NewGrammarError(fmt.Sprintf("hook event %q maps 1 to 16 values", event.Name))
	}
	for val, tr := range event.Values {
		if len(val) == 0 || !plain(val, valueMax) {
			return hostgrammar.NewGrammarError(fmt.Sprintf(
				"hook event %q has a value that isn't 1-64 bytes of text", event.Name,
			))
		}
		if !slices.Contains(allowed, tr) {
			return hostgrammar.NewGrammarError(fmt.Sprintf(
				"hook event %q can't report %s", event.Name, tr,
			))
		}
	}
	return nil
}

func validEventName(name string) bool {
	if len(name) < 1 || len(name) > eventNameMax {
		return false
	}
	for i := 0; i < len(name); i++ {
		c := name[i]
		if !((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_') {
			return false
		}
	}
	return true
}

// checkPointer validates an RFC 6901 JSON Pointer to a member: starts with '/',
// up to 128 bytes of plain text, and '~' only begins '~0' or '~1'.
func checkPointer(pointer string) error {
	escapesValid := true
	for i := 0; i < len(pointer); i++ {
		if pointer[i] == '~' {
			if i+1 >= len(pointer) || (pointer[i+1] != '0' && pointer[i+1] != '1') {
				escapesValid = false
				break
			}
			i++
		}
	}
	if strings.HasPrefix(pointer, "/") && plain(pointer, pointerMax) && escapesValid {
		return nil
	}
	return hostgrammar.NewGrammarError(fmt.Sprintf(
		"%q must be a JSON Pointer of up to 128 bytes", pointer,
	))
}

func jsonPointer(root any, pointer string) (any, bool) {
	if pointer == "" {
		return root, true
	}
	if !strings.HasPrefix(pointer, "/") {
		return nil, false
	}
	cur := root
	for _, rawSegment := range strings.Split(pointer[1:], "/") {
		seg := strings.ReplaceAll(strings.ReplaceAll(rawSegment, "~1", "/"), "~0", "~")
		obj, ok := cur.(map[string]any)
		if !ok {
			return nil, false
		}
		next, exists := obj[seg]
		if !exists {
			return nil, false
		}
		cur = next
	}
	return cur, true
}
