package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type heldTalkRequests struct {
	ports.RequestService
	accept func(core.PrepareRequest, bool) (core.PreparedRequest, error)
}

func (f heldTalkRequests) Prepare(_ context.Context, in core.PrepareRequest) (core.PreparedRequest, error) {
	return f.accept(in, false)
}

func (f heldTalkRequests) Enqueue(_ context.Context, in core.PrepareRequest) (core.PreparedRequest, error) {
	return f.accept(in, true)
}

func TestTalkDigestHoldReturnsWithoutAWaiterOrHostIO(t *testing.T) {
	for _, tc := range []struct {
		name   string
		bound  bool
		detach bool
	}{
		{name: "bound", bound: true},
		{name: "bound_detached", bound: true, detach: true},
		{name: "unbound"},
		{name: "unbound_detached", detach: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store, recipient, _ := requestIdentitiesFixture()
			const requestID = "req_11111111-0000-4000-8000-000000000000"
			bindings := callerBindingRepo{}
			if tc.bound {
				bindings.row = core.Binding{IdentityID: recipient.ID, PaneID: "%7"}
			}
			app := application{
				store: callerTestStore{tx: callerTestTx{identityTxFake: identityTxFake{records: store.records}, bindings: bindings}},
				requests: heldTalkRequests{accept: func(in core.PrepareRequest, enqueue bool) (core.PreparedRequest, error) {
					wantPolicy := core.RequestDeliveryPolicy{
						Kind: core.DigestKindReview, Mode: core.RequestDeliveryRequest, Automatic: true, Urgent: true,
					}
					if enqueue == tc.bound || in.Wait == tc.detach || in.DeliveryPolicy == nil || *in.DeliveryPolicy != wantPolicy {
						t.Fatalf("prepare: %+v, enqueue %t", in, enqueue)
					}
					var until uint64 // A zero deadline is still a held acceptance.
					return core.PreparedRequest{RequestID: requestID, DigestUntilMs: &until}, nil
				}},
			}
			report := app.talk(t.Context(), talkPlan{
				target: "worker", message: "review", timeout: time.Second, detach: tc.detach,
				digestKind: core.DigestKindReview, urgent: true,
			})
			var stdout, stderr bytes.Buffer
			if status := publish(&stdout, &stderr, report, true); status != 0 || stderr.Len() != 0 {
				t.Fatalf("exit %d, stdout %q, stderr %q", status, &stdout, &stderr)
			}
			var doc map[string]any
			if err := json.Unmarshal(stdout.Bytes(), &doc); err != nil {
				t.Fatal(err)
			}
			if doc["status"] != "queued" || doc["digest"] != true ||
				doc["digestUntilMs"] != float64(0) || doc["remainingMs"] != float64(0) ||
				doc["notification"] != "held" || doc["waitingFor"] != "digest_checklist" ||
				doc["pane"] != nil || doc["offline"] != nil || doc["recipientIdentityId"] != string(recipient.ID) {
				t.Fatalf("held report: %v", doc)
			}
			stdout.Reset()
			if err := report.Human(&stdout); err != nil {
				t.Fatal(err)
			}
			want := "Queued " + requestID + ": worker is in digest mode for 0 seconds (until UTC epoch 0 ms); delivery is in its next checklist.\n" +
				"hint: retrieve it later with tmt-go result " + requestID + "\n"
			if stdout.String() != want {
				t.Fatalf("held human output: %q", &stdout)
			}
		})
	}
}

func TestUnboundTalkPersistsDigestHoldAndUrgentBypass(t *testing.T) {
	world := t.TempDir()
	t.Setenv("HOME", world)
	t.Setenv(home.EnvHome, filepath.Join(world, "go"))
	t.Chdir(world)
	root, err := home.Resolve(os.LookupEnv, world)
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	_, member, owner := requestIdentitiesFixture()
	now := uint64(wallClock{}.NowMs())
	if err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		if err := tx.Identities().Insert(*member, now); err != nil {
			return err
		}
		return tx.Identities().Insert(*owner, now)
	}); err != nil {
		t.Fatal(err)
	}
	policy := core.DigestPolicyWrite{IdentityID: member.ID, OwnerID: owner.ID, SetterID: owner.ID, NowMs: now, UntilMs: now + 60_000}
	if _, err := store.WritePolicy(t.Context(), policy); err != nil {
		t.Fatal(err)
	}

	app := application{store: store, requests: storage.NewRequestService(store, wallClock{})}
	talk := func(args ...string) talkReport {
		t.Helper()
		args = append([]string{"talk", "Worker", "message"}, args...)
		inv, problem := parse(args)
		if problem != nil {
			t.Fatal(problem)
		}
		plan, problem := app.prepareTalk(t.Context(), root, inv)
		if problem != nil {
			t.Fatal(problem)
		}
		report, ok := app.talk(t.Context(), plan).(talkReport)
		if !ok {
			t.Fatal("expected a queued report from real storage")
		}
		return report
	}
	held := talk("--kind", "decision")
	if !held.Digest || held.DigestUntilMs == nil || *held.DigestUntilMs != policy.UntilMs {
		t.Fatalf("held request: %+v", held)
	}
	urgent := talk("--urgent", "--detach")
	if urgent.Digest || !urgent.Offline || urgent.Status != "queued" {
		t.Fatalf("urgent bypass: %+v", urgent)
	}
	if err := store.Read(t.Context(), func(tx ports.StoreTx) error {
		for _, report := range []talkReport{held, urgent} {
			attempt, err := tx.Requests().FindByID(report.RequestID)
			if err != nil || attempt == nil || attempt.WaitActive || attempt.Status != core.AttemptQueued {
				t.Fatalf("durable request %s: %+v, %v", report.RequestID, attempt, err)
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	view, err := store.ReadPolicies(t.Context(), core.DigestIdentityQuery{IdentityIDs: []core.IdentityID{member.ID}, NowMs: now})
	if err != nil || len(view) != 1 || view[0].HeldCount != 1 {
		t.Fatalf("durable Digest hold: %+v, %v", view, err)
	}
}
