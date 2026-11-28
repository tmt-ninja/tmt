package storage

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func capturePreparationFixture(t testing.TB) (*Storage, ports.HookCapturePreparation) {
	t.Helper()
	ctx := t.Context()
	store := testStorage(t)
	if _, err := store.db.ExecContext(ctx, `INSERT INTO identities
		(id,name,canonical_name,lifetime,created_at,updated_at)
		VALUES (?1,'Fixture','fixture','saved','1000','1000');
		INSERT INTO bindings
		(id,identity_id,transport,server_id,socket_path,server_pid,server_start_time,
		 pane_id,pane_pid,bound_at,last_verified_at,runtime_state,last_transition,runtime_pid,
		 runtime_start_identity,observed_provider_session_id,launch_owner_pid,launch_owner_start_identity)
		VALUES (?2,?1,'tmux','server-id','/tmp/fixture.sock',456,'server-start','%1',789,'1000','1000',
		 'running','started',120,'runtime-start','saved-session',119,'owner-start');
		INSERT INTO identity_session_preferences
		(identity_id,preferred_harness,remembered_harness,runtime_mode,provider_session_id,driver_state,driver_state_version)
		VALUES (?1,'claude','claude','default','saved-session',
		 '{"activity":{"session":"saved-session","pid":120,"start":"runtime-start","turn":"fixture-turn","state":"working","sinceMs":9000,"lastActivityMs":9000}}',3)`,
		bindingOwnerID, bindingID1); err != nil {
		t.Fatal(err)
	}
	var binding *core.Binding
	if err := store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		binding, err = tx.Bindings().FindByIdentity(bindingOwnerID)
		return err
	}); err != nil || binding == nil || binding.Session.LaunchOwner == nil || binding.Session.Runtime == nil {
		t.Fatalf("binding fixture = %+v, %v", binding, err)
	}
	turn := "fixture-turn"
	return store, ports.HookCapturePreparation{Expected: *binding, Owner: *binding.Session.LaunchOwner,
		Runtime: *binding.Session.Runtime, Driver: core.DriverClaude, ProviderSession: "saved-session", Turn: &turn,
		Final: &core.HookFinalText{Text: "a captured final", OriginalBytes: 16}, ObservedAtMs: uint64(time.Now().UnixMilli())}
}

