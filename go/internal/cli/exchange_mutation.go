package cli

import (
	"context"
	"fmt"
	"io"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

type exchangeAckReport struct {
	Identity     identityDocument `json:"identity"`
	RequestID    core.RequestID   `json:"requestId"`
	Revision     uint64           `json:"revision"`
	Acknowledged bool             `json:"acknowledged"`
	Changed      bool             `json:"changed"`
}

func (r exchangeAckReport) JSON() any                  { return r }
func (r exchangeAckReport) HumanStream() output.Stream { return output.Stdout }
func (r exchangeAckReport) ExitStatus() int            { return 0 }

func (r exchangeAckReport) Human(w io.Writer) error {
	if r.Changed {
		_, err := fmt.Fprintf(w, "✓ Acknowledged %s at revision %d\n", r.RequestID, r.Revision)
		return err
	}
	_, err := fmt.Fprintf(w, "%s was already acknowledged at revision %d\n", r.RequestID, r.Revision)
	return err
}

type exchangeAckAllReport struct {
	Identity            identityDocument `json:"identity"`
	AcknowledgedThrough uint64           `json:"acknowledgedThrough"`
}

func (r exchangeAckAllReport) JSON() any                  { return r }
func (r exchangeAckAllReport) HumanStream() output.Stream { return output.Stdout }
func (r exchangeAckAllReport) ExitStatus() int            { return 0 }

func (r exchangeAckAllReport) Human(w io.Writer) error {
	_, err := fmt.Fprintf(w, "✓ Acknowledged '%s' through revision %d; later revisions remain unacknowledged\n", r.Identity.Name, r.AcknowledgedThrough)
	return err
}

type exchangeWithdrawReport struct {
	Identity      identityDocument `json:"identity"`
	Status        string           `json:"status"`
	RequestID     core.RequestID   `json:"requestId"`
	Reason        string           `json:"reason"`
	WithdrawnAtMs uint64           `json:"withdrawnAtMs"`
	Changed       bool             `json:"changed"`
}

func (r exchangeWithdrawReport) JSON() any                  { return r }
func (r exchangeWithdrawReport) HumanStream() output.Stream { return output.Stdout }
func (r exchangeWithdrawReport) ExitStatus() int            { return 0 }

func (r exchangeWithdrawReport) Human(w io.Writer) error {
	action := "Already withdrew"
	if r.Changed {
		action = "Withdrew"
	}
	_, err := fmt.Fprintf(w, "✓ %s %s: %q\n", action, r.RequestID, r.Reason)
	return err
}

func (app application) mutateExchange(ctx context.Context, inv invocation, me *core.Identity, direction core.XDirection) output.Report {
	identity := identityJSON(me)
	switch inv.path[1] {
	case "ack":
		revision, _ := optionalDecimal(inv, "revision", 1, core.MaxJSSafeInteger)
		ack, err := app.requests.AckX(ctx, me.ID, direction, core.RequestID(inv.operands[0]), revision)
		if err != nil {
			return exchangeFailure(err)
		}
		return exchangeAckReport{Identity: identity, RequestID: ack.RequestID, Revision: ack.Revision, Acknowledged: true, Changed: ack.Changed}
	case "ackall":
		through, err := app.requests.AckAllX(ctx, me.ID, direction)
		if err != nil {
			return exchangeFailure(err)
		}
		return exchangeAckAllReport{Identity: identity, AcknowledgedThrough: through}
	default:
		withdrawal, err := app.requests.Withdraw(ctx, me.ID, core.RequestID(inv.operands[0]), inv.options["reason"])
		if err != nil {
			return exchangeFailure(err)
		}
		return exchangeWithdrawReport{
			Identity: identity, Status: "withdrawn", RequestID: withdrawal.RequestID, Changed: withdrawal.Changed,
			Reason: withdrawal.Withdrawal.Reason, WithdrawnAtMs: withdrawal.Withdrawal.WithdrawnAtMs,
		}
	}
}

func exchangeFailure(err error) *output.Failure {
	failure := responseServiceFailure(err)
	if failure.Code == "RESPONSE_ERROR" {
		return &output.Failure{Code: "X_ERROR", Message: "Could not complete the exchange operation.", Status: 1}
	}
	return failure
}
