package cli

import (
	"context"
	"fmt"
	"io"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

const maxResponseBytes = 1_048_576

type responseReport struct {
	Status        string         `json:"status"`
	RequestID     core.RequestID `json:"requestId"`
	Response      *string        `json:"response,omitempty"`
	BodyBytes     *uint64        `json:"bodyBytes,omitempty"`
	SubmittedAtMs *uint64        `json:"submittedAtMs,omitempty"`
	Reason        *string        `json:"reason,omitempty"`
	WithdrawnAtMs *uint64        `json:"withdrawnAtMs,omitempty"`
}

func (r responseReport) JSON() any { return r }

func (r responseReport) HumanStream() output.Stream { return output.Stdout }

func (r responseReport) ExitStatus() int { return 0 }

func (r responseReport) Human(w io.Writer) error {
	switch r.Status {
	case "submitted":
		_, err := fmt.Fprintf(w, "✓ Submitted response for request %s (%d bytes)\n", r.RequestID, *r.BodyBytes)
		return err
	case "completed":
		_, err := fmt.Fprintf(w, "Response for request '%s':\n%s\n", r.RequestID, *r.Response)
		return err
	case "withdrawn":
		_, err := fmt.Fprintf(w, "Request '%s' withdrawn at %d: %s\n", r.RequestID, *r.WithdrawnAtMs, *r.Reason)
		return err
	default:
		_, err := fmt.Fprintf(w, "Announcement '%s' does not require a response.\n", r.RequestID)
		return err
	}
}

func (app application) response(ctx context.Context, inv invocation) output.Report {
	if inv.path[0] == "reply" {
		return app.reply(ctx, inv)
	}
	return app.result(ctx, inv.operands[0])
}

func (app application) reply(ctx context.Context, inv invocation) output.Report {
	if !inv.has("message") {
		// NOT PORTED (#6938): bounded file and stdin response acquisition.
		return &output.Failure{Code: "NOT_PORTED", Message: "Reply file and stdin input are not yet ported.", Status: 2}
	}
	body := inv.options["message"]
	if len(body) > maxResponseBytes {
		return &output.Failure{Code: "RESPONSE_INPUT_TOO_LARGE", Message: "Response body must not exceed 1048576 UTF-8 bytes.", Status: 1}
	}
	if !utf8.ValidString(body) {
		return &output.Failure{Code: "RESPONSE_INPUT_INVALID", Message: "Response input is invalid.", Status: 1}
	}
	final, err := app.requests.SubmitResponse(ctx, core.SubmitResponse{
		RequestID: core.RequestID(inv.operands[0]),
		Receipt:   core.Receipt(inv.options["receipt"]),
		Body:      body,
	})
	if err != nil {
		return responseServiceFailure()
	}
	return responseReport{
		Status: "submitted", RequestID: final.RequestID,
		BodyBytes: &final.BodyBytes, SubmittedAtMs: &final.SubmittedAtMs,
	}
}

func (app application) result(ctx context.Context, input string) output.Report {
	id, result, err := app.requests.ResultByPrefix(ctx, input)
	if err != nil {
		return responseServiceFailure()
	}
	switch result.Status {
	case core.ResponseAvailable:
		if result.Final != nil {
			return responseReport{
				Status: "completed", RequestID: id, Response: &result.Final.Body,
				BodyBytes: &result.Final.BodyBytes, SubmittedAtMs: &result.Final.SubmittedAtMs,
			}
		}
	case core.ResponseWithdrawn:
		if result.Withdrawal != nil {
			return responseReport{
				Status: "withdrawn", RequestID: id,
				Reason: &result.Withdrawal.Reason, WithdrawnAtMs: &result.Withdrawal.WithdrawnAtMs,
			}
		}
	case core.ResponseNotRequired:
		return responseReport{Status: "not_required", RequestID: id}
	case core.ResponseUnavailable:
		return &output.Failure{
			Code: "RESPONSE_NOT_AVAILABLE", Status: 3,
			Message: fmt.Sprintf("Response for request '%s' is not available.", id),
			Request: &output.RequestFailure{RequestID: string(id), Status: "unavailable"},
		}
	}
	return responseServiceFailure()
}

func responseServiceFailure() *output.Failure {
	// NOT PORTED (#6938): typed response rejections and request-ID selection
	// diagnostics until the request service exposes its error types.
	return &output.Failure{Code: "RESPONSE_ERROR", Message: "Could not complete the response operation.", Status: 1}
}
