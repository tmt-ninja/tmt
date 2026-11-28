package cli

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

type exchangeFinalDocument struct {
	Status        core.FinalStatus `json:"status"`
	Reason        *string          `json:"reason,omitempty"`
	WithdrawnAtMs *uint64          `json:"withdrawnAtMs,omitempty"`
	SubmittedAtMs *uint64          `json:"submittedAtMs,omitempty"`
	ExpiresAtMs   *uint64          `json:"expiresAtMs,omitempty"`
	BodyBytes     *uint64          `json:"bodyBytes,omitempty"`
	Response      *string          `json:"response,omitempty"`
}

type exchangeItemDocument struct {
	RequestID            core.RequestID        `json:"requestId"`
	Urgent               bool                  `json:"urgent"`
	DigestKind           string                `json:"digestKind"`
	Mode                 string                `json:"mode"`
	RecipientIdentityID  *core.IdentityID      `json:"recipientIdentityId"`
	PreparedAtMs         uint64                `json:"preparedAtMs"`
	Delivery             core.AttemptStatus    `json:"delivery"`
	MessageState         deliveryDocument      `json:"messageState"`
	Final                exchangeFinalDocument `json:"final"`
	Revision             uint64                `json:"revision"`
	Acknowledged         bool                  `json:"acknowledged"`
	Settled              bool                  `json:"settled"`
	RetentionExpiresAtMs uint64                `json:"retentionExpiresAtMs"`
}

func exchangeItemJSON(item core.XItem, detailed bool) exchangeItemDocument {
	final := exchangeFinalDocument{Status: item.Final.Status}
	switch item.Final.Status {
	case core.FinalWithdrawn:
		if item.Final.Withdrawal != nil {
			final.Reason = &item.Final.Withdrawal.Reason
			final.WithdrawnAtMs = &item.Final.Withdrawal.WithdrawnAtMs
		}
	case core.FinalRetained, core.FinalExpired, core.FinalUnavailable:
		final.SubmittedAtMs = item.Final.SubmittedAtMs
		final.ExpiresAtMs = item.Final.ExpiresAtMs
		if item.Final.Status == core.FinalRetained {
			final.BodyBytes = item.Final.BodyBytes
			if detailed {
				final.Response = item.Final.Response
			}
		}
	}
	return exchangeItemDocument{
		RequestID: item.RequestID, Urgent: item.Urgent, DigestKind: item.DigestKind, Mode: item.Mode,
		RecipientIdentityID: item.Recipient, PreparedAtMs: item.PreparedAtMs, Delivery: item.Delivery,
		MessageState: deliveryJSON(item.MessageState), Final: final, Revision: item.Revision,
		Acknowledged: item.Acknowledged, Settled: item.Settled, RetentionExpiresAtMs: item.RetentionExpiresAtMs,
	}
}

type exchangeListReport struct {
	Identity  identityDocument       `json:"identity"`
	Items     []exchangeItemDocument `json:"items"`
	NextAfter *uint64                `json:"nextAfter"`
}

func (r exchangeListReport) JSON() any                  { return r }
func (r exchangeListReport) HumanStream() output.Stream { return output.Stdout }
func (r exchangeListReport) ExitStatus() int            { return 0 }

func (r exchangeListReport) Human(w io.Writer) error {
	if len(r.Items) == 0 {
		_, err := fmt.Fprintln(w, "No unacknowledged exchanges.")
		return err
	}
	var text strings.Builder
	fmt.Fprintf(&text, "unacknowledged exchanges (%d)\n", len(r.Items))
	for _, item := range r.Items {
		fmt.Fprintf(&text, "  %s  %s  %s  %d\n", item.RequestID, item.Delivery, item.Final.Status, item.Revision)
	}
	if r.NextAfter != nil {
		fmt.Fprintf(&text, "hint: more with tmt-go x ls --after %d --identity %s\n", *r.NextAfter, r.Identity.ID)
	}
	_, err := io.WriteString(w, text.String())
	return err
}

type exchangePromptDocument struct {
	Status       string  `json:"status"`
	Message      *string `json:"message,omitempty"`
	MessageBytes *int    `json:"messageBytes,omitempty"`
	ExpiresAtMs  *uint64 `json:"expiresAtMs,omitempty"`
}

func exchangePromptJSON(detail core.XDetail) exchangePromptDocument {
	if detail.Prompt != nil {
		size := len(*detail.Prompt)
		return exchangePromptDocument{
			Status: "retained", Message: detail.Prompt, MessageBytes: &size, ExpiresAtMs: detail.PromptExpiresAtMs,
		}
	}
	if detail.PromptExpiresAtMs != nil {
		return exchangePromptDocument{Status: "expired", ExpiresAtMs: detail.PromptExpiresAtMs}
	}
	return exchangePromptDocument{Status: "unavailable"}
}

