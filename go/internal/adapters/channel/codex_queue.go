//go:build darwin || linux

package channel

import (
	"encoding/json"
	"errors"
	"fmt"
	"unicode"
	"unicode/utf8"
)

const (
	codexInputLimit    = 64 * 1024
	codexResponseLimit = 1024 * 1024
	codexIDLimit       = 128
)

var errCodexQueueRequest = errors.New("invalid Codex queue input or correlation")

type codexQueueOutcome uint8

const (
	codexQueueUncertain codexQueueOutcome = iota
	codexQueueAccepted
	codexQueueRefused
)

type codexQueueResult struct {
	outcome      codexQueueOutcome
	submissionID string
	refusalCode  int64
}

type codexQueueRequest struct {
	id       string
	callerID string
	thread   string
	content  string
}

func newCodexQueueRequest(thread, content string) (codexQueueRequest, error) {
	if !validCodexID(thread) || len(content) > codexInputLimit || !utf8.ValidString(content) {
		return codexQueueRequest{}, errCodexQueueRequest
	}
	return codexQueueRequest{id: launchGeneration(), callerID: launchGeneration(), thread: thread, content: content}, nil
}

func (r codexQueueRequest) frame() map[string]any {
	return map[string]any{"id": r.id, "method": "thread/queue/add", "params": map[string]any{
		"threadId": r.thread, "clientUserMessageId": r.callerID,
		"input": []map[string]string{{"type": "text", "text": r.content}},
	}}
}

func (r codexQueueRequest) receipt(response map[string]json.RawMessage) codexQueueResult {
	if codexString(response["id"]) != r.id || response["method"] != nil {
		return codexQueueResult{}
	}
	result, failure := response["result"], response["error"]
	switch {
	case result != nil && failure == nil:
		submission, err := strictObject(result)
		if err != nil {
			return codexQueueResult{}
		}
		queued, err := strictObject(submission["queuedSubmission"])
		if err != nil {
			return codexQueueResult{}
		}
		id := codexString(queued["id"])
		if !validCodexID(id) || codexString(queued["clientUserMessageId"]) != r.callerID {
			return codexQueueResult{}
		}
		var input []json.RawMessage
		if json.Unmarshal(queued["input"], &input) != nil || len(input) != 1 {
			return codexQueueResult{}
		}
		item, err := strictObject(input[0])
		content, ok := decodeCodexString(item["text"])
		if err == nil && codexString(item["type"]) == "text" && ok && content == r.content {
			return codexQueueResult{outcome: codexQueueAccepted, submissionID: id}
		}
	case result == nil && failure != nil:
		detail, err := strictObject(failure)
		if err != nil {
			return codexQueueResult{}
		}
		var code int64
		if json.Unmarshal(detail["code"], &code) == nil && r.preEnqueueRefusal(code, codexString(detail["message"])) {
			return codexQueueResult{outcome: codexQueueRefused, refusalCode: code}
		}
	}
	return codexQueueResult{}
}

func (r codexQueueRequest) preEnqueueRefusal(code int64, message string) bool {
	switch code {
	case -32600:
		return message == fmt.Sprintf("session %s is archived. Run `codex unarchive %s` to unarchive it first.", r.thread, r.thread)
	case -32603:
		return message == "failed to read thread: invalid thread-store request: no rollout found for thread id "+r.thread
	default:
		return false
	}
}

func validCodexID(id string) bool {
	if id == "" || len(id) > codexIDLimit || !utf8.ValidString(id) {
		return false
	}
	for _, ch := range id {
		if unicode.IsControl(ch) {
			return false
		}
	}
	return true
}

func codexString(raw json.RawMessage) string {
	value, _ := decodeCodexString(raw)
	return value
}

func decodeCodexString(raw json.RawMessage) (string, bool) {
	var value *string
	if json.Unmarshal(raw, &value) != nil || value == nil {
		return "", false
	}
	return *value, true
}
