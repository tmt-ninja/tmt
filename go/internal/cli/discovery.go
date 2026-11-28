package cli

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

type discoverySource struct {
	Host   string  `json:"host"`
	Socket *string `json:"socket"`
	Status string  `json:"status"`
	Reason *string `json:"reason"`
}

type discoveryRow struct {
	Host      string           `json:"host"`
	Socket    *string          `json:"socket"`
	Server    any              `json:"server"`
	Session   string           `json:"session"`
	Window    string           `json:"window"`
	Pane      string           `json:"pane"`
	Target    string           `json:"target"`
	Native    any              `json:"native"`
	Runtime   map[string]any   `json:"runtime"`
	Identity  any              `json:"identity"`
	State     string           `json:"state"`
	Reason    *string          `json:"reason"`
	Duplicate bool             `json:"duplicate"`
	Display   discoveryDisplay `json:"display"`
	Adoptable bool             `json:"adoptable"`
	Expect    *string          `json:"expect"`
}

type discoveryDisplay struct {
	Title     string `json:"title"`
	Command   string `json:"command"`
	CWD       string `json:"cwd"`
	Truncated bool   `json:"truncated"`
}

type discoveryReport struct {
	Version      int               `json:"version"`
	ObservedAtMs uint64            `json:"observedAtMs"`
	Sources      []discoverySource `json:"sources"`
	Candidates   []discoveryRow    `json:"candidates"`
	Truncated    bool              `json:"truncated"`
}

func (r discoveryReport) JSON() any                  { return r }
func (r discoveryReport) ExitStatus() int            { return 0 }
func (r discoveryReport) HumanStream() output.Stream { return output.Stdout }

func (r discoveryReport) Human(w io.Writer) error {
	for _, source := range r.Sources {
		socket, _ := json.Marshal(source.Socket)
		if _, err := fmt.Fprintf(w, "%q on %s: %s\n", source.Host, socket, source.Status); err != nil {
			return err
		}
	}
	for _, row := range r.Candidates {
		if _, err := fmt.Fprintf(w, "  %s %q: %s\n", row.Pane, row.Display.Title, row.State); err != nil {
			return err
		}
	}
	return nil
}

func (app application) runDiscover(ctx context.Context, root home.Root, inv invocation) output.Report {
	ctx, stop := context.WithTimeout(ctx, 2*time.Second)
	defer stop()
	explicit := inv.options["socket"]
	host := inv.options["host"]
	if host == "" {
		host = "tmux"
	}
	report := discoveryReport{Version: 1, ObservedAtMs: uint64(wallClock{}.NowMs()),
		Sources:    []discoverySource{{Host: host, Socket: discoveryOptional(explicit), Status: "unknown"}},
		Candidates: []discoveryRow{}}
	source := &report.Sources[0]
	if host != "tmux" {
		// NOT PORTED (CLI-04): Discovery through admitted external host drivers.
		source.Status, source.Reason = "unsupported", discoveryOptional("driver_not_approved")
		return report
	}
	b := newBindingCLI(nil, app.caller.lookup)
	discoverer, ok := b.host.(markedHost)
	socket := b.socket(explicit)
	claim, _ := b.lookup("TMUX")
	_, expectedPID, _, valid := parseTmuxClaim(claim)
	if !ok || explicit == "" && claim != "" && !valid {
		source.Reason, report.Truncated = discoveryOptional("Could not verify the selected tmux server."), true
		return report
	}
	observation, err := discoverer.Discover(ctx, socket, "")
	if err != nil {
		reason := err.Error()
		if explicit != "" {
			if _, statErr := os.Lstat(socket); errors.Is(statErr, os.ErrNotExist) {
				source.Status, reason = "offline", "Could not execute tmux operation (tmux exit 1)."
			} else if errors.Is(statErr, os.ErrPermission) {
				source.Status = "permission_denied"
			}
		}
		source.Reason, report.Truncated = discoveryOptional(reason), true
		return report
	}
	if explicit == "" && expectedPID != 0 && len(observation.Candidates) != 0 &&
		observation.Candidates[0].Server.PID != expectedPID {
		source.Reason, report.Truncated = discoveryOptional("Could not verify the selected tmux server."), true
		return report
	}
	source.Status, source.Socket = "ok", &socket
	var page storage.DiscoveryPage
	var readErr error
	if len(observation.Candidates) != 0 && ctx.Err() == nil {
		page, readErr = storage.ReadDiscovery(ctx, root, "tmux", socket)
	}
	if readErr != nil {
		source.Status, source.Reason = "unknown", discoveryOptional(readErr.Error())
	}
	report.Truncated = observation.Truncated || page.Truncated || ctx.Err() != nil
	owners := make(map[string][]storage.DiscoveryEntry)
	for _, row := range page.Entries {
		owners[row.Binding.PaneID] = append(owners[row.Binding.PaneID], row)
	}
	bytes := 1024
	for _, pane := range observation.Candidates {
		row := classifyDiscovery(pane, owners[pane.Pane.PaneID])
		if readErr != nil {
			row.Reason, row.Adoptable, row.Expect = discoveryOptional("storage_unknown"), false, nil
		}
		encoded, _ := json.Marshal(row)
		bytes += len(encoded) + 1
		if bytes > 1024*1024 {
			report.Truncated = true
			break
		}
		report.Candidates = append(report.Candidates, row)
	}
	if report.Truncated {
		source.Reason = discoveryOptional("scan_limit")
		for i := range report.Candidates {
			row := &report.Candidates[i]
			row.Reason, row.Adoptable, row.Expect = discoveryOptional("scan_truncated"), false, nil
		}
	}
	return report
}

