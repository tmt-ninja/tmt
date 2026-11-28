package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type responseFake struct {
	ports.RequestService
	submit func(core.SubmitResponse) (core.FinalResponse, error)
	result func(string) (core.RequestID, core.ResponseLookup, error)
}

func (f responseFake) SubmitResponse(_ context.Context, input core.SubmitResponse) (core.FinalResponse, error) {
	return f.submit(input)
}

func (f responseFake) ResultByPrefix(_ context.Context, id string) (core.RequestID, core.ResponseLookup, error) {
	return f.result(id)
}

func TestReplyPassesExactInputAndPublishesOnlyAcknowledgment(t *testing.T) {
	t.Setenv("TMT_GO_HOME", t.TempDir())
	for _, body := range []string{"", "\ufeff\r\n\x00—\n"} {
		const id = "req_12345678-0000-4000-8000-000000000000"
		const receipt = "opaque-proof"
		service := responseFake{submit: func(input core.SubmitResponse) (core.FinalResponse, error) {
			want := core.SubmitResponse{RequestID: id, Receipt: receipt, Body: body}
			if input != want {
				t.Errorf("submitted %+v, want %+v", input, want)
			}
			return core.FinalResponse{RequestID: id, Body: body, BodyBytes: uint64(len(body)), SubmittedAtMs: 42}, nil
		}}
		app := application{requests: service}
		want := map[string]any{"status": "submitted", "requestId": id, "bodyBytes": float64(len(body)), "submittedAtMs": float64(42)}
		assertResponse(t, app, []string{"reply", id, "--receipt", receipt, "--message=" + body, "--json"}, 0, want)
	}
}

func TestReplyRejectsInvalidInputBeforeCallingService(t *testing.T) {
	t.Setenv("TMT_GO_HOME", t.TempDir())
	app := application{requests: responseFake{}}
	for _, tc := range []struct{ body, code string }{
		{body: "\xff", code: "RESPONSE_INPUT_INVALID"},
		{body: strings.Repeat("é", maxResponseBytes/2+1), code: "RESPONSE_INPUT_TOO_LARGE"},
	} {
		var stdout, stderr bytes.Buffer
		args := []string{"reply", "req", "--receipt", "opaque-proof", "--message=" + tc.body, "--json"}
		if status := app.run(context.Background(), args, &stdout, &stderr); status != 1 || stderr.Len() != 0 || !strings.Contains(stdout.String(), tc.code) {
			t.Fatalf("exit = %d, stdout = %q, stderr = %q", status, &stdout, &stderr)
		}
	}
}

func TestResultUsesServiceSelectionAndNativeReports(t *testing.T) {
	t.Setenv("TMT_GO_HOME", t.TempDir())
	const prefix = "12345678"
	const id = "req_12345678-0000-4000-8000-000000000000"
	for _, tc := range []struct {
		lookup core.ResponseLookup
		status int
		want   map[string]any
	}{
		{
			lookup: core.ResponseLookup{Status: core.ResponseAvailable, Final: &core.FinalResponse{RequestID: id, Body: "a\r\n\x00", BodyBytes: 4, SubmittedAtMs: 42}},
			want:   map[string]any{"status": "completed", "requestId": id, "response": "a\r\n\x00", "bodyBytes": float64(4), "submittedAtMs": float64(42)},
		},
		{
			lookup: core.ResponseLookup{Status: core.ResponseAvailable, Final: &core.FinalResponse{RequestID: id}},
			want:   map[string]any{"status": "completed", "requestId": id, "response": "", "bodyBytes": float64(0), "submittedAtMs": float64(0)},
		},
		{
			lookup: core.ResponseLookup{Status: core.ResponseWithdrawn, Withdrawal: &core.Withdrawal{Reason: "obsolete", WithdrawnAtMs: 42}},
			want:   map[string]any{"status": "withdrawn", "requestId": id, "reason": "obsolete", "withdrawnAtMs": float64(42)},
		},
		{
			lookup: core.ResponseLookup{Status: core.ResponseNotRequired},
			want:   map[string]any{"status": "not_required", "requestId": id},
		},
		{
			lookup: core.ResponseLookup{Status: core.ResponseUnavailable},
			status: 3,
			want: map[string]any{"status": "unavailable", "requestId": id, "error": map[string]any{
				"code": "RESPONSE_NOT_AVAILABLE", "message": "Response for request '" + id + "' is not available.",
			}},
		},
	} {
		t.Run(string(tc.lookup.Status), func(t *testing.T) {
			service := responseFake{result: func(input string) (core.RequestID, core.ResponseLookup, error) {
				if input != prefix {
					t.Errorf("selection input = %q, want %q", input, prefix)
				}
				return id, tc.lookup, nil
			}}
			assertResponse(t, application{requests: service}, []string{"result", prefix, "--json"}, tc.status, tc.want)
		})
	}
}

func TestResultUnexpectedServiceErrorIsRedacted(t *testing.T) {
	t.Setenv("TMT_GO_HOME", t.TempDir())
	service := responseFake{result: func(string) (core.RequestID, core.ResponseLookup, error) {
		return "", core.ResponseLookup{}, errors.New("private endpoint data")
	}}
	assertResponse(t, application{requests: service}, []string{"result", "12345678", "--json"}, 1, map[string]any{
		"error": map[string]any{"code": "RESPONSE_ERROR", "message": "Could not complete the response operation."},
	})
}

func assertResponse(t *testing.T, app application, args []string, status int, want map[string]any) {
	t.Helper()
	var stdout, stderr bytes.Buffer
	if got := app.run(context.Background(), args, &stdout, &stderr); got != status || stderr.Len() != 0 {
		t.Fatalf("exit = %d, want %d, stdout = %q, stderr = %q", got, status, &stdout, &stderr)
	}
	var doc map[string]any
	if err := json.Unmarshal(stdout.Bytes(), &doc); err != nil || !reflect.DeepEqual(doc, want) {
		t.Fatalf("stdout = %q, want %+v, decode error = %v", &stdout, want, err)
	}
}
