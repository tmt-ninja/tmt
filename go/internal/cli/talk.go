package cli

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/delivery"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type talkPlan struct {
	root          home.Root
	target        string
	message       string
	originator    identitySelection
	hasSender     bool
	callerFailure *output.Failure
	detach        bool
	delay         time.Duration
	timeout       time.Duration
	poll          time.Duration
	pasteDelay    time.Duration
	retention     uint64
	digestKind    core.DigestKind
	urgent        bool
}

func (app application) prepareTalk(ctx context.Context, root home.Root, inv invocation) (talkPlan, *output.Failure) {
	plan := talkPlan{
		root:   root,
		target: inv.operands[0], message: inv.operands[1], detach: inv.has("detach"), urgent: inv.has("urgent"),
		digestKind: core.DigestKind(inv.options["kind"]),
	}
	for _, option := range []string{"remote", "room", "passthrough", "expect-name"} {
		if inv.has(option) {
			// NOT PORTED (CLI-15, CLI-16, CLI-17, CLI-18): Remote and room routes, passthrough and name pinning.
			return plan, &output.Failure{Code: "NOT_PORTED", Message: fmt.Sprintf("Talk option '--%s' is not yet ported.", option), Status: 2}
		}
	}

	settings, err := loadSettings(root)
	if err != nil {
		return plan, talkConfigFailure()
	}
	plan.timeout = timerSeconds(settings["timeout"].value.(float64))
	plan.retention = settings["exchange.retentionDays"].value.(uint64)
	plan.pasteDelay = timerSeconds(settings["pasteEnterDelayMs"].value.(float64) / 1000)

	if inv.has("timeout") {
		value, failure := durationSeconds(inv.options["timeout"])
		if failure != nil {
			return plan, failure
		}
		if !core.ValidObserverTimeoutSeconds(value) {
			return plan, talkUsage("Talk timeout must be finite, positive, and no greater than 24 hours.")
		}
		plan.timeout = timerSeconds(value)
	}
	// No observation interval needs to exceed the request's own deadline.
	plan.poll = timerSeconds(min(settings["pollInterval"].value.(float64), plan.timeout.Seconds()))
	if inv.has("delay") {
		value, failure := durationSeconds(inv.options["delay"])
		if failure != nil {
			return plan, failure
		}
		if !core.ValidTimerDelayMs(value * 1000) {
			return plan, talkUsage("Talk delay exceeds the supported timer limit.")
		}
		plan.delay = timerSeconds(value)
	}

	if !utf8.ValidString(plan.message) {
		return plan, &output.Failure{Code: "REQUEST_INPUT_INVALID", Message: "Original request is invalid.", Status: 1}
	}
	if len(plan.message) > core.MaxExchangeTextBytes {
		return plan, &output.Failure{Code: "REQUEST_INPUT_TOO_LARGE", Message: "Original request exceeds the UTF-8 byte limit.", Status: 1}
	}
	selected, failure := app.caller.selectIdentity(ctx, inv)
	if failure == nil {
		plan.originator, plan.hasSender = selected, true
	} else if failure.Code != "IDENTITY_REQUIRED" {
		// A first request to a raw pane may precede server metadata. It
		// may deliver after target verification, with no inferred sender.
		if failure.Code != "PANE_NOT_FOUND" || !core.IsPaneTarget(plan.target) || app.caller.lookup == nil {
			return plan, failure
		}
		value, _ := app.caller.lookup("TMUX")
		if _, _, _, ok := parseTmuxClaim(value); !ok {
			return plan, failure
		}
		plan.callerFailure = failure
	}
	return plan, nil
}

func durationSeconds(raw string) (float64, *output.Failure) {
	text := strings.ToLower(raw)
	scale := 1.0
	switch {
	case strings.HasSuffix(text, "ms"):
		text, scale = strings.TrimSuffix(text, "ms"), 0.001
	case strings.HasSuffix(text, "m"):
		text, scale = strings.TrimSuffix(text, "m"), 60
	default:
		text = strings.TrimSuffix(text, "s")
	}
	integer, fraction, hasFraction := strings.Cut(text, ".")
	if decimalText(integer) && (!hasFraction || decimalText(fraction)) {
		if value, err := strconv.ParseFloat(text, 64); err == nil {
			return value * scale, nil
		}
	}
	return 0, talkUsage(fmt.Sprintf("Invalid time format: %s. Use number (seconds) or number with ms/s/m suffix.", raw))
}

