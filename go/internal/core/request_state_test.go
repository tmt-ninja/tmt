package core

import "testing"

func TestPlanBeginSend(t *testing.T) {
	prepared := RequestAttempt{
		AttemptID: "attempt-1", Status: AttemptPrepared, CadenceReserved: true, WaitActive: true,
		ExpiresAtMs: 200, RetentionExpiresAtMs: 300,
	}
	transition, err := PlanBeginSend(prepared, 199)
	if err != nil || transition == nil || *transition != (AttemptTransition{
		AttemptID: prepared.AttemptID, From: AttemptPrepared, To: AttemptSending, AtMs: 199, CadenceReserved: true,
	}) {
		t.Fatalf("begin send = %+v, %v", transition, err)
	}
	transition, err = PlanBeginSend(prepared, 200)
	if err != ErrAttemptExpired || transition == nil || *transition != (AttemptTransition{
		AttemptID: prepared.AttemptID, From: AttemptPrepared, To: AttemptDefinitelyFailed, AtMs: 200, ReleaseWait: true,
	}) {
		t.Fatalf("expired prepared send must commit a failure and waiter release: %+v, %v", transition, err)
	}
	if transition, err = PlanBeginSend(prepared, 300); transition != nil || err != ErrAttemptExpired {
		t.Fatalf("retention expiry must preserve stored state: %+v, %v", transition, err)
	}
	prepared.Status = AttemptUncertain
	if transition, err = PlanBeginSend(prepared, 199); transition != nil || err != ErrAttemptState {
		t.Fatalf("uncertain handoff cannot be replayed: %+v, %v", transition, err)
	}
}

func TestPlanSettlement(t *testing.T) {
	const expires = 200
	const retainedUntil = MetadataSettlementFloorMs + 150
	submitted := uint64(120)
	for _, tc := range []struct {
		name    string
		from    AttemptStatus
		outcome Settlement
		now     uint64
		final   *uint64
		want    AttemptStatus
		err     error
	}{
		{"prepared can fail before sending", AttemptPrepared, SettlementDefinitelyFailed, 149, nil, AttemptDefinitelyFailed, nil},
		{"prepared cannot settle sent", AttemptPrepared, SettlementSent, 149, nil, "", ErrAttemptState},
		{"successful handoff", AttemptSending, SettlementSent, 150, nil, AttemptSent, nil},
		{"uncertain handoff", AttemptSending, SettlementUncertain, 150, nil, AttemptUncertain, nil},
		{"expiry after begin makes failure uncertain", AttemptSending, SettlementDefinitelyFailed, expires, nil, AttemptUncertain, nil},
		{"accepted final proves possible handoff", AttemptSending, SettlementDefinitelyFailed, 150, &submitted, AttemptUncertain, nil},
		{"retry matches current outcome", AttemptUncertain, SettlementDefinitelyFailed, 150, &submitted, "", nil},
		{"retry cannot overwrite terminal outcome", AttemptUncertain, SettlementSent, 150, nil, "", ErrAttemptState},
		{"retained terminal outcome retries after expiry", AttemptSent, SettlementSent, retainedUntil, nil, "", nil},
		{"retention expiry refuses new settlement", AttemptSending, SettlementUncertain, retainedUntil, nil, "", ErrAttemptExpired},
	} {
		t.Run(tc.name, func(t *testing.T) {
			attempt := RequestAttempt{
				AttemptID: "attempt-1", Status: tc.from, ExpiresAtMs: expires,
				RetentionExpiresAtMs: retainedUntil, ResponseSubmittedAtMs: tc.final, CadenceReserved: true,
			}
			transition, err := PlanSettlement(attempt, tc.outcome, tc.now)
			if err != tc.err {
				t.Fatalf("settlement error = %v, want %v", err, tc.err)
			}
			if tc.want == "" {
				if transition != nil {
					t.Fatalf("unexpected transition %+v", transition)
				}
				return
			}
			if transition == nil || transition.To != tc.want || transition.AttemptID != attempt.AttemptID ||
				transition.From != tc.from || transition.AtMs != tc.now {
				t.Fatalf("transition = %+v, want %s from %s", transition, tc.want, tc.from)
			}
			wantRetention := max(retainedUntil, tc.now+MetadataSettlementFloorMs)
			if transition.RetentionExpiresAtMs == nil || *transition.RetentionExpiresAtMs != wantRetention {
				t.Fatalf("transition = %+v, want retention deadline %d", transition, wantRetention)
			}
			if transition.CadenceReserved != (tc.want != AttemptDefinitelyFailed) {
				t.Fatalf("incorrect cadence reservation in %+v", transition)
			}
		})
	}
}
