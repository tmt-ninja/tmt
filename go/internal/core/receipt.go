package core

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"strings"
	"unicode/utf8"
)

const MaxExchangeTextBytes = 1_048_576

func ValidExchangeText(value string) bool {
	return len(value) <= MaxExchangeTextBytes && utf8.ValidString(value)
}

// EncodeReceipt binds a compact receipt to the immutable prepared route.
// The unkeyed digest provides correlation, not caller authentication.
func EncodeReceipt(id RequestID, attempt AttemptID, route RequestRoute) Receipt {
	token := responseToken(id, attempt, route)
	return Receipt("v2_" + base64.RawURLEncoding.EncodeToString(token[:]))
}

func responseToken(id RequestID, attempt AttemptID, route RequestRoute) [16]byte {
	fields := []byte("tmt/reply-receipt/v2\x00")
	fields = receiptField(fields, string(id))
	fields = receiptField(fields, string(attempt))
	switch route.Kind {
	case RequestRoutePane:
		endpoint := route.Pane
		fields = receiptField(fields, endpoint.Server.ID)
		fields = receiptField(fields, endpoint.Server.Socket)
		fields = binary.BigEndian.AppendUint64(fields, endpoint.Server.PID)
		fields = receiptField(fields, endpoint.Server.StartTime)
		fields = receiptField(fields, endpoint.PaneID)
		fields = binary.BigEndian.AppendUint64(fields, endpoint.PanePID)
	case RequestRouteInbox:
		fields = append(fields, "inbox\x00"...)
		fields = receiptField(fields, string(*route.Recipient))
	}
	sum := sha256.Sum256(fields)
	return [16]byte(sum[:16])
}

func receiptField(fields []byte, value string) []byte {
	fields = binary.BigEndian.AppendUint64(fields, uint64(len(value)))
	return append(fields, value...)
}

// ReceiptProof is bounded decoded correlation evidence. Verify it against
// the original attempt or final inside the acceptance transaction.
type ReceiptProof struct {
	compact  *[16]byte
	attempt  AttemptID
	endpoint RequestEndpoint
}

func DecodeReceipt(receipt Receipt, id RequestID) (ReceiptProof, error) {
	invalid := &RequestFailure{Code: "RESPONSE_RECEIPT_INVALID", Message: "Response receipt is invalid.", Status: 1}
	encoded := string(receipt)
	if len(encoded) == 0 || len(encoded) > 8192 || strings.ContainsAny(encoded, "\r\n") {
		return ReceiptProof{}, invalid
	}
	if payload, compact := strings.CutPrefix(encoded, "v2_"); compact {
		if len(encoded) != 25 {
			return ReceiptProof{}, invalid
		}
		bytes, err := base64.RawURLEncoding.Strict().DecodeString(payload)
		if err != nil || len(bytes) != 16 {
			return ReceiptProof{}, invalid
		}
		token := [16]byte(bytes)
		return ReceiptProof{compact: &token}, nil
	}
	bytes, err := base64.RawURLEncoding.Strict().DecodeString(encoded)
	if err != nil || !utf8.Valid(bytes) {
		return ReceiptProof{}, invalid
	}
	legacy, ok := parseLegacyReceipt(bytes)
	if !ok {
		return ReceiptProof{}, invalid
	}
	if legacy.request != id {
		return ReceiptProof{}, &RequestFailure{Code: "RESPONSE_RECEIPT_MISMATCH",
			Message: "Response receipt does not match the requested ID.", Status: 1}
	}
	return ReceiptProof{attempt: legacy.attempt, endpoint: legacy.endpoint}, nil
}

func (p ReceiptProof) Verify(id RequestID, attempt AttemptID, route RequestRoute) error {
	if p.compact != nil {
		want := responseToken(id, attempt, route)
		if subtle.ConstantTimeCompare(p.compact[:], want[:]) != 1 {
			return &RequestFailure{Code: "RESPONSE_RECEIPT_MISMATCH",
				Message: "Response receipt does not match the request.", Status: 1}
		}
		return nil
	}
	if p.attempt != attempt {
		return &RequestFailure{Code: "RESPONSE_ATTEMPT_MISMATCH",
			Message: "Response attempt does not match the request.", Status: 1}
	}
	if route.Kind != RequestRoutePane || route.Pane == nil || *route.Pane != p.endpoint {
		return &RequestFailure{Code: "RESPONSE_RECIPIENT_MISMATCH",
			Message: "Response does not match the original recipient.", Status: 1}
	}
	return nil
}

type legacyReceipt struct {
	request  RequestID
	attempt  AttemptID
	endpoint RequestEndpoint
}

func parseLegacyReceipt(text []byte) (legacyReceipt, bool) {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(text, &object); err != nil || len(object) != 4 {
		return legacyReceipt{}, false
	}
	var version float64
	if err := json.Unmarshal(object["version"], &version); err != nil || version != 1 {
		return legacyReceipt{}, false
	}
	request, requestOK := boundedReceiptString(object["requestId"], 256)
	attempt, attemptOK := boundedReceiptString(object["attemptId"], 4096)
	if !requestOK || !attemptOK {
		return legacyReceipt{}, false
	}
	var endpoint map[string]json.RawMessage
	if err := json.Unmarshal(object["endpoint"], &endpoint); err != nil || len(endpoint) != 6 {
		return legacyReceipt{}, false
	}
	serverID, idOK := boundedReceiptString(endpoint["serverId"], 4096)
	socket, socketOK := boundedReceiptString(endpoint["socketPath"], 4096)
	start, startOK := boundedReceiptString(endpoint["serverStartTime"], 4096)
	pane, paneOK := boundedReceiptString(endpoint["paneId"], 4096)
	id, tmuxPane := strings.CutPrefix(pane, "%")
	serverPID, serverPIDOK := receiptPID(endpoint["serverPid"])
	panePID, panePIDOK := receiptPID(endpoint["panePid"])
	if !idOK || !socketOK || !startOK || !paneOK || !tmuxPane || !isASCIIDigits(id) || !serverPIDOK || !panePIDOK {
		return legacyReceipt{}, false
	}
	return legacyReceipt{request: RequestID(request), attempt: AttemptID(attempt), endpoint: RequestEndpoint{
		Server: ServerEvidence{Host: "tmux", ID: serverID, Socket: socket, PID: serverPID, StartTime: start},
		PaneID: pane, PanePID: panePID,
	}}, true
}

func boundedReceiptString(raw json.RawMessage, max int) (string, bool) {
	var value string
	err := json.Unmarshal(raw, &value)
	return value, err == nil && len(value) > 0 && len(value) <= max
}

func receiptPID(raw json.RawMessage) (uint64, bool) {
	var value float64
	if err := json.Unmarshal(raw, &value); err != nil || value < 1 || value > MaxJSSafeInteger {
		return 0, false
	}
	pid := uint64(value)
	return pid, float64(pid) == value
}
