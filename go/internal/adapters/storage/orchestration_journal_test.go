package storage

import (
	"errors"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func TestOrchJournalUsesNativeLimitExclusivePagesAndRetention(t *testing.T) {
	parallelStorageFixture(t)
	store := testStorage(t)
	ctx := t.Context()
	target := core.OrchJournalSubject{Kind: core.OrchSubjectIdentity, ID: string(bindingOwnerID)}
	query := core.OrchJournalQuery{Subject: target, Limit: 1, NowMs: 5000}
	for _, limit := range []uint16{0, 101} {
		query.Limit = limit
		_, err := store.ReadJournal(ctx, query)
		requireRequestFailure(t, err, "ORCH_INPUT_INVALID", 1)
	}
	query.Limit = 1
	const frozen = `[{"field":"receiving","source":{"kind":"member","planId":"66a4f2b0-7ec1-4229-bf76-f8fb617fec64","identityId":"` + string(bindingOwnerID) + `","revision":7,"slot":{"startMs":1000,"endMs":8000},"defaulted":false}}]`
	if _, err := store.db.ExecContext(ctx, `INSERT INTO orchestration_decisions(id,recorded_ms,expires_ms,subject_kind,subject_id,
		actor_id,recipient_id,action,outcome,reason,configuration_revision,time_zone,sources)
		VALUES (1,2000,6000,'identity',?1,?2,NULL,'send','sent','digest_delivered',8,'UTC',?3),
		(3,3000,5000,'identity',?1,NULL,NULL,'delay','held','already_expired',8,'UTC','[]'),
		(4,3000,6000,'identity',?2,NULL,NULL,'delay','held','other_subject',8,'UTC','[]')`,
		bindingOwnerID, bindingOtherID, frozen); err != nil {
		t.Fatal(err)
	}
	page, err := store.ReadJournal(ctx, query)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != 1 || page.NextBefore != nil || page.RetainedAfterMs != 0 {
		t.Fatalf("exact limit and low clock cutoff: %+v %v", page, err)
	}
	item := page.Items[0]
	if item.Subject != target || item.ActorID == nil || *item.ActorID != bindingOtherID || item.RecipientID != nil ||
		item.Action != core.OrchActionSend || item.Outcome != core.OrchOutcomeSent || item.Reason != "digest_delivered" ||
		item.ConfigurationRevision != 8 || len(item.Sources) != 1 || item.Sources[0].Field != core.OrchFieldReceiving {
		t.Fatalf("typed journal evidence: %+v", item)
	}
	source := item.Sources[0].Source
	if source.Kind != core.OrchSourceMember || source.PlanID == nil || *source.PlanID != orchPlanID ||
		source.IdentityID == nil || *source.IdentityID != bindingOwnerID || source.Revision != 7 ||
		source.Slot == nil || *source.Slot != (core.OrchTimeSlot{StartMs: 1000, EndMs: 8000}) || source.Defaulted {
		t.Fatalf("typed journal source: %+v", source)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO orchestration_decisions(id,recorded_ms,expires_ms,subject_kind,subject_id,
		recipient_id,action,outcome,reason,configuration_revision,time_zone,sources)
		VALUES (5,3500,6500,'identity',?1,?1,'send','failed','digest_unsent',9,'UTC','[]')`, bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	page, err = store.ReadJournal(ctx, query)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != 5 || page.NextBefore == nil || *page.NextBefore != 5 ||
		page.Items[0].RecipientID == nil || *page.Items[0].RecipientID != bindingOwnerID || page.Items[0].ActorID != nil {
		t.Fatalf("limit + one: %+v %v", page, err)
	}
	query.Before = page.NextBefore
	page, err = store.ReadJournal(ctx, query)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != 1 || page.NextBefore != nil {
		t.Fatalf("exclusive continuation: %+v %v", page, err)
	}
	query.NowMs = orchJournalRetentionMs + 5000
	page, err = store.ReadJournal(ctx, query)
	if err != nil || len(page.Items) != 0 || page.RetainedAfterMs != 5000 {
		t.Fatalf("aged journal: %+v %v", page, err)
	}
	var count uint64
	if err := store.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM orchestration_decisions").Scan(&count); err != nil || count != 4 {
		t.Fatalf("read altered retained rows: %d %v", count, err)
	}
}

func TestOrchJournalRefusesCorruptStoredSourcesAndEnums(t *testing.T) {
	parallelStorageFixture(t)
	store := testStorage(t)
	ctx := t.Context()
	query := core.OrchJournalQuery{Subject: core.OrchJournalSubject{Kind: core.OrchSubjectJob, ID: "local job"}, Limit: 5, NowMs: 2000}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO orchestration_decisions(recorded_ms,expires_ms,subject_kind,subject_id,
		action,outcome,reason,configuration_revision,time_zone,sources)
		VALUES(1000,3000,'job','local job','jobRun','completed','snapshot',0,'UTC','[]')`); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{
		`null`,
		`[{"field":"future","source":{"kind":"base","revision":0,"defaulted":false}}]`,
		`[{"field":"receiving","source":{"kind":"future","revision":0,"defaulted":false}}]`,
		`[{"field":"receiving","source":{"kind":"base","defaulted":false}}]`,
		`[{"field":"receiving","source":{"kind":"base","revision":0}}]`,
		`[{"field":"receiving","source":{"kind":"plan","planId":"66a4f2b0-7ec1-4229-bf76-f8fb617fec64","revision":1,"defaulted":false,"slot":{"startMs":9000,"endMs":8000}}}]`,
		`[{"field":"receiving","source":{"kind":"base","revision":0,"defaulted":false}},{"field":"receiving","source":{"kind":"base","revision":0,"defaulted":false}}]`,
	} {
		if _, err := store.db.ExecContext(ctx, "UPDATE orchestration_decisions SET sources=?", raw); err != nil {
			t.Fatal(err)
		}
		if page, err := store.ReadJournal(ctx, query); !errors.Is(err, errInvalidOrchRow) || len(page.Items) != 0 {
			t.Fatalf("corrupt source %s admitted: %+v %v", raw, page, err)
		}
	}
	if _, err := store.db.ExecContext(ctx, "PRAGMA ignore_check_constraints=ON"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE orchestration_decisions SET sources='[]',outcome='future'"); err != nil {
		t.Fatal(err)
	}
	if page, err := store.ReadJournal(ctx, query); !errors.Is(err, errInvalidOrchRow) || len(page.Items) != 0 {
		t.Fatalf("corrupt outcome admitted: %+v %v", page, err)
	}
}
