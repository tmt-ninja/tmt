package cli

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/delivery"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type liveRequestFake struct {
	talkWaitFake
	prepare func(core.PrepareRequest) (core.PreparedRequest, error)
	begin   func(core.AttemptID) error
	settle  func(core.AttemptID, core.Settlement) error
}

func (f liveRequestFake) Prepare(_ context.Context, in core.PrepareRequest) (core.PreparedRequest, error) {
	return f.prepare(in)
}

func (f liveRequestFake) BeginSend(_ context.Context, id core.AttemptID) error {
	return f.begin(id)
}

func (f liveRequestFake) Settle(_ context.Context, id core.AttemptID, settlement core.Settlement) error {
	return f.settle(id, settlement)
}

func TestLiveTalkFencesDeliveryAndSettlesBeforeReadingFinal(t *testing.T) {
	store, recipient, _ := requestIdentitiesFixture()
	start := "fixture-pane-start"
	binding := core.Binding{
		ID: "go-binding", IdentityID: recipient.ID, PaneID: "%7", PanePID: 20, PaneIncarnation: &start,
		Server: core.ServerEvidence{Host: "tmux", Socket: "/private/tmp/go-test.sock", ID: "go-server", PID: 10, StartTime: "start"},
	}
	marker := binding.Marker(*recipient)
	pane := ports.PaneRef{Server: binding.Server.Socket, PaneID: binding.PaneID}
	const requestID = "req_11111111-0000-4000-8000-000000000000"
	const attemptID = "22222222-0000-4000-8000-000000000000"
	const receipt = "v2_AAAAAAAAAAAAAAAAAAAAAA"
	const message = "exact payload"
	for _, uncertain := range []bool{false, true} {
		var actions []string
		checkID := func(id core.AttemptID) {
			t.Helper()
			if id != attemptID {
				t.Fatalf("attempt ID = %s", id)
			}
		}
		app := application{
			store: callerTestStore{tx: callerTestTx{
				identityTxFake: identityTxFake{records: store.records}, bindings: callerBindingRepo{row: binding},
			}},
			caller: callerSelector{probe: func(_ context.Context, ref ports.PaneRef) (core.EndpointProbe, error) {
				if ref != pane {
					t.Fatalf("probe = %+v", ref)
				}
				actions = append(actions, "probe")
				return core.EndpointProbe{
					State: core.EndpointProbeLive, Server: binding.Server,
					Panes: []core.PaneObservation{{ID: pane.PaneID, PID: binding.PanePID, Incarnation: &start, Marker: &marker}},
				}, nil
			}},
			live: liveTalkHost{
				driver: func(context.Context, core.Identity, core.Binding, core.EndpointProbe) (ports.Driver, error) {
					return codex.Driver{}, nil
				},
				capture: func(context.Context, ports.PaneRef, ports.CaptureOpts) (ports.Screen, error) {
					return ports.Screen{Pane: pane, Text: "› Ask Codex to do anything\n← for agents · ? for shortcuts\n"}, nil
				},
				deliver: func(_ context.Context, root home.Root, target delivery.PasteTarget, in ports.DeliveryInput) (ports.DeliveryOutcome, error) {
					actions = append(actions, "deliver")
					if root.Dir != "/fixture" || target.Pane != pane || target.Identity.ID != recipient.ID ||
						!reflect.DeepEqual(target.Binding, &binding) || !strings.HasPrefix(in.Text, message+"\n\n") ||
						!strings.Contains(in.Text, "<tmt-reply from=\"a&lt;b\">\ntmt-go reply "+requestID+" --receipt "+receipt+" --message <text>") ||
						len(in.Submit) != 1 || in.Submit[0].Key != "Enter" {
						t.Fatalf("unexpected delivery frame or target: %+v, %+v", target, in)
					}
					if uncertain {
						return ports.DeliveryUncertain, errors.New("private transport detail")
					}
					return ports.DeliveryDelivered, nil
				},
			},
			requests: liveRequestFake{
				prepare: func(in core.PrepareRequest) (core.PreparedRequest, error) {
					actions = append(actions, "prepare")
					if in.Message != message || in.Route.Kind != core.RequestRouteInbox || in.Route.Recipient == nil || *in.Route.Recipient != recipient.ID {
						t.Fatalf("prepare = %+v", in)
					}
					return core.PreparedRequest{RequestID: requestID, AttemptID: attemptID, Receipt: receipt}, nil
				},
				begin: func(id core.AttemptID) error {
					checkID(id)
					actions = append(actions, "begin")
					return nil
				},
				settle: func(id core.AttemptID, got core.Settlement) error {
					checkID(id)
					actions = append(actions, "settle")
					want := core.SettlementSent
					if uncertain {
						want = core.SettlementUncertain
					}
					if got != want {
						t.Fatalf("settlement = %v, want %v", got, want)
					}
					return nil
				},
				talkWaitFake: talkWaitFake{
					read: func(_ context.Context, id core.RequestID) (core.ResponseLookup, error) {
						actions = append(actions, "read")
						if id != requestID {
							t.Fatalf("read request = %s", id)
						}
						return core.ResponseLookup{Status: core.ResponseAvailable, Final: &core.FinalResponse{RequestID: id, Body: "done"}}, nil
					},
					release: func(_ context.Context, id core.AttemptID) error {
						checkID(id)
						actions = append(actions, "release")
						return nil
					},
				},
			},
		}
		result := app.liveTalk(t.Context(), talkPlan{root: home.Root{Dir: "/fixture"}, target: "worker", message: message, timeout: time.Second, poll: time.Second},
			*recipient, binding, core.PrepareRequest{
				Kind: core.RequestKindRequest, Message: message, Wait: true,
				Route: core.RequestRoute{Kind: core.RequestRouteInbox, Recipient: &recipient.ID},
			}, "a<b")
		want := []string{"prepare", "begin", "probe", "deliver", "settle"}
		if uncertain {
			failure, ok := result.(*output.Failure)
			if !ok || failure.Code != "DELIVERY_UNCERTAIN" || failure.Request.DeliveryState != "uncertain" {
				t.Fatalf("uncertain result: %+v", result)
			}
		} else {
			want = append(want, "read")
			done, ok := result.(talkReport)
			if !ok || done.Status != "completed" || done.Pane != pane.PaneID || done.Response == nil || *done.Response != "done" {
				t.Fatalf("completed result: %+v", result)
			}
		}
		want = append(want, "release")
		if !reflect.DeepEqual(actions, want) {
			t.Fatalf("actions = %v, want %v", actions, want)
		}
	}
}
