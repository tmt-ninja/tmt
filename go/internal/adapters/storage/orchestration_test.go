package storage

import (
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const orchFirstJob = "2fd920c4-b289-49cb-a5ad-d08d55abb6ce"
const orchSecondJob = "4c881613-65a1-41e2-a91a-0ad7fa1c45c1"
const orchPlanID = "66a4f2b0-7ec1-4229-bf76-f8fb617fec64"

func TestReadJobsFiltersPagesAndProjectsPolicyAndRuns(t *testing.T) {
	ctx := t.Context()
	store := bindingFixture(t)
	message := strings.Repeat("界", 100) + " final marker"
	if _, err := store.db.ExecContext(ctx, `INSERT INTO orchestration_jobs(id,revision,owner_id,message,schedule)
		VALUES (?,1,?,?, '{"kind":"every","zone":"UTC","seconds":60,"anchorMs":0,"from":null}'),
		(?,2,?,'second','{"kind":"cron","zone":"UTC","expression":"* * * * *"}')`,
		orchFirstJob, bindingOwnerID, message, orchSecondJob, bindingOtherID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO orchestration_settings VALUES (1,9,'UTC');
		INSERT INTO digest_receiving_settings VALUES (1,8,'{"enabled":true,"defaultReceiving":{"mode":"auto"},"members":[]}');
		INSERT INTO orchestration_wake_clock(id,next_admission_ms) VALUES (1,4567)`); err != nil {
		t.Fatal(err)
	}
	operation := "d11f253f-9af4-47aa-bcd3-bbb9a46b48b0"
	receipt := `{"operationId":"` + operation + `","createdAtMs":5000,"items":[{"recipientId":"` + string(bindingOwnerID) + `","requestId":"req_1f2f8c9c-ecc4-46e5-9230-e08a7bf54f61","acceptance":"recipientUnavailable"}]}`
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`INSERT INTO orchestration_plans(id,name,revision,priority,enabled,schedule,fields)
		VALUES (?,'Working week',3,7,1,'{"kind":"weekly","anchorDate":"2026-11-23","intervalWeeks":1,"weekdays":[1,2],"start":"09:00","end":"17:00"}',
		'{"routine":"hold","talkLimit":null}')`, []any{orchPlanID}},
		{`INSERT INTO orchestration_plan_targets(plan_id,position,target) VALUES (?,0,'{"kind":"all"}')`, []any{orchPlanID}},
		{`INSERT INTO orchestration_member_overrides(plan_id,identity_id,fields) VALUES (?,?,'{"routine":"run"}')`, []any{orchPlanID, bindingOwnerID}},
		{`INSERT INTO office_dispatch_operations(operation_id,intent_digest,receipt) VALUES (?,?,?)`, []any{operation, strings.Repeat("a", 64), receipt}},
		{`INSERT INTO orchestration_job_runs(job_id,revision,slot_ms,observed_slot_ms,manual,operation_id,recorded_ms)
		VALUES (?,1,0,0,0,?,5000)`, []any{orchFirstJob, operation}},
	} {
		if _, err := store.db.ExecContext(ctx, statement.sql, statement.args...); err != nil {
			t.Fatal(err)
		}
	}

	query := core.OrchJobQuery{Limit: 1, NowMs: 6000}
	page, err := store.ReadJobs(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].ID != orchFirstJob || !page.Items[0].OwnerAvailable ||
		page.Items[0].MessagePreview != strings.Repeat("界", 85) || page.FullMessage != nil || page.NextAfter == nil {
		t.Fatalf("first page: %+v", page)
	}
	policy := page.Policy
	if policy.Revision != 9 || policy.TimeZone == nil || *policy.TimeZone != "UTC" || !policy.DigestEnabled || policy.DigestRevision != 8 ||
		len(policy.BaseReceiving) != 1 || policy.BaseReceiving[bindingOwnerID].Mode != core.OrchReceivingAuto ||
		len(policy.Plans) != 1 || len(policy.Plans[0].Schedule.Weekdays) != 2 ||
		!policy.Plans[0].Fields.TalkLimitPresent || policy.Plans[0].Fields.TalkLimit != nil ||
		*policy.Plans[0].Members[bindingOwnerID].Routine != core.OrchRoutineRun {
		t.Fatalf("owner policy: %+v", policy)
	}
	runs := page.RecentRuns[orchFirstJob]
	if len(runs) != 1 || runs[0].Receipt.Items[0].Acceptance != core.OrchDispatchUnavailable || runs[0].Request != nil {
		t.Fatalf("recent runs: %+v", runs)
	}
	query.AfterNumber = *page.NextAfter
	page, err = store.ReadJobs(ctx, query)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != orchSecondJob || page.NextAfter != nil ||
		len(page.Policy.BaseReceiving) != 1 || page.Policy.BaseReceiving[bindingOtherID].Mode != core.OrchReceivingAuto {
		t.Fatalf("second page: %+v, %v", page, err)
	}
	first := orchFirstJob
	page, err = store.ReadJobs(ctx, core.OrchJobQuery{Limit: 1, NowMs: 6000, JobID: &first, FullMessage: true})
	if err != nil || page.FullMessage == nil || *page.FullMessage != message {
		t.Fatalf("full message: %v, %v", page.FullMessage, err)
	}
	if version, err := store.SchemaVersion(ctx); err != nil || version != uint64(SchemaVersion) {
		t.Fatalf("schema: %d, %v", version, err)
	}
	if wake, err := store.WakeAdmissionMs(ctx); err != nil || wake != 4567 {
		t.Fatalf("wake clock: %d, %v", wake, err)
	}
}

func TestOrchJobsAndOwnerPolicyStayOnPinnedSnapshot(t *testing.T) {
	ctx := t.Context()
	store := bindingFixture(t)
	if _, err := store.db.ExecContext(ctx, `INSERT INTO orchestration_jobs(id,revision,owner_id,message,schedule)
		VALUES (?,1,?,'original','{"kind":"cron","zone":"UTC","expression":"* * * * *"}');
		INSERT INTO digest_receiving_settings VALUES (1,1,'{"enabled":true,"defaultReceiving":{"mode":"auto"},"members":[]}')`,
		orchFirstJob, bindingOwnerID); err != nil {
		t.Fatal(err)
	}
	writer, err := openSQLite(store.path)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()
	err = store.transact(ctx, true, func(r records) error {
		jobs, err := orchJobs(r, core.OrchJobQuery{Limit: 1, NowMs: 1000})
		if err != nil {
			return err
		}
		if len(jobs) != 1 {
			t.Fatalf("jobs: %+v", jobs)
		}
		if _, err := writer.ExecContext(ctx, `UPDATE orchestration_jobs SET message='changed',revision=2;
			UPDATE digest_receiving_settings SET revision=2,settings='{"enabled":true,"defaultReceiving":{"mode":"direct"},"members":[]}'`); err != nil {
			return err
		}
		job := jobs[0]
		policy, err := readOrchPolicy(r, map[core.IdentityID]core.Name{*job.OwnerID: *job.OwnerName})
		if err != nil {
			return err
		}
		if job.Revision != 1 || policy.DigestRevision != 1 || policy.BaseReceiving[bindingOwnerID].Mode != core.OrchReceivingAuto {
			t.Fatalf("snapshot mixed revisions: %+v, %+v", job, policy)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	page, err := store.ReadJobs(ctx, core.OrchJobQuery{Limit: 1, NowMs: 1000})
	if err != nil || len(page.Items) != 1 || page.Items[0].Revision != 2 || page.Policy.DigestRevision != 2 ||
		page.Policy.BaseReceiving[bindingOwnerID].Mode != core.OrchReceivingDirect {
		t.Fatalf("next snapshot did not see the writer: %+v, %v", page, err)
	}
}
