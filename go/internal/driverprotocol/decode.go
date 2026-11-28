package driverprotocol

import (
	"fmt"
	"slices"
	"strings"
)

const (
	messageMax    = 512
	versionMax    = 64
	panesMax      = 4096
	cwdMax        = 4096
	commandMax    = 256
	nameMax       = 256
	startTimeMax  = 64
	configDirsMax = 4
	argvMax       = 64
)

// DecodeErrorKind classifies why a driver's stdout could not be accepted.
type DecodeErrorKind uint8

const (
	DecodeTooLarge DecodeErrorKind = iota
	DecodeJSON
	DecodeInvalid
	DecodeGrammar
	DecodeProtocol
)

// DecodeError reports why a driver's output failed bounding, JSON parsing, or contract validation.
type DecodeError struct {
	Kind      DecodeErrorKind
	Op        Op
	Limit     int
	Reason    string
	Grammar   error
	Protocols []uint32
}

func (e *DecodeError) Error() string {
	switch e.Kind {
	case DecodeTooLarge:
		return fmt.Sprintf("%s printed more than %d bytes", e.Op, e.Limit)
	case DecodeJSON:
		return fmt.Sprintf("%s printed invalid JSON: %s", e.Op, e.Reason)
	case DecodeInvalid:
		return fmt.Sprintf("%s: %s", e.Op, e.Reason)
	case DecodeGrammar:
		return fmt.Sprintf("capabilities: %v", e.Grammar)
	case DecodeProtocol:
		return fmt.Sprintf("the driver speaks protocol %v; this tmt speaks %d", e.Protocols, Protocol)
	default:
		return "decode error"
	}
}

// Answer is implemented by every typed driver response whose fields are validated against
// either *Grammar (host ops) or *RuntimeDeclaration (runtime ops).
type Answer[D any] interface {
	Op() Op
	Check(declaration D) error
}

// Decode parses and validates a driver's answer for op T.
// Returns (val, nil, nil) on {"ok": ...}, (zero, driverErr, nil) on {"error": ...},
// or (zero, nil, decodeErr) when the driver broke the wire contract.
func Decode[D any, T Answer[D]](declaration D, output []byte) (T, *DriverError, *DecodeError) {
	var zero T
	op := zero.Op()
	env, derr := decodeEnvelope[T](op, output)
	if derr != nil {
		return zero, nil, derr
	}
	if env.Error != nil {
		return zero, env.Error, nil
	}
	val := *env.Ok
	if err := val.Check(declaration); err != nil {
		return zero, nil, &DecodeError{Kind: DecodeInvalid, Op: op, Reason: err.Error()}
	}
	return val, nil, nil
}

// DecodeCapabilities decodes and validates a host driver's capabilities response.
func DecodeCapabilities(output []byte) (*Capabilities, *Grammar, *DecodeError) {
	caps, derr := decodeDeclared[Capabilities](output)
	if derr != nil {
		return nil, nil, derr
	}
	if derr := checkCommonCapabilities(caps.Protocols, caps.Kind, "host", caps.Version); derr != nil {
		return nil, nil, derr
	}
	grammar, err := GrammarFromCapabilities(&caps)
	if err != nil {
		return nil, nil, &DecodeError{Kind: DecodeGrammar, Op: OpCapabilities, Grammar: err}
	}
	return &caps, grammar, nil
}

// DecodeRuntimeCapabilities decodes and validates a runtime driver's capabilities response.
func DecodeRuntimeCapabilities(output []byte) (*RuntimeCapabilities, *RuntimeDeclaration, *DecodeError) {
	caps, derr := decodeDeclared[RuntimeCapabilities](output)
	if derr != nil {
		return nil, nil, derr
	}
	if derr := checkCommonCapabilities(caps.Protocols, caps.Kind, "runtime", caps.Version); derr != nil {
		return nil, nil, derr
	}
	decl, err := NewRuntimeDeclaration(&caps)
	if err != nil {
		return nil, nil, &DecodeError{Kind: DecodeGrammar, Op: OpCapabilities, Grammar: err}
	}
	return &caps, decl, nil
}

func decodeDeclared[T any](output []byte) (T, *DecodeError) {
	var zero T
	env, derr := decodeEnvelope[T](OpCapabilities, output)
	if derr != nil {
		return zero, derr
	}
	if env.Error != nil {
		return zero, &DecodeError{
			Kind:   DecodeInvalid,
			Op:     OpCapabilities,
			Reason: fmt.Sprintf("the driver refused: %s", env.Error.Message),
		}
	}
	return *env.Ok, nil
}

func checkCommonCapabilities(protocols []uint32, kind, expected, version string) *DecodeError {
	if !slices.Contains(protocols, Protocol) {
		return &DecodeError{
			Kind:      DecodeProtocol,
			Op:        OpCapabilities,
			Protocols: slices.Clone(protocols),
		}
	}
	if kind != expected {
		return &DecodeError{
			Kind:   DecodeInvalid,
			Op:     OpCapabilities,
			Reason: fmt.Sprintf("kind must be %s", expected),
		}
	}
	if len(version) == 0 || !plain(version, versionMax) {
		return &DecodeError{
			Kind:   DecodeInvalid,
			Op:     OpCapabilities,
			Reason: "version must be 1-64 bytes of text",
		}
	}
	return nil
}

