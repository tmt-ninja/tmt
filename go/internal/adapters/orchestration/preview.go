package orchestration

import (
	"cmp"
	"context"
	"reflect"
	"slices"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type PreviewView struct {
	SchemaVersion         int             `json:"schemaVersion"`
	ObservedAtMs          uint64          `json:"observedAtMs"`
	ConfigurationRevision uint64          `json:"configurationRevision"`
	Before                OverviewView    `json:"before"`
	After                 OverviewView    `json:"after"`
	Changes               []PreviewChange `json:"changes"`
}

type PreviewChange struct {
	IdentityID core.IdentityID `json:"identityId"`
	Fields     []string        `json:"fields"`
}

func ReadPreview(ctx context.Context, reader ports.OrchReader, query OverviewQuery, candidate core.OrchPlan, now uint64) (PreviewView, *core.RequestFailure) {
	page, calendar, at, err := overviewSnapshot(ctx, reader, query, now)
	if err != nil {
		return PreviewView{}, readFailure(err)
	}
	afterPage := page
	afterPage.Policy.Plans = make([]core.OrchPlan, 0, len(page.Policy.Plans)+1)
	for _, plan := range page.Policy.Plans {
		if plan.ID == candidate.ID {
			continue
		}
		if plan.Name == candidate.Name || plan.Priority == candidate.Priority {
			return PreviewView{}, readFailure(core.ErrOrchInput)
		}
		afterPage.Policy.Plans = append(afterPage.Policy.Plans, plan)
	}
	afterPage.Policy.Plans = append(afterPage.Policy.Plans, candidate)
	slices.SortFunc(afterPage.Policy.Plans, func(a, b core.OrchPlan) int { return cmp.Compare(a.Priority, b.Priority) })
	before, failure := overview(page, calendar, at, query.RangeDays, query.Plan, now)
	if failure != nil {
		return PreviewView{}, failure
	}
	after, failure := overview(afterPage, calendar, at, query.RangeDays, query.Plan, now)
	if failure != nil {
		return PreviewView{}, failure
	}
	view := PreviewView{
		SchemaVersion: 1, ObservedAtMs: now, ConfigurationRevision: page.Policy.Revision,
		Before: before, After: after, Changes: changedMembers(before.Members, after.Members),
	}
	if failure := boundReadOutput(view); failure != nil {
		return PreviewView{}, failure
	}
	return view, nil
}

func changedMembers(before, after []OverviewMember) []PreviewChange {
	changed := []PreviewChange{}
	// Both views keep the same pinned identities, in the same order.
	for i, member := range before {
		old, next := member.Effective, after[i].Effective
		var fields []string
		for _, field := range []struct {
			name      string
			old, next any
		}{
			{"state", old.State, next.State}, {"receiving", old.Receiving, next.Receiving},
			{"sending", old.Sending, next.Sending}, {"routine", old.Routine, next.Routine},
			{"talkLimit", old.TalkLimit, next.TalkLimit},
		} {
			if !reflect.DeepEqual(field.old, field.next) {
				fields = append(fields, field.name)
			}
		}
		if len(fields) != 0 {
			changed = append(changed, PreviewChange{IdentityID: member.IdentityID, Fields: fields})
		}
	}
	return changed
}
