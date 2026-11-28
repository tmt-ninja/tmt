package core

import "testing"

func TestDeliveryProjectionPrecedence(t *testing.T) {
	const now = 20_000
	age, oldest, limit := uint64(15_000), uint64(10_000), uint64(5_000)
	idle := DeliveryActivity{Phase: DigestPhaseIdle, SinceMs: age}
	working := DeliveryActivity{Phase: DigestPhaseWorking, SinceMs: age}
	waiting := DeliveryActivity{Phase: DigestPhaseWaiting, SinceMs: age}
	tests := []struct {
		name      string
		change    func(*DeliveryFacts)
		state     string
		reason    string
		canSend   bool
		countdown bool
	}{
		{"queued", func(*DeliveryFacts) {}, "sent", "waiting_for_delivery", true, false},
		{"claimed", func(f *DeliveryFacts) { f.Wake = WakeClaimed }, "sent", "waiting_for_delivery", false, false},
		{"unavailable", func(f *DeliveryFacts) { f.Wake = WakeUnavailable }, "not_sent", "unreachable", true, false},
		{"person beats held", func(f *DeliveryFacts) {
			f.RecipientPerson, f.Hold, f.Wake = true, DeliveryHoldUnconfirmed, WakeUncertain
		}, "delivered", "waiting_for_person", false, false},
		{"final beats person", func(f *DeliveryFacts) {
			f.RecipientPerson, f.Answer = true, DeliveryFinalAnswer
		}, "answered", "answered_by_reply", false, false},
		{"held during approval", func(f *DeliveryFacts) {
			f.Hold, f.Activity = DeliveryHoldOpen, &waiting
			f.OldestHeldAtMs, f.MaxHoldMs = &oldest, &limit
		}, "batched", "held_to_save_usage", false, true},
		{"unconfirmed hold", func(f *DeliveryFacts) { f.Hold = DeliveryHoldUnconfirmed }, "unconfirmed", "handed_over", false, false},
		{"approval without hold", func(f *DeliveryFacts) { f.Activity = &waiting }, "sent", "awaiting_approval", false, false},
		{"turn underway", func(f *DeliveryFacts) {
			f.Wake, f.Activity, f.TurnStartedMs = WakeSent, &working, &age
		}, "working", "agent_working", false, false},
		{"idle ended the recorded turn", func(f *DeliveryFacts) {
			f.Wake, f.Activity, f.TurnStartedMs = WakeSent, &idle, &age
		}, "unconfirmed", "turn_ended_without_reply", false, false},
		{"old working activity", func(f *DeliveryFacts) {
			old := DeliveryActivity{Phase: DigestPhaseWorking, SinceMs: 1}
			f.Wake, f.Activity = WakeSent, &old
		}, "delivered", "reached_the_agent", false, false},
		{"talk hold beats approval", func(f *DeliveryFacts) { f.TalkHeld, f.Activity = true, &waiting },
			"batched", "held_at_talk_limit", false, false},
		{"captured fold", func(f *DeliveryFacts) { f.Answer = DeliveryFoldedAnswer },
			"answered", "answered_by_folded_turn", false, false},
		{"first-party start refusal", func(f *DeliveryFacts) {
			f.Wake, f.Activity, f.RecipientStartRefusal = WakeSent, &working, "previous_session_live"
			f.RecipientName = "two words"
		}, "delivered", "session_not_bound", false, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			f := DeliveryFacts{
				Attempt: RequestAttempt{Status: AttemptQueued, PreparedAtMs: 2, Route: RequestRoute{Kind: RequestRouteInbox}},
				Wake:    WakeNotAttempted,
			}
			test.change(&f)
			view := ProjectDelivery(f, now)
			if view.State != test.state || view.Reason != test.reason || view.CanSendNow != test.canSend || view.ReasonText == "" {
				t.Fatalf("delivery projection = %+v", view)
			}
			if test.countdown {
				if view.LatestMs == nil || *view.LatestMs != oldest+limit || view.RemainingMs == nil || *view.RemainingMs != 0 {
					t.Fatalf("saturating held countdown = %+v", view)
				}
			} else if view.LatestMs != nil || view.RemainingMs != nil {
				t.Fatalf("unexpected countdown = %+v", view)
			}
			if view.Reason == "session_not_bound" &&
				view.ReasonText != "session not bound · the old session is still running; move it with: tmt resume --move -- 'two words'" {
				t.Fatalf("start refusal recovery = %q", view.ReasonText)
			}
		})
	}
}
