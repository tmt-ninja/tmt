package core

import (
	"encoding/base64"
	"errors"
	"testing"
)

func TestCompactReceiptMatchesNativeVector(t *testing.T) {
	endpoint := RequestEndpoint{
		Server: ServerEvidence{Host: "tmux", ID: "server-1", Socket: "/tmp/tmt-test.sock", PID: 1234, StartTime: "2026-09-06T00:00:00.000Z"},
		PaneID: "%17", PanePID: 5678,
	}
	route := RequestRoute{Kind: RequestRoutePane, Pane: &endpoint}
	// Non-English request text comes from the native independent wire vector.
	receipt := EncodeReceipt("request-α", "attempt-1", route)
	if receipt != "v2_UrBhy1oeIPSUGg7Uo9o2Tw" {
		t.Fatalf("receipt = %q", receipt)
	}
	proof, err := DecodeReceipt(receipt, "unrelated")
	if err != nil {
		t.Fatal(err)
	}
	if err := proof.Verify("request-α", "attempt-1", route); err != nil {
		t.Fatal(err)
	}
	requireReceiptFailure(t, proof.Verify("request-β", "attempt-1", route), "RESPONSE_RECEIPT_MISMATCH")
	for _, malformed := range []Receipt{"", "v2_eO65v2RuWainfXCY5QqO-QQ", "v2_eO65v2RuWainfXCY5QqO-R", receipt + "\n", receipt + "="} {
		_, err := DecodeReceipt(malformed, "request-α")
		requireReceiptFailure(t, err, "RESPONSE_RECEIPT_INVALID")
	}
}

func TestLegacyReceiptVerifiesRecordedTmuxEndpoint(t *testing.T) {
	wire := Receipt(base64.RawURLEncoding.EncodeToString([]byte(`{
		"version":1.0,"requestId":"legacy","attemptId":"attempt",
		"endpoint":{"serverId":"server","socketPath":"/tmp/tmt.sock","serverPid":4e1,
		"serverStartTime":"start","paneId":"%9","panePid":190}
	}`)))
	_, err := DecodeReceipt(wire, "wrong")
	requireReceiptFailure(t, err, "RESPONSE_RECEIPT_MISMATCH")
	proof, err := DecodeReceipt(wire, "legacy")
	if err != nil {
		t.Fatal(err)
	}
	endpoint := RequestEndpoint{
		Server: ServerEvidence{Host: "tmux", ID: "server", Socket: "/tmp/tmt.sock", PID: 40, StartTime: "start"},
		PaneID: "%9", PanePID: 190,
	}
	route := RequestRoute{Kind: RequestRoutePane, Pane: &endpoint}
	if err := proof.Verify("legacy", "attempt", route); err != nil {
		t.Fatal(err)
	}
	requireReceiptFailure(t, proof.Verify("legacy", "another-attempt", route), "RESPONSE_ATTEMPT_MISMATCH")
	endpoint.PanePID++
	requireReceiptFailure(t, proof.Verify("legacy", "attempt", route), "RESPONSE_RECIPIENT_MISMATCH")
}

func requireReceiptFailure(t *testing.T, err error, code string) {
	t.Helper()
	var failure *RequestFailure
	if !errors.As(err, &failure) || failure.Code != code || failure.Status != 1 {
		t.Fatalf("receipt failure = %+v (%v), want %s", failure, err, code)
	}
}
