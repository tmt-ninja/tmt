package cli

import (
	"context"
	"maps"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type exchangeReaderFake struct {
	ports.RequestService
	list func(core.XQuery) (core.XPage, error)
	show func(core.IdentityID, core.XDirection, core.RequestID) (core.XDetail, error)
}

func (f exchangeReaderFake) ListX(_ context.Context, query core.XQuery) (core.XPage, error) {
	return f.list(query)
}

func (f exchangeReaderFake) ShowX(_ context.Context, identity core.IdentityID, direction core.XDirection, request core.RequestID) (core.XDetail, error) {
	return f.show(identity, direction, request)
}

func TestExchangeListAndShowProtectContentBoundaries(t *testing.T) {
	t.Setenv("TMT_GO_HOME", t.TempDir())
	store, me, other := requestIdentitiesFixture()
	const id = "req_exact"
	message := "☃\n\x00"
	response := ""
	receipt := core.Receipt("v2_fixture")
	bytes, submitted, expires, after := uint64(0), uint64(10), uint64(20), uint64(12)
	item := core.XItem{
		RequestID: id, Recipient: &other.ID, Urgent: true, DigestKind: "review", Mode: "request",
		PreparedAtMs: 7, Delivery: core.AttemptSent, Revision: after, RetentionExpiresAtMs: 30,
		MessageState: core.DeliveryView{State: "answered", Reason: "answered_by_reply", ReasonText: "answered"},
		Final:        core.XFinal{Status: core.FinalRetained, BodyBytes: &bytes, SubmittedAtMs: &submitted, ExpiresAtMs: &expires, Response: &response},
	}
	var showDirection core.XDirection
	service := exchangeReaderFake{
		list: func(q core.XQuery) (core.XPage, error) {
			if want := (core.XQuery{Identity: me.ID, Direction: core.XOutgoing, After: 3, Limit: 1}); q != want {
				t.Fatalf("list query = %+v, want %+v", q, want)
			}
			return core.XPage{Items: []core.XItem{item}, NextAfter: &after}, nil
		},
		show: func(identity core.IdentityID, direction core.XDirection, request core.RequestID) (core.XDetail, error) {
			if identity != me.ID || request != id || direction != showDirection {
				t.Fatalf("show input = %s %v %s", identity, direction, request)
			}
			return core.XDetail{Exchange: item, Prompt: &message, PromptExpiresAtMs: &expires, Receipt: &receipt}, nil
		},
	}
	identity := map[string]any{"id": string(me.ID), "name": "Worker", "canonicalName": "worker", "lifetime": "saved"}
	final := map[string]any{"status": "retained", "submittedAtMs": float64(10), "expiresAtMs": float64(20), "bodyBytes": float64(0)}
	row := map[string]any{
		"requestId": id, "recipientIdentityId": string(other.ID), "preparedAtMs": float64(7),
		"urgent": true, "digestKind": "review", "mode": "request", "delivery": "sent", "revision": float64(12),
		"acknowledged": false, "settled": false, "retentionExpiresAtMs": float64(30), "final": final,
		"messageState": map[string]any{
			"state": "answered", "reason": map[string]any{"code": "answered_by_reply", "text": "answered"},
			"latestMs": nil, "remainingMs": nil, "canSendNow": false,
		},
	}
	app := application{store: store, requests: service}
	assertResponse(t, app, []string{"x", "--identity", "worker", "--after", "3", "--limit", "1", "--json"}, 0, map[string]any{
		"identity": identity, "items": []any{row}, "nextAfter": float64(12),
	})

	detail := maps.Clone(row)
	detailFinal := maps.Clone(final)
	detailFinal["response"] = response
	detail["final"] = detailFinal
	detail["prompt"] = map[string]any{"status": "retained", "message": message, "messageBytes": float64(len(message)), "expiresAtMs": float64(20)}
	want := map[string]any{"identity": identity, "exchange": detail}
	args := []string{"x", "show", id, "--identity", "worker", "--json"}
	assertResponse(t, app, args, 0, want)

	showDirection = core.XIncoming
	detail["reply"] = map[string]any{
		"receipt": string(receipt),
		"command": "tmt-go reply " + id + " --receipt " + string(receipt) + " --message <text>",
	}
	assertResponse(t, app, append(args, "--incoming"), 0, want)
}

func TestExchangePromptDistinguishesExpiredFromUnavailable(t *testing.T) {
	expires := uint64(24)
	if got := exchangePromptJSON(core.XDetail{PromptExpiresAtMs: &expires}); got.Status != "expired" || got.ExpiresAtMs != &expires || got.Message != nil {
		t.Fatalf("expired prompt = %+v", got)
	}
	if got := exchangePromptJSON(core.XDetail{}); got.Status != "unavailable" || got.ExpiresAtMs != nil {
		t.Fatalf("unavailable prompt = %+v", got)
	}
}
