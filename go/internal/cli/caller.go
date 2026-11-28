package cli

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// callerSelector verifies one explicit tmux claim. Host I/O is kept outside
// the storage transaction, and explicit identity selectors never call it.
type callerSelector struct {
	lookup func(string) (string, bool)
	probe  func(context.Context, ports.PaneRef) (core.EndpointProbe, error)
}

func newTmuxClient() (tmux.Client, error) {
	path, err := exec.LookPath("tmux")
	if err != nil {
		return tmux.Client{}, err
	}
	return tmux.Client{Path: path, Process: process.Runner{}}, nil
}

func systemCaller(client func() (tmux.Client, error)) callerSelector {
	return callerSelector{
		lookup: os.LookupEnv,
		probe: func(ctx context.Context, pane ports.PaneRef) (core.EndpointProbe, error) {
			tmuxClient, err := client()
			if err != nil {
				return core.EndpointProbe{}, err
			}
			return tmuxClient.ProbeBinding(ctx, pane)
		},
	}
}

type identitySelection struct {
	explicit *string
	claim    callerClaim
	probe    core.EndpointProbe
}

func (s callerSelector) selectIdentity(ctx context.Context, inv invocation) (identitySelection, *output.Failure) {
	if name, present := inv.options["identity"]; present {
		return identitySelection{explicit: &name}, nil
	}
	claim, probe, failure := s.observe(ctx)
	return identitySelection{claim: claim, probe: probe}, failure
}

type callerClaim struct {
	pane      ports.PaneRef
	serverPID uint64
}

func (s callerSelector) observe(ctx context.Context) (callerClaim, core.EndpointProbe, *output.Failure) {
	if s.lookup == nil || s.probe == nil {
		return callerClaim{}, core.EndpointProbe{}, identityRequired()
	}
	tmux, _ := s.lookup("TMUX")
	pane, _ := s.lookup("TMUX_PANE")
	if tmux == "" && pane == "" {
		// NOT PORTED (#6938): bounded tmux caller discovery by process ancestry.
		return callerClaim{}, core.EndpointProbe{}, identityRequired()
	}
	claim, ok := parseCallerClaim(tmux, pane)
	if !ok {
		return callerClaim{}, core.EndpointProbe{}, callerPaneMissing()
	}
	observed, err := s.probe(ctx, claim.pane)
	if err != nil || observed.State != core.EndpointProbeLive ||
		observed.Server.Host != "tmux" || observed.Server.Socket != claim.pane.Server ||
		observed.Server.PID != claim.serverPID || observed.Server.ID == "" || observed.Server.StartTime == "" {
		return callerClaim{}, core.EndpointProbe{}, callerPaneMissing()
	}
	for _, pane := range observed.Panes {
		if pane.ID == claim.pane.PaneID && pane.PID > 0 {
			return claim, observed, nil
		}
	}
	return callerClaim{}, core.EndpointProbe{}, callerPaneMissing()
}

func parseCallerClaim(tmux, pane string) (callerClaim, bool) {
	// The socket path may itself contain commas. Parse the two trailing
	// fields from the right and never fall back to the default server.
	last := strings.LastIndexByte(tmux, ',')
	if last < 0 || !decimalText(tmux[last+1:]) {
		return callerClaim{}, false
	}
	server := tmux[:last]
	first := strings.LastIndexByte(server, ',')
	if first < 0 || !strings.HasPrefix(pane, "%") || !decimalText(pane[1:]) {
		return callerClaim{}, false
	}
	socket, pid := server[:first], server[first+1:]
	if !filepath.IsAbs(socket) || !utf8.ValidString(socket) || strings.ContainsRune(socket, 0) || !decimalText(pid) {
		return callerClaim{}, false
	}
	number, err := strconv.ParseUint(pid, 10, 31)
	if err != nil || number == 0 {
		return callerClaim{}, false
	}
	return callerClaim{pane: ports.PaneRef{Server: socket, PaneID: pane}, serverPID: number}, true
}

func decimalText(value string) bool {
	return value != "" && strings.IndexFunc(value, func(ch rune) bool { return ch < '0' || ch > '9' }) == -1
}

func callerPaneMissing() *output.Failure {
	return &output.Failure{Code: "PANE_NOT_FOUND", Message: "Could not verify the caller pane.", Status: 3}
}

func verifiedCaller(tx ports.StoreTx, claim callerClaim, probe core.EndpointProbe) (*core.Identity, error) {
	key := core.EndpointKey{Host: probe.Server.Host, ServerID: probe.Server.ID, PaneID: claim.pane.PaneID}
	binding, err := tx.Bindings().FindByEndpoint(key)
	if err != nil || binding == nil || binding.EndpointKey() != key {
		return nil, err
	}
	identity, err := tx.Identities().FindByID(binding.IdentityID)
	if err != nil || identity == nil {
		return nil, err
	}
	state, pane := core.EvaluateBinding(*identity, binding, probe)
	if state != core.BindingActive || pane == nil || binding.PaneIncarnation != nil && pane.Incarnation == nil {
		return nil, nil
	}
	return identity, nil
}
