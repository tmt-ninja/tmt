package cli

import (
	"context"
	"io"
	"strconv"
	"strings"

	json "encoding/json/v2"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func registerJobsGrammar(group *commandSpec) {
	list := group.child("ls")
	list.summary = "List jobs, their next slots and recorded outcomes"
	list.aliases = []string{"list"}
	list.options = []string{"owner", "squad-room", "cursor", "limit"}
	show := group.child("show")
	show.summary = "Read a job and its exact message"
	show.operands = []operandSpec{required("job")}
	options = append(options,
		optionSpec{name: "owner", value: true, help: "Filter by an exact current owner name or UUID"},
		optionSpec{name: "squad-room", value: true, help: "Filter by the explicit squad room UUID"},
		optionSpec{name: "cursor", value: true, help: "Continue the same filtered page"},
	)
}

type jobsReport struct{ view orchestration.JobListView }

func (r jobsReport) JSON() any                  { return r.view }
func (r jobsReport) HumanStream() output.Stream { return output.Stdout }
func (r jobsReport) ExitStatus() int            { return 0 }

func (r jobsReport) Human(w io.Writer) error {
	term := outputTerminal(w)
	table := clistyle.NewTable(clistyle.ColumnFixed, clistyle.ColumnName, clistyle.ColumnFixed, clistyle.ColumnName)
	for _, row := range r.view.Jobs {
		owner, title := "no owner", "null"
		if row.Target.IdentityName != nil {
			owner = string(*row.Target.IdentityName)
		}
		if row.Title != nil {
			title = *row.Title
		}
		addOrchRow(table, row.DisplayID, owner, row.State, title)
	}
	if err := table.Write(w, term); err != nil {
		return err
	}
	if cursor := r.view.NextCursor; cursor != nil {
		return clistyle.WriteDetail(w, term, "More jobs", []clistyle.DetailField{{Label: "cursor", Value: *cursor}})
	}
	return nil
}

type jobReport struct{ view orchestration.JobDetailView }

func (r jobReport) JSON() any                  { return r.view }
func (r jobReport) HumanStream() output.Stream { return output.Stdout }
func (r jobReport) ExitStatus() int            { return 0 }

func (r jobReport) Human(w io.Writer) error {
	row := r.view.Job
	owner, next := "null", "null"
	if row.Target.IdentityName != nil {
		owner = string(*row.Target.IdentityName)
	}
	if row.NextRunAtMs != nil {
		next = strconv.FormatInt(*row.NextRunAtMs, 10)
	}
	definition, err := json.Marshal(row.Definition)
	if err != nil {
		return err
	}
	lastRun, err := json.Marshal(row.LastRun)
	if err != nil {
		return err
	}
	return clistyle.WriteDetail(w, outputTerminal(w), "Job", []clistyle.DetailField{
		{Label: "id", Value: row.DisplayID}, {Label: "owner", Value: owner}, {Label: "state", Value: row.State},
		{Label: "definition", Value: string(definition)}, {Label: "next run", Value: next}, {Label: "last run", Value: string(lastRun)},
	})
}

func runOrchJobs(ctx context.Context, root home.Root, inv invocation) output.Report {
	query := core.OrchJobQuery{Limit: orchestration.JobDefaultLimit}
	if limit, problem := optionalDecimal(inv, "limit", 1, orchestration.JobMaxLimit); problem != "" {
		return talkUsage(problem)
	} else if inv.has("limit") {
		query.Limit = uint16(limit)
	}
	if inv.has("squad-room") {
		room := inv.options["squad-room"]
		query.RoomID = &room
	}
	var cursor *string
	if inv.has("cursor") {
		value := inv.options["cursor"]
		cursor = &value
	}
	return withOrchStore(ctx, root, func(store orchStore, now uint64) output.Report {
		if inv.has("owner") {
			selector := inv.options["owner"]
			var owner *core.Identity
			err := store.Read(ctx, func(tx ports.StoreTx) error {
				var err error
				owner, err = core.ResolveIdentity(tx.Identities(), selector)
				return err
			})
			if err != nil {
				return bindingFailure("IDENTITY_ERROR", "Could not read identity storage.", 1)
			}
			if owner == nil {
				return identityMissing(selector)
			}
			query.OwnerID = &owner.ID
		}
		query.NowMs = now
		admitted, ok := orchestration.AdmitJobs(query, cursor)
		if !ok {
			return bindingFailure("ORCH_INPUT_INVALID", "Invalid orchestration input or calendar selection.", 1)
		}
		view, failure := orchestration.ReadJobs(ctx, store, admitted)
		if failure != nil {
			return bindingFailure(failure.Code, failure.Message, failure.Status)
		}
		return jobsReport{view: view}
	})
}

func runOrchJob(ctx context.Context, root home.Root, inv invocation) output.Report {
	selector := inv.operands[0]
	query := core.OrchJobQuery{Limit: 1, FullMessage: true}
	if core.ValidUUID(selector) && selector != "00000000-0000-0000-0000-000000000000" {
		query.JobID = &selector
	} else {
		numberText, hasPrefix := strings.CutPrefix(selector, "j")
		number, err := strconv.ParseUint(strings.TrimPrefix(numberText, "+"), 10, 64)
		if !hasPrefix || err != nil || number == 0 || !core.ValidJSSafeInteger(number) {
			failure := orchestration.InvalidJob()
			return bindingFailure(failure.Code, failure.Message, failure.Status)
		}
		query.Number = &number
	}
	return withOrchStore(ctx, root, func(store orchStore, now uint64) output.Report {
		query.NowMs = now
		view, failure := orchestration.ReadJob(ctx, store, query)
		if failure != nil {
			return bindingFailure(failure.Code, failure.Message, failure.Status)
		}
		return jobReport{view: view}
	})
}