func timerSeconds(seconds float64) time.Duration {
	return time.Duration(math.Ceil(seconds*1000)) * time.Millisecond
}

func talkUsage(message string) *output.Failure {
	return &output.Failure{Code: "USAGE_ERROR", Message: message, Status: 1}
}

func talkConfigFailure() *output.Failure {
	return &output.Failure{Code: "CONFIG_ERROR", Message: "Could not read talk settings.", Status: 1}
}

type talkReport struct {
	Status              string                 `json:"status"`
	RequestID           core.RequestID         `json:"requestId"`
	Target              string                 `json:"target"`
	Identity            *output.TargetIdentity `json:"identity"`
	Pane                string                 `json:"pane,omitempty"`
	RecipientIdentityID core.IdentityID        `json:"recipientIdentityId,omitempty"`
	Offline             bool                   `json:"offline,omitempty"`
	Notification        string                 `json:"notification,omitempty"`
	Digest              bool                   `json:"digest,omitempty"`
	DigestUntilMs       *uint64                `json:"digestUntilMs,omitempty"`
	RemainingMs         *uint64                `json:"remainingMs,omitempty"`
	WaitingFor          string                 `json:"waitingFor,omitempty"`
	Suggestion          string                 `json:"suggestion,omitempty"`
	Response            *string                `json:"response,omitempty"`
	BodyBytes           *uint64                `json:"bodyBytes,omitempty"`
	SubmittedAtMs       *uint64                `json:"submittedAtMs,omitempty"`
}

func (r talkReport) JSON() any                  { return r }
func (r talkReport) HumanStream() output.Stream { return output.Stdout }
func (r talkReport) ExitStatus() int            { return 0 }

func (r talkReport) Human(w io.Writer) error {
	target := r.Target
	term := outputTerminal(w)
	if r.DigestUntilMs != nil {
		seconds := *r.RemainingMs / 1000
		if *r.RemainingMs%1000 != 0 {
			seconds++
		}
		if _, err := fmt.Fprintf(w, "Queued %s: %s is in digest mode for %d seconds (until UTC epoch %d ms); delivery is in its next checklist.\n",
			r.RequestID, clistyle.Escape(target), seconds, *r.DigestUntilMs); err != nil {
			return err
		}
		return clistyle.WriteHint(w, term, fmt.Sprintf("retrieve it later with "+flavor.Binary+" result %s", r.RequestID))
	}
	var message string
	switch {
	case r.Pane != "" && r.Response != nil:
		message = fmt.Sprintf("Completed request %s for %s (%s)", r.RequestID, target, r.Pane)
	case r.Pane != "":
		message = fmt.Sprintf("Sent request %s to %s (%s)", r.RequestID, target, r.Pane)
	case r.Response != nil:
		message = fmt.Sprintf("Completed queued request %s for %s", r.RequestID, target)
	default:
		message = fmt.Sprintf("Queued request %s for %s without a live endpoint", r.RequestID, target)
	}
	if err := clistyle.WriteSuccess(w, term, message); err != nil {
		return err
	}
	if r.Response != nil {
		if _, err := fmt.Fprintln(w, *r.Response); err != nil {
			return err
		}
	} else if r.Offline && r.Suggestion != "" {
		if err := clistyle.WriteHint(w, term, r.Suggestion); err != nil {
			return err
		}
	}
	return clistyle.WriteHint(w, term, fmt.Sprintf("retrieve it later with "+flavor.Binary+" result %s", r.RequestID))
}

func (r talkReport) heldByDigest(until uint64, recipient core.IdentityID, now uint64) talkReport {
	remaining := until - min(until, now)
	r.Pane = ""
	r.Status, r.RecipientIdentityID = "queued", recipient
	r.Digest, r.DigestUntilMs, r.RemainingMs = true, &until, &remaining
	r.Notification, r.WaitingFor = "held", "digest_checklist"
	return r
}

func (r talkReport) recipientHints() string {
	return fmt.Sprintf("recipient pull: "+flavor.Binary+" inbox --identity '%s' --json; recipient inspection: "+flavor.Binary+" x show %s --incoming --identity '%s' --json",
		r.RecipientIdentityID, r.RequestID, r.RecipientIdentityID)
}

