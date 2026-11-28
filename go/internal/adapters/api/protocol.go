package api

import (
	"context"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tick"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

const ProtocolVersion = 1

type versionRange struct {
	Min uint64 `json:"min"`
	Max uint64 `json:"max"`
}

var supported = versionRange{ProtocolVersion, ProtocolVersion}

// Fault is the public error resource for an admitted API request.
type Fault struct {
	Code      string        `json:"code"`
	Message   string        `json:"message"`
	Supported *versionRange `json:"supported,omitempty"`
}

func (f *Fault) Error() string { return f.Message }

func invalid() *Fault {
	return &Fault{Code: "API_INPUT_INVALID", Message: "Invalid operation, fields or bounded input."}
}

// Request is the admitted v1 envelope. Operation-specific input validation
// happens before an operation can open storage or perform effects.
type Request struct {
	Operation string
	Input     jsontext.Value
	Identity  *string
	Anonymous bool
}

type envelope struct {
	Version    *uint64        `json:"version"`
	Operation  *string        `json:"operation"`
	Input      jsontext.Value `json:"input"`
	Identity   *string        `json:"identity"`
	Originator *string        `json:"originator"`
}

// Decode admits the version, exact field names and attribution rules of v1.
func Decode(body []byte) (Request, *Fault) {
	var wire envelope
	if len(body) > InputLimit || json.Unmarshal(body, &wire, json.RejectUnknownMembers(true)) != nil ||
		wire.Version == nil || wire.Operation == nil || len(wire.Input) == 0 {
		return Request{}, invalid()
	}
	if *wire.Version != ProtocolVersion {
		version := supported
		return Request{}, &Fault{
			Code: "API_VERSION_UNSUPPORTED", Message: "Unsupported API major version.", Supported: &version,
		}
	}
	anonymous := wire.Originator != nil && *wire.Originator == "anonymous"
	if wire.Originator != nil && !anonymous {
		return Request{}, invalid()
	}
	if wire.Identity != nil && (len(*wire.Identity) > 256 || strings.TrimSpace(*wire.Identity) == "") {
		return Request{}, invalid()
	}
	hasIdentity := wire.Identity != nil
	if requiresOriginator(*wire.Operation) {
		if hasIdentity == anonymous {
			return Request{}, invalid()
		}
	} else if hasIdentity || anonymous {
		return Request{}, invalid()
	}
	return Request{Operation: *wire.Operation, Input: wire.Input, Identity: wire.Identity, Anonymous: anonymous}, nil
}

func requiresOriginator(operation string) bool {
	switch operation {
	case "dispatch.create", "orchestration.job.run", "rooms.write", "rooms.retire", "requests.sendNow", "requests.ack":
		return true
	default:
		return false
	}
}

// Server serves local API requests against the invocation's resolved data root.
type Server struct {
	Root home.Root
}

type requestSession struct {
	root  home.Root
	store *storage.Storage
}

func (s *requestSession) close() error {
	if s.store == nil {
		return nil
	}
	return s.store.Close()
}

func unavailable() *Fault {
	return &Fault{
		Code:    "API_UNAVAILABLE",
		Message: "Operation could not be confirmed. For a write, inspect its operation receipt or current revision before retrying.",
	}
}

func operationFault(err error) *Fault {
	var failure *core.RequestFailure
	if errors.As(err, &failure) {
		return &Fault{Code: failure.Code, Message: failure.Message}
	}
	return unavailable()
}

// ServeOnce reads one JSON document through EOF and writes one response.
func (s Server) ServeOnce(input *os.File, output io.Writer) (int, error) {
	body, err := process.ReadInputStdin(input, InputLimit)
	var result SessionResponse
	if err != nil || len(body) > InputLimit {
		code := "API_INPUT_INVALID"
		if errors.Is(err, process.ErrInputTimeout) {
			code = "API_INPUT_TIMEOUT"
		}
		result, err = encodeFault(&Fault{
			Code: code, Message: "Expected one bounded JSON request on non-terminal stdin, closed within five seconds.",
		})
	} else {
		session := requestSession{root: s.Root}
		result, err = session.respond(body)
		if closeErr := session.close(); closeErr != nil && err == nil && result.Status == 0 {
			result, err = encodeFault(unavailable())
		}
	}
	if err != nil {
		return 1, err
	}
	line := append(result.Body, '\n')
	n, err := output.Write(line)
	if err == nil && n != len(line) {
		err = io.ErrShortWrite
	}
	if err != nil {
		return 1, err
	}
	return result.Status, nil
}

// ServeSession serves consecutive requests on the same redirected descriptors.
func (s Server) ServeSession(input, output *os.File) (int, error) {
	session := requestSession{root: s.Root}
	status, err := ServeSession(input, output, session.respond, nil)
	if closeErr := session.close(); closeErr != nil {
		return 1, errors.Join(err, closeErr)
	}
	return status, err
}

func (s *requestSession) respond(body []byte) (SessionResponse, error) {
	request, fault := Decode(body)
	if fault != nil {
		return encodeFault(fault)
	}
	ctx := context.Background()
	now := uint64(time.Now().UnixMilli())
	if fault := s.checkSchema(ctx); fault != nil {
		response, err := encodeFault(fault)
		response.Stale = fault.Code == "API_SESSION_STALE"
		return response, err
	}

	var value any
	switch request.Operation {
	case "capabilities", "storage.root":
		if !emptyObject(request.Input) {
			return encodeFault(invalid())
		}
		if request.Operation == "capabilities" {
			value = capabilities()
		} else {
			value = map[string]string{"dataRoot": s.root.Dir}
		}
	case "tick.status":
		if !emptyObject(request.Input) {
			return encodeFault(invalid())
		}
		status, err := tick.Status(s.root, now)
		if errors.Is(err, tick.ErrInvalid) {
			return encodeFault(&Fault{Code: "TICK_INPUT_INVALID", Message: tick.ErrInvalid.Error()})
		}
		if err != nil {
			return encodeFault(&Fault{Code: "TICK_IO", Message: "Tick I/O failed: " + err.Error()})
		}
		value = status
	case "digest.wake.step":
		input, ok := decodeWake(request.Input)
		if !ok {
			return encodeFault(invalid())
		}
		if fault := s.open(ctx); fault != nil {
			return encodeFault(fault)
		}
		result, err := s.wake(ctx, input)
		if err != nil {
			return encodeFault(operationFault(err))
		}
		value = result
	default:
		digest := decodeDigest(request.Operation, request.Input, now)
		usage := decodeUsage(request.Operation, request.Input, now)
		if digest == nil && usage == nil {
			return encodeFault(invalid())
		}
		if fault := s.open(ctx); fault != nil {
			return encodeFault(fault)
		}
		var err error
		if digest != nil {
			value, err = digest(ctx, s.store)
		} else {
			value, err = usage(ctx, s.store)
		}
		if err != nil {
			return encodeFault(operationFault(err))
		}
	}
	encoded, err := json.Marshal(value, json.Deterministic(true))
	if err != nil {
		return encodeFault(unavailable())
	}
	if len(encoded) > OutputLimit {
		return encodeFault(&Fault{Code: "API_OUTPUT_TOO_LARGE", Message: "Response exceeds the API bound; request a smaller page."})
	}
	return SessionResponse{Body: encoded}, nil
}

func (s *requestSession) open(ctx context.Context) *Fault {
	if s.store != nil {
		return nil
	}
	store, err := storage.Open(ctx, s.root)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			return &Fault{
				Code:    "STORAGE_NOT_WRITABLE",
				Message: fmt.Sprintf("Could not write to the data directory %s. No API operation was performed.", s.root.Dir),
			}
		}
		return unavailable()
	}
	s.store = store
	return nil
}

