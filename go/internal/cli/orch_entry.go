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
)

func registerOrchGrammar() {
	why := grammar.child("orch").child("why")
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
	if !slices.Equal(inv.path, []string{"orch", "why"}) {
		return bindingFailure("NOT_PORTED", fmt.Sprintf("Command '%s' is not yet ported.", strings.Join(inv.path, " ")), 2)
	}
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

	store, err := storage.Open(ctx, root)
	if err != nil {
		if errors.Is(err, os.ErrPermission) {
			return bindingFailure("STORAGE_NOT_WRITABLE", fmt.Sprintf("Could not write to the data directory %s. No orchestration operation was performed.", root.Dir), 1)
		}
		return bindingFailure("ORCH_STORAGE_UNAVAILABLE", "Could not open orchestration storage.", 1)
	}
	query.NowMs = uint64(time.Now().UnixMilli())
	view, failure := orchestration.ReadWhy(ctx, store, query)
	closeErr := store.Close()
	if failure != nil {
		return bindingFailure(failure.Code, failure.Message, failure.Status)
	}
	if closeErr != nil {
		return bindingFailure("CLEANUP_ERROR", "Could not clean up command resources. Effects may already have occurred.", 1)
	}
	return whyReport{view: view}
}
