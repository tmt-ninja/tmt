package cli

import (
	"context"
	"reflect"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type identityStoreFake struct {
	ports.Store
	records identityRepoFake
}

func (s identityStoreFake) Read(_ context.Context, fn func(ports.StoreTx) error) error {
	return fn(identityTxFake{records: s.records})
}

type identityTxFake struct {
	ports.StoreTx
	records identityRepoFake
}

func (tx identityTxFake) Identities() ports.IdentityRepo { return tx.records }

type identityRepoFake struct {
	ports.IdentityRepo
	byID map[core.IdentityID]*core.Identity
}

func (r identityRepoFake) FindByID(id core.IdentityID) (*core.Identity, error) {
	return r.byID[id], nil
}

func (r identityRepoFake) FindByCanonicalName(name string) (*core.Identity, error) {
	for _, identity := range r.byID {
		if identity.CanonicalName == name {
			return identity, nil
		}
	}
	return nil, nil
}

type incomingFake struct {
	ports.RequestService
	inbox  func(core.InboxQuery) (core.InboxPage, error)
	answer func(core.AnswerRequest) (core.AnswerResult, error)
}

func (f incomingFake) Inbox(_ context.Context, q core.InboxQuery) (core.InboxPage, error) {
	return f.inbox(q)
}

func (f incomingFake) Answer(_ context.Context, answer core.AnswerRequest) (core.AnswerResult, error) {
	return f.answer(answer)
}

func requestIdentitiesFixture() (identityStoreFake, *core.Identity, *core.Identity) {
	me := &core.Identity{ID: "11111111-0000-4000-8000-000000000000", Name: "Worker", CanonicalName: "worker", Lifetime: core.LifetimeSaved}
	from := &core.Identity{ID: "22222222-0000-4000-8000-000000000000", Name: "Lead", CanonicalName: "lead", Lifetime: core.LifetimeTemporary}
	return identityStoreFake{records: identityRepoFake{byID: map[core.IdentityID]*core.Identity{me.ID: me, from.ID: from}}}, me, from
}

func TestInboxSelectsIdentityAndMapsSenderMetadata(t *testing.T) {
	t.Setenv("TMT_GO_HOME", t.TempDir())
	store, me, from := requestIdentitiesFixture()
	content := "first line\nsecond line"
	unknown := core.IdentityID("retired")
	service := incomingFake{inbox: func(q core.InboxQuery) (core.InboxPage, error) {
		want := core.InboxQuery{Recipient: me.ID, Originator: &from.ID, Limit: 20}
		if !reflect.DeepEqual(q, want) {
			t.Errorf("query = %+v, want %+v", q, want)
		}
		makeItem := func(id core.RequestID, originator *core.IdentityID, preview *string) core.InboxItem {
			return core.InboxItem{
				RequestID: id, Originator: core.Originator{IdentityID: originator}, PreparedAtMs: 12,
				Delivery: core.AttemptQueued, MessageState: core.DeliveryView{State: "waiting", Reason: "inbox", ReasonText: "waiting in inbox"},
				Preview: preview,
			}
		}
		return core.InboxPage{Items: []core.InboxItem{
			makeItem("req_known", &from.ID, &content), makeItem("req_retired", &unknown, nil), makeItem("req_anon", nil, nil),
		}, More: true}, nil
	}}
	item := func(id string, party, preview any) map[string]any {
		return map[string]any{
			"requestId": id, "from": party, "preparedAtMs": float64(12), "delivery": "queued", "preview": preview,
			"messageState": map[string]any{
				"state": "waiting", "reason": map[string]any{"code": "inbox", "text": "waiting in inbox"},
				"latestMs": nil, "remainingMs": nil, "canSendNow": false,
			},
		}
	}
	assertResponse(t, application{store: store, requests: service},
		[]string{"inbox", "--identity", string(me.ID), "--from", "Lead", "--limit", "20", "--json"}, 0, map[string]any{
			"identity": map[string]any{"id": string(me.ID), "name": "Worker", "canonicalName": "worker", "lifetime": "saved"},
			"items": []any{
				item("req_known", map[string]any{"identityId": string(from.ID), "name": "Lead", "canonicalName": "lead"}, content),
				item("req_retired", map[string]any{"identityId": string(unknown), "name": nil, "canonicalName": nil}, nil),
				item("req_anon", nil, nil),
			}, "more": true,
		})
}

func TestAnswerByRequestIDPassesExactBodyWithoutSupposingSender(t *testing.T) {
	t.Setenv("TMT_GO_HOME", t.TempDir())
	store, me, _ := requestIdentitiesFixture()
	const body = "\ufeff\r\n\x00"
	id := core.RequestID("req_anonymous")
	service := incomingFake{answer: func(input core.AnswerRequest) (core.AnswerResult, error) {
		want := core.AnswerRequest{Recipient: me.ID, RequestID: &id, Body: body}
		if !reflect.DeepEqual(input, want) {
			t.Errorf("answer = %+v, want %+v", input, want)
		}
		return core.AnswerResult{Final: core.FinalResponse{RequestID: id, Body: body, BodyBytes: uint64(len(body)), SubmittedAtMs: 24}}, nil
	}}
	assertResponse(t, application{store: store, requests: service},
		[]string{"answer", "--identity", "worker", "--request", string(id), body, "--json"}, 0, map[string]any{
			"identity": map[string]any{"id": string(me.ID), "name": "Worker", "canonicalName": "worker", "lifetime": "saved"},
			"status":   "submitted", "requestId": string(id), "from": nil, "bodyBytes": float64(len(body)), "submittedAtMs": float64(24),
		})
}

func TestAnswerLeavesAmbiguousRequestsUnselected(t *testing.T) {
	t.Setenv("TMT_GO_HOME", t.TempDir())
	store, me, from := requestIdentitiesFixture()
	const message = "lead is waiting on you for 2 requests; nothing was sent.\n  req_first  One\n  req_second  Two"
	service := incomingFake{answer: func(input core.AnswerRequest) (core.AnswerResult, error) {
		want := core.AnswerRequest{Recipient: me.ID, Originator: &from.ID, Body: "body"}
		if !reflect.DeepEqual(input, want) {
			t.Errorf("answer = %+v, want %+v", input, want)
		}
		return core.AnswerResult{}, &core.RequestFailure{Code: "ANSWER_AMBIGUOUS", Message: message, Status: 1}
	}}
	assertResponse(t, application{store: store, requests: service},
		[]string{"answer", "--identity", "worker", "Lead", "body", "--json"}, 1, map[string]any{
			"error": map[string]any{"code": "ANSWER_AMBIGUOUS", "message": message},
		})
}
