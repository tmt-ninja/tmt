package core

import (
	"math"
	"strings"
	"unicode"
)

const (
	DeliveryTurnWindowMs = 21_600_000
	DeliveryBindWindowMs = 600_000
)

type DeliveryHold uint8

const (
	DeliveryHoldNone DeliveryHold = iota
	DeliveryHoldOpen
	DeliveryHoldClaimed
	DeliveryHoldDelivered
	DeliveryHoldUnconfirmed
)

type DeliveryAnswer uint8

const (
	DeliveryNoAnswer DeliveryAnswer = iota
	DeliveryFinalAnswer
	DeliveryTurnAnswer
	DeliveryFoldedAnswer
	DeliveryTurnNoAnswer
	DeliveryNoTurnStarted
)

type DeliveryActivity struct {
	Phase   DigestPhase
	SinceMs uint64
}

// DeliveryFacts are observed within one storage snapshot.
type DeliveryFacts struct {
	Attempt               RequestAttempt
	Wake                  WakeState
	Hold                  DeliveryHold
	HeldAtMs              uint64
	OldestHeldAtMs        *uint64
	MaxHoldMs             *uint64
	RecipientPerson       bool
	RecipientName         string
	RecipientStartRefusal string
	RecipientRecovery     string
	Activity              *DeliveryActivity
	TurnStartedMs         *uint64
	TurnEnded             bool
	TalkHeld              bool
	Answer                DeliveryAnswer
}

func deliveryState(state, reason, text string) DeliveryView {
	return DeliveryView{State: state, Reason: reason, ReasonText: text}
}

type deliveryHandover uint8

const (
	handoverWaiting deliveryHandover = iota
	handoverInFlight
	handoverReached
	handoverUncertain
	handoverUnreachable
	handoverRefused
)

func (f DeliveryFacts) handover() deliveryHandover {
	if f.Attempt.Route.Kind == RequestRouteInbox {
		switch f.Wake {
		case WakeClaimed:
			return handoverInFlight
		case WakeSent:
			return handoverReached
		case WakeUnavailable:
			return handoverUnreachable
		case WakeUncertain:
			return handoverUncertain
		default:
			return handoverWaiting
		}
	}
	switch f.Attempt.Status {
	case AttemptSent:
		return handoverReached
	case AttemptUncertain:
		return handoverUncertain
	case AttemptDefinitelyFailed:
		return handoverRefused
	default:
		return handoverWaiting
	}
}