func (r talkReport) observerFailure(code, message string, status int) *output.Failure {
	suggestion := fmt.Sprintf("Inspect with '"+flavor.Binary+" result %s --json'. Do not resend solely because the observer ended.", r.RequestID)
	if r.Pane == "" {
		suggestion = fmt.Sprintf("Inspect with '"+flavor.Binary+" result %s --json'. The request stays queued for a later reply; do not resend solely because the observer ended. %s.",
			r.RequestID, r.recipientHints())
	}
	return &output.Failure{
		Code: code, Message: message, Status: status,
		Request:    &output.RequestFailure{RequestID: string(r.RequestID)},
		Target:     &output.TargetFailure{Target: r.Target, Pane: r.Pane, Identity: r.Identity},
		Suggestion: suggestion,
	}
}

func (app application) talk(ctx context.Context, plan talkPlan) output.Report {
	var recipient *core.Identity
	var binding *core.Binding
	var directPane bool
	originator := core.Originator{Kind: core.OriginatorUnknown}
	senderName := "unknown"
	err := app.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		records := tx.Identities()
		directPane, err = core.AddressesPane(records, plan.target)
		if err != nil {
			return err
		}
		if !directPane {
			if plan.callerFailure != nil {
				return plan.callerFailure
			}
			recipient, err = core.ResolveIdentity(records, plan.target)
			if err != nil || recipient == nil {
				return err
			}
			binding, err = tx.Bindings().FindByIdentity(recipient.ID)
			if err != nil {
				return err
			}
		}
		if !plan.hasSender {
			return nil
		}
		if plan.originator.explicit == nil {
			sender, err := verifiedCaller(tx, plan.originator.claim, plan.originator.probe)
			if err == nil && sender != nil {
				originator = core.Originator{Kind: core.OriginatorVerified, IdentityID: &sender.ID}
				senderName = sender.CanonicalName
			}
			return err
		}
		sender, err := core.ResolveIdentity(records, *plan.originator.explicit)
		if err != nil {
			return err
		}
		if sender == nil {
			return &core.RequestFailure{Code: "NAME_NOT_FOUND", Message: fmt.Sprintf("Identity '%s' was not found.", *plan.originator.explicit), Status: 3}
		}
		originator = core.Originator{Kind: core.OriginatorExplicit, IdentityID: &sender.ID}
		senderName = sender.CanonicalName
		return nil
	})
	if err != nil {
		if plan.callerFailure != nil && errors.Is(err, plan.callerFailure) {
			return plan.callerFailure
		}
		return talkFailure(err)
	}
	var pane directTalkPane
	if directPane {
		var failure *output.Failure
		pane, failure = app.resolveDirectTalkPane(ctx, plan.target)
		if failure != nil {
			return failure
		}
		recipient, binding = pane.recipient, pane.binding
	} else if recipient == nil {
		return identityMissing(plan.target)
	}

	if !waitForTalkTimer(ctx, plan.delay) {
		return &output.Failure{Code: "INTERRUPTED", Message: "Interrupted before preparing the request. No message was sent.", Status: 1}
	}
	kind := plan.digestKind
	if kind == "" {
		kind = core.DigestKindFyi
	}
	req := core.PrepareRequest{
		RequestID: core.RequestID("req_" + talkUUID()), AttemptID: core.AttemptID(talkUUID()),
		Kind: core.RequestKindRequest, Origin: core.RequestOriginPerson, Originator: originator,
		Message: plan.message, Wait: !plan.detach, RetentionDays: plan.retention,
		ExpiresAtMs: uint64(time.Now().Add(plan.timeout + plan.pasteDelay + time.Second).UnixMilli()),
		DeliveryPolicy: &core.RequestDeliveryPolicy{
			Urgent: plan.urgent, Kind: kind, Automatic: true, Mode: core.RequestDeliveryRequest,
		},
	}
	if recipient == nil {
		endpoint := core.RequestEndpoint{Server: pane.snapshot.Server, PaneID: pane.snapshot.Pane.PaneID, PanePID: pane.snapshot.Process.PID}
		req.Route = core.RequestRoute{Kind: core.RequestRoutePane, Pane: &endpoint}
		return app.deliverTalk(ctx, plan, delivery.PasteTarget{
			Pane:    pane.snapshot.Pane,
			Unbound: &delivery.UnboundPasteFence{Server: pane.snapshot.Server, Process: pane.snapshot.Process},
		}, req, senderName)
	}
	req.Route, req.Recipient = core.RequestRoute{Kind: core.RequestRouteInbox, Recipient: &recipient.ID}, &recipient.ID
	if binding != nil {
		return app.liveTalk(ctx, plan, *recipient, *binding, req, senderName)
	}
	prepared, err := app.requests.Enqueue(ctx, req)
	if err != nil {
		return talkFailure(err)
	}
	report := talkReport{
		RequestID: prepared.RequestID, Target: plan.target, RecipientIdentityID: recipient.ID,
		Identity: &output.TargetIdentity{Name: string(recipient.Name), CanonicalName: recipient.CanonicalName},
	}
	if prepared.DigestUntilMs != nil {
		return report.heldByDigest(*prepared.DigestUntilMs, recipient.ID, uint64(wallClock{}.NowMs()))
	}
	if plan.detach {
		report.Status, report.Offline = "queued", true
		report.Notification, report.WaitingFor = "not_attempted", "recipient_inbox_pull"
		report.Suggestion = "no live notification was attempted; waiting for the recipient's inbox pull; " + report.recipientHints()
		return report
	}
	return app.waitForTalk(ctx, plan, prepared, report)
}

