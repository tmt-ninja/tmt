//go:build darwin || linux

package tmux

import (
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

const testServerID = "3fa85f64-5717-4562-b3fc-2c963f66afa6"

func TestProbeBindingReadsExactPrivatePane(t *testing.T) {
	server := tmuxtest.Start(t)
	path, err := exec.LookPath("tmux")
	if err != nil {
		t.Fatal(err)
	}
	client := Client{Path: path, Process: process.Runner{}}
	pane := ports.PaneRef{Server: server.Socket, PaneID: strings.TrimSpace(server.Run("display-message", "-p", "#{pane_id}"))}
	got, err := client.ProbeBinding(t.Context(), pane)
	if err != nil || got.State != core.EndpointProbeUnknown {
		t.Fatalf("probe of unmarked server = %+v, %v", got, err)
	}
	server.Run("set-option", "-s", "@tmt.server-id", testServerID)
	got, err = client.ProbeBinding(t.Context(), pane)
	if err != nil || got.State != core.EndpointProbeLive || got.Server.Socket != pane.Server ||
		got.Server.ID != testServerID || got.Server.PID == 0 || got.Server.StartTime == "" ||
		len(got.Panes) != 1 || got.Panes[0].ID != pane.PaneID || got.Panes[0].Incarnation == nil || got.Panes[0].Marker != nil {
		t.Fatalf("unmarked pane probe = %+v, %v", got, err)
	}

	observed := got.Panes[0]
	marker := fmt.Sprintf(`{"version":1,"globalIdentity":{"name":"member","canonicalName":"member","identityId":"identity","bindingId":"binding","serverId":%q,"panePid":%d}}`, testServerID, observed.PID)
	server.Run("set-option", "-p", "-t", pane.PaneID, "@tmt.agent", marker)
	t.Setenv("TMUX", "/invalid/ambient/socket,1,0")
	t.Setenv("TMUX_PANE", "%9999")
	got, err = client.ProbeBinding(t.Context(), pane)
	if err != nil || len(got.Panes) != 1 {
		t.Fatalf("marked pane probe = %+v, %v", got, err)
	}
	identity := core.Identity{ID: "identity", Name: "member", CanonicalName: "member"}
	binding := core.Binding{ID: "binding", IdentityID: identity.ID, Server: got.Server,
		PaneID: pane.PaneID, PanePID: observed.PID, PaneIncarnation: observed.Incarnation}
	if state, _ := core.EvaluateBinding(identity, &binding, got); state != core.BindingActive {
		t.Fatalf("EvaluateBinding = %v, probe = %+v", state, got)
	}
	wrong, _ := client.ProbeBinding(t.Context(), ports.PaneRef{Server: pane.Server, PaneID: "%9999"})
	if wrong.State != core.EndpointProbeUnknown {
		t.Fatalf("missing exact pane proved a binding: %+v", wrong)
	}
}

func TestProbeBindingRejectsChangedSnapshot(t *testing.T) {
	pane := ports.PaneRef{Server: "/private-test/socket", PaneID: "%1"}
	calls := 0
	c := Client{Path: "/fixture/tmux", Process: runFunc(func(_ context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
		calls++
		switch calls {
		case 1, 3:
			if len(spec.Args) < 7 || spec.Args[1] != "-S" || spec.Args[2] != pane.Server ||
				spec.Args[3] != "display-message" || spec.Args[6] != pane.PaneID {
				t.Fatalf("unexpected probe args: %q", spec.Args)
			}
			row := strings.Join([]string{pane.Server, testServerID, "101", "1700000000", pane.PaneID, strconv.Itoa(101 + calls), ""}, "\t")
			return ports.Bounded{Stdout: []byte(row + "\n")}, nil
		case 2:
			if spec.Path != "/bin/ps" || len(spec.Args) < 2 || spec.Args[1] != "102" {
				t.Fatalf("unexpected process probe: %q %q", spec.Path, spec.Args)
			}
			return ports.Bounded{Stdout: []byte("Sat Jan  1 00:00:00 2000 S\n")}, nil
		default:
			t.Fatalf("unexpected fourth command: %q", spec.Args)
			return ports.Bounded{}, nil
		}
	})}
	got, err := c.ProbeBinding(t.Context(), pane)
	if calls != 3 || err != nil || got.State != core.EndpointProbeUnknown {
		t.Fatalf("changed host snapshot: calls = %d, probe = %+v, err = %v", calls, got, err)
	}
}

func TestBindingMarkerRejectsAmbiguousJSON(t *testing.T) {
	marker := `{"name":"member","canonicalName":"member","identityId":"i","bindingId":"b","serverId":"s","panePid":10}`
	if got := bindingMarker(`{"version":1,"globalIdentity":` + marker + `}`); got == nil || got.PanePID != 10 {
		t.Fatalf("valid marker = %+v", got)
	}
	for _, input := range []string{
		`{"version":1,"version":1,"globalIdentity":` + marker + `}`,
		`{"version":1,"globalIdentity":` + strings.Replace(marker, `"panePid":10`, `"panePid":7,"panePid":10`, 1) + `}`,
		`{"version":1,"globalIdentity":` + marker + `}{}`,
		`{"version":1,"GlobalIdentity":` + marker + `}`,
	} {
		if got := bindingMarker(input); got != nil {
			t.Errorf("admitted ambiguous marker: %+v", got)
		}
	}
}
