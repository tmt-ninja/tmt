package cli

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type identityDocument struct {
	ID            core.IdentityID `json:"id"`
	Name          core.Name       `json:"name"`
	CanonicalName string          `json:"canonicalName"`
	Lifetime      core.Lifetime   `json:"lifetime"`
}

func identityJSON(identity *core.Identity) identityDocument {
	return identityDocument{
		ID: identity.ID, Name: identity.Name, CanonicalName: identity.CanonicalName, Lifetime: identity.Lifetime,
	}
}

type partyDocument struct {
	IdentityID    core.IdentityID `json:"identityId"`
	Name          *core.Name      `json:"name"`
	CanonicalName *string         `json:"canonicalName"`
}

type deliveryReason struct {
	Code string `json:"code"`
	Text string `json:"text"`
}

type deliveryDocument struct {
	State       string         `json:"state"`
	Reason      deliveryReason `json:"reason"`
	LatestMs    *uint64        `json:"latestMs"`
	RemainingMs *uint64        `json:"remainingMs"`
	CanSendNow  bool           `json:"canSendNow"`
}

func deliveryJSON(view core.DeliveryView) deliveryDocument {
	return deliveryDocument{
		State: view.State, Reason: deliveryReason{Code: view.Reason, Text: view.ReasonText},
		LatestMs: view.LatestMs, RemainingMs: view.RemainingMs, CanSendNow: view.CanSendNow,
	}
}

type inboxItemDocument struct {
	RequestID    core.RequestID     `json:"requestId"`
	From         *partyDocument     `json:"from"`
	PreparedAtMs uint64             `json:"preparedAtMs"`
	Delivery     core.AttemptStatus `json:"delivery"`
	MessageState deliveryDocument   `json:"messageState"`
	Preview      *string            `json:"preview"`
}

type inboxReport struct {
	Identity identityDocument    `json:"identity"`
	Items    []inboxItemDocument `json:"items"`
	More     bool                `json:"more"`
}

func (r inboxReport) JSON() any                  { return r }
func (r inboxReport) HumanStream() output.Stream { return output.Stdout }
func (r inboxReport) ExitStatus() int            { return 0 }

func (r inboxReport) Human(w io.Writer) error {
	if len(r.Items) == 0 {
		_, err := fmt.Fprintln(w, "Nothing is waiting on you.")
		return err
	}
	now := time.Now()
	rows := clistyle.NewTable(clistyle.ColumnFixed, clistyle.ColumnFixed, clistyle.ColumnFixed, clistyle.ColumnDetail)
	for _, item := range r.Items {
		preview := "(prompt no longer retained)"
		if item.Preview != nil && *item.Preview != "" {
			line, _, found := strings.Cut(*item.Preview, "\n")
			preview = line
			if found {
				preview = strings.TrimSuffix(preview, "\r")
			}
		}
		elapsed := now.Sub(time.UnixMilli(int64(item.PreparedAtMs)))
		rows.AddRow(
			clistyle.Cell{Text: partyName(item.From, "anonymous")},
			clistyle.Cell{Text: clistyle.RelativeTime(elapsed), Token: clistyle.TokenDim},
			clistyle.Cell{Text: string(item.RequestID), Token: clistyle.TokenDim},
			clistyle.Cell{Text: preview},
		)
	}
	count := len(r.Items)
	section := clistyle.ListSection{Title: "waiting on you", Count: &count, Rows: rows, Hint: "tmt-go answer <name> \"…\""}
	if r.More {
		section.Note = "newer requests not shown; raise --limit"
	}
	return clistyle.WriteList(w, outputTerminal(w), []clistyle.ListSection{section})
}

type answerReport struct {
	Identity      identityDocument `json:"identity"`
	Status        string           `json:"status"`
	RequestID     core.RequestID   `json:"requestId"`
	From          *partyDocument   `json:"from"`
	BodyBytes     uint64           `json:"bodyBytes"`
	SubmittedAtMs uint64           `json:"submittedAtMs"`
}

func (r answerReport) JSON() any                  { return r }
func (r answerReport) HumanStream() output.Stream { return output.Stdout }
func (r answerReport) ExitStatus() int            { return 0 }

func (r answerReport) Human(w io.Writer) error {
	return success(w, fmt.Sprintf("Answered %s (%s)", partyName(r.From, "an anonymous sender"), r.RequestID))
}

func partyName(party *partyDocument, fallback string) string {
	if party == nil || party.CanonicalName == nil {
		return fallback
	}
	return *party.CanonicalName
}

type answerArguments struct {
	from    *string
	request *core.RequestID
	text    string
	inline  bool
}

func answerOperands(inv invocation) answerArguments {
	var args answerArguments
	if inv.has("request") {
		request := core.RequestID(inv.options["request"])
		args.request = &request
	}
	switch len(inv.operands) {
	case 1:
		if args.request != nil && !inv.has("file") && !inv.has("stdin") {
			args.text, args.inline = inv.operands[0], true
		} else {
			args.from = &inv.operands[0]
		}
	case 2:
		args.from = &inv.operands[0]
		args.text, args.inline = inv.operands[1], true
	}
	return args
}

