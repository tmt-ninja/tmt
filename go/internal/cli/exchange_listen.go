package cli

import (
	"context"
	"fmt"
	"io"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type listenTiming struct {
	timeout, debounce time.Duration
	observed          uint64
	quietSince        time.Duration
	quiet             bool
}

func (timing *listenTiming) step(elapsed time.Duration, watermark uint64) (delay time.Duration, finished bool) {
	switch {
	case watermark == 0:
		timing.quiet = false
	case watermark > timing.observed:
		timing.observed, timing.quietSince, timing.quiet = watermark, elapsed, true
	}
	remaining := timing.timeout - elapsed
	if timing.quiet {
		remaining = min(remaining, timing.debounce-(elapsed-timing.quietSince))
	}
	return min(remaining, 250*time.Millisecond), remaining <= 0
}

func listenDuration(inv invocation, option string, fallback time.Duration) time.Duration {
	if !inv.has(option) {
		return fallback
	}
	seconds, _ := durationSeconds(inv.options[option])
	return time.Duration(seconds * float64(time.Second))
}

func (app application) listenX(ctx context.Context, inv invocation, selected identitySelection, started time.Time) output.Report {
	identity, _, failure := app.requestIdentities(ctx, selected, nil)
	if failure != nil {
		return failure
	}
	observer, ok := app.requests.(ports.IncomingXObserver)
	if !ok {
		return bindingFailure("X_ERROR", "Could not complete the exchange operation.", 1)
	}
	query := core.XQuery{Identity: identity.ID, Direction: core.XIncoming}
	if inv.has("room") {
		if err := app.store.Read(ctx, func(tx ports.StoreTx) error {
			room, err := resolveRoom(tx.Rooms(), inv.options["room"], true)
			if err == nil {
				query.RoomID = &room.ID
			}
			return err
		}); err != nil {
			return roomFailure(err)
		}
	}
	timing := listenTiming{
		timeout: listenDuration(inv, "timeout", 15*time.Minute), debounce: listenDuration(inv, "debounce", 10*time.Second),
	}
	interrupted := func() *output.Failure {
		return bindingFailure("INTERRUPTED", "Interrupted while listening for incoming activity.", 1)
	}
	for {
		if ctx.Err() != nil {
			return interrupted()
		}
		var current *core.Identity
		if err := app.store.Read(ctx, func(tx ports.StoreTx) error {
			var err error
			current, err = tx.Identities().FindByID(identity.ID)
			return err
		}); err != nil {
			if ctx.Err() != nil {
				return interrupted()
			}
			return exchangeFailure(err)
		}
		if current == nil {
			return bindingFailure("IDENTITY_RETIRED", "The selected identity was retired while listening.", 3)
		}
		watermark, err := observer.IncomingXWatermark(ctx, identity.ID, query.RoomID)
		if ctx.Err() != nil {
			return interrupted()
		}
		if err != nil {
			return exchangeFailure(err)
		}
		delay, finished := timing.step(time.Since(started), watermark)
		if finished {
			return app.listenXPage(ctx, identity, query)
		}
		if !waitForTalkTimer(ctx, delay) {
			return interrupted()
		}
	}
}

func (app application) listenXPage(ctx context.Context, identity *core.Identity, query core.XQuery) output.Report {
	page, err := app.requests.ListX(ctx, query)
	if err != nil {
		return exchangeFailure(err)
	}
	identities := make(map[core.IdentityID]*core.Identity)
	if len(page.Items) != 0 {
		if err := app.store.Read(ctx, func(tx ports.StoreTx) error {
			for _, item := range page.Items {
				for _, id := range []*core.IdentityID{item.Sender, item.Recipient} {
					if id == nil {
						continue
					}
					if _, alreadyRead := identities[*id]; alreadyRead {
						continue
					}
					found, err := tx.Identities().FindByID(*id)
					if err != nil {
						return err
					}
					identities[*id] = found
				}
			}
			return nil
		}); err != nil {
			return exchangeFailure(err)
		}
	}
	report := listenReport{Reason: "timeout", IdentityID: identity.ID, Items: make([]listenItem, 0, len(page.Items)), NextAfter: page.NextAfter}
	for _, item := range page.Items {
		report.Reason = "messages"
		target := string(item.RequestID)
		if item.Kind != core.XResponse {
			target += " --incoming"
		}
		selector := " --identity " + core.CommandWord(string(identity.CanonicalName))
		report.Items = append(report.Items, listenItem{
			RequestID: item.RequestID, RoomID: item.RoomID, Revision: item.Revision, Kind: item.Kind, Direction: core.XIncoming,
			Sender: listenParticipant(item.Sender, identities), Recipient: listenParticipant(item.Recipient, identities),
			PreparedAtMs: item.PreparedAtMs, Delivery: item.Delivery, MessageState: deliveryJSON(item.MessageState),
			FinalStatus: item.Final.Status, Acknowledged: item.Acknowledged, Settled: item.Settled,
			RetentionExpiresAtMs: item.RetentionExpiresAtMs,
			InspectCommand:       flavor.Binary + " x show " + target + selector,
			AckCommand:           fmt.Sprintf("%s x ack %s --revision %d%s", flavor.Binary, target, item.Revision, selector),
		})
	}
	return report
}

type listenParty struct {
	IdentityID    core.IdentityID `json:"identityId"`
	Name          core.Name       `json:"name,omitempty"`
	CanonicalName string          `json:"canonicalName,omitempty"`
	Lifetime      core.Lifetime   `json:"lifetime,omitempty"`
}

func listenParticipant(id *core.IdentityID, identities map[core.IdentityID]*core.Identity) *listenParty {
	if id == nil {
		return nil
	}
	if identity := identities[*id]; identity != nil {
		return &listenParty{identity.ID, identity.Name, identity.CanonicalName, identity.Lifetime}
	}
	// NOT PORTED (CLI-22): Historical names of retired participants.
	return &listenParty{IdentityID: *id}
}

type listenItem struct {
	RequestID            core.RequestID     `json:"requestId"`
	RoomID               *core.RoomID       `json:"roomId,omitempty"`
	Revision             uint64             `json:"revision"`
	Kind                 core.XKind         `json:"kind"`
	Direction            core.XDirection    `json:"direction"`
	Sender               *listenParty       `json:"sender"`
	Recipient            *listenParty       `json:"recipient"`
	PreparedAtMs         uint64             `json:"preparedAtMs"`
	Delivery             core.AttemptStatus `json:"delivery"`
	MessageState         deliveryDocument   `json:"messageState"`
	FinalStatus          core.FinalStatus   `json:"finalStatus"`
	Acknowledged         bool               `json:"acknowledged"`
	Settled              bool               `json:"settled"`
	RetentionExpiresAtMs uint64             `json:"retentionExpiresAtMs"`
	InspectCommand       string             `json:"inspectCommand"`
	AckCommand           string             `json:"ackCommand"`
}

type listenReport struct {
	Reason     string          `json:"reason"`
	IdentityID core.IdentityID `json:"identityId"`
	Items      []listenItem    `json:"items"`
	NextAfter  *uint64         `json:"nextAfter"`
}

func (r listenReport) JSON() any                  { return r }
func (r listenReport) HumanStream() output.Stream { return output.Stdout }
func (r listenReport) ExitStatus() int            { return 0 }

func (r listenReport) Human(w io.Writer) error {
	count := len(r.Items)
	if count == 0 {
		_, err := fmt.Fprintln(w, "No incoming messages before the listener timeout.")
		return err
	}
	name := func(party *listenParty) string {
		if party != nil && party.Name != "" {
			return string(party.Name)
		}
		return "-"
	}
	term := outputTerminal(w)
	rows := clistyle.NewTable(clistyle.ColumnFixed, clistyle.ColumnName, clistyle.ColumnDetail, clistyle.ColumnFixed, clistyle.ColumnFixed)
	for _, item := range r.Items {
		rows.AddRow(clistyle.Cell{Text: string(item.Kind)}, clistyle.Cell{Text: string(item.RequestID)},
			clistyle.Cell{Text: name(item.Sender) + " → " + name(item.Recipient)},
			clistyle.Cell{Text: item.MessageState.State}, clistyle.Cell{Text: string(item.FinalStatus)})
	}
	section := clistyle.ListSection{Title: "incoming", Count: &count, Rows: rows}
	if r.NextAfter != nil {
		section.Note = "More incoming work remains; acknowledge handled items and listen again."
	}
	if err := clistyle.WriteList(w, term, []clistyle.ListSection{section}); err != nil {
		return err
	}
	for _, item := range r.Items {
		if err := clistyle.WriteHint(w, term, item.InspectCommand+", then "+item.AckCommand); err != nil {
			return err
		}
	}
	return nil
}
