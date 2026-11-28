package cli

import (
	"context"
	"io"
	"strconv"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func registerPlanGrammar(plan *commandSpec) {
	list := plan.child("ls")
	list.summary = "List stored plans (Base always applies)"
	list.aliases = []string{"list"}
	show := plan.child("show")
	show.summary = "Read one plan by UUID or unique exact name"
	show.operands = []operandSpec{required("plan-name")}
}

type plansReport struct{ view orchestration.PlansView }

func (r plansReport) JSON() any                  { return r.view }
func (r plansReport) HumanStream() output.Stream { return output.Stdout }
func (r plansReport) ExitStatus() int            { return 0 }

func (r plansReport) Human(w io.Writer) error {
	terminal := outputTerminal(w)
	if len(r.view.Plans) == 0 {
		return clistyle.WriteHint(w, terminal, orchestration.BaseOnlyHint)
	}
	table := clistyle.NewTable(clistyle.ColumnName, clistyle.ColumnFixed, clistyle.ColumnFixed, clistyle.ColumnFixed)
	for _, plan := range r.view.Plans {
		table.AddRow(clistyle.Cell{Text: plan.Name}, clistyle.Cell{Text: strconv.FormatInt(int64(plan.Priority), 10)},
			clistyle.Cell{Text: strconv.FormatBool(plan.Enabled)}, clistyle.Cell{Text: plan.ID})
	}
	return table.Write(w, terminal)
}

func orchPlanMissingSubcommand() output.Report {
	command := flavor.Binary + " orch plan"
	return talkUsage("error: '" + command + "' requires a subcommand but one was not provided\n" +
		"  [subcommands: ls, list, show, add, set, rm]\n\nUsage: " + command + " [OPTIONS] <COMMAND>\n")
}

func runOrchPlans(ctx context.Context, root home.Root, selector *string) output.Report {
	if !orchestration.ValidPlanSelector(selector) {
		return bindingFailure("ORCH_INPUT_INVALID", "Invalid orchestration input or calendar selection.", 1)
	}
	return withOrchStore(ctx, root, func(reader ports.OrchReader, now uint64) output.Report {
		view, failure := orchestration.ReadPlans(ctx, reader, selector, now)
		if failure != nil {
			return bindingFailure(failure.Code, failure.Message, failure.Status)
		}
		return plansReport{view: view}
	})
}