func (app application) incoming(ctx context.Context, inv invocation, selected identitySelection, body string) output.Report {
	if inv.path[0] == "answer" {
		args := answerOperands(inv)
		me, from, failure := app.requestIdentities(ctx, selected, args.from)
		if failure != nil {
			return failure
		}
		return app.answer(ctx, me, from, args.request, body)
	}
	var sender *string
	if inv.has("from") {
		name := inv.options["from"]
		sender = &name
	}
	me, from, failure := app.requestIdentities(ctx, selected, sender)
	if failure != nil {
		return failure
	}
	limit, _ := optionalDecimal(inv, "limit", 1, 200)
	return app.inbox(ctx, me, from, limit)
}

func (app application) requestIdentities(ctx context.Context, selected identitySelection, sender *string) (me, from *core.Identity, failure *output.Failure) {
	err := app.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		if selected.explicit != nil {
			me, err = core.ResolveIdentity(tx.Identities(), *selected.explicit)
		} else {
			me, err = verifiedCaller(tx, selected.claim, selected.probe)
		}
		if err != nil || me == nil || sender == nil {
			return err
		}
		from, err = core.ResolveIdentity(tx.Identities(), *sender)
		return err
	})
	switch {
	case err != nil:
		return nil, nil, &output.Failure{Code: "IDENTITY_ERROR", Message: "Could not read identity storage.", Status: 1}
	case me == nil:
		if selected.explicit == nil {
			return nil, nil, identityRequired()
		}
		return nil, nil, identityMissing(*selected.explicit)
	case sender != nil && from == nil:
		return nil, nil, identityMissing(*sender)
	}
	return me, from, nil
}

func identityRequired() *output.Failure {
	return &output.Failure{Code: "IDENTITY_REQUIRED", Message: "An identity is required; use --identity or run from a verified bound pane.", Status: 1}
}

func identityMissing(selector string) *output.Failure {
	return &output.Failure{Code: "NAME_NOT_FOUND", Message: fmt.Sprintf("Identity '%s' was not found.", selector), Status: 3}
}

func identityID(identity *core.Identity) *core.IdentityID {
	if identity == nil {
		return nil
	}
	return &identity.ID
}

func readParty(records core.IdentityReader, id core.IdentityID) (*partyDocument, error) {
	found, err := records.FindByID(id)
	if err != nil || found == nil {
		return nil, err
	}
	return &partyDocument{IdentityID: id, Name: &found.Name, CanonicalName: &found.CanonicalName}, nil
}

func (app application) inbox(ctx context.Context, me, from *core.Identity, limit uint64) output.Report {
	page, err := app.requests.Inbox(ctx, core.InboxQuery{Recipient: me.ID, Originator: identityID(from), Limit: limit})
	if err != nil {
		return incomingFailure(err)
	}
	items := make([]inboxItemDocument, 0, len(page.Items))
	parties := make(map[core.IdentityID]*partyDocument)
	if err := app.store.Read(ctx, func(tx ports.StoreTx) error {
		for _, item := range page.Items {
			var sender *partyDocument
			if id := item.Originator.IdentityID; id != nil {
				var known bool
				sender, known = parties[*id]
				if !known {
					var err error
					sender, err = readParty(tx.Identities(), *id)
					if err != nil {
						return err
					}
					if sender == nil {
						sender = &partyDocument{IdentityID: *id}
					}
					parties[*id] = sender
				}
			}
			items = append(items, inboxItemDocument{
				RequestID: item.RequestID, From: sender, PreparedAtMs: item.PreparedAtMs,
				Delivery: item.Delivery, MessageState: deliveryJSON(item.MessageState), Preview: item.Preview,
			})
		}
		return nil
	}); err != nil {
		return incomingFailure(err)
	}
	return inboxReport{Identity: identityJSON(me), Items: items, More: page.More}
}

func (app application) answer(ctx context.Context, me, from *core.Identity, id *core.RequestID, body string) output.Report {
	result, err := app.requests.Answer(ctx, core.AnswerRequest{
		Recipient: me.ID, Originator: identityID(from), RequestID: id, Body: body,
	})
	if err != nil {
		return responseServiceFailure(err)
	}
	// NOT PORTED (CLI-19): Best-effort reply notifications after acceptance.
	var sender *partyDocument
	if from != nil {
		sender = &partyDocument{IdentityID: from.ID, Name: &from.Name, CanonicalName: &from.CanonicalName}
	} else if originator := result.Originator.IdentityID; originator != nil {
		// The final is already accepted. Failure to look up a display name
		// must never turn acceptance into an instruction to submit again.
		_ = app.store.Read(ctx, func(tx ports.StoreTx) error {
			party, err := readParty(tx.Identities(), *originator)
			if err == nil && party != nil {
				sender = party
			}
			return err
		})
	}
	return answerReport{
		Identity: identityJSON(me), Status: "submitted", From: sender,
		RequestID: result.Final.RequestID, BodyBytes: result.Final.BodyBytes, SubmittedAtMs: result.Final.SubmittedAtMs,
	}
}

func incomingFailure(err error) *output.Failure {
	failure := responseServiceFailure(err)
	if failure.Code == "RESPONSE_ERROR" {
		return &output.Failure{Code: "ANSWER_ERROR", Message: "Could not read or answer requests.", Status: 1}
	}
	return failure
}
