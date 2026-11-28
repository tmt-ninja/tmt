package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

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

func (app application) reply(ctx context.Context, inv invocation, body string) output.Report {
	final, err := app.requests.SubmitResponse(ctx, core.SubmitResponse{
		RequestID: core.RequestID(inv.operands[0]),
		Receipt:   core.Receipt(inv.options["receipt"]),
		Body:      body,
	})
	if err != nil {
		return responseServiceFailure(err)
	}
	return responseReport{
		Status: "submitted", RequestID: final.RequestID,
		BodyBytes: &final.BodyBytes, SubmittedAtMs: &final.SubmittedAtMs,
	}
}

func responseBody(stdin *os.File, inv invocation, inline string) (string, *output.Failure) {
	var data []byte
	var err error
	switch {
	case inv.has("file"):
		data, err = process.ReadInputFile(inv.options["file"], core.MaxExchangeTextBytes)
	case inv.has("stdin"):
		data, err = process.ReadInputStdin(stdin, core.MaxExchangeTextBytes)
	default:
		data = []byte(inline)
	}
	switch {
	case errors.Is(err, process.ErrInputTimeout):
		return "", &output.Failure{Code: "RESPONSE_INPUT_TIMEOUT", Message: "Timed out while reading response input.", Status: 4}
	case errors.Is(err, process.ErrInputFile):
		return "", &output.Failure{Code: "RESPONSE_FILE_ERROR", Message: "Could not read response input file.", Status: 1}
	case err != nil:
		return "", &output.Failure{Code: "RESPONSE_INPUT_INVALID", Message: "Response input must be complete valid UTF-8 and cannot be a TTY.", Status: 1}
	case len(data) > core.MaxExchangeTextBytes:
		return "", &output.Failure{Code: "RESPONSE_INPUT_TOO_LARGE", Message: "Response body must not exceed 1048576 UTF-8 bytes.", Status: 1}
	case !utf8.Valid(data):
		message := "Response input is invalid."
		if inv.has("file") || inv.has("stdin") {
			message = "Response input must be complete valid UTF-8 and cannot be a TTY."
		}
		return "", &output.Failure{Code: "RESPONSE_INPUT_INVALID", Message: message, Status: 1}
	}
	return string(data), nil
}

func (app application) result(ctx context.Context, input string) output.Report {
	id, result, err := app.requests.ResultByPrefix(ctx, input)
	if err != nil {
		return responseServiceFailure(err)
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
	return responseServiceFailure(nil)
}

func responseServiceFailure(err error) *output.Failure {
	var failure *core.RequestFailure
	if errors.As(err, &failure) && failure != nil {
		return &output.Failure{
			Code: failure.Code, Message: failure.Message, Status: failure.Status,
			Reason: failure.Reason, Stage: failure.Stage, Suggestion: failure.Suggestion,
		}
	}
	return &output.Failure{Code: "RESPONSE_ERROR", Message: "Could not complete the response operation.", Status: 1}
}
