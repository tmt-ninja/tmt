package cli

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

type previewReport struct{ view orchestration.PreviewView }

func (r previewReport) JSON() any                  { return r.view }
func (r previewReport) HumanStream() output.Stream { return output.Stdout }
func (r previewReport) ExitStatus() int            { return 0 }

func (r previewReport) Human(w io.Writer) error {
	if err := clistyle.WriteDetail(w, outputTerminal(w), "Plan preview", []clistyle.DetailField{
		{Label: "changed members", Value: strconv.Itoa(len(r.view.Changes))}, {Label: "saved", Value: "false"},
	}); err != nil {
		return err
	}
	for _, change := range r.view.Changes {
		if _, err := fmt.Fprintf(w, "%s: %s\n", change.IdentityID, strings.Join(change.Fields, ", ")); err != nil {
			return err
		}
	}
	return (overviewReport{view: r.view.After}).Human(w)
}

func runOrchPreview(ctx context.Context, root home.Root, inv invocation) output.Report {
	if !inv.has("file") {
		return talkUsage("Missing required option '--file'.")
	}
	query, failure := orchOverviewQuery(inv)
	if failure != nil {
		return failure
	}
	plan, problem := orchestration.ReadCandidateFile(inv.options["file"])
	if problem != nil {
		return bindingFailure(problem.Code, problem.Message, problem.Status)
	}
	return withOrchStore(ctx, root, func(reader orchStore, now uint64) output.Report {
		view, failure := orchestration.ReadPreview(ctx, reader, query, plan, now)
		if failure != nil {
			return bindingFailure(failure.Code, failure.Message, failure.Status)
		}
		return previewReport{view: view}
	})
}