// ProjectDelivery gives X, inbox, job and send-now callers one delivery rule.
func ProjectDelivery(f DeliveryFacts, nowMs uint64) DeliveryView {
	switch f.Answer {
	case DeliveryFinalAnswer:
		return deliveryState("answered", "answered_by_reply", "answered")
	case DeliveryTurnAnswer:
		return deliveryState("answered", "answered_by_turn", "answered, the agent's turn ended with this reply")
	case DeliveryFoldedAnswer:
		return deliveryState("answered", "answered_by_folded_turn", "answered together with the earlier message: it was typed into the running turn")
	case DeliveryTurnNoAnswer:
		return deliveryState("unconfirmed", "turn_ended_without_answer", "no answer captured: the agent's turn ended without a final message")
	case DeliveryNoTurnStarted:
		return deliveryState("unconfirmed", "no_turn_started", "no answer captured: no turn started with this text, the agent may have taken it into a running turn")
	}

	attempt := f.Attempt
	if f.RecipientPerson && (attempt.Status == AttemptSent || attempt.Route.Kind == RequestRouteInbox && attempt.Status == AttemptQueued) {
		return deliveryState("delivered", "waiting_for_person", "waiting for the person")
	}
	handover := f.handover()
	if f.TalkHeld {
		switch {
		case attempt.Status == AttemptDefinitelyFailed:
			return deliveryState("not_sent", "talk_hold_expired", "not sent, the talk-limit hold was not resumed in time")
		case handover == handoverWaiting:
			return deliveryState("batched", "held_at_talk_limit", "held at the talk limit, sends when a person or a lead resumes the pair")
		}
	}
	idle := f.Activity != nil && f.Activity.Phase == DigestPhaseIdle
	waiting := f.Activity != nil && f.Activity.Phase == DigestPhaseWaiting
	over := f.TurnEnded || f.TurnStartedMs != nil && (idle || elapsedDeliveryMs(nowMs, *f.TurnStartedMs) > DeliveryTurnWindowMs)
	switch {
	case handover == handoverUncertain || f.Hold == DeliveryHoldUnconfirmed:
		return deliveryState("unconfirmed", "handed_over", "handed to the agent, delivery unconfirmed, do not resend")
	case handover == handoverRefused:
		return deliveryState("not_sent", "refused", "not sent, nothing reached the agent")
	case handover == handoverUnreachable:
		view := deliveryState("not_sent", "unreachable", "not sent, the agent could not be reached")
		view.CanSendNow = true
		return view
	case handover == handoverReached && over:
		return deliveryState("unconfirmed", "turn_ended_without_reply", "no reply yet: the agent's turn ended without one")
	case handover == handoverReached && !over && !idle && f.deliveryStarted(nowMs):
		return deliveryState("working", "agent_working", "the agent has started on it")
	case handover == handoverReached || f.Hold == DeliveryHoldDelivered:
		if f.RecipientStartRefusal != "" {
			return deliveryState("delivered", "session_not_bound", refusedDeliveryText(f))
		}
		return deliveryState("delivered", "reached_the_agent", "delivered")
	case handover == handoverInFlight || f.Hold == DeliveryHoldClaimed:
		return deliveryState("sent", "waiting_for_delivery", "waiting for delivery")
	case f.Hold == DeliveryHoldOpen:
		view := deliveryState("batched", "held_to_save_usage", "batched to save usage, sends when the agent finishes this turn")
		view.CanSendNow = !waiting
		if f.MaxHoldMs != nil {
			start := f.HeldAtMs
			if f.OldestHeldAtMs != nil {
				start = *f.OldestHeldAtMs
			}
			latest := start + min(*f.MaxHoldMs, math.MaxUint64-start)
			remaining := elapsedDeliveryMs(latest, nowMs)
			view.LatestMs, view.RemainingMs = &latest, &remaining
		}
		return view
	case waiting:
		return deliveryState("sent", "awaiting_approval", "waiting for the agent's approval prompt to clear")
	default:
		view := deliveryState("sent", "waiting_for_delivery", "waiting for delivery")
		view.CanSendNow = true
		return view
	}
}

func (f DeliveryFacts) deliveryStarted(now uint64) bool {
	if f.Activity == nil || f.RecipientStartRefusal != "" {
		return false
	}
	since := f.Attempt.PreparedAtMs
	if f.Attempt.SettledAtMs != nil {
		since = *f.Attempt.SettledAtMs
	}
	if f.Activity.SinceMs < since {
		return false
	}
	start := f.Activity.SinceMs
	if f.TurnStartedMs != nil {
		start = *f.TurnStartedMs
	}
	return elapsedDeliveryMs(now, start) <= DeliveryTurnWindowMs
}

func elapsedDeliveryMs(now, since uint64) uint64 {
	return now - min(now, since)
}

func refusedDeliveryText(f DeliveryFacts) string {
	const prefix = "session not bound · "
	const fallback = "inspect the recipient's identity for the next step"
	if f.RecipientStartRefusal == "session_not_learned" {
		if f.RecipientRecovery == "" || len(prefix)+len(f.RecipientRecovery) > 256 ||
			strings.ContainsFunc(f.RecipientRecovery, unicode.IsControl) {
			return prefix + fallback
		}
		return prefix + f.RecipientRecovery
	}
	step, command := "exit the agent in its pane, then run:", "tmt resume"
	fallbackStep := "exit the agent in its pane, then run tmt resume there"
	if f.RecipientStartRefusal == "previous_session_live" {
		step, command = "the old session is still running; move it with:", "tmt resume --move"
		fallbackStep = "the old session is still running; run tmt resume --move in its bound pane"
	}
	if f.RecipientName != "" {
		command += " -- " + CommandWord(f.RecipientName)
	}
	text := prefix + step + " " + command
	if len(text) >= 256 || strings.ContainsAny(text, "\n\r\u0085\u2028\u2029") {
		return prefix + fallbackStep
	}
	return text
}
