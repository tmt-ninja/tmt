package cli

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

func registerOverviewGrammar(orch *commandSpec) {
	orch.summary = "Read orchestration slots and effective member policies"
	orch.options = []string{"range", "at", "plan", "member"}
	preview := orch.child("preview")
	preview.summary = "Preview a candidate plan without saving or delivering"
	preview.options = append([]string{"file"}, orch.options...)
	options = append(options,
		optionSpec{name: "range", value: true, help: "Show 1d, 7d or 30d of local calendar slots"},
		optionSpec{name: "at", value: true, help: "Evaluate an RFC3339 instant or local YYYY-MM-DD HH:MM"},
		optionSpec{name: "plan", value: true, help: "Filter the timeline by exact plan name or UUID"},
		optionSpec{name: "member", value: true, help: "Filter canonical names case-insensitively, prefix matches first"},
	)
}

type overviewReport struct{ view orchestration.OverviewView }

func (r overviewReport) JSON() any                  { return r.view }
func (r overviewReport) HumanStream() output.Stream { return output.Stdout }
func (r overviewReport) ExitStatus() int            { return 0 }

func (r overviewReport) Human(w io.Writer) error {
	v := r.view
	zone, err := orchestration.LoadCalendar(&v.TimeZone)
	if err != nil {
		return err
	}
	terminal := outputTerminal(w)
	window := func(from, to uint64) string { return zone.FormatMs(from) + " → " + zone.FormatMs(to) }
	if err := clistyle.WriteDetail(w, terminal, "Orchestration", []clistyle.DetailField{
		{Label: "at", Value: zone.FormatMs(v.AtMs)}, {Label: "zone", Value: v.TimeZone},
		{Label: "range", Value: window(v.Range.StartMs, v.Range.EndMs)},
	}); err != nil {
		return err
	}
	if v.EmptyState != nil {
		if err := clistyle.WriteHint(w, terminal, *v.EmptyState); err != nil {
			return err
		}
	}
	names := make(map[string]string, len(v.Plans))
	for _, plan := range v.Plans {
		names[plan.ID] = plan.Name
	}
	timeline := clistyle.NewTable(clistyle.ColumnFixed, clistyle.ColumnName, clistyle.ColumnFixed)
	addOrchRow(timeline, "slot", "plans", "count")
	for _, interval := range v.Timeline {
		plan := "Base"
		if len(interval.PlanIDs) != 0 {
			current := make([]string, 0, len(interval.PlanIDs))
			for _, id := range interval.PlanIDs {
				current = append(current, orchPlanName(names, id))
			}
			plan = strings.Join(current, ", ")
		}
		addOrchRow(timeline, window(interval.StartMs, interval.EndMs), plan, strconv.Itoa(len(interval.PlanIDs)))
	}
	if err := timeline.Write(w, terminal); err != nil {
		return err
	}
	members := clistyle.NewTable(clistyle.ColumnName, clistyle.ColumnFixed, clistyle.ColumnFixed,
		clistyle.ColumnFixed, clistyle.ColumnFixed, clistyle.ColumnName)
	addOrchRow(members, "member", "state", "receiving", "sending", "routine", "set by")
	for _, member := range v.Members {
		fields := member.Effective
		receiving := "unavailable"
		if fields.Receiving.Available {
			value := fields.Receiving.Value
			receiving = string(value.Mode)
			if value.Mode == core.OrchReceivingBatch {
				receiving += " " + orchInterval(value.IntervalMs)
			}
		}
		source := func(s core.OrchSource) string {
			switch s.Kind {
			case core.OrchSourceBase:
				return "Base"
			case core.OrchSourceFocus:
				return "personal focus"
			default:
				return orchPlanName(names, *s.PlanID)
			}
		}
		setBy := fmt.Sprintf("state: %s; receiving: %s; sending: %s; routine: %s",
			source(fields.State.Source), source(fields.Receiving.Source), source(fields.Sending.Source), source(fields.Routine.Source))
		addOrchRow(members, string(member.Name), string(fields.State.Value), receiving,
			string(fields.Sending.Value), string(fields.Routine.Value), setBy)
	}
	return members.Write(w, terminal)
}

func addOrchRow(table *clistyle.Table, columns ...string) {
	cells := make([]clistyle.Cell, len(columns))
	for i, text := range columns {
		cells[i] = clistyle.Cell{Text: text}
	}
	table.AddRow(cells...)
}

func orchPlanName(names map[string]string, id string) string {
	if name, ok := names[id]; ok {
		return name
	}
	return id
}

func orchInterval(ms uint64) string {
	switch {
	case ms%60_000 == 0:
		return strconv.FormatUint(ms/60_000, 10) + "m"
	case ms%1000 == 0:
		return strconv.FormatUint(ms/1000, 10) + "s"
	default:
		return strconv.FormatUint(ms, 10) + "ms"
	}
}

func orchOverviewQuery(inv invocation) (orchestration.OverviewQuery, *output.Failure) {
	query := orchestration.OverviewQuery{RangeDays: 1}
	if inv.has("range") {
		switch inv.options["range"] {
		case "1d":
		case "7d":
			query.RangeDays = 7
		case "30d":
			query.RangeDays = 30
		default:
			return query, talkUsage("Option '--range' must be 1d, 7d or 30d.")
		}
	}
	if inv.has("at") {
		value := inv.options["at"]
		query.LocalAt = &value
	}
	if inv.has("plan") {
		value := inv.options["plan"]
		query.Plan = &value
	}
	if inv.has("member") {
		value := inv.options["member"]
		query.MemberQuery = &value
	}
	if !orchestration.ValidOverview(query) {
		return query, bindingFailure("ORCH_INPUT_INVALID", "Invalid orchestration input or calendar selection.", 1)
	}
	return query, nil
}

func runOrchOverview(ctx context.Context, root home.Root, inv invocation) output.Report {
	query, failure := orchOverviewQuery(inv)
	if failure != nil {
		return failure
	}
	return withOrchStore(ctx, root, func(reader orchStore, now uint64) output.Report {
		view, failure := orchestration.ReadOverview(ctx, reader, query, now)
		if failure != nil {
			return bindingFailure(failure.Code, failure.Message, failure.Status)
		}
		return overviewReport{view: view}
	})
}
