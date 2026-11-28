package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"reflect"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/delivery"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func (app application) sendNow(ctx context.Context, root home.Root, selected identitySelection, selector string, delay time.Duration) (report output.Report) {
	me, _, failure := app.requestIdentities(ctx, selected, nil)
	if failure != nil {
		return failure
	}
	release, err := app.requests.ReleaseSendNow(ctx, core.RequestRef(selector), me.ID)
	if err != nil {
		return sendNowFailure(err)
	}
	id := release.RequestID
	if release.Already != nil {
		return sendNowReport{Status: "already", RequestID: id, State: string(*release.Already)}
	}

	query := core.ReleasedWakeQuery{RequestID: id, RecipientID: release.RecipientID}
	claim, err := app.requests.ClaimReleasedWake(ctx, query)
	if err != nil {
		return sendNowFailure(err)
	}
	if !claim.Claimed {
		// Native reports every lost claim race as already/sent.
		return sendNowReport{Status: "already", RequestID: id, State: "sent"}
	}
	if claim.Generation == nil {
		return sendNowFailure(nil)
	}
	proof := core.ReleasedWakeProof{RequestID: id, RecipientID: query.RecipientID, Generation: *claim.Generation}
	outcome := core.WakeUnavailable
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		err := app.requests.SettleReleasedWake(cleanup, core.ReleasedWakeSettlement{Proof: proof, Outcome: outcome})
		if err == nil || outcome == core.WakeUncertain {
			return
		}
		if outcome == core.WakeSent {
			failed := bindingFailure("SEND_NOW_ERROR", "Could not settle send-now delivery.", 1)
			failed.Suggestion = fmt.Sprintf("Inspect with '"+flavor.Binary+" result %s'.", id)
			report = failed
			return
		}
		report = sendNowFailure(err)
	}()

	recipient, binding, err := app.sendNowRecipient(ctx, proof.RecipientID)
	if err != nil {
		return sendNowFailure(err)
	}
	if recipient == nil || binding == nil || binding.Server.Host != "tmux" {
		// NOT PORTED (CLI-02, CLI-25): Released wake through built-in and external hosts.
		return sendNowUntyped(id, "SEND_NOW_UNREACHABLE")
	}
	pane := ports.PaneRef{Server: binding.Server.Socket, PaneID: binding.PaneID}
	driver, failure := app.liveDriver(ctx, *recipient, *binding, pane)
	if failure != nil {
		return sendNowUntyped(id, failure.Code)
	}
	currentRecipient, currentBinding, err := app.sendNowRecipient(ctx, proof.RecipientID)
	if err != nil {
		return sendNowFailure(err)
	}
	if currentRecipient == nil || *currentRecipient != *recipient || !reflect.DeepEqual(currentBinding, binding) {
		return sendNowUntyped(id, "SEND_NOW_UNREACHABLE")
	}
	payload, err := app.requests.ReadClaimedWake(ctx, proof)
	if err != nil {
		return sendNowFailure(err)
	}
	if payload == nil {
		return sendNowClosed()
	}
	attempt := payload.Attempt
	if attempt.RequestID != id || attempt.Route.Kind != core.RequestRouteInbox ||
		attempt.Route.Recipient == nil || *attempt.Route.Recipient != proof.RecipientID || attempt.AttemptID == "" {
		return sendNowFailure(nil)
	}
	receipt := core.EncodeReceipt(id, attempt.AttemptID, attempt.Route)
	sender := payload.SenderName
	if sender == "" {
		sender = "unknown"
	}
	var thread *output.RequestThreadRoot
	if root := payload.ThreadRoot; root != nil {
		thread = &output.RequestThreadRoot{RequestID: string(root.RequestID), Text: root.Text}
	}
	frame := output.RequestFrame(payload.Message, sender, string(id), string(receipt), thread)
	if ctx.Err() != nil {
		return sendNowUntyped(id, "SEND_NOW_UNREACHABLE")
	}

	sendCtx, cancel := context.WithTimeout(ctx, 8*time.Second+delay)
	defer cancel()
	delivered, err := app.live.deliver(sendCtx, root,
		delivery.PasteTarget{Pane: pane, Binding: binding, Identity: *recipient},
		ports.DeliveryInput{Text: frame, BeforeSubmit: delay, Submit: driver.SubmitPlan(frame)},
	)
	switch {
	case delivered == ports.DeliveryDelivered && err == nil:
		outcome = core.WakeSent
		return sendNowReport{Status: "sent", RequestID: id, State: "delivered"}
	case delivered == ports.DeliveryNotStarted:
		if errors.Is(err, delivery.ErrChannelEvidence) {
			// NOT PORTED (CLI-02, CLI-23): Wake delivery through verified provider channels.
			return sendNowUntyped(id, "DELIVERY_CHANNEL_UNAVAILABLE")
		}
		return sendNowUntyped(id, "SEND_NOW_UNREACHABLE")
	default:
		outcome = core.WakeUncertain
		return sendNowUntyped(id, "DELIVERY_UNCERTAIN")
	}
}

