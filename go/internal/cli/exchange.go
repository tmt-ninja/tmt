package cli

import (
	"context"
	"fmt"
	"io"
	"strconv"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
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
	rows := clistyle.NewTable(clistyle.ColumnName, clistyle.ColumnFixed, clistyle.ColumnFixed, clistyle.ColumnFixed, clistyle.ColumnFixed)
	for _, item := range r.Items {
		recipient := "-"
		if item.RecipientIdentityID != nil {
			recipient = clistyle.ShortID(string(*item.RecipientIdentityID))
		}
		delivery := item.MessageState.State
		if item.Urgent {
			delivery += " urgent"
		}
		rows.AddRow(
			clistyle.Cell{Text: string(item.RequestID)},
			clistyle.Cell{Text: recipient, Token: clistyle.TokenDim},
			clistyle.Cell{Text: delivery},
			clistyle.Cell{Text: string(item.Final.Status)},
			clistyle.Cell{Text: "r" + strconv.FormatUint(item.Revision, 10), Token: clistyle.TokenDim},
		)
	}
	count := len(r.Items)
	section := clistyle.ListSection{Title: "exchanges", Count: &count, Rows: rows}
	if r.NextAfter != nil {
		section.Hint = fmt.Sprintf("more with "+flavor.Binary+" x ls --after %d --identity %s", *r.NextAfter, core.CommandWord(r.Identity.CanonicalName))
	}
	return clistyle.WriteList(w, outputTerminal(w), []clistyle.ListSection{section})
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
	e := r.Exchange
	term := outputTerminal(w)
	message := e.MessageState.State
	if reason := e.MessageState.Reason.Text; reason != message {
		message += ": " + reason
	}
	fields := []clistyle.DetailField{
		{Label: "message", Value: message},
		{Label: "urgent", Value: strconv.FormatBool(e.Urgent)},
		{Label: "digest kind", Value: e.DigestKind},
	}
	if e.Mode == "passthrough" {
		fields = append(fields, clistyle.DetailField{Label: "mode", Value: e.Mode})
	}
	fields = append(fields,
		clistyle.DetailField{Label: "final", Value: string(e.Final.Status)},
		clistyle.DetailField{Label: "revision", Value: strconv.FormatUint(e.Revision, 10)},
		clistyle.DetailField{Label: "acknowledged", Value: strconv.FormatBool(e.Acknowledged)},
		clistyle.DetailField{Label: "settled", Value: strconv.FormatBool(e.Settled)},
	)
	if err := clistyle.WriteDetail(w, term, string(e.RequestID), fields); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(w, term.Paint(clistyle.TokenTitle, "PROMPT"), term.Paint(clistyle.TokenDim, e.Prompt.Status)); err != nil {
		return err
	}
	if e.Prompt.Message != nil {
		if _, err := fmt.Fprintln(w, *e.Prompt.Message); err != nil {
			return err
		}
	}
	if e.Final.Response != nil {
		if _, err := fmt.Fprintf(w, "%s\n%s\n", term.Paint(clistyle.TokenTitle, "FINAL"), *e.Final.Response); err != nil {
			return err
		}
	}
	if e.Final.WithdrawnAtMs != nil && e.Final.Reason != nil {
		if _, err := fmt.Fprintf(w, "Withdrawn at %d: %s\n", *e.Final.WithdrawnAtMs, *e.Final.Reason); err != nil {
			return err
		}
	}
	if e.Reply != nil {
		return clistyle.WriteHint(w, term, e.Reply.Command)
	}
	return nil
}

func (app application) exchange(ctx context.Context, inv invocation, selected identitySelection) output.Report {
	action := "ls"
	if len(inv.path) == 2 {
		action = inv.path[1]
	}
	me, _, failure := app.requestIdentities(ctx, selected, nil)
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
				Command: output.ReplyCommand(string(detail.Exchange.RequestID), string(*detail.Receipt)),
			}
		}
		return exchangeShowReport{Identity: identityJSON(me), Exchange: report}
	default:
		return app.mutateExchange(ctx, inv, me, direction)
	}
}
