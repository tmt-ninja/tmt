package orchestration

import (
	"bytes"
	"context"
	"encoding/base64"
	json "encoding/json/v2"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type jobFixture struct {
	ports.OrchReader
	page  core.OrchJobReadPage
	query core.OrchJobQuery
}

func (f *jobFixture) ReadJobs(_ context.Context, q core.OrchJobQuery) (core.OrchJobReadPage, error) {
	f.query = q
	return f.page, nil
}

func TestJobCursorBindsCanonicalFiltersAndNativeDocument(t *testing.T) {
	owner := core.IdentityID("11111111-1111-4111-8111-111111111111")
	at, after := uint64(1_700_000_000_000), uint64(2)
	query := core.OrchJobQuery{OwnerID: &owner, Limit: 1, NowMs: at}
	zone := "UTC"
	f := &jobFixture{page: core.OrchJobReadPage{
		Items:     []core.OrchJob{{Number: 2, Schedule: core.OrchJobSchedule{Kind: core.OrchJobEvery, Zone: zone, Seconds: 10}}},
		NextAfter: &after, Policy: core.OrchPolicySnapshot{TimeZone: &zone},
	}}
	view, failure := ReadJobs(t.Context(), f, query)
	if failure != nil || view.NextCursor == nil {
		t.Fatalf("jobs result: %+v %v", view, failure)
	}
	want := `{"version":1,"after":2,"room":null,"owner":"11111111-1111-4111-8111-111111111111","job":null}`
	decoded, err := base64.RawURLEncoding.DecodeString(*view.NextCursor)
	if err != nil || string(decoded) != want {
		t.Fatalf("cursor = %q, %v", decoded, err)
	}
	query.Limit = 2 // A page size change keeps the canonical selector tuple.
	next, ok := AdmitJobs(query, view.NextCursor)
	if !ok || next.AfterNumber != 2 {
		t.Fatalf("resume = %+v, %t", next, ok)
	}
	query.OwnerID = nil
	if _, ok := AdmitJobs(query, view.NextCursor); ok {
		t.Fatal("cursor from another owner admitted")
	}
	withNewline := *view.NextCursor + "\n"
	if _, ok := AdmitJobs(f.query, &withNewline); ok {
		t.Fatal("noncanonical base64 cursor admitted")
	}
}

func TestJobsCarryExactShowBodyAndBodyFreeCanonicalRunEvidence(t *testing.T) {
	jobID := "22222222-2222-4222-8222-222222222222"
	title, message := "Standup", "  hello\x00雪\r\n"
	owner, ownerName := core.IdentityID("11111111-1111-4111-8111-111111111111"), core.Name("Night-1")
	kind, zone := core.OrchJobEvery, "UTC"
	at := uint64(1_700_000_000_000)
	runRequest := core.RequestID("req_33333333-3333-4333-8333-333333333333")
	response, length := "response that stays private", uint64(27)
	ack := true
	room := core.RoomID("55555555-5555-4555-8555-555555555555")
	parent := core.RequestID("req_66666666-6666-4666-8666-666666666666")
	row := core.OrchJob{ID: jobID, Number: 7, Revision: 1, OwnerID: &owner, OwnerName: &ownerName, OwnerAvailable: true,
		Title: &title, MessagePreview: "  hello", Schedule: core.OrchJobSchedule{Kind: kind, Zone: zone, Seconds: 10}}
	f := &jobFixture{page: core.OrchJobReadPage{
		Items: []core.OrchJob{row}, Policy: core.OrchPolicySnapshot{TimeZone: &zone, Identities: map[core.IdentityID]core.Name{owner: ownerName}},
		FullMessage: &message, RecentRuns: map[string][]core.OrchJobRun{jobID: {{
			ID: 6, Revision: 1, SlotMs: int64(at), RecordedMs: at,
			Receipt: core.OrchDispatchReceipt{OperationID: "44444444-4444-4444-8444-444444444444", Items: []core.OrchDispatchItem{{RequestID: runRequest, Acceptance: core.OrchDispatchQueued}}},
			Request: &core.OrchJobRequest{Attempt: core.RequestAttempt{RequestID: runRequest, Recipient: &owner, Route: core.RequestRoute{Kind: core.RequestRouteInbox}},
				RoomID: &room, ParentRequestID: &parent, RecipientAcknowledged: ack,
				Final: core.XFinal{Status: core.FinalRetained, Response: &response, BodyBytes: &length, SubmittedAtMs: &at, ExpiresAtMs: &at}},
		}}},
	}}
	query := core.OrchJobQuery{NowMs: at, Limit: 1, JobID: &jobID}
	list, failure := ReadJobs(t.Context(), f, query)
	if failure != nil || len(list.Jobs) != 1 || list.Jobs[0].Definition != nil ||
		list.Jobs[0].State != "on" || list.Jobs[0].NextRunAtMs == nil || *list.Jobs[0].NextRunAtMs != int64(at)+10_000 {
		t.Fatalf("list result = %+v %v", list, failure)
	}
	detail, failure := ReadJob(t.Context(), f, query)
	if failure != nil || !f.query.FullMessage || detail.Job.DisplayID != "j7" || detail.Job.Definition == nil || detail.Job.Definition.Message != message ||
		detail.Job.LastRun == nil || detail.Job.LastRun.ResultReference == nil || detail.Job.LastRun.ResultReference.RequestID != runRequest ||
		len(detail.Job.RecentRuns) != 1 {
		t.Fatalf("show result = %+v %v", detail, failure)
	}
	wire, err := json.Marshal(detail)
	if err != nil || bytes.Contains(wire, []byte(response)) || !bytes.Contains(wire, []byte(`"anchorMs":0,"from":null`)) ||
		!bytes.Contains(wire, []byte(`"recipientAcknowledged":true`)) ||
		!bytes.Contains(wire, []byte(`"parentRequestId":"`+string(parent)+`","roomId":"`+string(room)+`"`)) {
		t.Fatalf("show shape = %s %v", wire, err)
	}
	// A successful pane delivery still carries no recipient acknowledgment.
	f.page.RecentRuns[jobID][0].Request.Attempt.Route.Kind = core.RequestRoutePane
	detail, failure = ReadJob(t.Context(), f, query)
	if failure != nil || detail.Job.LastRun == nil || detail.Job.LastRun.Request == nil ||
		detail.Job.LastRun.Request.RecipientAcknowledged != nil {
		t.Fatalf("pane acknowledgment = %+v %v", detail.Job.LastRun, failure)
	}

}
