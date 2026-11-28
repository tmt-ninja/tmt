package storage

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const orchFirstJob = "2fd920c4-b289-49cb-a5ad-d08d55abb6ce"
const orchSecondJob = "4c881613-65a1-41e2-a91a-0ad7fa1c45c1"
const orchPlanID = "66a4f2b0-7ec1-4229-bf76-f8fb617fec64"

func TestReadJobsFiltersPagesAndProjectsPolicyAndRuns(t *testing.T) {
	parallelStorageFixture(t)
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

func TestOrchPolicySnapshotUsesNativeMemberCapAndFilterOrder(t *testing.T) {
	parallelStorageFixture(t)
	store := testStorage(t)
	ctx := t.Context()
	identities := make([]core.Identity, orchSnapshotMemberLimit+1)
	for i := range identities {
		name := fmt.Sprintf("A Ops %03d", i)
		if i >= 128 {
			name = fmt.Sprintf("Ops %03d", i)
		}
		identities[i] = core.Identity{ID: core.IdentityID(fmt.Sprintf("24874151-2cfc-49ab-848d-%012d", i)),
			Name: core.Name(name), CanonicalName: core.NormalizeName(name), Lifetime: core.LifetimeSaved}
	}
	if err := store.transact(ctx, false, func(r records) error {
		for _, identity := range identities {
			if err := r.Identities().Insert(identity, 1000); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	query := "  ＯＰＳ  "
	input := core.OrchSnapshotQuery{MemberQuery: &query}
	page, err := store.ReadPolicySnapshot(ctx, input)
	failure := requireRequestFailure(t, err, "ORCH_LIMIT", 1)
	if failure.Message != "Orchestration query exceeds its bounded expansion." {
		t.Fatalf("over-limit message: %q", failure.Message)
	}
	if len(page.IdentityIDs) != 0 || len(page.Policy.Identities) != 0 {
		t.Fatalf("more than 256 matches produced a partial snapshot: %+v", page)
	}

	last := identities[len(identities)-1].ID
	if _, err := store.db.ExecContext(ctx, "UPDATE identities SET retired_at_ms=1500 WHERE id=?", last); err != nil {
		t.Fatal(err)
	}
	page, err = store.ReadPolicySnapshot(ctx, input)
	if err != nil || len(page.IdentityIDs) != orchSnapshotMemberLimit || len(page.Policy.Identities) != orchSnapshotMemberLimit {
		t.Fatalf("exact member cap = %d/%d, %v", len(page.IdentityIDs), len(page.Policy.Identities), err)
	}
	want := append(slices.Clone(identities[128:256]), identities[:128]...)
	for i, identity := range want {
		id := page.IdentityIDs[i]
		if id != identity.ID || page.Policy.Identities[id] != identity.Name {
			t.Fatalf("member %d = %s (%q), want %s (%q)", i, id, page.Policy.Identities[id], identity.ID, identity.Name)
		}
	}
}

func TestOrchPolicySnapshotMatchesFollowingDigestReceivingRead(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	ctx := t.Context()
	if _, err := store.db.ExecContext(ctx, "INSERT INTO orchestration_settings(id,revision,time_zone) VALUES (1,8,'UTC')"); err != nil {
		t.Fatal(err)
	}
	write := core.DigestReceivingWrite{Enabled: true, Default: core.OrchReceiving{Mode: core.OrchReceivingAuto},
		Members: []core.DigestReceivingMember{{IdentityID: bindingOwnerID, Receiving: core.OrchReceiving{Mode: core.OrchReceivingDirect}}}}
	rev, err := store.SyncReceiving(ctx, write)
	if err != nil || rev != 1 {
		t.Fatalf("initial receiving: %d %v", rev, err)
	}
	write.ExpectedRevision = rev
	write.Default = core.OrchReceiving{Mode: core.OrchReceivingBatch, IntervalMs: 60000}
	rev, err = store.SyncReceiving(ctx, write)
	if err != nil || rev != 2 {
		t.Fatalf("updated receiving: %d %v", rev, err)
	}
	page, err := store.ReadPolicySnapshot(ctx, core.OrchSnapshotQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if page.Policy.Revision != 8 || page.Policy.DigestRevision != rev || !page.Policy.DigestEnabled ||
		len(page.IdentityIDs) != 2 || page.Policy.Identities[bindingOwnerID] != "Alice" ||
		page.Policy.BaseReceiving[bindingOwnerID].Mode != core.OrchReceivingDirect ||
		page.Policy.BaseReceiving[bindingOtherID] != write.Default {
		t.Fatalf("overview policy: %+v", page)
	}
	// Digest uses the overview receiving revision to CAS its actual follow-up
	// publication. An identical document must preserve that revision.
	write.ExpectedRevision = page.Policy.DigestRevision
	if following, err := store.SyncReceiving(ctx, write); err != nil || following != page.Policy.DigestRevision {
		t.Fatalf("following Digest receiving revision = %d, %v", following, err)
	}
	jobs, err := store.ReadJobs(ctx, core.OrchJobQuery{Limit: 1, NowMs: 2000})
	if err != nil || jobs.Policy.DigestRevision != page.Policy.DigestRevision {
		t.Fatalf("following jobs policy revision = %d, %v", jobs.Policy.DigestRevision, err)
	}
}

func TestSchemaVersionObservesNewerHistoryOnOpenHandle(t *testing.T) {
	parallelStorageFixture(t)
	store := testStorage(t)
	ctx := t.Context()
	const version = uint64(SchemaVersion + 1)
	if _, err := store.db.ExecContext(ctx, "INSERT INTO _migrations VALUES (?, 'future-schema', 'future')", version); err != nil {
		t.Fatal(err)
	}
	if got, err := store.SchemaVersion(ctx); err != nil || got != version {
		t.Fatalf("observed schema = %d, %v, want %d", got, err, version)
	}
}
