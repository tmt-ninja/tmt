package storage

import (
	"context"
	"crypto/rand"
	"fmt"
	"strings"
	"unicode"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type requestWake struct {
	state    core.WakeState
	deadline *uint64
}

func readRequestWake(r records, id core.RequestID) (requestWake, error) {
	var w requestWake
	err := r.one("SELECT wake_state,receipt_deadline_ms FROM request_attempts WHERE request_id=?", id).Scan(&w.state, &w.deadline)
	if err == nil && !w.state.Valid() {
		return w, requestState()
	}
	return w, err
}

func (w requestWake) observed(now uint64) core.WakeState {
	if w.state == core.WakeUncertain && w.deadline != nil && now < *w.deadline {
		return core.WakeClaimed
	}
	return w.state
}

func (w requestWake) ownsDeadline(expected *uint64) bool {
	if expected == nil {
		return w.state == core.WakeClaimed && w.deadline == nil
	}
	return w.state == core.WakeUncertain && w.deadline != nil && *w.deadline == *expected
}

func liveWakeRequest(a core.RequestAttempt, now uint64) bool {
	return a.ResponseSubmittedAtMs == nil && a.Withdrawal == nil && now < a.ExpiresAtMs && now < a.RetentionExpiresAtMs
}

func (s *RequestService) ClaimReleasedWake(ctx context.Context, q core.ReleasedWakeQuery) (core.ReleasedWakeClaim, error) {
	if q.RequestID == "" || q.RecipientID == "" {
		return core.ReleasedWakeClaim{}, requestState()
	}
	if q.ReceiptDeadlineMs != nil {
		deadline := *q.ReceiptDeadlineMs
		if !safeTime(deadline) {
			return core.ReleasedWakeClaim{}, requestState()
		}
		q.ReceiptDeadlineMs = &deadline
	}
	var generation core.WakeClaimGeneration
	if _, err := rand.Read(generation[:]); err != nil {
		return core.ReleasedWakeClaim{}, err
	}
	cal, err := s.store.loadDigestCalendar(ctx)
	if err != nil {
		return core.ReleasedWakeClaim{}, err
	}
	var claim core.ReleasedWakeClaim
	err = s.transact(ctx, false, func(r records, now uint64) error {
		var err error
		claim, err = claimReleasedWake(r, q, cal, now)
		return err
	})
	if err != nil {
		return core.ReleasedWakeClaim{}, err
	}
	if claim.Claimed {
		s.wakeLock.Lock()
		if s.wakes == nil {
			s.wakes = make(map[core.WakeClaimGeneration]core.ReleasedWakeQuery)
		}
		s.wakes[generation] = q
		s.wakeLock.Unlock()
		claim.Generation = &generation
	}
	return claim, nil
}

func claimReleasedWake(r records, q core.ReleasedWakeQuery, cal digestCalendar, now uint64) (core.ReleasedWakeClaim, error) {
	var claim core.ReleasedWakeClaim
	attempt, err := (requestRows{r}).FindByID(q.RequestID)
	if err != nil {
		return claim, err
	}
	if attempt == nil {
		return claim, sendNowNotFound()
	}
	if attempt.Route.Kind != core.RequestRouteInbox || !matchesIdentity(attempt.Route.Recipient, q.RecipientID) {
		return claim, requestState()
	}
	wake, err := readRequestWake(r, q.RequestID)
	if err != nil {
		return claim, err
	}
	claim.State = wake.observed(now)
	if claim.State != core.WakeNotAttempted || attempt.Status != core.AttemptQueued {
		return claim, nil
	}
	policy, err := deliveryPolicy(r, q.RequestID)
	if err != nil || !ordinaryInboxRequest(*attempt, policy) {
		return claim, err
	}
	if q.ReceiptDeadlineMs != nil && now >= *q.ReceiptDeadlineMs {
		return claim, requestState()
	}
	claim.DigestUntilMs, err = holdReleasedWake(r, *attempt, policy, cal, now)
	if err != nil || claim.DigestUntilMs != nil {
		return claim, err
	}
	ok, err := affectedOne(r.exec(`UPDATE request_attempts SET receipt_deadline_ms=?2,
		wake_state=CASE WHEN ?2 IS NULL THEN 'claimed' ELSE 'uncertain' END
		WHERE request_id=?1 AND status='queued' AND route_kind='inbox' AND request_kind='request'
		  AND recipient_identity_id=?3 AND wake_state='not_attempted'`, q.RequestID, q.ReceiptDeadlineMs, q.RecipientID))
	if err != nil || !ok {
		return claim, requiredMutation(ok, err, "wake changed during claim")
	}
	eligible, err := activeWakeRecipient(r, q)
	if err != nil {
		return claim, err
	}
	if attempt.ResponseSubmittedAtMs != nil || !eligible {
		claim.State = core.WakeUnavailable
		return claim, settleReleasedWakeRows(r, q, core.WakeUnavailable, now)
	}
	if err := recordWakeCapture(r, *attempt, "pending", now); err != nil {
		return claim, err
	}
	claim.State, claim.Claimed = core.WakeClaimed, true
	return claim, nil
}

func holdReleasedWake(r records, a core.RequestAttempt, p storedPolicy, cal digestCalendar, now uint64) (*uint64, error) {
	var exists bool
	err := r.one(`SELECT EXISTS(SELECT 1 FROM focus_items WHERE identity_id=? AND request_id=? AND source='incoming')`,
		*a.Route.Recipient, a.RequestID).Scan(&exists)
	if err != nil {
		return nil, err
	}
	if exists {
		policy, err := digestPolicy(r, *a.Route.Recipient)
		if err != nil {
			return nil, err
		}
		var until uint64
		if policy != nil {
			until = policy.UntilMs
		}
		return &until, nil
	}
	input := core.PrepareRequest{
		RequestID: a.RequestID, Originator: a.Originator, Route: a.Route, Recipient: a.Recipient,
		DeliveryPolicy: &core.RequestDeliveryPolicy{Urgent: p.urgent, Kind: core.DigestKind(p.kind),
			Automatic: p.automatic, Mode: core.RequestDeliveryMode(p.mode)},
	}
	hold, err := incomingDigestHold(r, input, cal, now)
	if err != nil || hold == nil {
		return nil, err
	}
	return &hold.until, recordIncomingDigestHold(r, input, *hold, now)
}

func activeWakeRecipient(r records, q core.ReleasedWakeQuery) (bool, error) {
	var eligible bool
	err := r.one(`SELECT EXISTS(
		SELECT 1 FROM request_attempts a JOIN identities i ON i.id=a.recipient_identity_id
		WHERE a.request_id=?1 AND i.id=?2 AND i.retired_at_ms IS NULL
		AND (a.room_id IS NULL OR EXISTS(SELECT 1 FROM office_meeting_members m
			JOIN office_meeting_rooms z ON z.room_id=m.room_id
			WHERE z.room_id=a.room_id AND z.retired=0 AND m.identity_id=i.id)))`,
		q.RequestID, q.RecipientID).Scan(&eligible)
	return eligible, err
}

func (s *RequestService) readWakeProof(proof core.ReleasedWakeProof) (core.ReleasedWakeQuery, error) {
	query, ok := s.wakes[proof.Generation]
	if !ok || query.RequestID != proof.RequestID || query.RecipientID != proof.RecipientID {
		return core.ReleasedWakeQuery{}, requestState()
	}
	return query, nil
}

func (s *RequestService) ReadClaimedWake(ctx context.Context, proof core.ReleasedWakeProof) (*core.ReleasedWakePayload, error) {
	s.wakeLock.Lock()
	defer s.wakeLock.Unlock()
	q, err := s.readWakeProof(proof)
	if err != nil {
		return nil, err
	}
	var payload *core.ReleasedWakePayload
	err = s.transact(ctx, true, func(r records, now uint64) error {
		var err error
		payload, err = readClaimedWakePayload(r, q, now)
		return err
	})
	if err != nil {
		return nil, err
	}
	return payload, nil
}

func readClaimedWakePayload(r records, q core.ReleasedWakeQuery, now uint64) (*core.ReleasedWakePayload, error) {
	attempt, err := (requestRows{r}).FindByID(q.RequestID)
	if err != nil || attempt == nil {
		return nil, err
	}
	if attempt.Kind != core.RequestKindRequest || attempt.Status != core.AttemptQueued ||
		attempt.Route.Kind != core.RequestRouteInbox || !matchesIdentity(attempt.Route.Recipient, q.RecipientID) ||
		!liveWakeRequest(*attempt, now) {
		return nil, nil
	}
	wake, err := readRequestWake(r, q.RequestID)
	if err != nil {
		return nil, err
	}
	if !wake.ownsDeadline(q.ReceiptDeadlineMs) {
		return nil, requestState()
	}
	if wake.observed(now) != core.WakeClaimed {
		return nil, nil
	}
	eligible, err := activeWakeRecipient(r, q)
	if err != nil || !eligible {
		return nil, err
	}
	rawID, prefixed := strings.CutPrefix(string(q.RequestID), "req_")
	if !prefixed || !canonicalBindingID(rawID) {
		return nil, nil
	}
	var prompt *string
	err = r.one(`SELECT message_text FROM request_attempts
		WHERE request_id=? AND message_expires_at_ms>? AND message_bytes IS NOT NULL`, q.RequestID, now).Scan(&prompt)
	if isNoRows(err) || err == nil && prompt == nil {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sender := "unknown"
	if attempt.Originator.IdentityID != nil {
		identity, err := (identityRows{r}).FindByID(*attempt.Originator.IdentityID)
		if err != nil {
			return nil, err
		}
		if identity != nil {
			sender = sendNowSenderLabel(string(identity.Name))
		}
	}
	// NOT PORTED (#6938, GO1-23): project the native thread root alongside the prompt.
	return &core.ReleasedWakePayload{Attempt: *attempt, Message: *prompt, SenderName: sender}, nil
}

// Native previews replace line separators, display controls and bidi markers
// with spaces, and count Unicode scalars rather than bytes.
func sendNowSenderLabel(name string) string {
	name = strings.ReplaceAll(name, "\r\n", "\n")
	var label strings.Builder
	var count int
	for _, r := range name {
		if count == 160 {
			break
		}
		if unicode.IsControl(r) || r == '\u061c' || r == '\u200e' || r == '\u200f' ||
			r >= '\u2028' && r <= '\u202e' || r >= '\u2066' && r <= '\u2069' {
			r = ' '
		}
		label.WriteRune(r)
		count++
	}
	return label.String()
}

func (s *RequestService) SettleReleasedWake(ctx context.Context, in core.ReleasedWakeSettlement) error {
	if !in.Outcome.IsSettlement() {
		return requestState()
	}
	s.wakeLock.Lock()
	defer s.wakeLock.Unlock()
	q, err := s.readWakeProof(in.Proof)
	if err != nil {
		return err
	}
	// A lost settlement never grants a new send, even when the SQLite
	// outcome is unknown. Only a committed unavailable state can reopen.
	delete(s.wakes, in.Proof.Generation)
	return s.transact(ctx, false, func(r records, now uint64) error {
		return settleReleasedWakeRows(r, q, in.Outcome, now)
	})
}

func settleReleasedWakeRows(r records, q core.ReleasedWakeQuery, outcome core.WakeState, now uint64) error {
	wake, err := readRequestWake(r, q.RequestID)
	if err != nil {
		return err
	}
	if !wake.ownsDeadline(q.ReceiptDeadlineMs) || outcome != core.WakeUncertain && wake.observed(now) != core.WakeClaimed {
		return requestState()
	}
	ok, err := affectedOne(r.exec(`UPDATE request_attempts SET wake_state=?,receipt_deadline_ms=NULL
		WHERE request_id=? AND recipient_identity_id=? AND route_kind='inbox'`, outcome, q.RequestID, q.RecipientID))
	if err != nil || !ok {
		return requiredMutation(ok, err, "wake changed during settlement")
	}
	if outcome == core.WakeUnavailable {
		_, err := r.exec(`DELETE FROM capture_entries WHERE request_id=? AND kind='input'
			AND source='incoming' AND checklist_id IS NULL AND delivery='pending'`, q.RequestID)
		return err
	}
	attempt, err := (requestRows{r}).FindByID(q.RequestID)
	if err != nil {
		return err
	}
	if attempt == nil {
		return requestState()
	}
	captureState := "delivered"
	if outcome == core.WakeUncertain {
		captureState = "uncertain"
	}
	if err := recordWakeCapture(r, *attempt, captureState, now); err != nil || outcome != core.WakeSent {
		return err
	}
	attention, err := getAttention(r, incomingAttention, q.RecipientID, q.RequestID, now)
	if err != nil || attention.acknowledged {
		return err
	}
	_, err = r.exec(`UPDATE request_attempts SET recipient_attention_acknowledged_revision=?
		WHERE request_id=? AND recipient_identity_id=? AND recipient_attention_revision=?`,
		attention.revision, q.RequestID, q.RecipientID, attention.revision)
	return err
}

func recordWakeCapture(r records, attempt core.RequestAttempt, delivery string, now uint64) error {
	if delivery != "pending" {
		result, err := r.exec(`UPDATE capture_entries SET delivery=?2 WHERE request_id=?1 AND kind='input'
			AND source='incoming' AND checklist_id IS NULL AND delivery='pending'`, attempt.RequestID, delivery)
		if err != nil {
			return err
		}
		count, err := result.RowsAffected()
		if err != nil || count != 0 {
			return err
		}
	}
	recipient, err := digestRecipientEvidence(r, *attempt.Route.Recipient)
	if err != nil {
		return err
	}
	activity := wakeActivity(recipient)
	if activity == nil || core.DigestPhase(activity.State) != core.DigestPhaseWorking ||
		recipient.binding.Session.RuntimeState != "running" {
		return nil
	}
	binding := recipient.binding
	var batch string
	err = r.one(`SELECT id FROM capture_batches WHERE identity_id=? AND binding_id=? AND driver=?
		AND session_id=? AND runtime_pid=? AND runtime_start=? AND closed_ms IS NULL`, binding.IdentityID, binding.ID,
		*recipient.driver, activity.Session, activity.PID, activity.Start).Scan(&batch)
	if isNoRows(err) {
		var id [16]byte
		if _, err := rand.Read(id[:]); err != nil {
			return err
		}
		id[6] = (id[6] & 0x0f) | 0x40
		id[8] = (id[8] & 0x3f) | 0x80
		batch = fmt.Sprintf("%x-%x-%x-%x-%x", id[:4], id[4:6], id[6:8], id[8:10], id[10:])
		if _, err := r.exec("UPDATE capture_batches SET closed_ms=?2 WHERE identity_id=?1 AND closed_ms IS NULL",
			binding.IdentityID, now); err != nil {
			return err
		}
		if _, err := r.exec(`INSERT INTO capture_batches(id,identity_id,binding_id,driver,session_id,runtime_pid,runtime_start,
			provider_turn,created_ms) VALUES(?,?,?,?,?,?,?,?,?)`, batch, binding.IdentityID, binding.ID, *recipient.driver,
			activity.Session, activity.PID, activity.Start, activity.Turn, now); err != nil {
			return err
		}
		// NOT PORTED (#6938, GO1-05): native capture batch retention.
	} else if err != nil {
		return err
	}
	_, err = r.exec(`INSERT INTO capture_entries(identity_id,batch_id,kind,request_id,source,delivery,created_ms)
		VALUES (?,?,'input',?,'incoming',?,?) ON CONFLICT DO NOTHING`, binding.IdentityID, batch, attempt.RequestID, delivery, now)
	return err
}
