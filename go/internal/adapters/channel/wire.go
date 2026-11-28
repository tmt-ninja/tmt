//go:build darwin || linux

package channel

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const (
	claudeContentLimit     = core.MaxExchangeTextBytes + 64*1024
	claudeFrameLimit       = 6*claudeContentLimit + 4096
	claudeReplyLimit       = 4096
	claudeConnectionBudget = 2 * time.Second

	claudeProtocolVersion = "2025-11-25"
	claudeCapability      = "claude/channel"
	claudeNotification    = "notifications/claude/channel"
	claudeInstructions    = "Events from this channel are tmt requests from other agents. Each event carries its own instructions for replying with the tmt command; follow them."
)

type claudeFrame struct {
	Version    uint8  `json:"version"`
	Generation string `json:"generation"`
	Content    string `json:"content"`
}

type claudeReply struct {
	Written bool    `json:"written,omitempty"`
	Refused *string `json:"refused,omitempty"`
}

type SendOutcome uint8

const (
	SendDenied SendOutcome = iota
	SendUnsupported
	SendUncertain
	SendUnacknowledged
	SendQueued
)

func classifyReply(line []byte) SendOutcome {
	if !utf8.Valid(line) {
		return SendUncertain
	}
	object, err := strictObject(line, "written", "refused")
	if err != nil {
		return SendUncertain
	}
	var result claudeReply
	if err := json.Unmarshal(line, &result); err != nil {
		return SendUncertain
	}
	if result.Written && result.Refused == nil {
		return SendUnacknowledged
	}
	written := object["written"]
	if result.Refused != nil && (written == nil || bytes.Equal(written, []byte("false"))) {
		return SendDenied
	}
	return SendUncertain
}

func frameContent(line []byte, generation string, ready bool) (string, string) {
	if len(line) > claudeFrameLimit || !utf8.Valid(line) {
		return "", "frame_invalid"
	}
	object, err := strictObject(line, "version", "generation", "content")
	if err != nil || object["version"] == nil || object["generation"] == nil || object["content"] == nil {
		return "", "frame_invalid"
	}
	var frame claudeFrame
	if json.Unmarshal(line, &frame) != nil {
		return "", "frame_invalid"
	}
	if frame.Version != 1 {
		return "", "version"
	}
	if frame.Generation != generation {
		return "", "generation"
	}
	if !ready {
		return "", "not_ready"
	}
	if frame.Content == "" || len(frame.Content) > claudeContentLimit {
		return "", "content"
	}
	return frame.Content, ""
}

func exchangeClaude(ctx context.Context, conn net.Conn, generation, content string) SendOutcome {
	deadline := time.Now().Add(claudeConnectionBudget)
	if bound, ok := ctx.Deadline(); ok && bound.Before(deadline) {
		deadline = bound
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.SetDeadline(time.Now()) })
	defer stop()
	if err := conn.SetDeadline(deadline); err != nil || ctx.Err() != nil {
		return SendUncertain
	}
	if err := writeSocketFrame(conn, claudeFrame{Version: 1, Generation: generation, Content: content}); err != nil {
		return SendUncertain
	}
	line, err := readSocketFrame(conn, claudeReplyLimit)
	if err != nil || !time.Now().Before(deadline) || ctx.Err() != nil {
		return SendUncertain
	}
	return classifyReply(line)
}

// readSocketFrame reads one bounded, newline-terminated frame. The caller
// sets one absolute deadline for all reads and writes on the connection.
func readSocketFrame(conn net.Conn, maxBytes int) ([]byte, error) {
	return readBoundedFrame(bufio.NewReader(conn), maxBytes)
}

func readBoundedFrame(reader *bufio.Reader, maxBytes int) ([]byte, error) {
	var line []byte
	for {
		part, err := reader.ReadSlice('\n')
		if len(part) > maxBytes-len(line) {
			return nil, errors.New("channel frame exceeds its bound")
		}
		line = append(line, part...)
		if err == nil {
			return line[:len(line)-1], nil
		}
		if errors.Is(err, io.EOF) && len(line) != 0 {
			return nil, io.ErrUnexpectedEOF
		}
		if !errors.Is(err, bufio.ErrBufferFull) {
			return nil, err
		}
	}
}

func writeSocketFrame(conn net.Conn, frame any) error {
	text, err := json.Marshal(frame)
	if err != nil {
		return err
	}
	data := append(text, '\n')
	n, err := conn.Write(data)
	if err == nil && n != len(data) {
		return io.ErrShortWrite
	}
	return err
}

type mcpRequest struct {
	Method string          `json:"method"`
	ID     json.RawMessage `json:"id"`
	Params json.RawMessage `json:"params"`
}

func claudeMCPResponse(line []byte, build string) (response []byte, initialized bool) {
	var request mcpRequest
	if !utf8.Valid(line) || json.Unmarshal(line, &request) != nil || request.Method == "" {
		return nil, false
	}
	if request.ID == nil {
		return nil, request.Method == "notifications/initialized"
	}
	envelope := map[string]any{"jsonrpc": "2.0", "id": request.ID}
	switch request.Method {
	case "initialize":
		var params struct {
			ProtocolVersion string `json:"protocolVersion"`
		}
		_ = json.Unmarshal(request.Params, &params)
		protocol := claudeProtocolVersion
		switch params.ProtocolVersion {
		case "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05":
			protocol = params.ProtocolVersion
		}
		envelope["result"] = map[string]any{
			"protocolVersion": protocol,
			"capabilities":    map[string]any{"experimental": map[string]any{claudeCapability: struct{}{}}},
			"serverInfo":      map[string]string{"name": claudeServerName, "version": build},
			"instructions":    claudeInstructions,
		}
	case "ping":
		envelope["result"] = struct{}{}
	default:
		envelope["error"] = map[string]any{"code": -32601, "message": "Method not found"}
	}
	response, _ = json.Marshal(envelope)
	return response, false
}

func claudeMCPNotification(content string) []byte {
	text, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0", "method": claudeNotification, "params": map[string]string{"content": content},
	})
	return text
}

func isInitializeRequest(line []byte) bool {
	var req mcpRequest
	return json.Unmarshal(line, &req) == nil && req.Method == "initialize" && req.ID != nil
}
