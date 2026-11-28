package orchestration

import (
	"context"
	json "encoding/json/v2"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const (
	talkAlpha core.IdentityID = "11111111-1111-4111-8111-111111111111"
	talkBravo core.IdentityID = "22222222-2222-4222-8222-222222222222"
	talkGamma core.IdentityID = "33333333-3333-4333-8333-333333333333"
	talkOld   core.IdentityID = "44444444-4444-4444-8444-444444444444"
	talkNow   uint64          = 1_789_000_000_000
)

type talkReader struct {
	ports.OrchReader
	page    core.OrchTalkFactsPage
	queries []core.OrchTalkFactsQuery
}

func (r *talkReader) ReadTalkFacts(_ context.Context, query core.OrchTalkFactsQuery) (core.OrchTalkFactsPage, error) {
	r.queries = append(r.queries, query)
	return r.page, nil
}

func talkPolicy() core.OrchPolicySnapshot {
	zone := "UTC"
	limit := uint32(2)
	plan := core.OrchPlan{
		ID: "55555555-5555-4555-8555-555555555555", Name: "Pair limit", Priority: 1, Enabled: true, Revision: 1,
		Schedule: core.OrchPlanSchedule{Kind: "always"},
		Targets:  []core.OrchTarget{{Kind: "all"}},
		Fields:   core.OrchPolicyFields{TalkLimitPresent: true, TalkLimit: &limit},
		Members: map[core.IdentityID]core.OrchPolicyFields{
			talkBravo: {TalkLimitPresent: true, TalkLimit: &limit},
		},
	}
	return core.OrchPolicySnapshot{
		Revision: 7, TimeZone: &zone, Plans: []core.OrchPlan{plan},
		Identities: map[core.IdentityID]core.Name{talkAlpha: "alpha", talkBravo: "bravo", talkGamma: "gamma"},
	}
}

func TestTalksSelectEitherPeerAndKeepExpiredItemsInReadOnlyPage(t *testing.T) {
	policy := talkPolicy()
	policy.Leads = []core.IdentityID{talkGamma, talkOld}
	grantedBy := talkGamma
	policy.RouteGrants = []core.OrchRouteGrant{
		{FromID: talkAlpha, ToID: talkBravo, UntilMs: talkNow},
		{FromID: talkBravo, ToID: talkAlpha, UntilMs: talkNow + 1, GrantedBy: &grantedBy},
	}
	oldest := core.OrchHeldTalk{
		RequestID: "req_66666666-6666-4666-8666-666666666666", FromID: talkBravo, ToID: talkAlpha,
		HeldAtMs: talkNow - 10, ExpiresAtMs: talkNow,
	}
	reader := &talkReader{page: core.OrchTalkFactsPage{
		Policy: policy, SelectedIDs: []core.IdentityID{talkBravo},
		Pairs: []core.OrchTalkPair{
			{FirstID: talkAlpha, SecondID: talkBravo, Count: 2, WindowStartMs: talkNow - 100,
				HeldCount: 21, Held: []core.OrchHeldTalk{oldest}, HasLiveHold: true},
			{FirstID: talkBravo, SecondID: talkGamma, Count: 1, WindowStartMs: talkNow - talkWindowMs},
		},
	}}
	pattern := "BRAVO"
	query := TalkPageQuery{MemberQuery: &pattern, Limit: 1}
	view, failure := ReadTalks(t.Context(), reader, query, talkNow)
	if failure != nil || len(view.Pairs) != 1 || view.NextAfter == nil ||
		*view.NextAfter != string(talkAlpha)+":"+string(talkBravo) {
		t.Fatalf("first talks page = %+v, failure = %+v", view, failure)
	}
	pair := view.Pairs[0]
	if len(view.Leads) != 2 || view.Leads[0].Retired || !view.Leads[1].Retired || view.Leads[1].Name != nil ||
		len(view.RouteGrants) != 1 || view.RouteGrants[0].FromID != talkBravo ||
		pair.Count != 2 || pair.Limit == nil || *pair.Limit != 2 || pair.WindowStartMs != talkNow-100 ||
		pair.Members[0].Name != "alpha" || pair.Members[1].Name != "bravo" ||
		pair.State != "held" || pair.HeldCount != 21 || len(pair.Held) != 1 || pair.Held[0].State != "expired_unsent" ||
		pair.Held[0].FromName == nil || *pair.Held[0].FromName != "bravo" {
		t.Fatalf("retained evidence = %+v, pair = %+v", view, pair)
	}
	query.After = view.NextAfter
	next, failure := ReadTalks(t.Context(), reader, query, talkNow)
	if failure != nil || len(next.Pairs) != 1 || next.NextAfter != nil ||
		next.Pairs[0].Members[1].IdentityID != talkGamma || next.Pairs[0].State != "open" ||
		len(reader.queries) != 2 || reader.queries[1].Mode != core.OrchTalkFactsTalks ||
		reader.queries[1].MemberQuery != &pattern || reader.queries[1].ObservedAtMs != talkNow {
		t.Fatalf("next talks page = %+v, queries = %+v, failure = %+v", next, reader.queries, failure)
	}
}

func TestRoutesAtFollowChosenTimeRuleGrantAndPresentCount(t *testing.T) {
	policy := talkPolicy()
	paused := core.OrchSending("paused")
	start, end := talkNow+3_600_000, talkNow+7_200_000
	policy.Plans = append(policy.Plans, core.OrchPlan{
		ID: "77777777-7777-4777-8777-777777777777", Name: "Pause", Priority: 2, Revision: 1, Enabled: true,
		Schedule: core.OrchPlanSchedule{Kind: "once", StartMs: start, EndMs: end},
		Targets:  []core.OrchTarget{{Kind: "all"}},
		Fields:   core.OrchPolicyFields{Sending: &paused},
	})
	grantEnd := start + 100
	policy.RouteGrants = []core.OrchRouteGrant{{FromID: talkAlpha, ToID: talkBravo, UntilMs: grantEnd}}
	reader := &talkReader{page: core.OrchTalkFactsPage{
		Policy: policy, SelectedIDs: []core.IdentityID{talkBravo, talkAlpha},
		Pairs: []core.OrchTalkPair{{FirstID: talkAlpha, SecondID: talkBravo, Count: 2}},
	}}
	for _, scenario := range []struct {
		name    string
		at      uint64
		mode    core.OrchTalkFactsMode
		forward string
		reverse string
		source  string
	}{
		{"present", talkNow, core.OrchTalkFactsRoutesNow, "needs_person", "needs_person", "member"},
		{"before pause", start - 2, core.OrchTalkFactsRoutesAt, "allowed", "allowed", "base"},
		{"ordered grant", start + 1, core.OrchTalkFactsRoutesAt, "allowed", "blocked", "grant"},
		{"at grant expiration", grantEnd, core.OrchTalkFactsRoutesAt, "blocked", "blocked", "plan"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			query := RoutesQuery{TalkPageQuery: TalkPageQuery{Limit: 1}, AtMs: &scenario.at}
			first, failure := ReadRoutes(t.Context(), reader, query, talkNow)
			if failure != nil || len(first.Routes) != 1 || first.AtMs != scenario.at || first.ObservedAtMs != talkNow ||
				first.NextAfter == nil || *first.NextAfter != string(talkAlpha)+":"+string(talkBravo) ||
				reader.queries[len(reader.queries)-1].Mode != scenario.mode {
				t.Fatalf("first routes page = %+v, queries = %+v, failure = %+v", first, reader.queries, failure)
			}
			forward := first.Routes[0]
			source, err := json.Marshal(forward.Source)
			if forward.FromID != talkAlpha || forward.ToID != talkBravo || forward.Verdict != scenario.forward ||
				err != nil || !strings.Contains(string(source), `"kind":"`+scenario.source+`"`) {
				t.Fatalf("forward route = %+v, source = %s, err = %v", forward, source, err)
			}
			if scenario.source == "grant" && string(source) != `{"kind":"grant","grantUntilMs":`+strconv.FormatUint(grantEnd, 10)+`}` {
				t.Fatalf("grant source = %s", source)
			}
			query.After = first.NextAfter
			second, failure := ReadRoutes(t.Context(), reader, query, talkNow)
			if failure != nil || second.NextAfter != nil || len(second.Routes) != 1 ||
				second.Routes[0].FromID != talkBravo || second.Routes[0].ToID != talkAlpha ||
				second.Routes[0].Verdict != scenario.reverse {
				t.Fatalf("second routes page = %+v, failure = %+v", second, failure)
			}
		})
	}

	t.Run("present grant hides the cap in the route read", func(t *testing.T) {
		reader.page.Policy.Plans[1].Schedule = core.OrchPlanSchedule{Kind: "always"}
		query := RoutesQuery{TalkPageQuery: TalkPageQuery{Limit: 2}}
		view, failure := ReadRoutes(t.Context(), reader, query, talkNow)
		if failure != nil || len(view.Routes) != 2 || view.Routes[0].Verdict != "allowed" ||
			view.Routes[0].Source.grantUntilMs == nil || *view.Routes[0].Source.grantUntilMs != grantEnd ||
			view.Routes[1].Verdict != "blocked" {
			t.Fatalf("present grant = %+v, failure = %+v", view, failure)
		}
	})
}

