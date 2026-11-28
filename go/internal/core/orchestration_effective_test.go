package core

import (
	"reflect"
	"testing"
)

const orchTestDayMs = 86_400_000
const orchTestMonday = 20_997 // 2027-06-28, civil days from 1970-01-01.

type orchUTCTestCalendar struct{}

func (orchUTCTestCalendar) DayAt(ms uint64) (int32, error) {
	return int32(ms / orchTestDayMs), nil
}

func (orchUTCTestCalendar) Boundary(day int32, minute uint16, _ bool) (uint64, error) {
	return uint64(day)*orchTestDayMs + uint64(minute)*60_000, nil
}

func orchTestAt(day int32, minute uint16) uint64 {
	at, _ := (orchUTCTestCalendar{}).Boundary(day, minute, false)
	return at
}

func orchTestPlan(id string, priority int32, fields OrchPolicyFields) OrchPlan {
	return OrchPlan{ID: id, Revision: 1, Priority: priority, Enabled: true,
		Targets: []OrchTarget{{Kind: "all"}}, Schedule: OrchPlanSchedule{Kind: "always"}, Fields: fields}
}

func TestOrchHigherAwakeRestoresReceivingAndRoutineButPreservesSendingAndLimit(t *testing.T) {
	sleep, awake := OrchState("sleep"), OrchState("awake")
	leads, limit := OrchSending("leads"), uint32(20)
	lower := orchTestPlan("quiet", 1, OrchPolicyFields{State: &sleep, Sending: &leads, TalkLimitPresent: true, TalkLimit: &limit})
	higher := orchTestPlan("shift", 2, OrchPolicyFields{State: &awake})
	snapshot := OrchPolicySnapshot{Identities: map[IdentityID]Name{"seat": "night-1"}, Plans: []OrchPlan{higher, lower}}
	value, err := ResolveOrchEffective(snapshot, "seat", orchTestAt(orchTestMonday, 600), orchUTCTestCalendar{})
	if err != nil {
		t.Fatal(err)
	}
	if value.Receiving.Value.Mode != OrchReceivingDirect || value.Routine.Value != OrchRoutineRun ||
		value.Receiving.Source.PlanID == nil || *value.Receiving.Source.PlanID != "shift" || !value.Receiving.Source.Defaulted ||
		value.Sending.Value != "leads" || value.TalkLimit.Value == nil || *value.TalkLimit.Value != 20 || value.NextChangeAtMs != nil {
		t.Fatalf("effective = %+v", value)
	}
}

func TestOrchDigestOffOverridesOnlyReceiving(t *testing.T) {
	sleep, paused := OrchState("sleep"), OrchSending("paused")
	snapshot := OrchPolicySnapshot{
		Identities: map[IdentityID]Name{"seat": "night-1"}, DigestRevision: 9,
		Plans: []OrchPlan{orchTestPlan("sleep", 1, OrchPolicyFields{State: &sleep, Sending: &paused})},
	}
	at := orchTestAt(orchTestMonday, 600)
	for _, focus := range []bool{false, true} {
		if focus {
			snapshot.Focus = []OrchFocus{{IdentityID: "seat", Revision: 1, StartMs: at, EndMs: orchTestAt(orchTestMonday, 660)}}
		}
		value, err := ResolveOrchEffective(snapshot, "seat", at, orchUTCTestCalendar{})
		if err != nil {
			t.Fatal(err)
		}
		if value.Receiving.Value != (OrchReceiving{Mode: OrchReceivingDirect}) ||
			value.Receiving.Source.Kind != OrchSourceBase || value.Receiving.Source.Revision != 9 ||
			value.Routine.Value != OrchRoutineHold || value.Sending.Value != "paused" {
			t.Fatalf("focus %t effective = %+v", focus, value)
		}
	}
}

func TestOrchTimelineUsesExactBoundariesAndDisabledPlansHaveNoEffect(t *testing.T) {
	from := orchTestAt(orchTestMonday, 0)
	at := func(minute uint16) uint64 { return orchTestAt(orchTestMonday, minute) }
	plan := func(id string, enabled bool, start, end uint16) OrchPlan {
		p := orchTestPlan(id, 1, OrchPolicyFields{})
		p.Enabled = enabled
		p.Schedule = OrchPlanSchedule{Kind: "once", StartMs: at(start), EndMs: at(end)}
		return p
	}
	snapshot := OrchPolicySnapshot{Identities: map[IdentityID]Name{"seat": "night-1"}, Plans: []OrchPlan{
		plan("once", true, 60, 90), orchTestPlan("off", 2, OrchPolicyFields{}),
	}}
	snapshot.Plans[1].Enabled = false
	intervals, err := OrchTimeline(snapshot, OrchTimeSlot{StartMs: from, EndMs: at(120)}, orchUTCTestCalendar{})
	want := []OrchTimelineInterval{{from, at(60), []string{}}, {at(60), at(90), []string{"once"}}, {at(90), at(120), []string{}}}
	if err != nil || !reflect.DeepEqual(intervals, want) {
		t.Fatalf("timeline = %+v, %v; want %+v", intervals, err, want)
	}
}