type exchangeReplyDocument struct {
	Receipt core.Receipt `json:"receipt"`
	Command string       `json:"command"`
}

type exchangeDetailDocument struct {
	exchangeItemDocument
	Prompt exchangePromptDocument `json:"prompt"`
	Reply  *exchangeReplyDocument `json:"reply,omitempty"`
}

type exchangeShowReport struct {
	Identity identityDocument       `json:"identity"`
	Exchange exchangeDetailDocument `json:"exchange"`
}

func (r exchangeShowReport) JSON() any                  { return r }
func (r exchangeShowReport) HumanStream() output.Stream { return output.Stdout }
func (r exchangeShowReport) ExitStatus() int            { return 0 }

func (r exchangeShowReport) Human(w io.Writer) error {
	var text strings.Builder
	e := r.Exchange
	fmt.Fprintf(&text, "%s\nmessage: %q\nurgent: %t\ndigest kind: %s\n", e.RequestID, e.MessageState.Reason.Text, e.Urgent, e.DigestKind)
	if e.Mode == "passthrough" {
		fmt.Fprintf(&text, "mode: %s\n", e.Mode)
	}
	fmt.Fprintf(&text, "final: %s\nrevision: %d\nacknowledged: %t\nsettled: %t\nPROMPT %s\n",
		e.Final.Status, e.Revision, e.Acknowledged, e.Settled, e.Prompt.Status)
	if e.Prompt.Message != nil {
		fmt.Fprintln(&text, *e.Prompt.Message)
	}
	if e.Final.Response != nil {
		fmt.Fprintf(&text, "FINAL\n%s\n", *e.Final.Response)
	}
	if e.Final.WithdrawnAtMs != nil && e.Final.Reason != nil {
		fmt.Fprintf(&text, "Withdrawn at %d: %q\n", *e.Final.WithdrawnAtMs, *e.Final.Reason)
	}
	if e.Reply != nil {
		fmt.Fprintln(&text, "hint: "+e.Reply.Command)
	}
	_, err := io.WriteString(w, text.String())
	return err
}

func (app application) exchange(ctx context.Context, inv invocation) output.Report {
	action := "ls"
	if len(inv.path) == 2 {
		action = inv.path[1]
	}
	if action == "flow" || action == "listen" {
		// NOT PORTED (#6938): content-free flow and inbox listen are outside the initial service.
		return &output.Failure{Code: "NOT_PORTED", Message: fmt.Sprintf("Command 'x %s' is not yet ported.", action), Status: 2}
	}
	if !inv.has("identity") {
		// NOT PORTED (#6938): implicit verified caller selection for X.
		return identityRequired()
	}
	me, _, failure := app.requestIdentities(ctx, inv.options["identity"], nil)
	if failure != nil {
		return failure
	}
	direction := core.XOutgoing
	if inv.has("incoming") {
		direction = core.XIncoming
	}
	switch action {
	case "ls":
		limit, _ := optionalDecimal(inv, "limit", 1, 200)
		after, _ := optionalDecimal(inv, "after", 0, core.MaxJSSafeInteger)
		page, err := app.requests.ListX(ctx, core.XQuery{Identity: me.ID, Direction: direction, After: after, Limit: limit})
		if err != nil {
			return exchangeFailure(err)
		}
		items := make([]exchangeItemDocument, 0, len(page.Items))
		for _, item := range page.Items {
			items = append(items, exchangeItemJSON(item, false))
		}
		return exchangeListReport{Identity: identityJSON(me), Items: items, NextAfter: page.NextAfter}
	case "show":
		detail, err := app.requests.ShowX(ctx, me.ID, direction, core.RequestID(inv.operands[0]))
		if err != nil {
			return exchangeFailure(err)
		}
		report := exchangeDetailDocument{
			exchangeItemDocument: exchangeItemJSON(detail.Exchange, true),
			Prompt:               exchangePromptJSON(detail),
		}
		if direction == core.XIncoming && detail.Receipt != nil {
			report.Reply = &exchangeReplyDocument{
				Receipt: *detail.Receipt,
				Command: fmt.Sprintf("tmt-go reply %s --receipt %s --message <text>", detail.Exchange.RequestID, *detail.Receipt),
			}
		}
		return exchangeShowReport{Identity: identityJSON(me), Exchange: report}
	default:
		return app.mutateExchange(ctx, inv, me, direction)
	}
}