func TestOpenExistingCaptureRequiresCurrentRegularDatabase(t *testing.T) {
	ctx := t.Context()
	root := testRoot(t)
	if store, err := OpenExistingCapture(ctx, root, 0); err != nil || store != nil {
		t.Fatalf("missing hook store = %v, %v", store, err)
	}
	if _, err := os.Lstat(root.Dir); !os.IsNotExist(err) {
		t.Fatalf("missing hook store provisioned a home: %v", err)
	}

	if err := os.Mkdir(root.Dir, 0700); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(root.Dir, "other.db")
	if err := os.WriteFile(file, []byte("untouched"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(file, root.Database); err != nil {
		t.Fatal(err)
	}
	if store, err := OpenExistingCapture(ctx, root, 0); err == nil || store != nil {
		t.Fatalf("linked capture store = %v, %v", store, err)
	}
	assertFootprintFile(t, file, []byte("untouched"))

	older := testRoot(t)
	writeFootprintFixture(t, older.Dir, filepath.Base(older.Database), "")
	db := openFootprintFixture(t, older.Database)
	if _, err := db.Exec("CREATE TABLE fixture(data TEXT)"); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(older.Database)
	if err != nil {
		t.Fatal(err)
	}
	if store, err := OpenExistingCapture(ctx, older, 0); err == nil || store != nil {
		t.Fatalf("incompatible capture store = %v, %v", store, err)
	}
	assertFootprintFile(t, older.Database, before)
	if _, err := os.Lstat(filepath.Join(older.Dir, hookQueueFilename)); !os.IsNotExist(err) {
		t.Fatalf("incompatible capture store provisioned a queue: %v", err)
	}
}

func TestPrepareHookCaptureFencesExactLaunchAndCommitsFinal(t *testing.T) {
	parallelStorageFixture(t)
	store, input := capturePreparationFixture(t)
	ctx := t.Context()
	root := home.Root{Dir: filepath.Dir(store.path), Database: store.path}
	hook, err := OpenExistingCapture(ctx, root, 0)
	if err != nil || hook == nil {
		t.Fatalf("existing hook store = %v, %v", hook, err)
	}
	defer hook.Close()
	for _, drift := range []func(*ports.HookCapturePreparation){
		func(p *ports.HookCapturePreparation) { p.Expected.ID = bindingID2 },
		func(p *ports.HookCapturePreparation) { p.Owner.PID++ },
		func(p *ports.HookCapturePreparation) { p.Runtime.StartIdentity = "replacement-runtime" },
		func(p *ports.HookCapturePreparation) { p.ProviderSession = "replacement-session" },
		func(p *ports.HookCapturePreparation) { p.Driver = core.DriverCodex },
	} {
		wrong := input
		drift(&wrong)
		if event, err := hook.PrepareHookCapture(ctx, wrong); err != nil || event != nil {
			t.Fatalf("drifted hook preparation = %+v, %v", event, err)
		}
	}
	path := "ignored transcript path"
	input.FollowUp.Transcript = &path
	var event *core.HookCaptureEvent
	if err := store.transact(ctx, false, func(r records) error {
		// BEGIN IMMEDIATE is already held by this other connection.
		var err error
		event, err = hook.PrepareHookCapture(ctx, input)
		return err
	}); err != nil || event == nil || event.Capture == nil || event.Capture.Admitted != core.HookCaptureCommitted ||
		!event.Capture.Provisional || event.Capture.Batch == nil || event.FollowUp.Transcript != nil {
		t.Fatalf("prepared capture = %+v, %v", event, err)
	}
	var batches, receipts int
	if err := store.db.QueryRowContext(ctx, "SELECT (SELECT COUNT(*) FROM capture_batches),(SELECT COUNT(*) FROM hook_capture_receipts)").
		Scan(&batches, &receipts); err != nil || batches != 0 || receipts != 0 {
		t.Fatalf("preparation wrote batches=%d receipts=%d, %v", batches, receipts, err)
	}
	receipt, err := hook.CommitCapture(ctx, *event)
	if err != nil || receipt.Outcome != core.HookCaptureCommitted || receipt.BatchID == nil || *receipt.BatchID != *event.Capture.Batch {
		t.Fatalf("commit = %+v, %v", receipt, err)
	}
	repeat, err := hook.CommitCapture(ctx, *event)
	if err != nil || repeat.EventID != receipt.EventID || repeat.CommittedAtMs != receipt.CommittedAtMs || repeat.Outcome != receipt.Outcome {
		t.Fatalf("exact replay = %+v, %v", repeat, err)
	}
	var final, phase string
	if err := store.db.QueryRowContext(ctx, `SELECT (SELECT text FROM recent_responses),
		json_extract(driver_state,'$.activity.state') FROM identity_session_preferences WHERE identity_id=?`, bindingOwnerID).
		Scan(&final, &phase); err != nil || final != input.Final.Text || phase != "idle" {
		t.Fatalf("durable final %q, phase %q, %v", final, phase, err)
	}

	input.Final = nil
	next, err := hook.PrepareHookCapture(ctx, input)
	if err != nil || next == nil || next.Capture.Admitted != core.HookCaptureDuplicate ||
		next.Capture.Provisional || !equalOptionalText(next.Capture.Batch, receipt.BatchID) {
		t.Fatalf("ordinary duplicate = %+v, %v", next, err)
	}
	input.Continuation = true
	if next, err = hook.PrepareHookCapture(ctx, input); err != nil || next == nil || next.Capture.Admitted != core.HookCaptureNotApplicable {
		t.Fatalf("replayed continuation = %+v, %v", next, err)
	}
	input.ObservedAtMs++
	if next, err = hook.PrepareHookCapture(ctx, input); err != nil || next == nil || next.Capture.Admitted != core.HookCaptureCommitted {
		t.Fatalf("strictly later continuation = %+v, %v", next, err)
	}
	otherTurn := "other-turn"
	input.Turn = &otherTurn
	if next, err = hook.PrepareHookCapture(ctx, input); err != nil || next == nil || next.Capture.Admitted != core.HookCaptureNoAdmittedStart {
		t.Fatalf("different turn = %+v, %v", next, err)
	}
	input.Interrupted = true
	if next, err = hook.PrepareHookCapture(ctx, input); err != nil || next == nil || next.Capture.Admitted != core.HookCaptureNotApplicable {
		t.Fatalf("interrupted different turn = %+v, %v", next, err)
	}
}

func BenchmarkPrepareAndCommitHookCapture(b *testing.B) {
	store, input := capturePreparationFixture(b)
	ctx := b.Context()
	if _, err := store.db.ExecContext(ctx, `WITH RECURSIVE fixture(n) AS (
		VALUES (1) UNION ALL SELECT n+1 FROM fixture WHERE n<512)
		INSERT INTO identities (id,name,canonical_name,lifetime,created_at,updated_at)
		SELECT printf('a0be3c52-44c8-44e5-922b-%012d',n),printf('Seat %d',n),
			printf('seat-%d',n),'saved','1000','1000' FROM fixture;
		WITH RECURSIVE fixture(n) AS (VALUES (1) UNION ALL SELECT n+1 FROM fixture WHERE n<1024)
		INSERT INTO capture_batches (id,identity_id,binding_id,driver,session_id,runtime_pid,runtime_start,
			provider_turn,created_ms,closed_ms)
		SELECT printf('b0be3c52-44c8-44e5-922b-%012d',n),?1,?2,'claude','saved-session',
			120,'runtime-start','fixture-turn',8000,8500 FROM fixture`, bindingOwnerID, bindingID1); err != nil {
		b.Fatal(err)
	}
	root := home.Root{Dir: filepath.Dir(store.path), Database: store.path}
	hook, err := OpenExistingCapture(ctx, root, 30*time.Second)
	if err != nil || hook == nil {
		b.Fatalf("existing hook store = %v, %v", hook, err)
	}
	defer hook.Close()
	input.Continuation = true
	for b.Loop() {
		input.ObservedAtMs++
		event, err := hook.PrepareHookCapture(ctx, input)
		if err != nil || event == nil || event.Capture.Admitted != core.HookCaptureCommitted {
			b.Fatalf("prepare = %+v, %v", event, err)
		}
		receipt, err := hook.CommitCapture(ctx, *event)
		if err != nil || receipt.Outcome != core.HookCaptureCommitted {
			b.Fatalf("commit = %+v, %v", receipt, err)
		}
	}
}

func TestClaudePromptAdmitsOrdinaryStopAndKeepsNewerActivity(t *testing.T) {
	parallelStorageFixture(t)
	store, stop := capturePreparationFixture(t)
	ctx := t.Context()
	stop.Turn = nil
	editResumeFixture(t, store, "UPDATE identity_session_preferences SET driver_state=?, driver_state_version=6 WHERE identity_id=?",
		`{"model":"starting-model","noStartupIdle":{"session":"saved-session","pid":120,"start":"runtime-start"}}`, bindingOwnerID)
	prompt := ports.DigestPromptObservation{Expected: stop.Expected, Owner: stop.Owner, Runtime: stop.Runtime,
		ProviderSession: stop.ProviderSession, ObservedAtMs: stop.ObservedAtMs - 3}
	event, err := store.PrepareHookCapture(ctx, stop)
	if err != nil || event == nil || event.Capture.Admitted != core.HookCaptureNoAdmittedStart {
		t.Fatalf("Stop before prompt = %+v, %v", event, err)
	}
	observe := func(p ports.DigestPromptObservation, want bool) {
		t.Helper()
		writeBindingTest(t, store, func(tx ports.StoreTx) error {
			ok, err := tx.Bindings().ObserveDigestPrompt(p)
			requireBindingChange(t, ok, err, want)
			return nil
		})
	}
	observe(prompt, true)
	prompt.ObservedAtMs++
	observe(prompt, true)
	older := prompt
	older.ObservedAtMs--
	observe(older, false)
	var model, phase string
	var turn, suppression *string
	var since, last uint64
	if err := store.db.QueryRowContext(ctx, `SELECT json_extract(driver_state,'$.model'),json_extract(driver_state,'$.activity.state'),
		json_extract(driver_state,'$.activity.turn'),json_extract(driver_state,'$.noStartupIdle'),
		json_extract(driver_state,'$.activity.sinceMs'),json_extract(driver_state,'$.activity.lastActivityMs')
		FROM identity_session_preferences WHERE identity_id=?`, bindingOwnerID).
		Scan(&model, &phase, &turn, &suppression, &since, &last); err != nil || model != "starting-model" ||
		phase != "working" || turn != nil || suppression != nil || since != prompt.ObservedAtMs || last != prompt.ObservedAtMs {
		t.Fatalf("prompt state = %q %q %v %v %d %d, %v", model, phase, turn, suppression, since, last, err)
	}
	event, err = store.PrepareHookCapture(ctx, stop)
	if err != nil || event == nil || event.Capture.Admitted != core.HookCaptureCommitted {
		t.Fatalf("ordinary Stop after prompt = %+v, %v", event, err)
	}
	receipt, err := store.CommitCapture(ctx, *event)
	if err != nil || receipt.Outcome != core.HookCaptureCommitted {
		t.Fatalf("ordinary Stop receipt = %+v, %v", receipt, err)
	}
}
