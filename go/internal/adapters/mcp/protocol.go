package mcp

import (
	"bytes"
	jsonv1 "encoding/json"
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"os"

	"github.com/tmt-ninja/tmt/go/internal/adapters/api"
	"github.com/tmt-ninja/tmt/go/internal/core"
)

const (
	currentProtocol = "2025-11-25"
	earlierProtocol = "2025-06-18"
	instructions    = "These are same-user local TMT exchange tools. Pull incoming work with inbox and request. Send returns dispatch acceptance: retain operationId and recover with operation after interruption. Answer submits an exact final for one requestId; ack requires its observed incoming revision. Reads and answer never acknowledge. Timeout or unavailable results do not mean cancellation or permission to resend with a new operationId. This server does not enroll a channel or wake an unloaded model."
)

// CallTool executes one admitted tool using the invocation's pinned identity.
// isError marks a resource as an ordinary tool failure, not a JSON-RPC error.
type CallTool func(call ToolCall) (resource any, isError bool)

// Serve handles one MCP session over redirected stdio. The caller resolves and
// pins the saved identity and supplies the existing command services.
func Serve(input, output *os.File, version string, call CallTool) error {
	session := protocolSession{version: version, call: call}
	return ServeTransport(input, output, session.receive)
}

type protocolSession struct {
	version     string
	call        CallTool
	initialized bool
	ready       bool
}

func (s *protocolSession) receive(body []byte) ([]byte, error) {
	if !(jsontext.Value(body)).IsValid(jsontext.AllowDuplicateNames(true)) {
		return rpcError(nil, -32700, "Invalid JSON")
	}
	fields := readEnvelope(body)
	if fields == nil {
		return rpcError(nil, -32600, "Invalid MCP request")
	}
	id := jsontext.Value(fields["id"])
	var protocol, method *string
	if json.Unmarshal(fields["jsonrpc"], &protocol) != nil || protocol == nil || *protocol != "2.0" ||
		json.Unmarshal(fields["method"], &method) != nil || method == nil || !validID(id) {
		return rpcError(nil, -32600, "Invalid MCP request")
	}
	params := jsontext.Value(fields["params"])
	if id == nil {
		if *method == "notifications/initialized" && s.initialized && emptyParams(params) {
			s.ready = true
		}
		return nil, nil
	}

	var result any
	switch *method {
	case "initialize":
		if s.initialized {
			return rpcError(id, -32600, "Already initialized")
		}
		wanted, ok := initializeVersion(params)
		if !ok {
			return rpcError(id, -32602, "Invalid initialize parameters")
		}
		if wanted != earlierProtocol && wanted != currentProtocol {
			wanted = currentProtocol
		}
		s.initialized = true
		result = map[string]any{
			"protocolVersion": wanted,
			"capabilities":    map[string]any{"tools": struct{}{}},
			"serverInfo":      map[string]string{"name": "tmt", "version": s.version},
			"instructions":    instructions,
		}
	case "ping":
		if !emptyParams(params) {
			return rpcError(id, -32602, "Invalid parameters")
		}
		result = struct{}{}
	case "tools/list", "tools/call":
		if !s.ready {
			return rpcError(id, -32600, "Initialize before using tools")
		}
		if *method == "tools/list" {
			if !emptyParams(params) {
				return rpcError(id, -32602, "Invalid parameters")
			}
			result = map[string]any{"tools": definitions()}
		} else {
			tool, ok := decodeTool(params)
			if !ok {
				return rpcError(id, -32602, "Unknown tool or invalid arguments")
			}
			resource, failed := s.call(tool)
			result = toolResult(resource, failed)
		}
	default:
		return rpcError(id, -32601, "Method not found")
	}
	return json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "result": result}, json.Deterministic(true))
}

// Read only the envelope here so duplicated fields inside method parameters
// are reported as invalid parameters instead of an invalid request envelope.
func readEnvelope(body []byte) map[string]jsonv1.RawMessage {
	decoder := jsonv1.NewDecoder(bytes.NewReader(body))
	start, err := decoder.Token()
	if err != nil || start != jsonv1.Delim('{') {
		return nil
	}
	fields := make(map[string]jsonv1.RawMessage, 4)
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return nil
		}
		key, ok := token.(string)
		if !ok || fields[key] != nil {
			return nil
		}
		switch key {
		case "jsonrpc", "id", "method", "params":
		default:
			return nil
		}
		var value jsonv1.RawMessage
		if err := decoder.Decode(&value); err != nil {
			return nil
		}
		fields[key] = value
	}
	return fields
}

func validID(id jsontext.Value) bool {
	switch id.Kind() {
	case 0, '"':
		return true
	case '0':
		var number int64
		return json.Unmarshal(id, &number) == nil && number >= -core.MaxJSSafeInteger && number <= core.MaxJSSafeInteger
	default:
		return false
	}
}

func initializeVersion(params jsontext.Value) (string, bool) {
	var payload struct {
		ProtocolVersion *string                   `json:"protocolVersion"`
		Capabilities    map[string]jsontext.Value `json:"capabilities"`
		ClientInfo      *struct {
			Name    *string `json:"name"`
			Version *string `json:"version"`
		} `json:"clientInfo"`
	}
	if json.Unmarshal(params, &payload) != nil || payload.ProtocolVersion == nil || payload.Capabilities == nil ||
		payload.ClientInfo == nil || payload.ClientInfo.Name == nil || payload.ClientInfo.Version == nil {
		return "", false
	}
	return *payload.ProtocolVersion, true
}

func emptyParams(params jsontext.Value) bool {
	if params == nil {
		return true
	}
	var payload *struct {
		Meta jsontext.Value `json:"_meta"`
	}
	return json.Unmarshal(params, &payload, json.RejectUnknownMembers(true)) == nil &&
		payload != nil && (payload.Meta == nil || payload.Meta.Kind() == '{')
}

func rpcError(id jsontext.Value, code int, message string) ([]byte, error) {
	if id == nil {
		id = jsontext.Value("null")
	}
	return json.Marshal(map[string]any{
		"jsonrpc": "2.0", "id": id, "error": map[string]any{"code": code, "message": message},
	}, json.Deterministic(true))
}

func toolResult(resource any, failed bool) any {
	body, err := json.Marshal(resource, json.Deterministic(true))
	if err != nil || len(body) > api.OutputLimit {
		body = []byte(`{"error":{"code":"MCP_OUTPUT_TOO_LARGE","message":"Resource exceeds the local MCP output bound."}}`)
		failed = true
	}
	return map[string]any{
		"structuredContent": jsontext.Value(body),
		"content":           []map[string]string{{"type": "text", "text": string(body)}},
		"isError":           failed,
	}
}
