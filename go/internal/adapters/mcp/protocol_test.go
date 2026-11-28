package mcp

import (
	"encoding/json"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/api"
	"github.com/tmt-ninja/tmt/go/internal/core"
)

type rpcResponse struct {
	ID     json.RawMessage
	Result json.RawMessage
	Error  *struct {
		Code    int
		Message string
	}
}

func TestMCPLifecycleAndTypedToolCall(t *testing.T) {
	const initialize = `{"jsonrpc":"2.0","id":"init","method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"client","version":"1"}}}`
	const answer = `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tmt_answer","arguments":{"requestId":"req_test","message":"\uFEFFa\r\nb\u0000✓"}}}`
	input, output := transportFiles(t, []byte(strings.Join([]string{
		`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`,
		initialize,
		`{"jsonrpc":"2.0","method":"notifications/initialized"}`,
		`{"jsonrpc":"2.0","method":"tools/call","params":{"name":"tmt_list"}}`,
		`{"jsonrpc":"2.0","id":"schemas","method":"tools/list"}`,
		answer,
		"",
	}, "\n")))
	var calls []ToolCall
	if err := Serve(input, output, "test", func(tool ToolCall) (any, bool) {
		calls = append(calls, tool)
		return map[string]any{"status": "submitted", "requestId": tool.RequestID}, false
	}); err != nil {
		t.Fatal(err)
	}
	transcript, err := os.ReadFile(output.Name())
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(string(transcript), "\n"), "\n")
	if len(lines) != 4 {
		t.Fatalf("stdout = %s", transcript)
	}
	preInit := decodeResponse(t, []byte(lines[0]))
	if preInit.Error == nil || preInit.Error.Code != -32600 {
		t.Fatalf("pre-initialization tools = %s", lines[0])
	}
	init := decodeResponse(t, []byte(lines[1]))
	var negotiated struct {
		ProtocolVersion string
		Capabilities    map[string]json.RawMessage
		ServerInfo      struct{ Name, Version string }
	}
	if err := json.Unmarshal(init.Result, &negotiated); err != nil || negotiated.ProtocolVersion != earlierProtocol ||
		len(negotiated.Capabilities) != 1 || string(negotiated.Capabilities["tools"]) != "{}" || negotiated.ServerInfo.Version != "test" {
		t.Fatalf("initialize = %s, %v", lines[1], err)
	}
	list := decodeResponse(t, []byte(lines[2]))
	var schemas struct {
		Tools []struct {
			Name        string
			Annotations map[string]bool
			InputSchema struct {
				Required             []string
				AdditionalProperties *bool
			}
		}
	}
	if err := json.Unmarshal(list.Result, &schemas); err != nil {
		t.Fatal(err)
	}
	var names []string
	for i, tool := range schemas.Tools {
		names = append(names, tool.Name)
		if tool.InputSchema.AdditionalProperties == nil || *tool.InputSchema.AdditionalProperties ||
			tool.Annotations["readOnlyHint"] != (i < 5) || !tool.Annotations["idempotentHint"] {
			t.Fatalf("tool schema = %+v", tool)
		}
	}
	if !reflect.DeepEqual(names, []string{"tmt_list", "tmt_operation", "tmt_inbox", "tmt_request", "tmt_result", "tmt_send", "tmt_answer", "tmt_ack"}) {
		t.Fatalf("tools = %v", names)
	}
	if len(calls) != 1 || calls[0].Name != "tmt_answer" || calls[0].RequestID != "req_test" || calls[0].Message != "\uFEFFa\r\nb\x00✓" {
		t.Fatalf("admitted calls = %+v", calls)
	}
	result := decodeResponse(t, []byte(lines[3]))
	var toolResult struct {
		StructuredContent json.RawMessage
		Content           []struct{ Type, Text string }
		IsError           *bool
	}
	if err := json.Unmarshal(result.Result, &toolResult); err != nil || toolResult.IsError == nil || *toolResult.IsError ||
		len(toolResult.Content) != 1 || toolResult.Content[0].Type != "text" || toolResult.Content[0].Text != string(toolResult.StructuredContent) {
		t.Fatalf("tool result = %s, %v", lines[3], err)
	}
}

func TestMCPAdmissionRejectsMalformedAndInvalidRequestsBeforeEffects(t *testing.T) {
	s := protocolSession{ready: true, call: func(ToolCall) (any, bool) {
		t.Fatal("invalid request called a tool")
		return nil, true
	}}
	for _, tc := range []struct {
		document string
		code     int
	}{
		{`{`, -32700},
		{`[]`, -32600},
		{`{"jsonrpc":"2.0","id":null,"method":"ping"}`, -32600},
		{`{"jsonrpc":"2.0","id":1.5,"method":"ping"}`, -32600},
		{`{"jsonrpc":"2.0","id":9007199254740992,"method":"ping"}`, -32600},
		{`{"jsonrpc":"2.0","id":1,"id":2,"method":"ping"}`, -32600},
		{`{"jsonrpc":"2.0","id":1,"method":"ping","params":null}`, -32602},
		{`{"jsonrpc":"2.0","id":1,"method":"other"}`, -32601},
		{`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tmt_inbox","arguments":{"limit":1,"limit":2}}}`, -32602},
		{`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tmt_inbox","arguments":{"limit":null}}}`, -32602},
		{`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tmt_list","arguments":null}}`, -32602},
		{`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tmt_list","arguments":{"identity":"another"}}}`, -32602},
		{`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"tmt_ack","arguments":{"requestId":"req_test","revision":0}}}`, -32602},
	} {
		got, err := s.receive([]byte(tc.document))
		if err != nil {
			t.Fatal(err)
		}
		response := decodeResponse(t, got)
		if response.Error == nil || response.Error.Code != tc.code {
			t.Errorf("request %s: got %s, want %d", tc.document, got, tc.code)
		}
	}
}

func TestMCPToolAdmissionAndResourceBound(t *testing.T) {
	const request = `{"jsonrpc":"2.0","id":9007199254740991,"method":"tools/call","params":{"name":"tmt_send","arguments":{"operationId":"018ef04c-3bf0-7dde-a018-0d5359c658f3","recipientId":"6fe25dcc-3bba-40bd-b0af-830080642eae","message":"send exact"}}}`
	session := protocolSession{ready: true, call: func(tool ToolCall) (any, bool) {
		if tool.Name != "tmt_send" || tool.Message != "send exact" || !core.ValidUUID(tool.OperationID) ||
			tool.RecipientID != "6fe25dcc-3bba-40bd-b0af-830080642eae" {
			t.Fatalf("send tool = %+v", tool)
		}
		return strings.Repeat("a", api.OutputLimit), false
	}}
	raw, err := session.receive([]byte(request))
	if err != nil {
		t.Fatal(err)
	}
	reply := decodeResponse(t, raw)
	if string(reply.ID) != "9007199254740991" || reply.Error != nil ||
		!strings.Contains(string(reply.Result), `"isError":true`) ||
		!strings.Contains(string(reply.Result), "MCP_OUTPUT_TOO_LARGE") {
		t.Fatalf("oversize reply = %s", raw)
	}
}

func decodeResponse(t *testing.T, raw []byte) rpcResponse {
	t.Helper()
	var decoded rpcResponse
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("decode RPC response %s: %v", raw, err)
	}
	return decoded
}
