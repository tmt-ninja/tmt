package cli

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/gemini"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type liveTalkHost struct {
	driver  func(context.Context, core.Identity, core.Binding, core.EndpointProbe) (ports.Driver, error)
	capture func(context.Context, ports.PaneRef, ports.CaptureOpts) (ports.Screen, error)
	deliver func(context.Context, ports.PaneRef, ports.DeliveryInput) (ports.DeliveryOutcome, error)
}

func systemLiveTalkHost(acquire func() (tmux.Client, error)) liveTalkHost {
	drivers := []ports.Driver{claude.Driver{}, codex.Driver{}, gemini.Driver{}}
	return liveTalkHost{
		driver: func(ctx context.Context, identity core.Identity, binding core.Binding, probe core.EndpointProbe) (ports.Driver, error) {
			client, err := acquire()
			if err != nil {
				return nil, err
			}
			observer := runtime.Observer{Process: client.Process}
			provider, err := observer.ProveBoundMain(ctx, identity, binding, probe)
			if err != nil {
				return nil, err
			}
			for _, driver := range drivers {
				if driver.Name() == provider.Name {
					return driver, nil
				}
			}
			return nil, nil
		},
		capture: func(ctx context.Context, pane ports.PaneRef, opt ports.CaptureOpts) (ports.Screen, error) {
			client, err := acquire()
			if err != nil {
				return ports.Screen{}, err
			}
			return client.Capture(ctx, pane, opt)
		},
		deliver: func(ctx context.Context, pane ports.PaneRef, input ports.DeliveryInput) (ports.DeliveryOutcome, error) {
			client, err := acquire()
			if err != nil {
				return ports.DeliveryNotStarted, err
			}
			return client.Deliver(ctx, pane, input)
		},
	}
}

func (app application) liveDriver(ctx context.Context, recipient core.Identity, binding core.Binding, pane ports.PaneRef) (ports.Driver, *output.Failure) {
	unready := &output.Failure{
		Code: "DELIVERY_PREPARATION_FAILED", Message: "Recipient readiness could not be verified; the request was not delivered live.", Status: 1,
	}
	if app.caller.probe == nil || app.live.driver == nil || app.live.capture == nil || app.live.deliver == nil {
		return nil, unready
	}
	probe, err := app.caller.probe(ctx, pane)
	if err != nil || probe.State != core.EndpointProbeLive {
		return nil, &output.Failure{Code: "RECONCILIATION_FAILED", Message: "Could not verify the recipient's tmux endpoint.", Status: 1}
	}
	state, observed := core.EvaluateBinding(recipient, &binding, probe)
	if state != core.BindingActive || binding.PaneIncarnation == nil || observed.Incarnation == nil {
		return nil, &output.Failure{Code: "RECONCILIATION_FAILED", Message: "The recipient's recorded binding did not match the verified pane.", Status: 1}
	}
	if binding.Session.PlainProgram != nil {
		return nil, &output.Failure{Code: "RECIPIENT_NOT_AGENT", Message: "The target is running a plain program, not an agent.", Status: 1}
	}
	driver, err := app.live.driver(ctx, recipient, binding, probe)
	if err != nil || driver == nil {
		return nil, unready
	}
	screen, err := app.live.capture(ctx, pane, ports.CaptureOpts{})
	if err != nil || screen.Pane != pane {
		return nil, unready
	}
	switch driver.Classify(screen) {
	case ports.DriverIdle:
		return driver, nil
	case ports.DriverPrompt:
		return nil, &output.Failure{Code: "DELIVERY_AWAITING_APPROVAL", Message: "The recipient is waiting on an approval prompt. No message was delivered live.", Status: 1}
	default:
		return nil, unready
	}
}

