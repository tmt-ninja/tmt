package output

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"strings"
	"testing"
)

func TestUnavailableResultFailure(t *testing.T) {
	failure := &Failure{
		Code: "RESPONSE_NOT_AVAILABLE", Message: "Response for request 'req_1' is not available.", Status: 3,
		Request: &RequestFailure{RequestID: "req_1", Status: "unavailable"},
	}
	var stdout, stderr bytes.Buffer
	if status := Publish(&stdout, &stderr, failure, true); status != 3 || stderr.Len() != 0 {
		t.Fatalf("status = %d, stderr = %q", status, &stderr)
	}
	want := `{"error":{"code":"RESPONSE_NOT_AVAILABLE","message":"Response for request 'req_1' is not available."},"requestId":"req_1","status":"unavailable"}` + "\n"
	if stdout.String() != want {
		t.Fatalf("stdout = %q, want %q", &stdout, want)
	}
}

func TestFailureHumanEscapesControlsAndPreservesUsage(t *testing.T) {
	failure := &Failure{
		Code: "USAGE_ERROR", Status: 1,
		Message:    "error: Unexpected argument 'x\x1b'.\n\nUsage: tmt-go name <name>\n",
		Suggestion: "Hint: Run tmt-go help name.",
	}
	var stdout, stderr bytes.Buffer
	if status := Publish(&stdout, &stderr, failure, false); status != 1 || stdout.Len() != 0 {
		t.Fatalf("status = %d, stdout = %q", status, &stdout)
	}
	want := "error: Unexpected argument 'x\\u{1b}'\n\nUsage: tmt-go name <name>\nhint: Run tmt-go help name\n"
	if stderr.String() != want {
		t.Fatalf("stderr = %q, want %q", &stderr, want)
	}
}

type partialReport struct{ stream Stream }

func (partialReport) Human(w io.Writer) error {
	_, err := fmt.Fprintln(w, "partial result")
	return err
}

func (partialReport) JSON() any {
	return struct {
		Remaining string `json:"remaining"`
	}{Remaining: "<one>"}
}

func (p partialReport) HumanStream() Stream { return p.stream }
func (partialReport) ExitStatus() int       { return 5 }

func TestReportKeepsPartialDataAndStatus(t *testing.T) {
	for _, tc := range []struct {
		json           bool
		stream         Stream
		stdout, stderr string
	}{
		{stream: Stdout, stdout: "partial result\n"},
		{stream: Stderr, stderr: "partial result\n"},
		{json: true, stream: Stderr, stdout: "{\"remaining\":\"<one>\"}\n"},
	} {
		var stdout, stderr bytes.Buffer
		if status := Publish(&stdout, &stderr, partialReport{stream: tc.stream}, tc.json); status != 5 ||
			stdout.String() != tc.stdout || stderr.String() != tc.stderr {
			t.Fatalf("status = %d, stdout = %q, stderr = %q", status, &stdout, &stderr)
		}
	}
}

type brokenStream struct{}

func (brokenStream) Write([]byte) (int, error) { return 0, errors.New("broken stream") }

func TestPublishReportsOutputFailureOnce(t *testing.T) {
	var stderr bytes.Buffer
	if status := Publish(brokenStream{}, &stderr, partialReport{}, true); status != 1 {
		t.Fatalf("status = %d, want 1", status)
	}
	if strings.Count(stderr.String(), "\n") != 1 || !strings.Contains(stderr.String(), "broken stream") {
		t.Fatalf("stderr = %q", &stderr)
	}
}
