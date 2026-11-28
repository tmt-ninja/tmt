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
	firstNumber := uint64(1)
	byNumber := core.OrchJobQuery{Limit: 1, NowMs: 6000, Number: &firstNumber, FullMessage: true}
	page, err = store.ReadJobs(ctx, byNumber)
	if err != nil || len(page.Items) != 1 || page.Items[0].ID != first || page.NextAfter != nil ||
		page.FullMessage == nil || *page.FullMessage != message {
		t.Fatalf("exact number page: %+v, %v", page, err)
	}
	both := byNumber
	both.JobID = &first
	_, err = store.ReadJobs(ctx, both)
	requireRequestFailure(t, err, "ORCH_INPUT_INVALID", 1)
	for _, invalid := range []uint64{0, core.MaxJSSafeInteger + 1} {
		invalidQuery := byNumber
		invalidQuery.Number = &invalid
		_, err = store.ReadJobs(ctx, invalidQuery)
		requireRequestFailure(t, err, "ORCH_INPUT_INVALID", 1)
	}
	excluded := byNumber
	other := bindingOtherID
	excluded.OwnerID = &other
	page, err = store.ReadJobs(ctx, excluded)
	if err != nil || len(page.Items) != 0 || page.FullMessage != nil {
		t.Fatalf("filtered job returned text: %+v, %v", page, err)
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE orchestration_jobs SET removed=1, revision=2 WHERE id=?", first); err != nil {
		t.Fatal(err)
	}
	page, err = store.ReadJobs(ctx, byNumber)
	if err != nil || len(page.Items) != 0 || page.FullMessage != nil {
		t.Fatalf("removed job returned text: %+v, %v", page, err)
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

	// Native Plans skips the 256-member expansion while preserving the plan
	// documents, including targets and overrides.
	insertPlans := func(first, end int) {
		t.Helper()
		if err := store.transact(ctx, false, func(r records) error {
			for n := first; n < end; n++ {
				id := fmt.Sprintf("379a614e-5064-4678-af33-%012d", n)
				priority := orchPlanLimit - n
				if _, err := r.exec(`INSERT INTO orchestration_plans (id,name,revision,priority,enabled,schedule,fields)
					VALUES (?, ?, 1, ?, 1, '{"kind":"always"}', '{}')`,
					id, fmt.Sprintf("Plan %03d", priority), priority); err != nil {
					return err
				}
				if _, err := r.exec(`INSERT INTO orchestration_plan_targets (plan_id,position,target)
					VALUES (?,0,'{"kind":"all"}')`, id); err != nil {
					return err
				}
				if priority == 1 {
					if _, err := r.exec(`INSERT INTO orchestration_plan_targets (plan_id,position,target)
						VALUES (?,1,json_object('kind','identity','id',?))`, id, identities[0].ID); err != nil {
						return err
					}
					if _, err := r.exec(`INSERT INTO orchestration_member_overrides (plan_id,identity_id,fields)
						VALUES (?,?,'{"routine":"run"}')`, id, identities[0].ID); err != nil {
						return err
					}
				}
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := store.db.ExecContext(ctx, "INSERT INTO orchestration_settings VALUES (1,42,'UTC')"); err != nil {
		t.Fatal(err)
	}
	insertPlans(0, orchPlanLimit)
	plans, err := store.ReadPlans(ctx)
	if err != nil || plans.Revision != 42 || len(plans.Plans) != orchPlanLimit {
		t.Fatalf("read plans with 257 active members: revision %d, %d plans, %v", plans.Revision, len(plans.Plans), err)
	}
	for n, plan := range plans.Plans {
		if plan.Priority != int32(n+1) {
			t.Fatalf("plan %d priority = %d", n, plan.Priority)
		}
	}
	firstPlan := plans.Plans[0]
	override := firstPlan.Members[identities[0].ID]
	if len(firstPlan.Targets) != 2 || firstPlan.Targets[0].Kind != "all" ||
		firstPlan.Targets[1].Kind != "identity" || firstPlan.Targets[1].ID != identities[0].ID ||
		override.Routine == nil || *override.Routine != core.OrchRoutineRun {
		t.Fatalf("first plan targets and overrides: %+v", firstPlan)
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

	insertPlans(orchPlanLimit, orchPlanLimit+1)
	overflow, err := store.ReadPlans(ctx)
	failure = requireRequestFailure(t, err, "ORCH_LIMIT", 1)
	if failure.Message != "Orchestration query exceeds its bounded expansion." ||
		overflow.Revision != 0 || len(overflow.Plans) != 0 {
		t.Fatalf("plan overflow: %+v, %v", overflow, failure)
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

func TestReadJobRunProjectsExactRequestEvidence(t *testing.T) {
	parallelStorageFixture(t)
	ctx := t.Context()
	store := bindingFixture(t)
	clock := &requestClock{ms: 10_000}
	service := NewRequestService(store, clock)
	requestID := core.RequestID("req_1f2f8c9c-ecc4-46e5-9230-e08a7bf54f61")
	in := inboxRequest(requestID)
	sender, recipient := bindingOtherID, bindingOwnerID
	in.Originator.IdentityID, in.Recipient, in.Route.Recipient = &sender, &recipient, &recipient
	prepared, err := service.Enqueue(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	parent := core.RequestID("req_361a34af-1316-46a3-aab4-c2274468b471")
	room := core.RoomID("044b7488-3fd8-4913-ad09-2aa7dc66d00b")
	operation := "d11f253f-9af4-47aa-bcd3-bbb9a46b48b0"
	receipt := fmt.Sprintf(`{"operationId":%q,"createdAtMs":10000,"items":[{"recipientId":%q,"requestId":%q,"acceptance":"queued"}]}`,
		operation, recipient, requestID)
	editResumeFixture(t, store, `UPDATE request_attempts SET thread_root_request_id=?1, room_id=?2 WHERE request_id=?3`, parent, room, requestID)
	editResumeFixture(t, store, `INSERT INTO orchestration_jobs(id,revision,owner_id,message,schedule)
		VALUES (?,1,?,'run it','{"kind":"every","zone":"UTC","seconds":60,"anchorMs":0}')`, orchFirstJob, recipient)
	editResumeFixture(t, store, `INSERT INTO office_dispatch_operations(operation_id,intent_digest,receipt)
		VALUES (?,?,?)`, operation, strings.Repeat("a", 64), receipt)
	editResumeFixture(t, store, `INSERT INTO orchestration_job_runs(job_id,revision,slot_ms,observed_slot_ms,manual,operation_id,recorded_ms)
		VALUES (?,1,0,0,0,?,10000)`, orchFirstJob, operation)
	number := uint64(1)
	read := func(acknowledged bool) core.OrchJobRequest {
		t.Helper()
		var before, after uint64
		if err := store.db.QueryRowContext(ctx, "SELECT value FROM change_cursor WHERE id=1").Scan(&before); err != nil {
			t.Fatal(err)
		}
		page, err := store.ReadJobs(ctx, core.OrchJobQuery{Limit: 1, Number: &number, NowMs: uint64(clock.ms)})
		runs := page.RecentRuns[orchFirstJob]
		if err != nil || len(runs) != 1 || runs[0].Request == nil {
			t.Fatalf("job runs = %+v, %v", runs, err)
		}
		request := *runs[0].Request
		if request.Attempt.RequestID != requestID || request.ParentRequestID == nil || *request.ParentRequestID != parent ||
			request.RoomID == nil || *request.RoomID != room || request.RecipientAcknowledged != acknowledged {
			t.Fatalf("request evidence = %+v, want acknowledged=%t", request, acknowledged)
		}
		if err := store.db.QueryRowContext(ctx, "SELECT value FROM change_cursor WHERE id=1").Scan(&after); err != nil || before != after {
			t.Fatalf("job read changed cursor: %d to %d, %v", before, after, err)
		}
		return request
	}
	if request := read(false); request.Final.Status != core.FinalNotSubmitted {
		t.Fatalf("unanswered request final = %+v", request.Final)
	}
	if _, err := service.AckAllX(ctx, sender, core.XOutgoing); err != nil {
		t.Fatal(err)
	}
	read(false)
	incoming, err := service.ShowX(ctx, recipient, core.XIncoming, requestID)
	if err != nil {
		t.Fatal(err)
	}
	if ack, err := service.AckX(ctx, recipient, core.XIncoming, requestID, incoming.Exchange.Revision); err != nil || !ack.Changed {
		t.Fatalf("individual acknowledgement = %+v, %v", ack, err)
	}
	read(true)
	// Reset just this fixture's per-request acknowledgement to isolate the
	// recipient-wide watermark case from the per-row case.
	editResumeFixture(t, store, "UPDATE request_attempts SET recipient_attention_acknowledged_revision=0 WHERE request_id=?", requestID)
	read(false)
	if _, err := service.AckAllX(ctx, recipient, core.XIncoming); err != nil {
		t.Fatal(err)
	}
	read(true)
	if _, err := service.SubmitResponse(ctx, core.SubmitResponse{
		RequestID: requestID, Receipt: prepared.Receipt, Body: "FINAL-BODY-MUST-NOT-BE-IN-JOBS",
	}); err != nil {
		t.Fatal(err)
	}
	if request := read(true); request.Final.Status != core.FinalRetained || request.Final.Response != nil {
		t.Fatalf("answered request final = %+v", request.Final)
	}
}
