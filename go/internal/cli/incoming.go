package cli

import (
	"context"
	"fmt"
	"io"
	"strings"

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
	var text strings.Builder
	fmt.Fprintf(&text, "waiting on you (%d)\n", len(r.Items))
	for _, item := range r.Items {
		preview := "(prompt no longer retained)"
		if item.Preview != nil {
			preview, _, _ = strings.Cut(*item.Preview, "\n")
		}
		fmt.Fprintf(&text, "  %q  %s  %q\n", partyName(item.From, "anonymous"), item.RequestID, preview)
	}
	if r.More {
		fmt.Fprintln(&text, "newer requests not shown; raise --limit")
	}
	fmt.Fprintln(&text, "hint: tmt-go answer <name> \"…\"")
	_, err := io.WriteString(w, text.String())
	return err
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
	_, err := fmt.Fprintf(w, "✓ Answered %s (%s)\n", partyName(r.From, "an anonymous sender"), r.RequestID)
	return err
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

func (app application) incoming(ctx context.Context, inv invocation) output.Report {
	if !inv.has("identity") {
		// NOT PORTED (#6938): select the implicit caller using a verified live binding.
		return identityRequired()
	}
	selector := inv.options["identity"]
	if inv.path[0] == "answer" {
		args := answerOperands(inv)
		body, failure := responseBody(app.stdin, inv, args.text)
		if failure != nil {
			return failure
		}
		me, from, failure := app.requestIdentities(ctx, selector, args.from)
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
	me, from, failure := app.requestIdentities(ctx, selector, sender)
	if failure != nil {
		return failure
	}
	limit, _ := optionalDecimal(inv, "limit", 1, 200)
	return app.inbox(ctx, me, from, limit)
}

func (app application) requestIdentities(ctx context.Context, selector string, sender *string) (me, from *core.Identity, failure *output.Failure) {
	err := app.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		me, err = core.ResolveIdentity(tx.Identities(), selector)
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
		return nil, nil, identityMissing(selector)
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
	// NOT PORTED (#6938): best-effort reply notifications after acceptance.
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
