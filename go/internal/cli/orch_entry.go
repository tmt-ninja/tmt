package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func registerOrchGrammar() {
	orch := grammar.child("orch")
	registerOverviewGrammar(orch)
	registerPlanGrammar(orch.child("plan"))
	why := orch.child("why")
	why.summary = "Read retained receiving decision facts"
	why.operands = []operandSpec{required("subject")}
	why.options = []string{"before", "limit"}
	options = append(options, optionSpec{name: "before", value: true, help: "Read event IDs below this cursor"})
}

type whyReport struct{ view orchestration.JournalView }

func (r whyReport) JSON() any                  { return r.view }
func (r whyReport) HumanStream() output.Stream { return output.Stdout }
func (r whyReport) ExitStatus() int            { return 0 }

func (r whyReport) Human(w io.Writer) error {
	terminal := outputTerminal(w)
	if len(r.view.Items) == 0 {
		return clistyle.WriteHint(w, terminal, "No recorded decision. Slice 1 provides the journal; live producers arrive in slices 2–4.")
	}
	table := clistyle.NewTable(clistyle.ColumnFixed, clistyle.ColumnFixed, clistyle.ColumnFixed, clistyle.ColumnName)
	for _, entry := range r.view.Items {
		table.AddRow(clistyle.Cell{Text: journalStamp(entry.RecordedAtMs)}, clistyle.Cell{Text: string(entry.Action)},
			clistyle.Cell{Text: string(entry.Outcome)}, clistyle.Cell{Text: entry.Reason})
	}
	return table.Write(w, terminal)
}

func journalStamp(ms uint64) string {
	recorded := time.UnixMilli(int64(ms)).UTC()
	// Native's timestamp renderer accepts dates through year 9999.
	if recorded.Year() > 9999 {
		return "-"
	}
	fraction := strings.TrimRight(fmt.Sprintf("%03d", recorded.Nanosecond()/1_000_000), "0")
	if fraction == "" {
		fraction = "0"
	}
	return fmt.Sprintf("%s %d:%02d:%02d.%s +00:00:00",
		recorded.Format(time.DateOnly), recorded.Hour(), recorded.Minute(), recorded.Second(), fraction)
}

func runOrch(ctx context.Context, root home.Root, inv invocation) output.Report {
	switch {
	case len(inv.path) == 1:
		return runOrchOverview(ctx, root, inv)
	case slices.Equal(inv.path, []string{"orch", "preview"}):
		return runOrchPreview(ctx, root, inv)
	case slices.Equal(inv.path, []string{"orch", "why"}):
		return runOrchWhy(ctx, root, inv)
	case slices.Equal(inv.path, []string{"orch", "plan"}):
		return orchPlanMissingSubcommand()
	case slices.Equal(inv.path, []string{"orch", "plan", "ls"}):
		return runOrchPlans(ctx, root, nil)
	case slices.Equal(inv.path, []string{"orch", "plan", "show"}):
		return runOrchPlans(ctx, root, &inv.operands[0])
	default:
		return bindingFailure("NOT_PORTED", fmt.Sprintf("Command '%s' is not yet ported.", strings.Join(inv.path, " ")), 2)
	}
}

func runOrchWhy(ctx context.Context, root home.Root, inv invocation) output.Report {
	subject := core.OrchJournalSubject{Kind: core.OrchSubjectIdentity, ID: inv.operands[0]}
	if strings.HasPrefix(subject.ID, "req_") {
		subject.Kind = core.OrchSubjectRequest
	} else if id, ok := strings.CutPrefix(subject.ID, "job:"); ok {
		subject = core.OrchJournalSubject{Kind: core.OrchSubjectJob, ID: id}
	}
	query := core.OrchJournalQuery{Subject: subject, Limit: orchestration.JournalDefaultLimit}
	if limit, problem := optionalDecimal(inv, "limit", 1, orchestration.JournalMaxLimit); problem != "" {
		return talkUsage(problem)
	} else if inv.has("limit") {
		query.Limit = uint16(limit)
	}
	if before, problem := optionalDecimal(inv, "before", 1, core.MaxJSSafeInteger); problem != "" {
		return talkUsage(problem)
	} else if inv.has("before") {
		query.Before = &before
	}
	if !orchestration.ValidWhy(query) {
		return bindingFailure("ORCH_INPUT_INVALID", "Invalid orchestration input or calendar selection.", 1)
	}

	return withOrchStore(ctx, root, func(reader ports.OrchReader, now uint64) output.Report {
		query.NowMs = now
		view, failure := orchestration.ReadWhy(ctx, reader, query)
		if failure != nil {
			return bindingFailure(failure.Code, failure.Message, failure.Status)
		}
		return whyReport{view: view}
	})
}

func withOrchStore(ctx context.Context, root home.Root, run func(ports.OrchReader, uint64) output.Report) output.Report {
	store, err := storage.Open(ctx, root)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			return bindingFailure("STORAGE_NOT_WRITABLE", fmt.Sprintf("Could not write to the data directory %s. No orchestration operation was performed.", root.Dir), 1)
		}
		return bindingFailure("ORCH_STORAGE_UNAVAILABLE", "Could not open orchestration storage.", 1)
	}
	report := run(store, uint64(time.Now().UnixMilli()))
	if err := store.Close(); err != nil {
		if _, failed := report.(*output.Failure); !failed {
			return bindingFailure("CLEANUP_ERROR", "Could not clean up command resources. Effects may already have occurred.", 1)
		}
	}
	return report
}