func decodeEnvelope[T any](op Op, output []byte) (Response[T], *DecodeError) {
	var zero Response[T]
	limit := op.Bounds().MaxOutputBytes
	if len(output) > limit {
		return zero, &DecodeError{Kind: DecodeTooLarge, Op: op, Limit: limit}
	}
	var env Response[T]
	if err := unmarshalExact(output, &env); err != nil {
		return zero, &DecodeError{Kind: DecodeJSON, Op: op, Reason: err.Error()}
	}
	if env.Error != nil {
		if !plain(env.Error.Message, messageMax) {
			return zero, &DecodeError{
				Kind:   DecodeInvalid,
				Op:     op,
				Reason: "the error message must be up to 512 bytes of text",
			}
		}
		if !env.Error.Code.Answers(op) {
			return zero, &DecodeError{
				Kind:   DecodeInvalid,
				Op:     op,
				Reason: "an agent or name code answers only prompt or name-agent",
			}
		}
	}
	return env, nil
}

// DecodeDone decodes an answer to publish, input, prompt, focus, close, or name-agent:
// {"ok": {}}, or the driver's structured error.
func DecodeDone(op Op, output []byte) (*DriverError, *DecodeError) {
	env, derr := decodeEnvelope[Empty](op, output)
	if derr != nil {
		return nil, derr
	}
	if env.Error != nil {
		return env.Error, nil
	}
	return nil, nil
}

func require(ok bool, reason string) error {
	if !ok {
		return fmt.Errorf("%s", reason)
	}
	return nil
}

func checkPane(pane *Pane, grammar *Grammar) error {
	if err := require(grammar.IsPaneID(pane.ID), "a pane ID is outside the declared syntax"); err != nil {
		return err
	}
	if err := require(pane.Target == nil || grammar.IsTarget(*pane.Target), "a pane target is outside the declared syntax"); err != nil {
		return err
	}
	if err := require(pane.Cwd == nil || (strings.HasPrefix(*pane.Cwd, "/") && plain(*pane.Cwd, cwdMax)), "a pane cwd must be an absolute path of text"); err != nil {
		return err
	}
	if err := require(plain(pane.Command, commandMax), "a pane command must be text"); err != nil {
		return err
	}
	if err := require(validPID(pane.PanePID), "a pane pid is out of range"); err != nil {
		return err
	}
	if err := require(pane.SuggestedName == nil || plain(*pane.SuggestedName, nameMax), "a suggested name must be text"); err != nil {
		return err
	}
	if err := require(pane.AgentName == nil || (len(*pane.AgentName) > 0 && plain(*pane.AgentName, nameMax)), "an agent name must be 1-256 bytes of text"); err != nil {
		return err
	}
	if pane.Marker != nil {
		if err := checkMarker(pane.Marker); err != nil {
			return err
		}
	}
	return nil
}

func checkMarker(marker *Marker) error {
	if err := require(
		len(marker.Name) > 0 && plain(marker.Name, nameMax) &&
			len(marker.CanonicalName) > 0 && plain(marker.CanonicalName, nameMax),
		"a marker name must be text",
	); err != nil {
		return err
	}
	if err := require(
		uuidShaped(marker.IdentityID) && uuidShaped(marker.BindingID) && uuidShaped(marker.ServerID),
		"a marker ID is not a UUID",
	); err != nil {
		return err
	}
	return require(validPID(marker.PanePID), "a marker pid is out of range")
}

func checkPanes(panes []Pane, grammar *Grammar) error {
	if err := require(len(panes) <= panesMax, "more than 4096 panes"); err != nil {
		return err
	}
	seen := make(map[string]struct{}, len(panes))
	for i := range panes {
		if err := checkPane(&panes[i], grammar); err != nil {
			return err
		}
		if _, dup := seen[panes[i].ID]; dup {
			return fmt.Errorf("a pane is listed twice")
		}
		seen[panes[i].ID] = struct{}{}
	}
	return nil
}

func panesWithin(panes []Pane, requested *[]string) bool {
	if requested == nil {
		return true
	}
	for i := range panes {
		if !slices.Contains(*requested, panes[i].ID) {
			return false
		}
	}
	return true
}

// Within reports whether every reported pane was among requested (nil means all panes).
func (r SnapshotResponse) Within(requested *[]string) bool {
	return panesWithin(r.Panes, requested)
}

// Within reports whether every live pane was among requested.
func (r ProbeResponse) Within(requested []string) bool {
	if r.State != ProbeStateLive {
		return true
	}
	return panesWithin(r.Panes, &requested)
}