func TestTalkViewsAtMemberBoundAllowEmptySelection(t *testing.T) {
	policy := talkPolicy()
	for index := 0; len(policy.Identities) <= core.OrchMaxMembers; index++ {
		id := core.IdentityID(fmt.Sprintf("00000000-0000-4000-8000-%012d", index))
		policy.Identities[id] = "member"
	}
	reader := &talkReader{page: core.OrchTalkFactsPage{Policy: policy}}
	query := TalkPageQuery{Limit: 1}
	talks, failure := ReadTalks(t.Context(), reader, query, talkNow)
	if failure != nil || len(talks.Pairs) != 0 {
		t.Fatalf("empty talks = %+v, failure = %+v", talks, failure)
	}
	routes, failure := ReadRoutes(t.Context(), reader, RoutesQuery{TalkPageQuery: query}, talkNow)
	if failure != nil || len(routes.Routes) != 0 {
		t.Fatalf("empty routes = %+v, failure = %+v", routes, failure)
	}
	reader.page.SelectedIDs = []core.IdentityID{talkAlpha}
	_, failure = ReadRoutes(t.Context(), reader, RoutesQuery{TalkPageQuery: query}, talkNow)
	if failure == nil || failure.Code != "ORCH_LIMIT" {
		t.Fatalf("nonempty routes failure = %+v", failure)
	}
	reader.page.Pairs = []core.OrchTalkPair{{FirstID: talkAlpha, SecondID: talkBravo, Count: 1}}
	after := "z"
	query.After = &after
	_, failure = ReadTalks(t.Context(), reader, query, talkNow)
	if failure == nil || failure.Code != "ORCH_LIMIT" {
		t.Fatalf("talks beyond cursor failure = %+v", failure)
	}
}
