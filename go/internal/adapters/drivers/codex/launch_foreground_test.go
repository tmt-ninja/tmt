package codex

import (
	"context"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type foregroundFixture func(ports.ProcessSpec) ports.Bounded

func (f foregroundFixture) Run(_ context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
	return f(spec), nil
}

func TestNpmForegroundRechecksExactLauncherAndUniqueImmediateChild(t *testing.T) {
	executable, script, _ := npmShimFixture(t)
	shim, err := InspectNpmLauncher(ports.ProcessSpec{Path: executable})
	if err != nil || shim == nil {
		t.Fatalf("inspected npm launcher = %+v, %v", shim, err)
	}
	const start = "ps-v1:Sat Jan 1 00:00:00 2000"
	const topology = "10 1 10 30 sh\n15 10 30 30 sh\n20 15 30 30 tmt\n30 20 30 30 node\n40 30 30 30 codex\n"
	owner := core.ProcessIncarnation{PID: 20, StartIdentity: start}
	launcher := core.ProcessIncarnation{PID: 30, StartIdentity: start}
	identity := core.Identity{ID: "identity", Name: "fixture", CanonicalName: "fixture"}
	binding := core.Binding{
		ID: "binding", IdentityID: identity.ID, PaneID: "%3", PanePID: 10, PaneIncarnation: new(start),
		Server:  core.ServerEvidence{Host: "tmux", Socket: "/private-fixture/socket", ID: "server", PID: 9, StartTime: "1"},
		Session: core.BindingSessionState{RuntimeState: "unknown"},
	}
	marker := binding.Marker(identity)
	probe := core.EndpointProbe{State: core.EndpointProbeLive, Server: binding.Server,
		Panes: []core.PaneObservation{{ID: binding.PaneID, PID: binding.PanePID, Incarnation: binding.PaneIncarnation, Marker: &marker}}}
	for _, tc := range []struct {
		name          string
		newChild      bool
		changedScript bool
		reusedPID     string
		want          int
	}{
		{name: "exact", want: 40},
		{name: "second child appears", newChild: true},
		{name: "launcher argv changes", changedScript: true},
		{name: "intermediate PID is recycled", reusedPID: "15"},
		{name: "owner PID is recycled", reusedPID: "20"},
		{name: "provider PID is recycled", reusedPID: "40"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tables, argv, reused := 0, 0, 0
			observer := runtime.Observer{Process: foregroundFixture(func(spec ports.ProcessSpec) ports.Bounded {
				if spec.Args[0] == "-A" {
					tables++
					output := topology
					if tc.newChild && tables == 2 {
						output += "41 30 30 30 codex\n"
					}
					return ports.Bounded{Stdout: []byte(output)}
				}
				if spec.Args[len(spec.Args)-1] == "comm=,args=" {
					argv++
					path := script
					if tc.changedScript && argv == 2 {
						path = "/foreign/codex.js"
					}
					return ports.Bounded{Stdout: []byte("node node " + path + "\n")}
				}
				if spec.Args[1] == tc.reusedPID {
					reused++
					if reused > 1 {
						return ports.Bounded{Stdout: []byte("Sun Jan 2 00:00:00 2000 S\n")}
					}
				}
				return ports.Bounded{Stdout: []byte("Sat Jan 1 00:00:00 2000 S\n")}
			})}
			got, err := shim.ProveForeground(t.Context(), observer, identity, binding, probe, owner, launcher)
			if err != nil || got.Incarnation.PID != tc.want {
				t.Fatalf("foreground = %+v, error = %v", got, err)
			}
		})
	}
}
