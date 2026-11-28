package cli

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

type wallClock struct{}

func (wallClock) NowMs() int64 { return time.Now().UnixMilli() }

func (app application) runRequest(ctx context.Context, root home.Root, inv invocation) (report output.Report) {
	var selected identitySelection
	var body string
	var failure *output.Failure
	command := inv.path[0]
	var talk talkPlan
	var sendDelay time.Duration
	switch command {
	case "talk":
		var stop context.CancelFunc
		ctx, stop = signal.NotifyContext(ctx, os.Interrupt)
		defer stop()
		talk, failure = app.prepareTalk(ctx, root, inv)
		if failure != nil {
			return failure
		}

	case "send-now":
		var stop context.CancelFunc
		ctx, stop = signal.NotifyContext(ctx, os.Interrupt)
		defer stop()
		selected, failure = app.caller.selectIdentity(ctx, inv)
		if failure != nil {
			return failure
		}
		settings, err := loadSettings(root)
		if err != nil {
			return talkConfigFailure()
		}
		sendDelay = timerSeconds(settings["pasteEnterDelayMs"].value.(float64) / 1000)

	case "inbox", "answer", "x":
		if command == "x" && len(inv.path) == 2 && (inv.path[1] == "flow" || inv.path[1] == "listen") {
			// NOT PORTED (CLI-21, CLI-22): Content-free flow and inbox listening.
			return &output.Failure{Code: "NOT_PORTED", Message: fmt.Sprintf("Command 'x %s' is not yet ported.", inv.path[1]), Status: 2}
		}
		selected, failure = app.caller.selectIdentity(ctx, inv)
		if failure != nil {
			return failure
		}
	case "reply":
		// Decode the wire shape before acquiring input or opening storage. The
		// service keeps lookup and verification in the acceptance transaction.
		if _, err := core.DecodeReceipt(core.Receipt(inv.options["receipt"]), core.RequestID(inv.operands[0])); err != nil {
			return responseServiceFailure(err)
		}
	}

	switch command {
	case "reply":
		body, failure = responseBody(app.stdin, inv, inv.options["message"])
	case "answer":
		body, failure = responseBody(app.stdin, inv, answerOperands(inv).text)
	}
	if failure != nil {
		return failure
	}

	if app.requests == nil {
		store, err := storage.Open(ctx, root)
		if err != nil {
			return requestOpenFailure(command, err)
		}
		app.store = store
		app.requests = storage.NewRequestService(store, wallClock{})
		defer func() {
			if err := store.Close(); err != nil {
				if _, alreadyFailed := report.(*output.Failure); alreadyFailed {
					return
				}
				failure := &output.Failure{
					Code: "CLEANUP_ERROR", Message: "Could not clean up command resources. Effects may already have occurred.", Status: 1,
				}
				if result, ok := report.(responseReport); ok {
					failure.Request = &output.RequestFailure{RequestID: string(result.RequestID)}
				}
				report = failure
			}
		}()
	}

	switch command {
	case "talk":
		return app.talk(ctx, talk)
	case "send-now":
		return app.sendNow(ctx, root, selected, inv.operands[0], sendDelay)
	case "reply":
		return app.reply(ctx, inv, body)
	case "result":
		return app.result(ctx, inv.operands[0])
	case "x":
		return app.exchange(ctx, inv, selected)
	default:
		return app.incoming(ctx, inv, selected, body)
	}
}

func requestOpenFailure(command string, err error) *output.Failure {
	switch command {
	case "x":
		return exchangeFailure(err)
	case "talk":
		return talkFailure(err)
	case "send-now":
		return sendNowFailure(err)
	case "answer", "inbox":
		return incomingFailure(err)
	default:
		return responseServiceFailure(err)
	}
}
