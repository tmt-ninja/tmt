package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

type talksReport struct{ view orchestration.TalksView }

func (r talksReport) JSON() any                  { return r.view }
func (r talksReport) HumanStream() output.Stream { return output.Stdout }
func (r talksReport) ExitStatus() int            { return 0 }

func (r talksReport) Human(w io.Writer) error {
	terminal := outputTerminal(w)
	if len(r.view.Pairs) == 0 {
		return clistyle.WriteHint(w, terminal, "No agent pair talked in the last hour.")
	}
	table := clistyle.NewTable(clistyle.ColumnName, clistyle.ColumnFixed, clistyle.ColumnFixed, clistyle.ColumnFixed)
	for _, pair := range r.view.Pairs {
		limit, last, state := "unlimited", "-", "✓ Open"
		if pair.Limit != nil {
			limit = strconv.FormatUint(uint64(*pair.Limit), 10)
		}
		if pair.LastAtMs != nil {
			last = journalStamp(*pair.LastAtMs)
		}
		if pair.State == "held" {
			state = fmt.Sprintf("◆ Held · needs a person (%d)", pair.HeldCount)
		}
		names := string(pair.Members[0].Name) + " ↔ " + string(pair.Members[1].Name)
		addOrchRow(table, names, fmt.Sprintf("%d/%s", pair.Count, limit), last, state)
	}
	return table.Write(w, terminal)
}

type routesReport struct{ view orchestration.RoutesView }

func (r routesReport) JSON() any                  { return r.view }
func (r routesReport) HumanStream() output.Stream { return output.Stdout }
func (r routesReport) ExitStatus() int            { return 0 }

func (r routesReport) Human(w io.Writer) error {
	table := clistyle.NewTable(clistyle.ColumnName, clistyle.ColumnName, clistyle.ColumnFixed)
	for _, route := range r.view.Routes {
		verdict := "✓ Allowed"
		switch route.Verdict {
		case "blocked":
			verdict = "■ Blocked"
		case "needs_person":
			verdict = "◆ Needs a person"
		}
		addOrchRow(table, string(route.FromName), string(route.ToName), verdict)
	}
	return table.Write(w, outputTerminal(w))
}

func registerTalksGrammar(orch *commandSpec) {
	talks := orch.child("talks")
	talks.summary = "Read agent pairs with recent or held talk"
	talks.options = []string{"member", "limit", "after"}
	routes := orch.child("routes")
	routes.summary = "Read the sending verdict for each ordered pair of members"
	routes.options = []string{"member", "limit", "after", "at"}
}

func orchTalkPage(inv invocation) (orchestration.TalkPageQuery, *output.Failure) {
	query := orchestration.TalkPageQuery{Limit: orchestration.TalkPageLimit}
	if inv.has("limit") {
		var failure *output.Failure
		query.Limit, failure = orchTalkLimit(inv.options["limit"])
		if failure != nil {
			return query, failure
		}
	}
	if inv.has("member") {
		member := inv.options["member"]
		query.MemberQuery = &member
	}
	if inv.has("after") {
		after := inv.options["after"]
		query.After = &after
	}
	if !query.Valid() {
		return query, bindingFailure("ORCH_INPUT_INVALID", "Invalid orchestration input or calendar selection.", 1)
	}
	return query, nil
}

func orchTalkLimit(value string) (uint16, *output.Failure) {
	n, err := strconv.ParseInt(value, 10, 64)
	var reason string
	switch {
	case value == "":
		reason = "cannot parse integer from empty string"
	case errors.Is(err, strconv.ErrRange) && strings.HasPrefix(value, "-"):
		reason = "number too small to fit in target type"
	case errors.Is(err, strconv.ErrRange):
		reason = "number too large to fit in target type"
	case err != nil:
		reason = "invalid digit found in string"
	case n < 1 || n > orchestration.TalkPageLimit:
		reason = fmt.Sprintf("%d is not in 1..=%d", n, orchestration.TalkPageLimit)
	default:
		return uint16(n), nil
	}
	return 0, bindingFailure("USAGE_ERROR", fmt.Sprintf("error: invalid value '%s' for '--limit <limit>': %s\n", value, reason), 1)
}

func runOrchTalks(ctx context.Context, root home.Root, inv invocation) output.Report {
	query, failure := orchTalkPage(inv)
	if failure != nil {
		return failure
	}
	return withOrchStore(ctx, root, func(store orchStore, now uint64) output.Report {
		view, failure := orchestration.ReadTalks(ctx, store, query, now)
		if failure != nil {
			return bindingFailure(failure.Code, failure.Message, failure.Status)
		}
		return talksReport{view: view}
	})
}

func runOrchRoutes(ctx context.Context, root home.Root, inv invocation) output.Report {
	page, failure := orchTalkPage(inv)
	if failure != nil {
		return failure
	}
	query := orchestration.RoutesQuery{TalkPageQuery: page}
	if inv.has("at") {
		at := inv.options["at"]
		query.LocalAt = &at
	}
	return withOrchStore(ctx, root, func(store orchStore, now uint64) output.Report {
		view, failure := orchestration.ReadRoutes(ctx, store, query, now)
		if failure != nil {
			return bindingFailure(failure.Code, failure.Message, failure.Status)
		}
		return routesReport{view: view}
	})
}