func (app application) liveTalk(ctx context.Context, plan talkPlan, recipient core.Identity, binding core.Binding,
	req core.PrepareRequest, sender string,
) (result output.Report) {
	pane := ports.PaneRef{Server: binding.Server.Socket, PaneID: binding.PaneID}
	prepared, err := app.requests.Prepare(ctx, req)
	if err != nil {
		return talkFailure(err)
	}
	report := talkReport{
		RequestID: prepared.RequestID, Target: plan.target, Pane: pane.PaneID,
		Identity: output.TargetIdentity{Name: string(recipient.Name), CanonicalName: recipient.CanonicalName},
	}
	if prepared.DigestUntilMs != nil {
		return report.heldByDigest(*prepared.DigestUntilMs, recipient.ID, uint64(wallClock{}.NowMs()))
	}
	if req.Wait {
		defer app.releaseTalkWait(ctx, prepared, report, &result)
	}
	deadline := time.Now().Add(plan.timeout)
	if err := app.requests.BeginSend(ctx, prepared.AttemptID); err != nil {
		return report.observerFailure("REQUEST_STATE_ERROR", "Could not begin request delivery.", 1)
	}

	// Settle before observing the reply. A refusal before the transport
	// starts is proven-unsent; a possible handoff is never replayed.
	settled := false
	settle := func(outcome core.Settlement) *output.Failure {
		settled = true
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := app.requests.Settle(cleanup, prepared.AttemptID, outcome); err != nil {
			failure := report.observerFailure("REQUEST_STATE_ERROR", "Could not settle request delivery. Inspect before retrying.", 1)
			if outcome != core.SettlementDefinitelyFailed {
				failure.Request.DeliveryState = "uncertain"
			}
			return failure
		}
		return nil
	}
	defer func() {
		if !settled {
			if failure := settle(core.SettlementDefinitelyFailed); failure != nil {
				result = failure
			}
		}
	}()

	if failure := talkObserverState(ctx, plan, report, deadline); failure != nil {
		return failure
	}
	var current *core.Binding
	err = app.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		current, err = tx.Bindings().FindByIdentity(recipient.ID)
		return err
	})
	if err != nil || current == nil || !reflect.DeepEqual(*current, binding) {
		return report.observerFailure("DELIVERY_PREPARATION_FAILED", "The recipient's binding changed before delivery. No message was delivered live.", 1)
	}
	driver, failure := app.liveDriver(ctx, recipient, binding, pane)
	if failure != nil {
		return report.observerFailure(failure.Code, failure.Message, failure.Status)
	}
	if failure := talkObserverState(ctx, plan, report, deadline); failure != nil {
		return failure
	}

	frame := liveRequestFrame(plan.message, sender, prepared)
	delivery, stop := context.WithTimeout(context.WithoutCancel(ctx), 8*time.Second)
	delivered, err := app.live.deliver(delivery, pane, ports.DeliveryInput{Text: frame, Submit: driver.SubmitPlan(frame)})
	stop()
	if delivered == ports.DeliveryDelivered && err != nil {
		delivered = ports.DeliveryUncertain
	}
	switch delivered {
	case ports.DeliveryDelivered:
		if failure := settle(core.SettlementSent); failure != nil {
			return failure
		}
		report.Status = "sent"
		if plan.detach {
			return report
		}
		return app.observeTalk(ctx, plan, prepared, report, deadline)
	case ports.DeliveryUncertain:
		if failure := settle(core.SettlementUncertain); failure != nil {
			return failure
		}
		failure := report.observerFailure("DELIVERY_UNCERTAIN", "The request may have reached the pane. Inspect before retrying.", 1)
		failure.Request.DeliveryState = "uncertain"
		return failure
	default:
		if failure := settle(core.SettlementDefinitelyFailed); failure != nil {
			return failure
		}
		failure := report.observerFailure("DELIVERY_PREPARATION_FAILED", "No message was delivered live.", 1)
		failure.Request.DeliveryState = "not_delivered"
		return failure
	}
}

var requestSenderEscape = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&apos;")

func liveRequestFrame(message, sender string, prepared core.PreparedRequest) string {
	return fmt.Sprintf("%s\n\n<tmt-reply from=\"%s\">\ntmt-go reply %s --receipt %s --message <text>\n</tmt-reply>\n"+
		"Submit your response with the command above. Chat output alone does not complete the request. Your reply is the answer: do not repeat it in your pane or say you replied elsewhere. Report submission errors.",
		message, requestSenderEscape.Replace(sender), prepared.RequestID, prepared.Receipt)
}
