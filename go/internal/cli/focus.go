package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

var focusDirections = []string{
	string(tmux.SwapLeft), string(tmux.SwapRight), string(tmux.SwapUp), string(tmux.SwapDown),
}

func focusUsage(inv invocation, args []string) string {
	direction, into := inv.options["into"]
	if into && !slices.Contains(focusDirections, direction) {
		message := fmt.Sprintf("error: invalid value '%s' for '--into <into>'\n  [possible values: %s]\n",
			direction, strings.Join(focusDirections, ", "))
		if nearest := focusDirectionSuggestion(direction); nearest != "" {
			message += fmt.Sprintf("\n  tip: a similar value exists: '%s'\n", nearest)
		}
		return message
	}
	client, target := inv.has("client"), len(inv.operands) != 0
	if client && !into && !target || target && !client {
		return ""
	}
	// The native diagnostic shows the first conflicting argument as typed and
	// keeps the order of the retained flags in its usage line.
	first := ""
	var conflicting []string
	for _, arg := range args {
		if arg != "json" && first == "" {
			first = arg
		}
		if arg == "into" || arg == "target" {
			conflicting = append(conflicting, focusArgumentLabel(arg))
		}
	}
	usage := flavor.Binary + " focus"
	for _, arg := range args {
		if arg == "json" || arg == "client" && first == "client" || arg == "into" && first != "client" {
			usage += " " + focusArgumentLabel(arg)
		}
	}
	if !client {
		return "error: the following required arguments were not provided:\n  <target>\n\nUsage: " + usage + " <target>\n"
	}
	operand := "[target]"
	var message string
	switch {
	case first != "client":
		message = fmt.Sprintf("error: the argument '%s' cannot be used with '--client'\n", focusArgumentLabel(first))
		if target {
			operand = "<target>"
		}
	case len(conflicting) == 1:
		message = fmt.Sprintf("error: the argument '--client' cannot be used with '%s'\n", conflicting[0])
	default:
		message = "error: the argument '--client' cannot be used with:\n  " + strings.Join(conflicting, "\n  ") + "\n"
	}
	return message + "\nUsage: " + usage + " " + operand + "\n"
}

func focusArgumentLabel(arg string) string {
	switch arg {
	case "target":
		return "[target]"
	case "into":
		return "--into <into>"
	default:
		return "--" + arg
	}
}

func focusDirectionSuggestion(value string) string {
	nearest, best := "", 0.7
	text := []rune(value)
	for _, direction := range focusDirections {
		score := jaroSimilarity(text, []rune(direction))
		if score > 0.7 && score >= best {
			nearest, best = direction, score
		}
	}
	return nearest
}

// Native Clap compares possible values by Jaro similarity.
func jaroSimilarity(value, candidate []rune) float64 {
	window := max(max(len(value), len(candidate))/2-1, 0)
	matched := make([]bool, len(candidate))
	inOrder := make([]rune, 0, len(candidate))
	for i, ch := range value {
		for j := max(0, i-window); j < min(len(candidate), i+window+1); j++ {
			if !matched[j] && ch == candidate[j] {
				matched[j] = true
				inOrder = append(inOrder, ch)
				break
			}
		}
	}
	matches := len(inOrder)
	if matches == 0 {
		return 0
	}
	var index, reordered int
	for i, ch := range candidate {
		if matched[i] {
			if ch != inOrder[index] {
				reordered++
			}
			index++
		}
	}
	count := float64(matches)
	return (count/float64(len(value)) + count/float64(len(candidate)) + float64(matches-reordered/2)/count) / 3
}

func focusHostUnsupported(swap bool) *output.Failure {
	message := "No tmux client can be focused for this invocation: run it inside tmux, from a pane with an attached client. Nothing changed."
	if swap {
		message = "This host cannot swap panes for this invocation: use a verified caller pane and another target on the same server. Nothing changed."
	}
	return bindingFailure("HOST_UNSUPPORTED", message, 1)
}