func (app application) waitForTalk(ctx context.Context, plan talkPlan, prepared core.PreparedRequest, report talkReport) (result output.Report) {
	defer app.releaseTalkWait(ctx, prepared, report, &result)
	return app.observeTalk(ctx, plan, prepared, report, time.Now().Add(plan.timeout))
}

func (app application) releaseTalkWait(ctx context.Context, prepared core.PreparedRequest, report talkReport, result *output.Report) {
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err := app.requests.ReleaseWait(cleanup, prepared.AttemptID); err != nil {
		if _, failed := (*result).(*output.Failure); !failed {
			*result = report.observerFailure("CLEANUP_ERROR", "Could not release the request observer. Effects may already have occurred.", 1)
		}
	}
}

func (app application) observeTalk(ctx context.Context, plan talkPlan, prepared core.PreparedRequest, report talkReport, deadline time.Time) output.Report {
	for {
		if failure := talkObserverState(ctx, plan, report, deadline); failure != nil {
			return failure
		}
		lookup, err := app.requests.Result(ctx, prepared.RequestID)
		if failure := talkObserverState(ctx, plan, report, deadline); failure != nil {
			return failure
		}
		if err != nil {
			return report.observerFailure("REQUEST_STATE_ERROR", "Could not read the durable reply.", 1)
		}
		if lookup.Status == core.ResponseAvailable && lookup.Final != nil {
			report.Status, report.Response = "completed", &lookup.Final.Body
			report.BodyBytes, report.SubmittedAtMs = &lookup.Final.BodyBytes, &lookup.Final.SubmittedAtMs
			return report
		}
		waitForTalkTimer(ctx, min(plan.poll, time.Until(deadline)))
	}
}

func talkObserverState(ctx context.Context, plan talkPlan, report talkReport, deadline time.Time) *output.Failure {
	if ctx.Err() != nil {
		return report.observerFailure("INTERRUPTED", "Interrupted while waiting for a durable reply.", 1)
	}
	if !time.Now().Before(deadline) {
		message := fmt.Sprintf("Timed out waiting for %s after %gs", report.Target, plan.timeout.Seconds())
		if report.Pane == "" {
			message = fmt.Sprintf("%s has not responded within %gs; the request is still queued for inbox pull", report.Target, plan.timeout.Seconds())
		}
		failure := report.observerFailure("TIMEOUT", message, 4)
		failure.Request.Status = "timeout"
		return failure
	}
	return nil
}

func waitForTalkTimer(ctx context.Context, wait time.Duration) bool {
	if wait <= 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(wait)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return ctx.Err() == nil
	}
}

func talkFailure(err error) *output.Failure {
	var typed *core.RequestFailure
	if errors.As(err, &typed) && typed != nil {
		return responseServiceFailure(err)
	}
	return &output.Failure{Code: "REQUEST_STATE_ERROR", Message: "Could not complete the request operation.", Status: 1}
}

func talkUUID() string {
	var data [16]byte
	rand.Read(data[:])
	data[6] = data[6]&0x0f | 0x40
	data[8] = data[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", data[:4], data[4:6], data[6:8], data[8:10], data[10:])
}
