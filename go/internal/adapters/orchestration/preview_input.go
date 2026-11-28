package orchestration

import (
	"encoding/json/jsontext"
	json "encoding/json/v2"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const PlanDocumentLimit = 32_768

func readStrict(data []byte, out any) bool {
	return json.Unmarshal(data, out, json.RejectUnknownMembers(true)) == nil
}

func canonicalOrchID(value string) bool {
	return core.ValidUUID(value) && value != "00000000-0000-0000-0000-000000000000"
}

// DecodeReceiving admits the plan and Digest variants without accepting
// unknown fields, a null interval, or an interval on a fieldless mode.
func DecodeReceiving(raw jsontext.Value, digest bool) (core.OrchReceiving, bool) {
	var wire struct {
		Mode       core.OrchReceivingMode `json:"mode"`
		IntervalMs jsontext.Value         `json:"intervalMs"`
	}
	if !readStrict(raw, &wire) {
		return core.OrchReceiving{}, false
	}
	value := core.OrchReceiving{Mode: wire.Mode}
	switch value.Mode {
	case core.OrchReceivingDirect, core.OrchReceivingAuto:
		return value, len(wire.IntervalMs) == 0
	case core.OrchReceivingUrgent, core.OrchReceivingHold:
		return value, !digest && len(wire.IntervalMs) == 0
	case core.OrchReceivingBatch:
		if json.Unmarshal(wire.IntervalMs, &value.IntervalMs) != nil || value.IntervalMs == 0 ||
			!core.ValidJSSafeInteger(value.IntervalMs) {
			return core.OrchReceiving{}, false
		}
		return value, digest || value.IntervalMs <= 86_400_000 && value.IntervalMs%60_000 == 0
	default:
		return core.OrchReceiving{}, false
	}
}

func decodeCandidateFields(raw jsontext.Value) (core.OrchPolicyFields, bool) {
	var wire struct {
		State     jsontext.Value `json:"state"`
		Receiving jsontext.Value `json:"receiving"`
		Sending   jsontext.Value `json:"sending"`
		Routine   jsontext.Value `json:"routine"`
		TalkLimit jsontext.Value `json:"talkLimit"`
	}
	if len(raw) == 0 || string(raw) == "null" || !readStrict(raw, &wire) {
		return core.OrchPolicyFields{}, false
	}
	var fields core.OrchPolicyFields
	if len(wire.State) != 0 {
		var state core.OrchState
		if json.Unmarshal(wire.State, &state) != nil ||
			state != "awake" && state != "low" && state != "focus" && state != "sleep" {
			return fields, false
		}
		fields.State = &state
	}
	if len(wire.Receiving) != 0 {
		receiving, ok := DecodeReceiving(wire.Receiving, false)
		if !ok {
			return fields, false
		}
		fields.Receiving = &receiving
	}
	if len(wire.Sending) != 0 {
		var sending core.OrchSending
		if json.Unmarshal(wire.Sending, &sending) != nil ||
			sending != "anyone" && sending != "leads" && sending != "paused" {
			return fields, false
		}
		fields.Sending = &sending
	}
	if len(wire.Routine) != 0 {
		var routine core.OrchRoutine
		if json.Unmarshal(wire.Routine, &routine) != nil ||
			routine != core.OrchRoutineRun && routine != core.OrchRoutineHold {
			return fields, false
		}
		fields.Routine = &routine
	}
	if len(wire.TalkLimit) != 0 {
		if json.Unmarshal(wire.TalkLimit, &fields.TalkLimit) != nil ||
			fields.TalkLimit != nil && *fields.TalkLimit == 0 {
			return fields, false
		}
		fields.TalkLimitPresent = true
	}
	return fields, true
}

func candidateTarget(raw jsontext.Value) (core.OrchTarget, bool) {
	var wire struct {
		Kind    string         `json:"kind"`
		ID      jsontext.Value `json:"id"`
		Pattern jsontext.Value `json:"pattern"`
	}
	if !readStrict(raw, &wire) {
		return core.OrchTarget{}, false
	}
	target := core.OrchTarget{Kind: wire.Kind}
	switch target.Kind {
	case "all":
		return target, len(wire.ID) == 0 && len(wire.Pattern) == 0
	case "identity":
		if len(wire.Pattern) != 0 || json.Unmarshal(wire.ID, &target.ID) != nil {
			return target, false
		}
		return target, canonicalOrchID(string(target.ID))
	case "pattern":
		if len(wire.ID) != 0 || json.Unmarshal(wire.Pattern, &target.Pattern) != nil {
			return target, false
		}
		return target, validOrchLabel(&target.Pattern, 80)
	default:
		return target, false
	}
}

func candidateSchedule(raw jsontext.Value) (core.OrchPlanSchedule, bool) {
	var tag struct {
		Kind string `json:"kind"`
	}
	if json.Unmarshal(raw, &tag) != nil {
		return core.OrchPlanSchedule{}, false
	}
	schedule := core.OrchPlanSchedule{Kind: tag.Kind}
	switch tag.Kind {
	case "always":
		if !readStrict(raw, &tag) {
			return schedule, false
		}
	case "once":
		var wire struct {
			Kind    string `json:"kind"`
			StartMs uint64 `json:"startMs"`
			EndMs   uint64 `json:"endMs"`
		}
		if !readStrict(raw, &wire) {
			return schedule, false
		}
		schedule.StartMs, schedule.EndMs = wire.StartMs, wire.EndMs
	case "daily", "weekly":
		var wire struct {
			Kind          string         `json:"kind"`
			Start         string         `json:"start"`
			End           string         `json:"end"`
			AllDay        jsontext.Value `json:"allDay"`
			AnchorDate    jsontext.Value `json:"anchorDate"`
			IntervalWeeks jsontext.Value `json:"intervalWeeks"`
			Weekdays      jsontext.Value `json:"weekdays"`
		}
		if !readStrict(raw, &wire) ||
			len(wire.AllDay) != 0 && (string(wire.AllDay) == "null" || json.Unmarshal(wire.AllDay, &schedule.AllDay) != nil) {
			return schedule, false
		}
		schedule.Start, schedule.End = wire.Start, wire.End
		if tag.Kind == "daily" {
			if len(wire.AnchorDate) != 0 || len(wire.IntervalWeeks) != 0 || len(wire.Weekdays) != 0 {
				return schedule, false
			}
		} else if json.Unmarshal(wire.AnchorDate, &schedule.AnchorDate) != nil ||
			json.Unmarshal(wire.IntervalWeeks, &schedule.IntervalWeeks) != nil ||
			json.Unmarshal(wire.Weekdays, &schedule.Weekdays) != nil {
			return schedule, false
		}
	default:
		return schedule, false
	}
	_, err := core.NormalizeOrchSchedule(schedule)
	return schedule, err == nil
}

// DecodeCandidate admits an exact plan document for an in-memory preview.
func DecodeCandidate(raw jsontext.Value) (core.OrchPlan, error) {
	var wire struct {
		ID       string           `json:"id"`
		Name     string           `json:"name"`
		Revision uint64           `json:"revision"`
		Priority *int32           `json:"priority"`
		Enabled  *bool            `json:"enabled"`
		Targets  []jsontext.Value `json:"targets"`
		Schedule jsontext.Value   `json:"schedule"`
		Fields   jsontext.Value   `json:"fields"`
		Members  jsontext.Value   `json:"members"`
	}
	if !readStrict(raw, &wire) || !canonicalOrchID(wire.ID) || !validOrchLabel(&wire.Name, 80) ||
		wire.Revision == 0 || !core.ValidJSSafeInteger(wire.Revision) || wire.Priority == nil || wire.Enabled == nil ||
		len(wire.Targets) == 0 || len(wire.Targets) > core.OrchMaxMembers {
		return core.OrchPlan{}, core.ErrOrchInput
	}
	schedule, validSchedule := candidateSchedule(wire.Schedule)
	fields, validFields := decodeCandidateFields(wire.Fields)
	if !validSchedule || !validFields {
		return core.OrchPlan{}, core.ErrOrchInput
	}
	plan := core.OrchPlan{ID: wire.ID, Name: wire.Name, Revision: wire.Revision, Priority: *wire.Priority,
		Enabled: *wire.Enabled, Schedule: schedule, Fields: fields, Members: make(map[core.IdentityID]core.OrchPolicyFields)}
	for _, raw := range wire.Targets {
		target, ok := candidateTarget(raw)
		if !ok {
			return core.OrchPlan{}, core.ErrOrchInput
		}
		plan.Targets = append(plan.Targets, target)
	}
	if len(wire.Members) != 0 {
		var members []struct {
			IdentityID core.IdentityID `json:"identityId"`
			Fields     jsontext.Value  `json:"fields"`
		}
		if !readStrict(wire.Members, &members) || members == nil || len(members) > core.OrchMaxMembers {
			return core.OrchPlan{}, core.ErrOrchInput
		}
		for _, member := range members {
			fields, ok := decodeCandidateFields(member.Fields)
			if _, exists := plan.Members[member.IdentityID]; exists || !ok || !canonicalOrchID(string(member.IdentityID)) {
				return core.OrchPlan{}, core.ErrOrchInput
			}
			plan.Members[member.IdentityID] = fields
		}
	}
	var document map[string]any
	if json.Unmarshal(raw, &document) != nil {
		return core.OrchPlan{}, core.ErrOrchInput
	}
	if _, present := document["members"]; !present {
		document["members"] = []any{}
	}
	if schedule.Kind == "daily" || schedule.Kind == "weekly" {
		scheduleFields, ok := document["schedule"].(map[string]any)
		if !ok {
			return core.OrchPlan{}, core.ErrOrchInput
		}
		scheduleFields["allDay"] = schedule.AllDay
	}
	canonical, err := json.Marshal(document)
	if err != nil {
		return core.OrchPlan{}, core.ErrOrchInput
	}
	if len(canonical) > PlanDocumentLimit {
		return core.OrchPlan{}, core.ErrOrchLimit
	}
	return plan, nil
}

func ReadCandidateFile(path string) (core.OrchPlan, *core.RequestFailure) {
	plan, err := readCandidateFile(path)
	if err != nil {
		return core.OrchPlan{}, readFailure(err)
	}
	return plan, nil
}

func readCandidateFile(path string) (core.OrchPlan, error) {
	if path == "" || strings.HasSuffix(path, string(os.PathSeparator)) || filepath.Base(path) == "." || filepath.Base(path) == ".." {
		return core.OrchPlan{}, core.ErrOrchInput
	}
	parent, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return core.OrchPlan{}, core.ErrOrchInput
	}
	defer parent.Close()
	dir, err := parent.Open(".")
	if err != nil {
		return core.OrchPlan{}, core.ErrOrchInput
	}
	defer dir.Close()
	file, err := sys.OpenEntryNoFollow(dir, filepath.Base(path), os.O_RDONLY, 0)
	if err != nil {
		return core.OrchPlan{}, core.ErrOrchInput
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return core.OrchPlan{}, core.ErrOrchInput
	}
	data, err := io.ReadAll(io.LimitReader(file, PlanDocumentLimit+1))
	if err != nil {
		return core.OrchPlan{}, core.ErrOrchInput
	}
	if len(data) > PlanDocumentLimit {
		return core.OrchPlan{}, core.ErrOrchLimit
	}
	return DecodeCandidate(data)
}
