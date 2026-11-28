//go:build darwin || linux

package runtime

import (
	"context"
	"math"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

// BoundProvider identifies an observed foreground runtime. The zero value
// represents unknown evidence and never allows choosing a delivery driver.
type BoundProvider struct {
	Name        string
	Incarnation Incarnation
}

// ProveBoundMain checks an exact Go binding and its recorded live main
// provider. It observes placement and the terminal foreground group, then
// checks the recorded incarnation and any recorded launch owner.
// This does not establish Idle, permission or channel readiness.
func (o Observer) ProveBoundMain(ctx context.Context, identity core.Identity, binding core.Binding, probe core.EndpointProbe) (BoundProvider, error) {
	session := binding.Session
	if session.RuntimeState != "running" || session.Runtime == nil || session.PlainProgram != nil {
		return BoundProvider{}, nil
	}
	return o.provePaneProcess(ctx, identity, binding, probe, *session.Runtime, session.LaunchOwner)
}

// ProveLaunchChild checks the captured child of this launch against a fresh
// exact binding probe and the selected driver. It needs no recorded runtime
// because it runs before admission. An interpreter, background process, or
// different process with the same name cannot satisfy the proof.
func (o Observer) ProveLaunchChild(ctx context.Context, identity core.Identity, binding core.Binding,
	probe core.EndpointProbe, child core.ProcessIncarnation, driver core.DriverName,
) (bool, error) {
	if !driver.Valid() || (binding.Session.RuntimeState != "unknown" && binding.Session.RuntimeState != "ended") {
		return false, nil
	}
	proven, err := o.provePaneProcess(ctx, identity, binding, probe, child, nil)
	return err == nil && proven.Name == string(driver), err
}

func (o Observer) provePaneProcess(ctx context.Context, identity core.Identity, binding core.Binding,
	probe core.EndpointProbe, process core.ProcessIncarnation, owner *core.ProcessIncarnation,
) (BoundProvider, error) {
	if binding.PanePID == 0 || binding.PanePID > math.MaxInt32 || process.PID == 0 || process.PID > math.MaxInt32 {
		return BoundProvider{}, nil
	}
	owned, pane := core.EvaluateBinding(identity, &binding, probe)
	if owned != core.BindingActive || binding.PaneIncarnation == nil || pane.Incarnation == nil ||
		*pane.Incarnation != *binding.PaneIncarnation {
		return BoundProvider{}, nil
	}
	expected := Incarnation{PID: int(process.PID), Start: process.StartIdentity}
	if !expected.Valid() {
		return BoundProvider{}, nil
	}
	ps, err := o.queryPS(ctx, ancestryLimit, "-A", "-o", "pid=,ppid=,pgid=,tpgid=,comm=")
	if err != nil || ps.ExitCode != 0 {
		return BoundProvider{}, err
	}
	rows := parseProcessRows(ps.Stdout, true)
	name := foregroundProvider(rows, expected.PID, int(binding.PanePID))
	if name == "" {
		return BoundProvider{}, nil
	}
	if owner != nil {
		if owner.PID == 0 || owner.PID > math.MaxInt32 {
			return BoundProvider{}, nil
		}
		want := Incarnation{PID: int(owner.PID), Start: owner.StartIdentity}
		live, err := o.Observe(ctx, want.PID)
		if err != nil || live.Match(want) != Alive {
			return BoundProvider{}, err
		}
	}
	live, err := o.Observe(ctx, expected.PID)
	if err != nil || live.Match(expected) != Alive {
		return BoundProvider{}, err
	}
	return BoundProvider{Name: name, Incarnation: live.Incarnation}, nil
}

func foregroundProvider(rows map[int]processRow, process, pane int) string {
	row := rows[process]
	switch row.command {
	case "claude", "codex", "gemini":
	default:
		return ""
	}
	if row.group <= 0 || row.group != row.foreground || row.foreground != rows[pane].foreground ||
		findMain(rows, process, pane, row.command) != process {
		return ""
	}
	return row.command
}