func focusChanged() *output.Failure {
	return bindingFailure("RECONCILIATION_FAILED", "Could not verify the selected pane. Inspect the client before retrying.", 1)
}

func focusInactive(target string) *output.Failure {
	return bindingFailure("NAME_NOT_FOUND", fmt.Sprintf("Identity '%s' is not active.", target), 3)
}

func focusStoreFailure() *output.Failure {
	return bindingFailure("IDENTITY_ERROR", "Could not read identity storage.", 1)
}

func (app application) runFocus(ctx context.Context, root home.Root, inv invocation) output.Report {
	swap := inv.has("into")
	if app.caller.lookup == nil || app.tmux == nil {
		return focusHostUnsupported(swap)
	}
	caller, ok := focusCaller(app.caller.lookup)
	if !ok || swap && caller.PaneID == "" {
		return focusHostUnsupported(swap)
	}
	client, err := app.tmux()
	if err != nil {
		return focusHostUnsupported(swap)
	}
	view, err := client.InvokerClient(ctx, caller)
	if err != nil {
		return focusHostUnsupported(swap)
	}
	if inv.has("client") {
		return focusClientReport(view)
	}
	return withIdentityStore(ctx, root, app.store, focusStoreFailure(), func(store ports.Store) output.Report {
		target, failure := focusTarget(ctx, store, client, caller.Socket, inv.operands[0])
		if failure != nil {
			if swap && failure.Code == "HOST_UNSUPPORTED" {
				return focusHostUnsupported(true)
			}
			return failure
		}
		if swap {
			if target.Pane.PaneID == caller.PaneID {
				return focusHostUnsupported(true)
			}
			moved, err := client.SwapInto(ctx, caller, view, target, tmux.SwapDirection(inv.options["into"]))
			switch {
			case errors.Is(err, tmux.ErrInvokerClient):
				return focusHostUnsupported(true)
			case errors.Is(err, tmux.ErrNoNeighbour):
				return bindingFailure("PANE_NOT_FOUND", "No visible neighbouring pane in that direction; nothing changed.", 3)
			case err != nil:
				return focusChanged()
			default:
				return focusSwapReport(moved)
			}
		}
		after, err := client.FocusPane(ctx, caller, view, target)
		if errors.Is(err, tmux.ErrInvokerClient) {
			return focusHostUnsupported(false)
		}
		if err != nil {
			return focusChanged()
		}
		return focusPaneReport(view, after)
	})
}

func focusCaller(lookup func(string) (string, bool)) (tmux.TmuxCaller, bool) {
	value, _ := lookup("TMUX")
	pane, _ := lookup("TMUX_PANE")
	if pane != "" {
		claim, ok := parseCallerClaim(value, pane)
		return tmux.TmuxCaller{Socket: claim.pane.Server, ServerPID: claim.serverPID, PaneID: claim.pane.PaneID}, ok
	}
	socket, pid, session, ok := parseTmuxClaim(value)
	return tmux.TmuxCaller{Socket: socket, ServerPID: pid, SessionID: "$" + session}, ok
}

