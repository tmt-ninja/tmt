package storage

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type requestClock struct{ ms int64 }

func (c *requestClock) NowMs() int64 { return c.ms }

func seedRequestService(t *testing.T) (*Storage, *RequestService, *requestClock) {
	t.Helper()
	store := testStorage(t)
	clock := &requestClock{ms: 10_000}
	if err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		for _, id := range []core.IdentityID{"sender", "receiver", "other"} {
			if err := tx.Identities().Insert(core.Identity{
				ID: id, Name: core.Name(id), CanonicalName: string(id), Lifetime: core.LifetimeSaved,
			}, uint64(clock.ms)); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return store, NewRequestService(store, clock), clock
}

func inboxRequest(id core.RequestID) core.PrepareRequest {
	from, to := core.IdentityID("sender"), core.IdentityID("receiver")
	return core.PrepareRequest{
		RequestID: id, AttemptID: core.AttemptID("a_" + string(id)), Kind: core.RequestKindRequest,
		Origin: core.RequestOriginPerson, Originator: core.Originator{Kind: core.OriginatorExplicit, IdentityID: &from},
		Route: core.RequestRoute{Kind: core.RequestRouteInbox, Recipient: &to}, Recipient: &to,
		Message: "prompt 😺\x00\r\n ", ExpiresAtMs: 11_000, RetentionDays: 1, Wait: true,
	}
}

func paneRequest(id core.RequestID) core.PrepareRequest {
	in := inboxRequest(id)
	in.Route = core.RequestRoute{Kind: core.RequestRoutePane, Pane: &core.RequestEndpoint{
		Server: core.ServerEvidence{Host: "tmux", ID: "server", Socket: "/tmp/fixture.sock", PID: 123, StartTime: "start"},
		PaneID: "%42", PanePID: 456,
	}}
	return in
}

func requireRequestFailure(t *testing.T, err error, code string, status int) *core.RequestFailure {
	t.Helper()
	var failure *core.RequestFailure
	if !errors.As(err, &failure) || failure.Code != code || failure.Status != status {
		t.Fatalf("request failure = %+v (%v), want %s (%d)", failure, err, code, status)
	}
	return failure
}

func TestRequestServiceKeepsLateFinalUnread(t *testing.T) {
	parallelStorageFixture(t)
	store, service, clock := seedRequestService(t)
	ctx := t.Context()
	in := inboxRequest("req_abcdef01-0000-4000-8000-000000000001")
	prepared, err := service.Enqueue(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	out, err := service.ListX(ctx, core.XQuery{Identity: "sender", Direction: core.XOutgoing})
	if err != nil || len(out.Items) != 1 || out.Items[0].Delivery != core.AttemptQueued {
		t.Fatalf("outgoing = %+v, %v", out, err)
	}
	original := out.Items[0].Revision
	incoming, err := service.ShowX(ctx, "receiver", core.XIncoming, in.RequestID)
	if err != nil || incoming.Prompt == nil || *incoming.Prompt != in.Message ||
		incoming.Receipt == nil || *incoming.Receipt != prepared.Receipt || incoming.PromptExpiresAtMs == nil ||
		incoming.Exchange.Mode != "request" || incoming.Exchange.DigestKind != "fyi" || incoming.Exchange.Urgent {
		t.Fatalf("incoming detail = %+v, %v", incoming, err)
	}
	ack, err := service.AckX(ctx, "receiver", core.XIncoming, in.RequestID, incoming.Exchange.Revision)
	if err != nil || !ack.Changed {
		t.Fatalf("incoming ack = %+v, %v", ack, err)
	}
	inbox, err := service.Inbox(ctx, core.InboxQuery{Recipient: "receiver"})
	if err != nil || len(inbox.Items) != 1 || inbox.Items[0].Preview == nil || *inbox.Items[0].Preview != in.Message {
		t.Fatalf("acknowledging incoming removed the open request: %+v, %v", inbox, err)
	}
	through, err := service.AckAllX(ctx, "sender", core.XOutgoing)
	if err != nil || through != original {
		t.Fatalf("outgoing ackall = %d, %v", through, err)
	}
	clock.ms += int64(core.RequestMinExpiryMs) + 10
	if err := service.ReleaseWait(ctx, prepared.AttemptID); err != nil {
		t.Fatal(err)
	}
	body := " exact 🔎\x00\r\n "
	final, err := service.SubmitResponse(ctx, core.SubmitResponse{RequestID: in.RequestID, Receipt: prepared.Receipt, Body: body})
	if err != nil || final.Body != body || final.BodyBytes != uint64(len(body)) || final.SubmittedAtMs != uint64(clock.ms) {
		t.Fatalf("late final = %+v, %v", final, err)
	}
	resolved, result, err := service.ResultByPrefix(ctx, "ABCDEF01")
	if err != nil || resolved != in.RequestID || result.Status != core.ResponseAvailable || result.Final == nil || result.Final.Body != body {
		t.Fatalf("result = %q, %+v, %v", resolved, result, err)
	}
	out, err = service.ListX(ctx, core.XQuery{Identity: "sender", Direction: core.XOutgoing})
	if err != nil || len(out.Items) != 1 || out.Items[0].Revision <= original || out.Items[0].Acknowledged ||
		out.Items[0].Final.Status != core.FinalRetained || out.Items[0].Final.Response != nil {
		t.Fatalf("late final must be unread and metadata-only in list: %+v, %v", out, err)
	}
	_, err = service.AckX(ctx, "sender", core.XOutgoing, in.RequestID, original)
	requireRequestFailure(t, err, "X_REVISION_CONFLICT", 5)
	notices, err := service.ListX(ctx, core.XQuery{Identity: "sender", Direction: core.XIncoming})
	if err != nil || len(notices.Items) != 1 || notices.Items[0].Kind != core.XResponse ||
		notices.Items[0].Sender == nil || *notices.Items[0].Sender != "receiver" {
		t.Fatalf("incoming reply notice = %+v, %v", notices, err)
	}
	clock.ms++
	repeated, err := service.SubmitResponse(ctx, core.SubmitResponse{RequestID: in.RequestID, Receipt: prepared.Receipt, Body: body})
	if err != nil || repeated.SubmittedAtMs != final.SubmittedAtMs {
		t.Fatalf("identical retry changed final: %+v, %v", repeated, err)
	}
	detail, err := service.ShowX(ctx, "sender", core.XOutgoing, in.RequestID)
	if err != nil || detail.Exchange.Revision != out.Items[0].Revision || detail.Exchange.Final.Response == nil ||
		*detail.Exchange.Final.Response != body || detail.Exchange.Acknowledged {
		t.Fatalf("identical retry or read changed attention: %+v, %v", detail, err)
	}
	if err := store.Read(ctx, func(tx ports.StoreTx) error {
		a, err := tx.Requests().FindByID(in.RequestID)
		if err == nil && (a == nil || a.WaitActive || a.ResponseSubmittedAtMs == nil) {
			t.Fatalf("durable final marker and release missing: %+v", a)
		}
		return err
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRequestServiceNativeReplyRejections(t *testing.T) {
	parallelStorageFixture(t)
	_, service, clock := seedRequestService(t)
	ctx := t.Context()
	prepared, err := service.Prepare(ctx, paneRequest("live"))
	if err != nil {
		t.Fatal(err)
	}
	in := core.SubmitResponse{RequestID: prepared.RequestID, Receipt: prepared.Receipt, Body: "final"}
	_, err = service.SubmitResponse(ctx, core.SubmitResponse{RequestID: "live", Receipt: "broken"})
	requireRequestFailure(t, err, "RESPONSE_RECEIPT_INVALID", 1)
	_, err = service.SubmitResponse(ctx, core.SubmitResponse{RequestID: "unknown", Receipt: prepared.Receipt})
	requireRequestFailure(t, err, "RESPONSE_REQUEST_NOT_FOUND", 3)
	wrong := core.EncodeReceipt(in.RequestID, "wrong-attempt", paneRequest("live").Route)
	_, err = service.SubmitResponse(ctx, core.SubmitResponse{RequestID: "live", Receipt: wrong})
	requireRequestFailure(t, err, "RESPONSE_RECEIPT_MISMATCH", 1)
	_, err = service.SubmitResponse(ctx, in)
	requireRequestFailure(t, err, "RESPONSE_STATE_INVALID", 1)
	if err := service.BeginSend(ctx, prepared.AttemptID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SubmitResponse(ctx, in); err != nil {
		t.Fatal(err)
	}
	in.Body = "conflict"
	_, err = service.SubmitResponse(ctx, in)
	requireRequestFailure(t, err, "RESPONSE_CONFLICT", 5)
	_, err = service.Withdraw(ctx, "sender", in.RequestID, "late")
	requireRequestFailure(t, err, "REQUEST_ALREADY_FINAL", 5)
	clock.ms += int64(core.RetentionDayMs)
	_, err = service.SubmitResponse(ctx, in)
	requireRequestFailure(t, err, "RESPONSE_EXPIRED", 1)

	announcement := inboxRequest("announcement")
	announcement.Kind, announcement.Wait = core.RequestKindAnnouncement, false
	prepared, err = service.Enqueue(ctx, announcement)
	if err != nil || prepared.Receipt != "" {
		t.Fatalf("announcement returned a receipt: %+v, %v", prepared, err)
	}
	receipt := core.EncodeReceipt(announcement.RequestID, announcement.AttemptID, announcement.Route)
	_, err = service.SubmitResponse(ctx, core.SubmitResponse{RequestID: announcement.RequestID, Receipt: receipt})
	requireRequestFailure(t, err, "RESPONSE_NOT_REQUIRED", 1)

	queued, err := service.Enqueue(ctx, inboxRequest("withdraw"))
	if err != nil {
		t.Fatal(err)
	}
	withdrawal, err := service.Withdraw(ctx, "sender", queued.RequestID, " obsolete \n")
	if err != nil || !withdrawal.Changed || withdrawal.Withdrawal.Reason != " obsolete \n" {
		t.Fatalf("withdraw = %+v, %v", withdrawal, err)
	}
	_, err = service.SubmitResponse(ctx, core.SubmitResponse{RequestID: queued.RequestID, Receipt: queued.Receipt})
	requireRequestFailure(t, err, "REQUEST_WITHDRAWN", 5)
	result, err := service.Result(ctx, queued.RequestID)
	if err != nil || result.Status != core.ResponseWithdrawn || result.Withdrawal == nil || *result.Withdrawal != withdrawal.Withdrawal {
		t.Fatalf("withdrawn result = %+v, %v", result, err)
	}
}

func TestResultPrefixUsesNativeBoundsAndBoundedAmbiguity(t *testing.T) {
	parallelStorageFixture(t)
	_, service, _ := seedRequestService(t)
	ctx := t.Context()
	for i := range 7 {
		id := core.RequestID(fmt.Sprintf("req_12345678-0000-4000-8000-%012d", i))
		if _, err := service.Prepare(ctx, paneRequest(id)); err != nil {
			t.Fatal(err)
		}
	}
	_, _, err := service.ResultByPrefix(ctx, "1234567")
	short := requireRequestFailure(t, err, "USAGE_ERROR", 1)
	if short.Message != "Request-ID prefixes require at least 8 hex characters." {
		t.Fatal(short.Message)
	}
	_, _, err = service.ResultByPrefix(ctx, "req_12345678-")
	ambiguous := requireRequestFailure(t, err, "USAGE_ERROR", 1)
	if !strings.HasSuffix(ambiguous.Message, "; …and 2 more") ||
		strings.Count(ambiguous.Message, "req_12345678") != 5 ||
		!strings.HasPrefix(ambiguous.Message, "Request-ID prefix is ambiguous: req_12345678-0000-4000-8000-000000000000") {
		t.Fatal(ambiguous.Message)
	}
	id, result, err := service.ResultByPrefix(ctx, "87654321")
	if err != nil || id != "87654321" || result.Status != core.ResponseUnavailable {
		t.Fatalf("unmatched prefix = %q, %+v, %v", id, result, err)
	}
}

func TestAnswerRequiresUnambiguousRecordedRecipient(t *testing.T) {
	parallelStorageFixture(t)
	_, service, _ := seedRequestService(t)
	ctx := t.Context()
	for _, id := range []core.RequestID{"one", "two"} {
		if _, err := service.Enqueue(ctx, inboxRequest(id)); err != nil {
			t.Fatal(err)
		}
	}
	from := core.IdentityID("sender")
	_, err := service.Answer(ctx, core.AnswerRequest{Recipient: "receiver", Originator: &from, Body: "answer"})
	requireRequestFailure(t, err, "ANSWER_AMBIGUOUS", 1)
	one := core.RequestID("one")
	_, err = service.Answer(ctx, core.AnswerRequest{Recipient: "other", RequestID: &one, Body: "answer"})
	requireRequestFailure(t, err, "X_NOT_FOUND", 3)
	final, err := service.Answer(ctx, core.AnswerRequest{Recipient: "receiver", RequestID: &one, Body: "chosen"})
	if err != nil || final.Final.RequestID != one || final.Final.Body != "chosen" {
		t.Fatalf("explicit answer = %+v, %v", final, err)
	}
	final, err = service.Answer(ctx, core.AnswerRequest{Recipient: "receiver", Originator: &from, Body: "only one left"})
	if err != nil || final.Final.RequestID != "two" || final.Originator.IdentityID == nil || *final.Originator.IdentityID != from {
		t.Fatalf("unique answer = %+v, %v", final, err)
	}
	_, err = service.Answer(ctx, core.AnswerRequest{Recipient: "receiver", Originator: &from})
	requireRequestFailure(t, err, "ANSWER_NOT_WAITING", 3)
}

func TestRequestRetentionPrunesOnWriteAndPreservesPinnedFinal(t *testing.T) {
	parallelStorageFixture(t)
	store, service, clock := seedRequestService(t)
	ctx := t.Context()

	for _, id := range []core.RequestID{"prepared", "sending"} {
		attempt, err := service.Prepare(ctx, paneRequest(id))
		if err != nil {
			t.Fatal(err)
		}
		if id == "sending" {
			if err := service.BeginSend(ctx, attempt.AttemptID); err != nil {
				t.Fatal(err)
			}
		}
	}
	for _, id := range []core.RequestID{"final", "pinned"} {
		attempt, err := service.Enqueue(ctx, inboxRequest(id))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := service.SubmitResponse(ctx, core.SubmitResponse{RequestID: id, Receipt: attempt.Receipt, Body: "retained"}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE request_attempts SET keep_reply = 1 WHERE request_id = 'pinned'"); err != nil {
		t.Fatal(err)
	}
	clock.ms += int64(core.RetentionDayMs)
	result, err := service.Result(ctx, "final")
	if err != nil || result.Status != core.ResponseUnavailable {
		t.Fatalf("result at exact body expiry = %+v, %v", result, err)
	}
	var before int
	if err := store.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM request_responses").Scan(&before); err != nil || before != 2 {
		t.Fatalf("read changed physical response state: %d, %v", before, err)
	}
	if _, err := service.Prepare(ctx, paneRequest("triggers-cleanup")); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx ports.StoreTx) error {
		for id, want := range map[core.RequestID]core.AttemptStatus{
			"prepared": core.AttemptDefinitelyFailed, "sending": core.AttemptUncertain, "final": core.AttemptQueued,
		} {
			a, err := tx.Requests().FindByID(id)
			if err != nil {
				return err
			}
			if a == nil || a.Status != want || a.WaitActive || a.WaitReleasedAtMs == nil {
				t.Fatalf("cleanup %s = %+v, want %s and waiter release", id, a, want)
			}
		}
		unpinned, err := tx.Responses().FindByRequest("final")
		if err != nil {
			return err
		}
		pinned, err := tx.Responses().FindByRequest("pinned")
		if err != nil {
			return err
		}
		if unpinned != nil || pinned == nil {
			t.Fatalf("physical cleanup = %+v unpinned and %+v pinned", unpinned, pinned)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	detail, err := service.ShowX(ctx, "sender", core.XOutgoing, "final")
	if err != nil || detail.Prompt != nil || detail.PromptExpiresAtMs == nil ||
		detail.Exchange.Final.Status != core.FinalExpired || detail.Exchange.Final.SubmittedAtMs == nil {
		t.Fatalf("expired metadata after physical cleanup = %+v, %v", detail, err)
	}
	clock.ms += int64(core.ResponseAcceptanceWindowMs)
	if _, err := service.Prepare(ctx, paneRequest("triggers-metadata-cleanup")); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx ports.StoreTx) error {
		unpinned, err := tx.Requests().FindByID("final")
		if err != nil {
			return err
		}
		pinned, err := tx.Requests().FindByID("pinned")
		if err != nil {
			return err
		}
		if unpinned != nil || pinned == nil {
			t.Fatalf("metadata cleanup = %+v unpinned and %+v pinned", unpinned, pinned)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
