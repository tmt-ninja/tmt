package storage

import (
	"database/sql"
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"slices"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func readOrchPolicy(r records, owners map[core.IdentityID]core.Name) (core.OrchPolicySnapshot, error) {
	policy := core.OrchPolicySnapshot{Identities: owners, BaseReceiving: make(map[core.IdentityID]core.OrchReceiving)}
	err := r.one("SELECT revision,time_zone FROM orchestration_settings WHERE id=1").Scan(&policy.Revision, &policy.TimeZone)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return policy, err
	}
	policy.Plans, err = orchPlans(r)
	if err != nil {
		return policy, err
	}
	ids := make([]core.IdentityID, 0, len(owners))
	for id := range owners {
		ids = append(ids, id)
	}
	slices.Sort(ids)
	encoded, err := json.Marshal(ids)
	if err != nil {
		return policy, err
	}
	policy.Focus, err = scanRows(r, `SELECT identity_id,revision,start_ms,end_ms FROM orchestration_focus
		WHERE identity_id IN (SELECT value FROM json_each(?)) ORDER BY identity_id LIMIT 257`, func(row scanner) (core.OrchFocus, error) {
		var focus core.OrchFocus
		err := row.Scan(&focus.IdentityID, &focus.Revision, &focus.StartMs, &focus.EndMs)
		return focus, err
	}, string(encoded))
	if err != nil {
		return policy, err
	}
	policy.Leads, err = scanRows(r, "SELECT identity_id FROM orchestration_leads ORDER BY identity_id LIMIT 257", func(row scanner) (core.IdentityID, error) {
		var id core.IdentityID
		err := row.Scan(&id)
		return id, err
	})
	if err != nil {
		return policy, err
	}
	policy.RouteGrants, err = scanRows(r, "SELECT from_id,to_id,until_ms,granted_by FROM orchestration_route_grants ORDER BY from_id,to_id LIMIT 4097", func(row scanner) (core.OrchRouteGrant, error) {
		var grant core.OrchRouteGrant
		err := row.Scan(&grant.FromID, &grant.ToID, &grant.UntilMs, &grant.GrantedBy)
		return grant, err
	})
	if err != nil {
		return policy, err
	}
	err = readDigestOrchPolicy(r, &policy)
	return policy, err
}

func orchPlans(r records) ([]core.OrchPlan, error) {
	plans, err := scanRows(r, "SELECT id,name,revision,priority,enabled,schedule,fields FROM orchestration_plans ORDER BY priority LIMIT 129", func(row scanner) (core.OrchPlan, error) {
		var plan core.OrchPlan
		var schedule, fields []byte
		err := row.Scan(&plan.ID, &plan.Name, &plan.Revision, &plan.Priority, &plan.Enabled, &schedule, &fields)
		if err != nil {
			return plan, err
		}
		if !core.ValidUUID(plan.ID) || json.Unmarshal(schedule, &plan.Schedule, json.RejectUnknownMembers(true)) != nil || !validOrchPlanSchedule(plan.Schedule) {
			return plan, errInvalidOrchRow
		}
		plan.Fields, err = decodeOrchFields(fields)
		return plan, err
	})
	if err != nil {
		return nil, err
	}
	if len(plans) > 128 {
		return nil, errInvalidOrchRow
	}
	for index := range plans {
		if err := readOrchPlanMembers(r, &plans[index]); err != nil {
			return nil, err
		}
	}
	return plans, nil
}

func readOrchPlanMembers(r records, plan *core.OrchPlan) error {
	var err error
	plan.Targets, err = scanRows(r, "SELECT target FROM orchestration_plan_targets WHERE plan_id=? ORDER BY position LIMIT 257", func(row scanner) (core.OrchTarget, error) {
		var target core.OrchTarget
		var encoded []byte
		if err := row.Scan(&encoded); err != nil {
			return target, err
		}
		if json.Unmarshal(encoded, &target, json.RejectUnknownMembers(true)) != nil || !validOrchTarget(target) {
			return target, errInvalidOrchRow
		}
		return target, nil
	}, plan.ID)
	if err != nil {
		return err
	}
	if len(plan.Targets) == 0 || len(plan.Targets) > 256 {
		return errInvalidOrchRow
	}
	plan.Members = make(map[core.IdentityID]core.OrchPolicyFields)
	_, err = scanRows(r, "SELECT identity_id,fields FROM orchestration_member_overrides WHERE plan_id=? ORDER BY identity_id LIMIT 257", func(row scanner) (struct{}, error) {
		var id core.IdentityID
		var encoded []byte
		if err := row.Scan(&id, &encoded); err != nil {
			return struct{}{}, err
		}
		fields, err := decodeOrchFields(encoded)
		if err == nil {
			plan.Members[id] = fields
		}
		return struct{}{}, err
	}, plan.ID)
	if err == nil && len(plan.Members) > 256 {
		return errInvalidOrchRow
	}
	return err
}

