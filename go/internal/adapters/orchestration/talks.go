package orchestration

import (
	"context"
	json "encoding/json/v2"
	"slices"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const TalkPageLimit = 256
const talkWindowMs = 3_600_000

type TalkPageQuery struct {
	MemberQuery *string
	Limit       uint16
	After       *string
}

func (query TalkPageQuery) Valid() bool {
	return query.Limit >= 1 && query.Limit <= TalkPageLimit &&
		validOrchLabel(query.MemberQuery, 80) && validOrchLabel(query.After, 160)
}

type RoutesQuery struct {
	TalkPageQuery
	AtMs    *uint64
	LocalAt *string
}

func (query RoutesQuery) Valid() bool {
	return query.TalkPageQuery.Valid() && (query.AtMs == nil ||
		(query.LocalAt == nil && *query.AtMs > 0 && core.ValidJSSafeInteger(*query.AtMs)))
}

type TalksView struct {
	SchemaVersion         int          `json:"schemaVersion"`
	ConfigurationRevision uint64       `json:"configurationRevision"`
	ObservedAtMs          uint64       `json:"observedAtMs"`
	WindowMs              uint64       `json:"windowMs"`
	Leads                 []TalkLead   `json:"leads"`
	Pairs                 []TalkPair   `json:"pairs"`
	NextAfter             *string      `json:"nextAfter"`
	RouteGrants           []routeGrant `json:"routeGrants"`
}

type TalkLead struct {
	IdentityID core.IdentityID `json:"identityId"`
	Name       *core.Name      `json:"name"`
	Retired    bool            `json:"retired"`
}

type TalkPair struct {
	Members       [2]TalkMember `json:"members"`
	Count         uint64        `json:"count"`
	Limit         *uint32       `json:"limit"`
	LastAtMs      *uint64       `json:"lastAtMs"`
	WindowStartMs uint64        `json:"windowStartMs"`
	State         string        `json:"state"`
	HeldCount     uint64        `json:"heldCount"`
	Held          []HeldTalk    `json:"held"`
}

type TalkMember struct {
	IdentityID core.IdentityID                  `json:"identityId"`
	Name       core.Name                        `json:"name"`
	TalkLimit  core.OrchEffectiveField[*uint32] `json:"talkLimit"`
}

type HeldTalk struct {
	RequestID   core.RequestID  `json:"requestId"`
	FromID      core.IdentityID `json:"from"`
	FromName    *core.Name      `json:"fromName"`
	ToID        core.IdentityID `json:"to"`
	ToName      *core.Name      `json:"toName"`
	CreatedAtMs uint64          `json:"createdAtMs"`
	ExpiresAtMs uint64          `json:"expiresAtMs"`
	State       string          `json:"state"`
}

type routeGrant struct {
	FromID    core.IdentityID  `json:"from"`
	ToID      core.IdentityID  `json:"to"`
	UntilMs   uint64           `json:"untilMs"`
	GrantedBy *core.IdentityID `json:"grantedBy"`
}

type RoutesView struct {
	SchemaVersion         int        `json:"schemaVersion"`
	ConfigurationRevision uint64     `json:"configurationRevision"`
	ObservedAtMs          uint64     `json:"observedAtMs"`
	AtMs                  uint64     `json:"atMs"`
	Routes                []RouteRow `json:"routes"`
	NextAfter             *string    `json:"nextAfter"`
}

type RouteRow struct {
	FromID   core.IdentityID `json:"from"`
	FromName core.Name       `json:"fromName"`
	ToID     core.IdentityID `json:"to"`
	ToName   core.Name       `json:"toName"`
	Verdict  string          `json:"verdict"`
	Source   routeSource     `json:"source"`
}

type routeSource struct {
	policy       core.OrchSource
	grantUntilMs *uint64
}

func (source routeSource) MarshalJSON() ([]byte, error) {
	if source.grantUntilMs == nil {
		return json.Marshal(source.policy)
	}
	return json.Marshal(struct {
		Kind         string `json:"kind"`
		GrantUntilMs uint64 `json:"grantUntilMs"`
	}{"grant", *source.grantUntilMs})
}

type talkPairKey struct {
	from core.IdentityID
	to   core.IdentityID
}

func (key talkPairKey) cursor() string {
	return string(key.from) + ":" + string(key.to)
}

func (key talkPairKey) ordered() talkPairKey {
	if key.from > key.to {
		return talkPairKey{key.to, key.from}
	}
	return key
}

func ReadTalks(ctx context.Context, reader ports.OrchReader, query TalkPageQuery, now uint64) (TalksView, *core.RequestFailure) {
	page, calendar, err := loadTalkFacts(ctx, reader, query.MemberQuery, now, core.OrchTalkFactsTalks)
	if err != nil {
		return TalksView{}, readFailure(err)
	}
	policy := page.Policy
	view := TalksView{
		SchemaVersion: 1, ConfigurationRevision: policy.Revision, ObservedAtMs: now, WindowMs: talkWindowMs,
		Leads: make([]TalkLead, 0, len(policy.Leads)), Pairs: make([]TalkPair, 0, query.Limit),
		RouteGrants: make([]routeGrant, 0),
	}
	for _, id := range policy.Leads {
		name := talkName(policy.Identities, id)
		view.Leads = append(view.Leads, TalkLead{IdentityID: id, Name: name, Retired: name == nil})
	}
	for _, grant := range policy.RouteGrants {
		if now < grant.UntilMs {
			view.RouteGrants = append(view.RouteGrants, routeGrant(grant))
		}
	}
	selected := make(map[core.IdentityID]bool, len(page.SelectedIDs))
	for _, id := range page.SelectedIDs {
		selected[id] = true
	}
	effective := make(map[core.IdentityID]core.OrchEffectiveField[*uint32], len(policy.Identities))
	var last string
	for _, pair := range page.Pairs {
		first, firstKnown := policy.Identities[pair.FirstID]
		second, secondKnown := policy.Identities[pair.SecondID]
		key := (talkPairKey{pair.FirstID, pair.SecondID}).cursor()
		if !firstKnown || !secondKnown || (!selected[pair.FirstID] && !selected[pair.SecondID]) {
			continue
		}
		if len(policy.Identities) > core.OrchMaxMembers || len(policy.Plans) > core.OrchMaxPlans {
			return TalksView{}, readFailure(core.ErrOrchLimit)
		}
		if query.After != nil && key <= *query.After {
			continue
		}
		if len(view.Pairs) == int(query.Limit) {
			view.NextAfter = &last
			break
		}
		row := TalkPair{
			Members: [2]TalkMember{{IdentityID: pair.FirstID, Name: first}, {IdentityID: pair.SecondID, Name: second}},
			Count:   pair.Count, LastAtMs: pair.LastAtMs, WindowStartMs: pair.WindowStartMs, State: "open",
			HeldCount: pair.HeldCount, Held: make([]HeldTalk, 0, len(pair.Held)),
		}
		for i := range row.Members {
			member := &row.Members[i]
			limit, known := effective[member.IdentityID]
			if !known {
				resolved, err := core.ResolveOrchEffective(policy, member.IdentityID, now, calendar)
				if err != nil {
					return TalksView{}, readFailure(err)
				}
				limit = resolved.TalkLimit
				effective[member.IdentityID] = limit
			}
			member.TalkLimit = limit
		}
		row.Limit = core.OrchPairLimit(row.Members[0].TalkLimit.Value, row.Members[1].TalkLimit.Value)
		if pair.HasLiveHold {
			row.State = "held"
		}
		for _, hold := range pair.Held {
			state := "expired_unsent"
			if now < hold.ExpiresAtMs {
				state = "held"
			}
			row.Held = append(row.Held, HeldTalk{
				RequestID: hold.RequestID, FromID: hold.FromID, ToID: hold.ToID,
				FromName: talkName(policy.Identities, hold.FromID), ToName: talkName(policy.Identities, hold.ToID),
				CreatedAtMs: hold.HeldAtMs, ExpiresAtMs: hold.ExpiresAtMs, State: state,
			})
		}
		view.Pairs = append(view.Pairs, row)
		last = key
	}
	return view, boundReadOutput(view)
}

func ReadRoutes(ctx context.Context, reader ports.OrchReader, query RoutesQuery, now uint64) (RoutesView, *core.RequestFailure) {
	page, calendar, at, err := loadRouteFacts(ctx, reader, query, now)
	if err != nil {
		return RoutesView{}, readFailure(err)
	}
	view := RoutesView{
		SchemaVersion: 1, ConfigurationRevision: page.Policy.Revision, ObservedAtMs: now, AtMs: at,
		Routes: make([]RouteRow, 0, query.Limit),
	}
	if len(page.SelectedIDs) > core.OrchMaxMembers {
		return RoutesView{}, readFailure(core.ErrOrchLimit)
	}
	ids := slices.Clone(page.SelectedIDs)
	slices.Sort(ids)
	effective := make(map[core.IdentityID]core.OrchEffective, len(ids))
	for _, id := range ids {
		member, err := core.ResolveOrchEffective(page.Policy, id, at, calendar)
		if err != nil {
			return RoutesView{}, readFailure(err)
		}
		effective[id] = member
	}
	grants := make(map[talkPairKey]uint64, len(page.Policy.RouteGrants))
	for _, grant := range page.Policy.RouteGrants {
		grants[talkPairKey{grant.FromID, grant.ToID}] = grant.UntilMs
	}
	leads := make(map[core.IdentityID]bool, len(page.Policy.Leads))
	for _, id := range page.Policy.Leads {
		_, leads[id] = page.Policy.Identities[id]
	}
	counts := make(map[talkPairKey]uint64)
	if at == now {
		for _, pair := range page.Pairs {
			counts[talkPairKey{pair.FirstID, pair.SecondID}] = pair.Count
		}
	}
	var last string
	for _, from := range ids {
		for _, to := range ids {
			if from == to {
				continue
			}
			key := talkPairKey{from, to}
			cursor := key.cursor()
			if query.After != nil && cursor <= *query.After {
				continue
			}
			if len(view.Routes) == int(query.Limit) {
				view.NextAfter = &last
				return view, boundReadOutput(view)
			}
			evidence := core.OrchSendingEvidence{
				AtMs: at, GrantUntilMs: grants[key], SenderIsLead: leads[from], RecipientIsLead: leads[to],
			}
			if at == now {
				count := counts[key.ordered()]
				evidence.Count = &count
			}
			verdict, source := projectRoute(effective[from], effective[to], evidence)
			view.Routes = append(view.Routes, RouteRow{
				FromID: from, FromName: page.Policy.Identities[from], ToID: to, ToName: page.Policy.Identities[to],
				Verdict: verdict, Source: source,
			})
			last = cursor
		}
	}
	return view, boundReadOutput(view)
}

func loadRouteFacts(ctx context.Context, reader ports.OrchReader, query RoutesQuery, now uint64) (core.OrchTalkFactsPage, Calendar, uint64, error) {
	at, mode := now, core.OrchTalkFactsRoutesNow
	if query.AtMs != nil {
		at = *query.AtMs
	}
	if at != now || query.LocalAt != nil {
		mode = core.OrchTalkFactsRoutesAt
	}
	page, calendar, err := loadTalkFacts(ctx, reader, query.MemberQuery, now, mode)
	if err != nil || query.LocalAt == nil {
		return page, calendar, at, err
	}
	at, err = calendar.ParseAt(*query.LocalAt)
	if err != nil || at != now {
		return page, calendar, at, err
	}

	// The stated wall time is also the current instant. Use the counts and
	// zone of the snapshot that will supply the verdict.
	page, calendar, err = loadTalkFacts(ctx, reader, query.MemberQuery, now, core.OrchTalkFactsRoutesNow)
	if err != nil {
		return page, calendar, at, err
	}
	at, err = calendar.ParseAt(*query.LocalAt)
	return page, calendar, at, err
}

func loadTalkFacts(ctx context.Context, reader ports.OrchReader, member *string, now uint64, mode core.OrchTalkFactsMode) (core.OrchTalkFactsPage, Calendar, error) {
	page, err := reader.ReadTalkFacts(ctx, core.OrchTalkFactsQuery{MemberQuery: member, ObservedAtMs: now, Mode: mode})
	if err != nil {
		return core.OrchTalkFactsPage{}, Calendar{}, err
	}
	calendar, err := LoadCalendar(page.Policy.TimeZone)
	return page, calendar, err
}

func talkName(identities map[core.IdentityID]core.Name, id core.IdentityID) *core.Name {
	name, known := identities[id]
	if !known {
		return nil
	}
	return &name
}

func projectRoute(from, to core.OrchEffective, evidence core.OrchSendingEvidence) (string, routeSource) {
	decision := core.ResolveOrchSending(from, to, evidence)
	source := routeSource{policy: from.Sending.Source}
	switch decision.Route {
	case core.OrchSendingRestricted:
		return "blocked", source
	case core.OrchSendingGranted:
		return "allowed", routeSource{grantUntilMs: &evidence.GrantUntilMs}
	default:
		if decision.NeedsPerson {
			return "needs_person", routeSource{policy: decision.LimitSource}
		}
		return "allowed", source
	}
}
