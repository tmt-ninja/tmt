package mcp

import (
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

// ToolCall carries only schema-admitted parameters. Identity selection is
// private to the CLI invocation and cannot be supplied by a tool.
type ToolCall struct {
	Name        string
	OperationID string
	RecipientID core.IdentityID
	RequestID   core.RequestID
	From        *string
	Limit       *uint64
	Message     string
	Revision    uint64
}

type fieldKind uint8

const (
	textField fieldKind = iota
	uuidField
	messageField
	limitField
	revisionField
)

type toolField struct {
	name     string
	kind     fieldKind
	required bool
}

type toolSpec struct {
	name        string
	description string
	fields      []toolField
	readOnly    bool
}

var toolSpecs = []toolSpec{
	{"tmt_list", "List local non-retired identity records; presence is not reported.", nil, true},
	{"tmt_operation", "Recover an immutable dispatch acceptance by operation UUID; never sends or wakes again.", []toolField{{"operationId", uuidField, true}}, true},
	{"tmt_inbox", "List open requests addressed to this server's saved identity, oldest first. Reading never acknowledges.", []toolField{{"from", textField, false}, {"limit", limitField, false}}, true},
	{"tmt_request", "Read this identity's incoming request and its local reply receipt. Reading does not acknowledge or complete it.", []toolField{{"requestId", textField, true}}, true},
	{"tmt_result", "Read an exact retained final by request ID. Unavailable is not cancellation or permission to resend.", []toolField{{"requestId", textField, true}}, true},
	{"tmt_send", "Dispatch one durable request. Returns acceptance, with an optional first advisory wake. Retain operationId for recovery; identical retries never dispatch or wake twice.", []toolField{{"operationId", uuidField, true}, {"recipientId", uuidField, true}, {"message", messageField, true}}, false},
	{"tmt_answer", "Submit this saved identity's exact final for one incoming request. Identical retained retries are safe; changed finals conflict. Does not acknowledge attention.", []toolField{{"requestId", textField, true}, {"message", messageField, true}}, false},
	{"tmt_ack", "Acknowledge one incoming request at its observed revision. A stale revision cannot suppress newer attention.", []toolField{{"requestId", textField, true}, {"revision", revisionField, true}}, false},
}

func definitions() []any {
	defs := make([]any, 0, len(toolSpecs))
	for _, spec := range toolSpecs {
		properties := make(map[string]any, len(spec.fields))
		required := make([]string, 0, len(spec.fields))
		for _, field := range spec.fields {
			properties[field.name] = fieldSchema(field.kind)
			if field.required {
				required = append(required, field.name)
			}
		}
		defs = append(defs, map[string]any{
			"name":        spec.name,
			"description": spec.description,
			"inputSchema": map[string]any{"type": "object", "properties": properties, "required": required, "additionalProperties": false},
			"annotations": map[string]bool{"readOnlyHint": spec.readOnly, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false},
		})
	}
	return defs
}

func fieldSchema(kind fieldKind) any {
	switch kind {
	case textField:
		return map[string]any{"type": "string", "minLength": 1, "maxLength": 256}
	case uuidField:
		return map[string]any{"type": "string", "format": "uuid"}
	case messageField:
		return map[string]any{"type": "string", "maxLength": core.MaxExchangeTextBytes}
	case limitField:
		return map[string]any{"type": "integer", "minimum": 1, "maximum": 200}
	default:
		return map[string]any{"type": "integer", "minimum": 1, "maximum": core.MaxJSSafeInteger}
	}
}

func decodeTool(params jsontext.Value) (ToolCall, bool) {
	var payload struct {
		Name      *string        `json:"name"`
		Arguments jsontext.Value `json:"arguments"`
		Meta      jsontext.Value `json:"_meta"`
	}
	if json.Unmarshal(params, &payload, json.RejectUnknownMembers(true)) != nil ||
		payload.Name == nil || (payload.Meta != nil && payload.Meta.Kind() != '{') {
		return ToolCall{}, false
	}
	var args map[string]jsontext.Value
	if payload.Arguments != nil &&
		(json.Unmarshal(payload.Arguments, &args) != nil || args == nil) {
		return ToolCall{}, false
	}
	for _, spec := range toolSpecs {
		if spec.name == *payload.Name {
			return decodeArguments(spec, args)
		}
	}
	return ToolCall{}, false
}

func decodeArguments(spec toolSpec, args map[string]jsontext.Value) (ToolCall, bool) {
	tool := ToolCall{Name: spec.name}
	seen := 0
	for _, field := range spec.fields {
		value, ok := args[field.name]
		if !ok {
			if field.required {
				return ToolCall{}, false
			}
			continue
		}
		seen++
		if !setArgument(&tool, field, value) {
			return ToolCall{}, false
		}
	}
	return tool, seen == len(args)
}

func setArgument(tool *ToolCall, field toolField, raw jsontext.Value) bool {
	switch field.kind {
	case limitField, revisionField:
		var number uint64
		if json.Unmarshal(raw, &number) != nil || number == 0 {
			return false
		}
		if field.kind == limitField {
			if number > 200 {
				return false
			}
			tool.Limit = &number
		} else {
			if number > core.MaxJSSafeInteger {
				return false
			}
			tool.Revision = number
		}
		return true
	}

	var text *string
	if json.Unmarshal(raw, &text) != nil || text == nil {
		return false
	}
	switch field.kind {
	case textField:
		if len(*text) == 0 || len(*text) > 256 {
			return false
		}
		if field.name == "from" {
			tool.From = text
		} else {
			tool.RequestID = core.RequestID(*text)
		}
	case uuidField:
		if !core.ValidUUID(*text) {
			return false
		}
		if field.name == "operationId" {
			tool.OperationID = *text
		} else {
			tool.RecipientID = core.IdentityID(*text)
		}
	case messageField:
		if len(*text) > core.MaxExchangeTextBytes || (tool.Name == "tmt_send" && strings.TrimSpace(*text) == "") {
			return false
		}
		tool.Message = *text
	}
	return true
}