func (app application) sendNowRecipient(ctx context.Context, id core.IdentityID) (*core.Identity, *core.Binding, error) {
	var identity *core.Identity
	var binding *core.Binding
	err := app.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		identity, err = tx.Identities().FindByID(id)
		if err != nil || identity == nil {
			return err
		}
		binding, err = tx.Bindings().FindByIdentity(id)
		return err
	})
	return identity, binding, err
}

type sendNowReport struct {
	Status    string         `json:"status"`
	RequestID core.RequestID `json:"requestId"`
	State     string         `json:"state"`
}

func (r sendNowReport) JSON() any                  { return r }
func (r sendNowReport) HumanStream() output.Stream { return output.Stdout }
func (r sendNowReport) ExitStatus() int            { return 0 }
func (r sendNowReport) Human(w io.Writer) error {
	if r.Status == "sent" {
		return success(w, "Sent now.")
	}
	return success(w, "It already reached the agent, or is on its way; it was not sent again.")
}

func sendNowFailure(err error) *output.Failure {
	var typed *core.RequestFailure
	if errors.As(err, &typed) && typed != nil {
		failure := responseServiceFailure(typed)
		if failure.Code == "SEND_NOW_UNCONFIRMED" {
			failure.Suggestion = strings.Replace(failure.Suggestion, "Inspect with 'tmt result ", "Inspect with '"+flavor.Binary+" result ", 1)
		}
		return failure
	}
	return bindingFailure("SEND_NOW_ERROR", "Could not send the message now.", 1)
}

func sendNowClosed() *output.Failure {
	return bindingFailure("SEND_NOW_CLOSED", "Could not send now: it already has an answer, or was withdrawn or expired", 1)
}

func sendNowUntyped(id core.RequestID, code string) *output.Failure {
	message := ""
	switch code {
	case "DELIVERY_AWAITING_APPROVAL":
		message = "Could not send now: the agent is waiting for approval on its machine"
	case "RECIPIENT_NOT_AGENT":
		message = "Could not send now: the member runs a plain program, not an AI agent"
	case "DELIVERY_CHANNEL_UNAVAILABLE":
		message = "Could not send now: the agent's channel is not available"
	case "DELIVERY_UNCERTAIN":
		failure := bindingFailure(code, "It may have been sent. Delivery is not confirmed, so do not send it again.", 1)
		failure.Suggestion = fmt.Sprintf("Inspect with '"+flavor.Binary+" result %s'.", id)
		return failure
	default:
		code = "SEND_NOW_UNREACHABLE"
		message = "Could not send now: the agent could not be reached"
	}
	failure := bindingFailure(code, message, 1)
	failure.Suggestion = fmt.Sprintf("Nothing was typed; retry '"+flavor.Binary+" send-now %s' after it continues.", id)
	return failure
}
