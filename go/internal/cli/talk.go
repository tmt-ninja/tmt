package cli

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/config"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type talkPlan struct {
	target     string
	message    string
	originator identitySelection
	hasSender  bool
	detach     bool
	delay      time.Duration
	timeout    time.Duration
	poll       time.Duration
	retention  uint64
}

func (app application) prepareTalk(ctx context.Context, root home.Root, inv invocation) (talkPlan, *output.Failure) {
	plan := talkPlan{
		target: inv.operands[0], message: inv.operands[1], detach: inv.has("detach"),
		timeout: 180 * time.Second, poll: time.Second, retention: core.DefaultRetentionDays,
	}
	for _, option := range []string{"remote", "room", "passthrough", "urgent", "kind", "expect-name"} {
		if inv.has(option) {
			// NOT PORTED (#6938): nonlocal routing, passthrough and delivery policy.
			return plan, &output.Failure{Code: "NOT_PORTED", Message: fmt.Sprintf("Talk option '--%s' is not yet ported.", option), Status: 2}
		}
	}

	files, err := config.Resolve(root, root.Dir)
	if err != nil {
		return plan, talkConfigFailure()
	}
	doc, err := files.Read(config.Global)
	if err != nil {
		return plan, talkConfigFailure()
	}
	var defaults struct {
		Timeout      *float64 `json:"timeout"`
		PollInterval *float64 `json:"pollInterval"`
	}
	var exchange struct {
		RetentionDays *uint64 `json:"retentionDays"`
	}
	if raw := doc["defaults"]; len(raw) != 0 && json.Unmarshal(raw, &defaults) != nil {
		return plan, talkConfigFailure()
	}
	if raw := doc["exchange"]; len(raw) != 0 && json.Unmarshal(raw, &exchange) != nil {
		return plan, talkConfigFailure()
	}
	if defaults.Timeout != nil {
		if !core.ValidObserverTimeoutSeconds(*defaults.Timeout) {
			return plan, talkConfigFailure()
		}
		plan.timeout = timerSeconds(*defaults.Timeout)
	}
	if defaults.PollInterval != nil {
		if !core.ValidObserverTimeoutSeconds(*defaults.PollInterval) {
			return plan, talkConfigFailure()
		}
		plan.poll = timerSeconds(*defaults.PollInterval)
	}
	if exchange.RetentionDays != nil {
		if !core.ValidRetentionDays(*exchange.RetentionDays) {
			return plan, talkConfigFailure()
		}
		plan.retention = *exchange.RetentionDays
	}

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
	// NOT PORTED (#6938): implicit sender attribution is enabled only once the
	// production tmux probe uses the isolated marker namespace.
	if inv.has("identity") {
		selected, failure := app.caller.selectIdentity(ctx, inv)
		if failure != nil {
			return plan, failure
		}
		plan.originator, plan.hasSender = selected, true
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
	Status              string                `json:"status"`
	RequestID           core.RequestID        `json:"requestId"`
	Target              string                `json:"target"`
	Identity            output.TargetIdentity `json:"identity"`
	RecipientIdentityID core.IdentityID       `json:"recipientIdentityId"`
	Offline             bool                  `json:"offline,omitempty"`
	Notification        string                `json:"notification,omitempty"`
	WaitingFor          string                `json:"waitingFor,omitempty"`
	Suggestion          string                `json:"suggestion,omitempty"`
	Response            *string               `json:"response,omitempty"`
	BodyBytes           *uint64               `json:"bodyBytes,omitempty"`
	SubmittedAtMs       *uint64               `json:"submittedAtMs,omitempty"`
}

func (r talkReport) JSON() any                  { return r }
func (r talkReport) HumanStream() output.Stream { return output.Stdout }
func (r talkReport) ExitStatus() int            { return 0 }

func (r talkReport) Human(w io.Writer) error {
	var text strings.Builder
	target := r.Identity.Name
	if r.Response == nil {
		fmt.Fprintf(&text, "✓ Queued request %s for %s without a live endpoint\nhint: %s\n", r.RequestID, target, r.Suggestion)
	} else {
		fmt.Fprintf(&text, "✓ Completed queued request %s for %s\n%s\n", r.RequestID, target, *r.Response)
	}
	fmt.Fprintf(&text, "hint: retrieve it later with tmt-go result %s\n", r.RequestID)
	_, err := io.WriteString(w, text.String())
	return err
}

func (r talkReport) recipientHints() string {
	return fmt.Sprintf("recipient pull: tmt-go inbox --identity '%s' --json; recipient inspection: tmt-go x show %s --incoming --identity '%s' --json",
		r.RecipientIdentityID, r.RequestID, r.RecipientIdentityID)
}

func (r talkReport) observerFailure(code, message string, status int) *output.Failure {
	return &output.Failure{
		Code: code, Message: message, Status: status,
		Request: &output.RequestFailure{RequestID: string(r.RequestID)},
		Target:  &output.TargetFailure{Target: r.Target, Identity: &r.Identity},
		Suggestion: fmt.Sprintf("Inspect with 'tmt-go result %s --json'. The request stays queued for a later reply; do not resend solely because the observer ended. %s.",
			r.RequestID, r.recipientHints()),
	}
}

func (app application) talk(ctx context.Context, plan talkPlan) output.Report {
	var recipient *core.Identity
	var binding *core.Binding
	var directPane bool
	originator := core.Originator{Kind: core.OriginatorUnknown}
	err := app.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		records := tx.Identities()
		directPane, err = core.AddressesPane(records, plan.target)
		if err != nil || directPane {
			return err
		}
		recipient, err = core.ResolveIdentity(records, plan.target)
		if err != nil || recipient == nil {
			return err
		}
		binding, err = tx.Bindings().FindByIdentity(recipient.ID)
		if err != nil || !plan.hasSender {
			return err
		}
		sender, err := core.ResolveIdentity(tx.Identities(), *plan.originator.explicit)
		if err != nil {
			return err
		}
		if sender == nil {
			return &core.RequestFailure{Code: "NAME_NOT_FOUND", Message: fmt.Sprintf("Identity '%s' was not found.", *plan.originator.explicit), Status: 3}
		}
		originator = core.Originator{Kind: core.OriginatorExplicit, IdentityID: &sender.ID}
		return nil
	})
	if err != nil {
		return talkFailure(err)
	}
	if recipient == nil {
		if directPane {
			// NOT PORTED (#6938): direct pane delivery and live driver routing.
			return &output.Failure{Code: "NOT_PORTED", Message: "Talk to a direct pane is not yet ported.", Status: 2}
		}
		return identityMissing(plan.target)
	}
	if binding != nil {
		// Recorded ownership is neither liveness nor license to queue around
		// an unavailable host. Live delivery will verify this exact endpoint.
		return &output.Failure{Code: "NOT_PORTED", Message: "Talk to a bound identity is not yet ported.", Status: 2}
	}
	if !waitForTalkTimer(ctx, plan.delay) {
		return &output.Failure{Code: "INTERRUPTED", Message: "Interrupted before preparing the request. No message was sent.", Status: 1}
	}
	req := core.PrepareRequest{
		RequestID: core.RequestID("req_" + talkUUID()), AttemptID: core.AttemptID(talkUUID()),
		Kind: core.RequestKindRequest, Origin: core.RequestOriginPerson, Originator: originator,
		Route: core.RequestRoute{Kind: core.RequestRouteInbox, Recipient: &recipient.ID}, Recipient: &recipient.ID,
		Message: plan.message, Wait: !plan.detach, RetentionDays: plan.retention,
		ExpiresAtMs: uint64(time.Now().Add(plan.timeout).UnixMilli()),
	}
	prepared, err := app.requests.Enqueue(ctx, req)
	if err != nil {
		return talkFailure(err)
	}
	report := talkReport{
		RequestID: prepared.RequestID, Target: plan.target, RecipientIdentityID: recipient.ID,
		Identity: output.TargetIdentity{Name: string(recipient.Name), CanonicalName: recipient.CanonicalName},
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
	deadline := time.Now().Add(plan.timeout)
	defer func() {
		cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := app.requests.ReleaseWait(cleanup, prepared.AttemptID); err != nil {
			if _, failed := result.(*output.Failure); !failed {
				result = report.observerFailure("CLEANUP_ERROR", "Could not release the request observer. Effects may already have occurred.", 1)
			}
		}
	}()
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
		message := fmt.Sprintf("%s has not responded within %gs; the request is still queued for inbox pull", report.Target, plan.timeout.Seconds())
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
