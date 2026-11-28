package orchestration

import (
	"context"
	"maps"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type PlansView struct {
	SchemaVersion         int            `json:"schemaVersion"`
	ConfigurationRevision uint64         `json:"configurationRevision"`
	ObservedAtMs          uint64         `json:"observedAtMs"`
	Plans                 []PlanDocument `json:"plans"`
}

type PlanDocument struct {
	ID       string            `json:"id"`
	Name     string            `json:"name"`
	Revision uint64            `json:"revision"`
	Priority int32             `json:"priority"`
	Enabled  bool              `json:"enabled"`
	Targets  []core.OrchTarget `json:"targets"`
	Schedule planSchedule      `json:"schedule"`
	Fields   map[string]any    `json:"fields"`
	Members  []planMember      `json:"members"`
}

type planMember struct {
	IdentityID core.IdentityID `json:"identityId"`
	Fields     map[string]any  `json:"fields"`
}

type planSchedule struct {
	Kind          string `json:"kind"`
	StartMs       uint64 `json:"startMs,omitzero"`
	EndMs         uint64 `json:"endMs,omitzero"`
	AnchorDate    string `json:"anchorDate,omitempty"`
	IntervalWeeks uint8  `json:"intervalWeeks,omitzero"`
	Weekdays      []int  `json:"weekdays,omitempty"`
	Start         string `json:"start,omitempty"`
	End           string `json:"end,omitempty"`
	AllDay        *bool  `json:"allDay,omitempty"`
}

func ValidPlanSelector(selector *string) bool {
	return validOrchLabel(selector, 128)
}

func validOrchLabel(value *string, limit int) bool {
	return value == nil || len(*value) <= limit && utf8.ValidString(*value) && strings.TrimSpace(*value) != "" &&
		!strings.ContainsFunc(*value, unicode.IsControl)
}

func ReadPlans(ctx context.Context, reader ports.OrchReader, selector *string, now uint64) (PlansView, *core.RequestFailure) {
	page, err := reader.ReadPlans(ctx)
	if err != nil {
		return PlansView{}, readFailure(err)
	}
	plans, failure := selectPlans(page.Plans, selector)
	if failure != nil {
		return PlansView{}, failure
	}
	documents := make([]PlanDocument, 0, len(plans))
	for _, plan := range plans {
		doc, err := planDocument(plan)
		if err != nil {
			return PlansView{}, readFailure(err)
		}
		documents = append(documents, doc)
	}
	view := PlansView{
		SchemaVersion: 1, ConfigurationRevision: page.Revision, ObservedAtMs: now, Plans: documents,
	}
	if failure := boundReadOutput(view); failure != nil {
		return PlansView{}, failure
	}
	return view, nil
}

func selectPlans(plans []core.OrchPlan, selector *string) ([]core.OrchPlan, *core.RequestFailure) {
	if selector == nil {
		return plans, nil
	}
	value := *selector
	uuid := core.ValidUUID(value) && value != "00000000-0000-0000-0000-000000000000"
	var selected []core.OrchPlan
	for _, plan := range plans {
		if plan.ID == value || !uuid && plan.Name == value {
			if len(selected) > 0 {
				return nil, &core.RequestFailure{Code: "ORCH_PLAN_AMBIGUOUS", Message: "Plan name is ambiguous; select its UUID.", Status: 1}
			}
			selected = []core.OrchPlan{plan}
		}
	}
	if len(selected) == 0 {
		return nil, &core.RequestFailure{Code: "ORCH_PLAN_NOT_FOUND", Message: "Orchestration plan was not found.", Status: 3}
	}
	return selected, nil
}

func planDocument(plan core.OrchPlan) (PlanDocument, error) {
	schedule, err := planScheduleDocument(plan.Schedule)
	if err != nil {
		return PlanDocument{}, err
	}
	members := make([]planMember, 0, len(plan.Members))
	for _, id := range slices.Sorted(maps.Keys(plan.Members)) {
		members = append(members, planMember{IdentityID: id, Fields: policyFields(plan.Members[id])})
	}
	return PlanDocument{
		ID: plan.ID, Name: plan.Name, Revision: plan.Revision, Priority: plan.Priority, Enabled: plan.Enabled,
		Targets: plan.Targets, Schedule: schedule, Fields: policyFields(plan.Fields), Members: members,
	}, nil
}

func planScheduleDocument(raw core.OrchPlanSchedule) (planSchedule, error) {
	schedule, err := core.NormalizeOrchSchedule(raw)
	if err != nil {
		return planSchedule{}, err
	}
	if schedule.Kind != "weekly" {
		return planSchedule{Kind: schedule.Kind, StartMs: schedule.StartMs, EndMs: schedule.EndMs}, nil
	}
	return planSchedule{
		Kind: schedule.Kind, AnchorDate: schedule.AnchorDate, IntervalWeeks: schedule.IntervalWeeks,
		Weekdays: schedule.Weekdays, Start: schedule.Start, End: schedule.End, AllDay: &schedule.AllDay,
	}, nil
}

type receivingDocument struct {
	Mode       core.OrchReceivingMode `json:"mode"`
	IntervalMs uint64                 `json:"intervalMs,omitzero"`
}

func policyFields(fields core.OrchPolicyFields) map[string]any {
	out := make(map[string]any)
	if fields.State != nil {
		out["state"] = *fields.State
	}
	if fields.Receiving != nil {
		out["receiving"] = receivingDocument(*fields.Receiving)
	}
	if fields.Sending != nil {
		out["sending"] = *fields.Sending
	}
	if fields.Routine != nil {
		out["routine"] = *fields.Routine
	}
	if fields.TalkLimitPresent {
		out["talkLimit"] = fields.TalkLimit
	}
	return out
}