func (CallerResponse) Op() Op { return OpCaller }
func (r CallerResponse) Check(grammar *Grammar) error {
	if r.Pane == nil {
		return nil
	}
	if err := require(grammar.IsPaneID(r.Pane.ID), "the caller pane ID is outside the declared syntax"); err != nil {
		return err
	}
	if err := require(validSocket(r.Pane.Socket), "the caller socket must be an absolute path"); err != nil {
		return err
	}
	return require(validPID(r.Pane.ShellPID), "the caller shell pid is out of range")
}

func (ServerResponse) Op() Op { return OpServer }
func (r ServerResponse) Check(_ *Grammar) error {
	if r.Server == nil {
		return nil
	}
	if err := require(validSocket(r.Server.Socket), "the server socket must be an absolute path"); err != nil {
		return err
	}
	if err := require(validPID(r.Server.PID), "the server pid is out of range"); err != nil {
		return err
	}
	return require(
		len(r.Server.StartTime) > 0 && plain(r.Server.StartTime, startTimeMax),
		"the server start time must be 1-64 bytes of text",
	)
}

func (ResolveTargetResponse) Op() Op { return OpResolveTarget }
func (r ResolveTargetResponse) Check(grammar *Grammar) error {
	return require(
		r.PaneID == nil || grammar.IsPaneID(*r.PaneID),
		"the resolved pane ID is outside the declared syntax",
	)
}

func (SnapshotResponse) Op() Op { return OpSnapshot }
func (r SnapshotResponse) Check(grammar *Grammar) error {
	return checkPanes(r.Panes, grammar)
}

func (ProbeResponse) Op() Op { return OpProbe }
func (r ProbeResponse) Check(grammar *Grammar) error {
	if r.State == ProbeStateLive {
		return checkPanes(r.Panes, grammar)
	}
	return nil
}

func (ClearResponse) Op() Op                   { return OpClear }
func (ClearResponse) Check(_ *Grammar) error   { return nil }
func (CaptureResponse) Op() Op                 { return OpCapture }
func (CaptureResponse) Check(_ *Grammar) error { return nil }

func (FocusResponse) Op() Op { return OpFocus }
func (r FocusResponse) Check(grammar *Grammar) error {
	return require(
		r.Previous == nil || grammar.IsPaneID(*r.Previous),
		"the previous pane ID is outside the declared syntax",
	)
}

func (LocationsResponse) Op() Op { return OpLocations }
func (r LocationsResponse) Check(decl *RuntimeDeclaration) error {
	if err := require(len(r.ConfigDirs) >= 1 && len(r.ConfigDirs) <= configDirsMax, "configDirs holds 1 to 4 paths"); err != nil {
		return err
	}
	paths := make([]string, 0, len(r.ConfigDirs)+3)
	paths = append(paths, r.ConfigDirs...)
	paths = append(paths, r.Skills)
	if r.HookSettings != nil {
		paths = append(paths, *r.HookSettings)
	}
	if r.TranscriptRoot != nil {
		paths = append(paths, *r.TranscriptRoot)
	}
	for _, p := range paths {
		if err := require(absolutePath(p), "every path must be absolute, without . or .. components"); err != nil {
			return err
		}
	}
	if err := require((r.HookSettings != nil) == (decl.Hooks() != nil), "hookSettings is required with hooks, and null without"); err != nil {
		return err
	}
	if err := require(r.HookSettings == nil || r.inConfigDir(*r.HookSettings), "hookSettings must lie inside one of configDirs"); err != nil {
		return err
	}
	return require((r.TranscriptRoot != nil) == decl.Supports(OpUsage), "transcriptRoot is required with usage, and null without")
}

// Within reports whether skills lies inside one of configDirs or is the shared skills root under home.
func (r LocationsResponse) Within(home string) bool {
	shared := strings.TrimRight(home, "/") + "/.agents/skills"
	return r.Skills == shared || r.inConfigDir(r.Skills)
}

func (r LocationsResponse) inConfigDir(p string) bool {
	for _, dir := range r.ConfigDirs {
		prefix := strings.TrimRight(dir, "/")
		if rest, ok := strings.CutPrefix(p, prefix); ok && len(rest) > 1 && strings.HasPrefix(rest, "/") {
			return true
		}
	}
	return false
}

func (ResumeResponse) Op() Op { return OpResume }
func (r ResumeResponse) Check(decl *RuntimeDeclaration) error {
	if err := require(len(r.Argv) >= 1 && len(r.Argv) <= argvMax, "argv holds 1 to 64 strings"); err != nil {
		return err
	}
	if err := require(slices.Contains(decl.Executables(), r.Argv[0]), "argv must start with a declared executable"); err != nil {
		return err
	}
	for _, arg := range r.Argv {
		if err := require(!strings.ContainsRune(arg, '\x00'), "argv must not contain NUL"); err != nil {
			return err
		}
	}
	return nil
}

func (UsageResponse) Op() Op { return OpUsage }
func (r UsageResponse) Check(_ *RuntimeDeclaration) error {
	return require(r.ContextTokens == nil || *r.ContextTokens < (1<<53), "contextTokens is out of range")
}
