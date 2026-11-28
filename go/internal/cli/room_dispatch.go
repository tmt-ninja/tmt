package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func (app application) runRoomDispatch(ctx context.Context, root home.Root, inv invocation) (report output.Report) {
	operationID := core.DispatchOperationID(inv.options["operation-id"])
	if !inv.has("operation-id") {
		operationID = core.DispatchOperationID(talkUUID())
	}
	if !operationID.Valid() {
		return bindingFailure("DISPATCH_INVALID", "Operation ID must be a non-nil UUID.", 1)
	}
	settings, err := loadSettings(root)
	if err != nil {
		return bindingFailure("CONFIG_ERROR", "Could not read room dispatch settings.", 1)
	}
	store, err := storage.Open(ctx, root)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			return roomDispatchRetry(identityStorageNotWritable(root, "Nothing was queued."), operationID)
		}
		return roomDispatchFailure(err, operationID)
	}
	defer func() {
		if err := store.Close(); err != nil {
			if failure, failed := report.(*output.Failure); failed {
				report = roomDispatchRetry(failure, operationID)
			} else {
				report = roomDispatchRetry(bindingFailure("CLEANUP_ERROR", "Could not clean up command resources. Effects may already have occurred.", 1), operationID)
			}
		}
	}()
	var room *core.MeetingRoom
	if err := store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		room, err = resolveRoom(tx.Rooms(), inv.operands[0], false)
		return err
	}); err != nil {
		return roomDispatchRetry(roomFailure(err), operationID)
	}
	if len(room.MemberIDs) == 0 {
		return roomDispatchRetry(bindingFailure("ROOM_EMPTY", "Room has no active members; nothing was queued.", 1), operationID)
	}
	originator, failure := app.roomDispatchSender(ctx, store, inv)
	if failure != nil {
		return roomDispatchRetry(failure, operationID)
	}
	kind := core.RequestKindRequest
	if inv.path[1] == "broadcast" {
		kind = core.RequestKindAnnouncement
	}
	var dispatcher ports.RoomDispatcher = storage.NewRequestService(store, wallClock{})
	receipt, err := dispatcher.DispatchRoom(ctx, core.RoomDispatchInput{
		OperationID: operationID, RoomID: room.ID, Revision: room.Revision, RecipientIDs: room.MemberIDs,
		Originator: originator, Kind: kind, Message: inv.operands[1], RetentionDays: settings["exchange.retentionDays"].value.(uint64),
	})
	if err != nil {
		return roomDispatchFailure(err, operationID)
	}
	return roomDispatchReport{receipt}
}

func (app application) roomDispatchSender(ctx context.Context, store ports.Store, inv invocation) (core.Originator, *output.Failure) {
	originator := core.Originator{Kind: core.OriginatorUnknown}
	selected, failure := app.caller.selectIdentity(ctx, inv)
	if failure != nil {
		// Room dispatch is allowed without a sender. A failed caller probe
		// never supplies a sender identity.
		if failure.Code == "IDENTITY_REQUIRED" || failure.Code == "PANE_NOT_FOUND" {
			return originator, nil
		}
		return originator, failure
	}
	err := store.Read(ctx, func(tx ports.StoreTx) error {
		if selected.explicit != nil {
			sender, err := resolveSelectedIdentity(tx, selected)
			if err == nil {
				originator = core.Originator{Kind: core.OriginatorExplicit, IdentityID: &sender.ID}
			}
			return err
		}
		sender, err := verifiedCaller(tx, selected.claim, selected.probe)
		if err == nil && sender != nil {
			originator = core.Originator{Kind: core.OriginatorVerified, IdentityID: &sender.ID}
		}
		return err
	})
	if err != nil {
		var typed *output.Failure
		if errors.As(err, &typed) {
			return originator, typed
		}
		return originator, bindingFailure("IDENTITY_ERROR", "Could not read identity storage.", 1)
	}
	return originator, nil
}

func roomDispatchFailure(err error, operationID core.DispatchOperationID) *output.Failure {
	var typed *core.RequestFailure
	if errors.As(err, &typed) {
		return roomDispatchRetry(responseServiceFailure(typed), operationID)
	}
	return roomDispatchRetry(bindingFailure("STORAGE_UNAVAILABLE",
		"Dispatch could not be confirmed. Do not create a new operation merely to retry.", 1), operationID)
}

func roomDispatchRetry(failure *output.Failure, operationID core.DispatchOperationID) *output.Failure {
	failure.Suggestion = fmt.Sprintf("Retain operation ID %s; retry only the same composition.", operationID)
	return failure
}

type roomDispatchReport struct{ receipt core.DispatchReceipt }

func (r roomDispatchReport) JSON() any                  { return r.receipt }
func (r roomDispatchReport) HumanStream() output.Stream { return output.Stdout }
func (r roomDispatchReport) ExitStatus() int            { return 0 }

func (r roomDispatchReport) Human(w io.Writer) error {
	term := outputTerminal(w)
	rows := clistyle.NewTable(clistyle.ColumnName, clistyle.ColumnFixed, clistyle.ColumnFixed)
	queued, count := 0, len(r.receipt.Items)
	for _, item := range r.receipt.Items {
		state := clistyle.Cell{Token: clistyle.TokenWarn}
		switch item.Acceptance {
		case core.DispatchQueued:
			queued++
			state = clistyle.Cell{Text: "queued"}
		case core.DispatchUnavailable:
			state.Text = "unavailable"
		case core.DispatchRestricted:
			state.Text = "not sent · route"
		case core.DispatchHeld:
			state.Text = "held · needs a person"
		}
		rows.AddRow(clistyle.Cell{Text: clistyle.ShortID(string(item.RecipientID))}, state, clistyle.Cell{Text: string(item.RequestID)})
	}
	message := fmt.Sprintf("Queued for %d of %d recipients (operation %s)", queued, count, clistyle.ShortID(string(r.receipt.OperationID)))
	if err := clistyle.WriteSuccess(w, term, message); err != nil {
		return err
	}
	return clistyle.WriteList(w, term, []clistyle.ListSection{{
		Title: "recipients", Count: &count, Rows: rows,
		Hint: "queued is not completed; inspect each with " + flavor.Binary + " result <request-id>",
	}})
}