func classifyDiscovery(pane tmux.PaneSnapshot, owners []storage.DiscoveryEntry) discoveryRow {
	row := discoveryRow{Host: "tmux", Session: pane.Session, Window: pane.WindowIndex, Pane: pane.Pane.PaneID,
		Target: pane.Session + ":" + pane.WindowIndex + "." + pane.PaneIndex,
		State:  "unknown", Reason: discoveryOptional(pane.Reason), Duplicate: pane.Linked}
	row.Display = discoveryDisplay{pane.Title, pane.Command, pane.CWD, pane.TextTruncated}
	row.Runtime = map[string]any{"driver": nil, "state": "unknown", "reason": "executable_hint_is_advisory", "recordedState": nil}
	fenced := pane.ServerProcess.StartIdentity != "" && pane.Process.StartIdentity != ""
	if fenced {
		row.Socket = &pane.Pane.Server
		row.Server = map[string]any{"pid": pane.ServerProcess.PID, "start": pane.ServerProcess.StartIdentity,
			"identity": discoveryOptional(pane.Server.ID)}
		row.Native = map[string]any{"pid": pane.Process.PID, "start": pane.Process.StartIdentity}
		row.Runtime["driver"] = discoveryOptional(discoveryDriver(pane.Command))
	}
	switch {
	case len(owners) > 1:
		row.State, row.Reason, row.Duplicate = "duplicate", discoveryOptional("conflicting_bindings"), true
	case len(owners) == 1 && fenced:
		owner := owners[0]
		probe := core.EndpointProbe{State: core.EndpointProbeLive, Server: pane.Server, Panes: []core.PaneObservation{{
			ID: pane.Pane.PaneID, PID: pane.Process.PID, Incarnation: &pane.Process.StartIdentity, Marker: pane.Marker,
		}}}
		state, _ := core.EvaluateBinding(owner.Identity, &owner.Binding, probe)
		if state == core.BindingActive {
			row.State = "known"
			row.Identity = map[string]any{"id": owner.Identity.ID, "name": owner.Identity.Name, "binding": owner.Binding.ID}
			row.Runtime["recordedState"] = owner.Binding.Session.RuntimeState
		} else {
			row.State, row.Reason = "stale", discoveryOptional("stored_binding_stale")
		}
	case len(owners) == 0 && fenced && pane.Marker != nil:
		row.State, row.Reason = "hook_only", discoveryOptional("unverified_marker")
	}
	if fenced && row.Reason == nil {
		row.Adoptable, row.Expect = true, discoveryOptional(discoveryDigest(pane, discoveryDriver(pane.Command)))
	}
	return row
}

func discoveryOptional(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func discoveryDriver(command string) string {
	words := strings.FieldsFunc(strings.ToLower(command), func(ch rune) bool {
		return !(ch >= 'a' && ch <= 'z' || ch >= '0' && ch <= '9')
	})
	// NOT PORTED (CLI-04): Additional native built-in driver aliases.
	for _, name := range []core.DriverName{core.DriverClaude, core.DriverCodex, core.DriverGemini} {
		for _, word := range words {
			if word == string(name) {
				return word
			}
		}
	}
	return ""
}

func discoveryDigest(pane tmux.PaneSnapshot, driver string) string {
	fields := []string{pane.Server.Host, pane.Pane.Server, strconv.FormatUint(pane.ServerProcess.PID, 10),
		pane.ServerProcess.StartIdentity, pane.Server.StartTime, pane.Pane.PaneID,
		strconv.FormatUint(pane.Process.PID, 10), pane.Process.StartIdentity, driver}
	if marker := pane.Marker; marker != nil {
		fields = append(fields, string(marker.IdentityID), string(marker.BindingID), marker.ServerID, strconv.FormatUint(marker.PanePID, 10))
	}
	var payload []byte
	for _, field := range fields {
		payload = binary.BigEndian.AppendUint64(payload, uint64(len(field)))
		payload = append(payload, field...)
	}
	input := binary.BigEndian.AppendUint64([]byte("tmt-discovery-v1\x00"), uint64(len(payload)))
	sum := sha256.Sum256(append(input, payload...))
	return hex.EncodeToString(sum[:])
}
