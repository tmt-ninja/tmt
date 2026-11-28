package api

import (
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"errors"
	"io"
	"os"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
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
		result, err = s.respond(body)
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
	return ServeSession(input, output, s.respond, nil)
}

func (s Server) respond(body []byte) (SessionResponse, error) {
	request, fault := Decode(body)
	if fault != nil {
		return encodeFault(fault)
	}
	if !emptyObject(request.Input) {
		return encodeFault(invalid())
	}
	var value any
	switch request.Operation {
	case "capabilities":
		value = capabilities()
	case "storage.root":
		value = struct {
			DataRoot string `json:"dataRoot"`
		}{s.Root.Dir}
	default:
		return encodeFault(invalid())
	}
	encoded, err := json.Marshal(value)
	return SessionResponse{Body: encoded}, err
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
	return map[string]any{
		"version":    ProtocolVersion,
		"supported":  supported,
		"operations": []string{"capabilities", "storage.root"},
		"limits":     map[string]int{"inputBytes": InputLimit, "outputBytes": OutputLimit},
		"commands":   []string{"identity", "list", "x", "reply", "result"},
		"session":    map[string]any{"framing": "ndjson", "terminalCommandOutput": false},
	}
}