func validOrchTarget(target core.OrchTarget) bool {
	switch target.Kind {
	case "all":
		return target.ID == "" && target.Pattern == ""
	case "identity":
		return core.ValidUUID(string(target.ID)) && target.Pattern == ""
	case "pattern":
		return target.ID == "" && target.Pattern != ""
	default:
		return false
	}
}

func validOrchPlanSchedule(s core.OrchPlanSchedule) bool {
	switch s.Kind {
	case "always":
		return true
	case "once":
		return safeTime(s.StartMs) && safeTime(s.EndMs) && s.EndMs > s.StartMs
	case "daily":
		return s.Start != "" && s.End != ""
	case "weekly":
		return s.Start != "" && s.End != "" && s.AnchorDate != "" && s.IntervalWeeks > 0 && len(s.Weekdays) > 0
	default:
		return false
	}
}

func decodeOrchFields(encoded []byte) (core.OrchPolicyFields, error) {
	var document struct {
		State     *core.OrchState     `json:"state"`
		Receiving *core.OrchReceiving `json:"receiving"`
		Sending   *core.OrchSending   `json:"sending"`
		Routine   *core.OrchRoutine   `json:"routine"`
		TalkLimit jsontext.Value      `json:"talkLimit"`
	}
	if err := json.Unmarshal(encoded, &document, json.RejectUnknownMembers(true)); err != nil {
		return core.OrchPolicyFields{}, errInvalidOrchRow
	}
	f := core.OrchPolicyFields{State: document.State, Receiving: document.Receiving, Sending: document.Sending, Routine: document.Routine,
		TalkLimitPresent: len(document.TalkLimit) > 0}
	if f.TalkLimitPresent {
		if err := json.Unmarshal(document.TalkLimit, &f.TalkLimit); err != nil || f.TalkLimit != nil && *f.TalkLimit == 0 {
			return f, errInvalidOrchRow
		}
	}
	if f.State != nil && *f.State != "awake" && *f.State != "low" && *f.State != "focus" && *f.State != "sleep" ||
		f.Sending != nil && *f.Sending != "anyone" && *f.Sending != "leads" && *f.Sending != "paused" ||
		f.Routine != nil && *f.Routine != core.OrchRoutineRun && *f.Routine != core.OrchRoutineHold ||
		f.Receiving != nil && !validOrchReceiving(*f.Receiving, false) {
		return f, errInvalidOrchRow
	}
	return f, nil
}

func readDigestOrchPolicy(r records, policy *core.OrchPolicySnapshot) error {
	revision, document, err := readDigestReceiving(r)
	if err != nil || revision == 0 {
		return err
	}
	policy.DigestRevision, policy.DigestEnabled = revision, document.Enabled
	members := make(map[core.IdentityID]core.OrchReceiving, len(document.Members))
	for _, member := range document.Members {
		members[member.IdentityID] = member.Receiving
	}
	for id := range policy.Identities {
		receiving, ok := members[id]
		if !ok {
			receiving = document.DefaultReceiving
		}
		policy.BaseReceiving[id] = receiving
	}
	return nil
}

func validOrchReceiving(mode core.OrchReceiving, digest bool) bool {
	switch mode.Mode {
	case core.OrchReceivingDirect, core.OrchReceivingAuto:
		return mode.IntervalMs == 0
	case core.OrchReceivingUrgent, core.OrchReceivingHold:
		return !digest && mode.IntervalMs == 0
	case core.OrchReceivingBatch:
		return safeTime(mode.IntervalMs) && (digest || mode.IntervalMs <= 86400000 && mode.IntervalMs%60000 == 0)
	default:
		return false
	}
}