func (s *requestSession) checkSchema(ctx context.Context) *Fault {
	if s.store == nil {
		return nil
	}
	version, err := s.store.SchemaVersion(ctx)
	if err != nil {
		return unavailable()
	}
	if version != uint64(storage.SchemaVersion) {
		return &Fault{
			Code:    "API_SESSION_STALE",
			Message: "Core storage changed schema; reopen the API session with the current executable.",
		}
	}
	return nil
}

func emptyObject(input jsontext.Value) bool {
	var object map[string]jsontext.Value
	return json.Unmarshal(input, &object) == nil && object != nil && len(object) == 0
}

func encodeFault(fault *Fault) (SessionResponse, error) {
	body, err := json.Marshal(struct {
		Error *Fault `json:"error"`
	}{fault})
	return SessionResponse{Body: body, Status: 1}, err
}

func capabilities() any {
	operations := append([]string{"capabilities", "storage.root", "tick.status", "digest.wake.step"}, digestOperations...)
	operations = append(operations, usageOperations...)
	return map[string]any{
		"version":    ProtocolVersion,
		"supported":  supported,
		"operations": operations,
		"limits":     map[string]int{"inputBytes": InputLimit, "outputBytes": OutputLimit},
		"commands":   []string{"identity", "list", "x", "reply", "result"},
		"session":    map[string]any{"framing": "ndjson", "terminalCommandOutput": false},
	}
}