func focusTarget(ctx context.Context, store ports.Store, client tmux.Client, socket, selector string) (tmux.PaneSnapshot, *output.Failure) {
	var direct bool
	var entry bindingEntry
	err := store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		direct, err = core.AddressesPane(tx.Identities(), selector)
		if err != nil || direct {
			return err
		}
		entry, err = readBindingEntry(tx, selector)
		return err
	})
	if err != nil {
		return tmux.PaneSnapshot{}, focusStoreFailure()
	}
	var pane ports.PaneRef
	if direct {
		pane, err = client.ResolvePane(ctx, socket, core.TargetText(selector))
		if errors.Is(err, tmux.ErrPaneNotFound) {
			return tmux.PaneSnapshot{}, bindingPaneMissing(selector)
		}
		if err != nil {
			return tmux.PaneSnapshot{}, focusChanged()
		}
	} else {
		if entry.identity == nil {
			return tmux.PaneSnapshot{}, identityMissing(selector)
		}
		if entry.binding == nil {
			return tmux.PaneSnapshot{}, focusInactive(selector)
		}
		if entry.binding.Server.Host != "tmux" || entry.binding.Server.Socket != socket {
			// NOT PORTED (CLI-03, CLI-07): Focus through external hosts and attach to built-in terminals.
			return tmux.PaneSnapshot{}, focusHostUnsupported(false)
		}
		pane = ports.PaneRef{Server: socket, PaneID: entry.binding.PaneID}
	}
	seen, err := client.Discover(ctx, socket, pane.PaneID)
	if err == nil && len(seen.Candidates) == 0 {
		if direct {
			return tmux.PaneSnapshot{}, bindingPaneMissing(selector)
		}
		return tmux.PaneSnapshot{}, focusInactive(selector)
	}
	if err != nil || seen.Truncated || len(seen.Candidates) != 1 {
		return tmux.PaneSnapshot{}, focusChanged()
	}
	target := seen.Candidates[0]
	if target.Pane != pane || target.Linked || target.Reason != "" {
		return tmux.PaneSnapshot{}, focusChanged()
	}
	if direct && target.Marker == nil {
		return target, nil
	}
	var verified bindingEntry
	err = store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		verified.binding, err = tx.Bindings().FindByEndpoint(core.EndpointKey{
			Host: target.Server.Host, ServerID: target.Server.ID, PaneID: target.Pane.PaneID,
		})
		if err != nil || verified.binding == nil {
			return err
		}
		verified.identity, err = tx.Identities().FindByID(verified.binding.IdentityID)
		return err
	})
	if err != nil {
		return tmux.PaneSnapshot{}, focusStoreFailure()
	}
	if verified.identity == nil || verified.binding == nil || !direct && !sameBindingEntryForCLI(entry, verified) {
		return tmux.PaneSnapshot{}, focusChanged()
	}
	probe := core.EndpointProbe{State: core.EndpointProbeLive, Server: target.Server, Panes: []core.PaneObservation{{
		ID: pane.PaneID, PID: target.Process.PID, Incarnation: &target.Process.StartIdentity, Marker: target.Marker,
	}}}
	state, _ := core.EvaluateBinding(*verified.identity, verified.binding, probe)
	if state != core.BindingActive {
		return tmux.PaneSnapshot{}, focusChanged()
	}
	return target, nil
}

func focusClientReport(view tmux.ClientView) output.Report {
	return bindingReport{document: struct {
		Client string `json:"client"`
		Pane   string `json:"pane"`
	}{view.Name, view.PaneID}, render: func(w io.Writer) error {
		_, err := fmt.Fprintf(w, "Client %s shows %s.\n", view.Name, view.PaneID)
		return err
	}}
}

type focusPaneDocument struct {
	Pane string `json:"pane"`
}

func focusPaneReport(before, after tmux.ClientView) output.Report {
	return bindingReport{document: struct {
		Focused focusPaneDocument `json:"focused"`
		From    focusPaneDocument `json:"from"`
		Client  string            `json:"client"`
	}{focusPaneDocument{after.PaneID}, focusPaneDocument{before.PaneID}, after.Name}, render: func(w io.Writer) error {
		return success(w, "Focused "+after.PaneID)
	}}
}

func focusSwapReport(result tmux.SwapResult) output.Report {
	document := struct {
		Swapped *focusPaneDocument `json:"swapped"`
		With    focusPaneDocument  `json:"with"`
		Already bool               `json:"already,omitempty"`
	}{With: focusPaneDocument{result.Neighbour}, Already: result.Already}
	message := result.Target + " is already beside this pane"
	if !result.Already {
		document.Swapped = &focusPaneDocument{result.Target}
		message = fmt.Sprintf("Swapped %s with %s", result.Target, result.Neighbour)
	}
	return bindingReport{document: document, render: func(w io.Writer) error {
		return success(w, message)
	}}
}
