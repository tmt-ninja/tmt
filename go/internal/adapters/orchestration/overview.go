package orchestration

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type OverviewQuery struct {
	RangeDays   uint8
	AtMs        *uint64
	LocalAt     *string
	Plan        *string
	MemberQuery *string
}

type OverviewView struct {
	SchemaVersion         int                         `json:"schemaVersion"`
	ConfigurationRevision uint64                      `json:"configurationRevision"`
	ReceivingRevision     uint64                      `json:"receivingRevision"`
	ObservedAtMs          uint64                      `json:"observedAtMs"`
	AtMs                  uint64                      `json:"atMs"`
	TimeZone              string                      `json:"timeZone"`
	Range                 core.OrchTimeSlot           `json:"range"`
	SelectedPlanID        *string                     `json:"selectedPlanId"`
	Plans                 []PlanDocument              `json:"plans"`
	Members               []OverviewMember            `json:"members"`
	Timeline              []core.OrchTimelineInterval `json:"timeline"`
	EmptyState            *string                     `json:"emptyState"`
}

type OverviewMember struct {
	IdentityID     core.IdentityID   `json:"identityId"`
	Name           core.Name         `json:"name"`
	Effective      OverviewEffective `json:"effective"`
	ActivePlans    []string          `json:"activePlans"`
	NextChangeAtMs *uint64           `json:"nextChangeAtMs"`
	Jobs           *struct{}         `json:"jobs"`
}

type OverviewEffective struct {
	State     core.OrchEffectiveField[core.OrchState]   `json:"state"`
	Receiving OverviewReceiving                         `json:"receiving"`
	Sending   core.OrchEffectiveField[core.OrchSending] `json:"sending"`
	Routine   core.OrchEffectiveField[core.OrchRoutine] `json:"routine"`
	TalkLimit core.OrchEffectiveField[*uint32]          `json:"talkLimit"`
}

type OverviewReceiving struct {
	Value         *receivingDocument `json:"value"`
	Source        core.OrchSource    `json:"source"`
	Available     bool               `json:"available"`
	ProposedValue *receivingDocument `json:"proposedValue,omitempty"`
}

const BaseOnlyHint = "Base only. Create a plan with " + flavor.Binary +
	" orch plan add --help; personal focus: " + flavor.Binary + " orch focus --help."

func ValidOverview(query OverviewQuery) bool {
	return (query.RangeDays == 1 || query.RangeDays == 7 || query.RangeDays == 30) &&
		(query.AtMs == nil || *query.AtMs > 0 && core.ValidJSSafeInteger(*query.AtMs)) &&
		ValidPlanSelector(query.Plan) && validOrchLabel(query.MemberQuery, 80)
}

func ReadOverview(ctx context.Context, reader ports.OrchReader, query OverviewQuery, now uint64) (OverviewView, *core.RequestFailure) {
	page, calendar, at, err := overviewSnapshot(ctx, reader, query, now)
	if err != nil {
		return OverviewView{}, readFailure(err)
	}
	return overview(page, calendar, at, query.RangeDays, query.Plan, now)
}

func overviewSnapshot(ctx context.Context, reader ports.OrchReader, query OverviewQuery, now uint64) (core.OrchSnapshotPage, Calendar, uint64, error) {
	page, err := reader.ReadPolicySnapshot(ctx, core.OrchSnapshotQuery{MemberQuery: query.MemberQuery})
	if err != nil {
		return core.OrchSnapshotPage{}, Calendar{}, 0, err
	}
	calendar, err := LoadCalendar(page.Policy.TimeZone)
	if err != nil {
		return core.OrchSnapshotPage{}, Calendar{}, 0, err
	}
	at := now
	if query.LocalAt != nil {
		at, err = calendar.ParseAt(*query.LocalAt)
	} else if query.AtMs != nil {
		at = *query.AtMs
	}
	return page, calendar, at, err
}

func overview(page core.OrchSnapshotPage, calendar Calendar, at uint64, days uint8, selector *string, now uint64) (OverviewView, *core.RequestFailure) {
	snapshot := page.Policy
	if len(snapshot.Plans) > core.OrchMaxPlans || len(snapshot.Identities) > core.OrchMaxMembers || len(snapshot.Focus) > core.OrchMaxMembers {
		return OverviewView{}, readFailure(core.ErrOrchLimit)
	}
	ids := make(map[string]bool, len(snapshot.Plans))
	priorities := make(map[int32]bool, len(snapshot.Plans))
	for _, plan := range snapshot.Plans {
		if ids[plan.ID] || priorities[plan.Priority] {
			return OverviewView{}, readFailure(core.ErrOrchInput)
		}
		ids[plan.ID], priorities[plan.Priority] = true, true
	}
	displayPlans, failure := selectPlans(snapshot.Plans, selector)
	if failure != nil {
		return OverviewView{}, failure
	}
	window, err := calendar.Range(at, days)
	if err != nil {
		return OverviewView{}, readFailure(err)
	}
	display := snapshot
	display.Plans = displayPlans
	timeline, err := core.OrchTimeline(display, window, calendar)
	if err != nil {
		return OverviewView{}, readFailure(err)
	}

	view := OverviewView{
		SchemaVersion: 1, ConfigurationRevision: snapshot.Revision, ReceivingRevision: snapshot.DigestRevision,
		ObservedAtMs: now, AtMs: at, TimeZone: calendar.Name(), Range: window, Timeline: timeline,
		Plans: make([]PlanDocument, 0, len(snapshot.Plans)), Members: make([]OverviewMember, 0, len(page.IdentityIDs)),
	}
	if selector != nil {
		view.SelectedPlanID = &displayPlans[0].ID
	}
	if len(snapshot.Plans) == 0 {
		hint := BaseOnlyHint
		view.EmptyState = &hint
	}
	for _, plan := range snapshot.Plans {
		document, err := planDocument(plan)
		if err != nil {
			return OverviewView{}, readFailure(err)
		}
		view.Plans = append(view.Plans, document)
	}
	for _, id := range page.IdentityIDs {
		resolved, err := core.ResolveOrchEffective(snapshot, id, at, calendar)
		if err != nil {
			return OverviewView{}, readFailure(err)
		}
		value := receivingDocument(resolved.Receiving.Value)
		receiving := OverviewReceiving{Source: resolved.Receiving.Source, Available: snapshot.DigestRevision != 0}
		if receiving.Available {
			receiving.Value = &value
		} else {
			receiving.ProposedValue = &value
		}
		view.Members = append(view.Members, OverviewMember{
			IdentityID: id, Name: snapshot.Identities[id],
			Effective: OverviewEffective{State: resolved.State, Receiving: receiving, Sending: resolved.Sending,
				Routine: resolved.Routine, TalkLimit: resolved.TalkLimit},
			ActivePlans: resolved.ActivePlans, NextChangeAtMs: resolved.NextChangeAtMs,
		})
	}
	if failure := boundReadOutput(view); failure != nil {
		return OverviewView{}, failure
	}
	return view, nil
}
