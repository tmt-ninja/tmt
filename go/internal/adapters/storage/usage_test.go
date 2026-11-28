package storage

import (
	"errors"
	"reflect"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func TestConsumptionHistoryKeepsClosedSeedAndSourceEvidence(t *testing.T) {
	parallelStorageFixture(t)
	store := bindingFixture(t)
	ctx := t.Context()
	const seed = `{"driver":"pi","session":"historical-session","consumption":{"inputTokens":120,"outputTokens":30,"cachedInputTokens":50,"cacheWriteTokens":0,"epoch":"1f2f8c9c-ecc4-46e5-9230-e08a7bf54f61","sequence":8,"observedAtMs":4198000,"complete":true,"gap":false}}`
	const details = `{"cacheWriteTokens":0,"byModel":[{"modelId":"past/model","inputTokens":10,"outputTokens":2,"cachedInputTokens":4,"cacheWriteTokens":0}],"byDriver":[{"driver":"agy","inputTokens":10,"outputTokens":2,"cachedInputTokens":4}]}`
	_, err := store.db.ExecContext(ctx, `INSERT INTO consumption_buckets
		(identity_id,from_ms,input_tokens,output_tokens,cached_input_tokens,covered_ms,complete,gap,discontinuous,sampled_at_ms,latest,details)
		VALUES (?1,4195000,10,2,4,5000,1,0,1,4198000,?2,?3),
		(?1,4200000,99,2,4,5000,1,0,0,4203000,?2,NULL)`, bindingOwnerID, seed, details)
	if err != nil {
		t.Fatal(err)
	}
	const earlier = `{"observedAtMs":3800000,"windows":[{"windowMinutes":300,"usedPercent":20,"resetsAtMs":5000000}]}`
	const later = `{"provider":"agy","observedAtMs":4100000,"windows":[{"windowMinutes":300,"usedPercent":25,"resetsAtMs":5200000}]}`
	_, err = store.db.ExecContext(ctx, `INSERT INTO consumption_tier5m
		(identity_id,from_ms,input_tokens,output_tokens,cached_input_tokens,covered_ms,complete,gap,discontinuous,sampled_at_ms,limits,details,credits,service_tier)
		VALUES (?1,3600000,10,2,4,300000,1,0,0,3800000,?2,?4,
		'{"observedAtMs":3800000,"balance":"42.00","hasCredits":true,"unlimited":false}','default'),
		(?1,3900000,10,2,4,1000,0,1,1,4100000,?3,?4,NULL,'priority')`, bindingOwnerID, earlier, later, details)
	if err != nil {
		t.Fatal(err)
	}
	cut := uint64(4200000)
	query := core.ConsumptionHistoryQuery{IdentityIDs: []core.IdentityID{bindingOtherID, "missing", bindingOwnerID, bindingOtherID},
		WindowsMs: []uint64{10000, 4200000}, MaxBuckets: 1, NowMs: 4209999, ThroughMs: &cut}
	page, err := store.ConsumptionHistory(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	if page.AsOfMs != query.NowMs || page.ThroughMs != cut || page.ResolutionMs != 5000 || page.RetainedFromMs != 0 ||
		len(page.Identities) != 4 || page.Identities[0].ID != bindingOtherID || page.Identities[1].Found ||
		page.Identities[3].ID != bindingOtherID || page.Identities[0].Cause == nil || *page.Identities[0].Cause != core.ConsumptionNoBinding {
		t.Fatalf("page bounds and identity order = %+v", page)
	}
	h := page.Identities[2]
	if !h.Found || !h.Reporting || h.Cause != nil || h.AvailableFromMs == nil || *h.AvailableFromMs != 4198000 ||
		h.LastSampleAtMs == nil || *h.LastSampleAtMs != 4198000 || h.Latest == nil || h.Latest.Driver != core.DriverName("pi") ||
		h.Latest.Session != "historical-session" || h.Latest.Consumption.Sequence != 8 || h.Latest.Consumption.ObservedAtMs != 4198000 ||
		h.Latest.Consumption.CacheWriteTokens == nil || *h.Latest.Consumption.CacheWriteTokens != 0 {
		t.Fatalf("closed seed = %+v", h)
	}
	if len(h.Windows) != 2 || h.Windows[0].WindowMs != 10000 || h.Windows[1].WindowMs != 4200000 {
		t.Fatalf("window order = %+v", h.Windows)
	}
	fine := h.Windows[0].Buckets[0]
	if fine.InputTokens != 10 || fine.CoveredMs != 5000 || fine.Complete || !fine.Gap || !fine.Discontinuous ||
		fine.CacheWriteTokens == nil || *fine.CacheWriteTokens != 0 || len(fine.ByDriver) != 1 || fine.ByDriver[0].Driver != core.DriverName("agy") {
		t.Fatalf("fine bucket = %+v", fine)
	}
	rollup := h.Windows[1]
	merged := rollup.Buckets[0]
	if rollup.AvailableFromMs == nil || *rollup.AvailableFromMs != 3600000 || rollup.ResolutionMs == nil || *rollup.ResolutionMs != 300000 ||
		rollup.RetainedFromMs == nil || *rollup.RetainedFromMs != 3600000 || merged.InputTokens != 20 || merged.CoveredMs != 301000 ||
		merged.Complete || !merged.Gap || !merged.Discontinuous || len(merged.ByModel) != 1 || merged.ByModel[0].InputTokens != 20 ||
		merged.ByModel[0].CacheWriteTokens == nil || *merged.ByModel[0].CacheWriteTokens != 0 ||
		merged.RateLimits == nil || merged.RateLimits.Provider != "agy" || merged.Credits == nil || merged.Credits.Balance != "42.00" ||
		merged.ServiceTier == nil || *merged.ServiceTier != "priority" {
		t.Fatalf("rollup = %+v", rollup)
	}
	// Legacy limits without a provider field keep their Codex provenance.
	query.WindowsMs = []uint64{4200000}
	query.MaxBuckets = 14
	page, err = store.ConsumptionHistory(ctx, query)
	if err != nil {
		t.Fatal(err)
	}
	legacy := page.Identities[2].Windows[0].Buckets[12].RateLimits
	if legacy == nil || legacy.Provider != "codex" {
		t.Fatalf("legacy limits: %+v", legacy)
	}
	invalidCut := cut + 1
	query.ThroughMs = &invalidCut
	if _, err := store.ConsumptionHistory(ctx, query); !errors.Is(err, errUsageQuery) {
		t.Fatalf("unaligned pin = %v", err)
	}
	if _, err := store.db.ExecContext(ctx, "UPDATE consumption_tier5m SET credits='{\"balance\":\"bad\"}'"); err != nil {
		t.Fatal(err)
	}
	query.ThroughMs = &cut
	if _, err := store.ConsumptionHistory(ctx, query); !errors.Is(err, errUsageEvidence) {
		t.Fatalf("corrupted credits = %v", err)
	}
}

func TestRetiredUsageAndWakeTurnPages(t *testing.T) {
	parallelStorageFixture(t)
	store, svc, _ := seedRequestService(t)
	ctx := t.Context()
	request := inboxRequest("req_1f2f8c9c-ecc4-46e5-9230-e08a7bf54f61")
	if _, err := svc.Enqueue(ctx, request); err != nil {
		t.Fatal(err)
	}
	steps := []struct {
		sql  string
		args []any
	}{
		{"INSERT INTO request_turns (request_id,started_ms,ended_ms) VALUES (?,11000,13000)", []any{request.RequestID}},
		{`INSERT INTO wake_turns(identity_id,started_ms,ended_ms,input_tokens,output_tokens,cached_input_tokens,models,measured)
		VALUES ('receiver',11000,13000,10,2,3,'[{"modelId":"historical","inputTokens":10,"outputTokens":2,"cachedInputTokens":3,"cacheWriteTokens":0}]',0),
		('other',12000,14000,NULL,NULL,NULL,NULL,0)`, nil},
		{"UPDATE identities SET retired_at_ms=15000 WHERE id IN ('receiver','other')", nil},
		{`INSERT INTO consumption_tier5m(identity_id,from_ms,input_tokens,output_tokens,cached_input_tokens,covered_ms,complete,gap,discontinuous)
		VALUES ('receiver',300000,0,0,0,0,0,1,0),('other',600000,0,0,0,0,0,1,0)`, nil},
	}
	for _, step := range steps {
		if _, err := store.db.ExecContext(ctx, step.sql, step.args...); err != nil {
			t.Fatal(err)
		}
	}
	q := core.RetiredRollupQuery{FromMs: 400000, NowMs: 1200000, Limit: 1}
	retired, err := store.RetiredWithRollup(ctx, q)
	if err != nil || !retired.More || !reflect.DeepEqual(retired.IdentityIDs, []core.IdentityID{"other"}) {
		t.Fatalf("retired page = %+v, %v", retired, err)
	}
	q.FromMs = 600000
	retired, err = store.RetiredWithRollup(ctx, q)
	if err != nil || retired.More || !reflect.DeepEqual(retired.IdentityIDs, []core.IdentityID{"other"}) {
		t.Fatalf("strict bucket-end bound = %+v, %v", retired, err)
	}
	history := core.ConsumptionHistoryQuery{IdentityIDs: []core.IdentityID{"receiver"}, NowMs: q.NowMs, MaxBuckets: 1}
	page, err := store.ConsumptionHistory(ctx, history)
	if err != nil || page.Identities[0].Found {
		t.Fatalf("retired hidden = %+v, %v", page, err)
	}
	history.IncludeRetired = true
	page, err = store.ConsumptionHistory(ctx, history)
	if err != nil || !page.Identities[0].Found || !page.Identities[0].Retired {
		t.Fatalf("retired requested = %+v, %v", page, err)
	}

	wq := core.WakeTurnQuery{FromMs: 13000, ThroughMs: 14000, Limit: 1}
	wake, err := store.WakeTurns(ctx, wq)
	if err != nil || !wake.More || len(wake.Turns) != 1 {
		t.Fatalf("wake page = %+v, %v", wake, err)
	}
	turn := wake.Turns[0]
	if turn.IdentityID != "receiver" || turn.StartedAtMs != 11000 || turn.EndedAtMs != 13000 || turn.Measured ||
		turn.Tokens == nil || turn.Tokens.InputTokens != 10 || !reflect.DeepEqual(turn.RequestIDs, []core.RequestID{request.RequestID}) ||
		len(turn.ByModel) != 1 || turn.ByModel[0].CacheWriteTokens == nil || *turn.ByModel[0].CacheWriteTokens != 0 {
		t.Fatalf("unmeasured turn still carries evidence = %+v", turn)
	}
	wq.IdentityIDs = []core.IdentityID{"other"}
	wake, err = store.WakeTurns(ctx, wq)
	if err != nil || wake.More || len(wake.Turns) != 1 || wake.Turns[0].IdentityID != "other" ||
		wake.Turns[0].Tokens != nil || wake.Turns[0].ByModel != nil {
		t.Fatalf("filtered turn with absent tokens = %+v, %v", wake, err)
	}
}
