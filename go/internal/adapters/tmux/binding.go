//go:build darwin || linux

package tmux

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const (
	// OptionNamespace is the selected build’s namespace for tmux user options.
	OptionNamespace = flavor.OptionNamespace
	ServerIDOption  = OptionNamespace + "server-id"
	AgentOption     = OptionNamespace + "agent"
)

const bindingOptionLimit = 32 * 1024

var bindingFormat = fields("socket_path", ServerIDOption, "pid", "start_time", "pane_id", "pane_pid", AgentOption)

// ProbeBinding observes only the exact pane on the explicit socket. It never
// initializes missing host metadata or treats an unavailable probe as loss.
func (c Client) ProbeBinding(ctx context.Context, pane ports.PaneRef) (core.EndpointProbe, error) {
	if !validPane(pane.PaneID) {
		return core.EndpointProbe{}, errors.New("invalid tmux pane ID")
	}
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	read := func() (string, error) {
		return c.run(ctx, pane.Server, bindingOptionLimit, nil, "display-message", "-p", "-t", pane.PaneID, bindingFormat)
	}
	text, err := read()
	if err != nil {
		return core.EndpointProbe{}, err
	}
	probe, ok := parseBindingProbe(text, pane)
	if !ok {
		return core.EndpointProbe{}, nil
	}

	observed, err := (runtime.Observer{Process: c.Process}).Observe(ctx, int(probe.Panes[0].PID))
	if err != nil {
		return core.EndpointProbe{}, err
	}
	if observed.State != runtime.Alive && observed.State != runtime.Suspended {
		return core.EndpointProbe{}, nil
	}
	// The process observation must still correspond to the same host snapshot.
	fresh, err := read()
	if err != nil {
		return core.EndpointProbe{}, err
	}
	if fresh != text || ctx.Err() != nil {
		return core.EndpointProbe{}, ctx.Err()
	}
	start := observed.Incarnation.Start
	probe.Panes[0].Incarnation = &start
	return probe, nil
}

func parseBindingProbe(text string, pane ports.PaneRef) (core.EndpointProbe, bool) {
	row, ok := decodeRow(strings.TrimSuffix(text, "\n"), 7)
	if !ok || !utf8.ValidString(text) || row[0] != pane.Server || row[4] != pane.PaneID ||
		!serverID(row[1]) || !decimal(row[2]) || !decimal(row[3]) || !decimal(row[5]) {
		return core.EndpointProbe{}, false
	}
	serverPID, serverErr := strconv.ParseUint(row[2], 10, 31)
	panePID, paneErr := strconv.ParseUint(row[5], 10, 31)
	start, startErr := strconv.ParseUint(row[3], 10, 64)
	if serverErr != nil || paneErr != nil || startErr != nil || serverPID == 0 || panePID == 0 || start == 0 {
		return core.EndpointProbe{}, false
	}
	return core.EndpointProbe{
		State:  core.EndpointProbeLive,
		Server: core.ServerEvidence{Host: "tmux", ID: row[1], Socket: row[0], PID: serverPID, StartTime: row[3]},
		Panes:  []core.PaneObservation{{ID: row[4], PID: panePID, Marker: bindingMarker(row[6])}},
	}, true
}

func serverID(id string) bool {
	if len(id) != 36 || id[8] != '-' || id[13] != '-' || id[18] != '-' || id[23] != '-' {
		return false
	}
	raw, err := hex.DecodeString(strings.ReplaceAll(id, "-", ""))
	return err == nil && len(raw) == 16 && raw[6]>>4 == 4 && raw[8]>>6 == 2
}

func bindingMarker(text string) *core.BindingMarker {
	doc := uniqueObject([]byte(text))
	var version uint64
	if json.Unmarshal(doc["version"], &version) != nil || version != 1 {
		return nil
	}
	marker := uniqueObject(doc["globalIdentity"])
	var name, canonical, identity, binding, server string
	var pid uint64
	if json.Unmarshal(marker["name"], &name) != nil || name == "" ||
		json.Unmarshal(marker["canonicalName"], &canonical) != nil || canonical == "" ||
		json.Unmarshal(marker["identityId"], &identity) != nil || identity == "" ||
		json.Unmarshal(marker["bindingId"], &binding) != nil || binding == "" ||
		json.Unmarshal(marker["serverId"], &server) != nil || server == "" ||
		json.Unmarshal(marker["panePid"], &pid) != nil || pid == 0 || pid > 9007199254740991 {
		return nil
	}
	return &core.BindingMarker{
		Name: core.Name(name), CanonicalName: canonical, IdentityID: core.IdentityID(identity),
		BindingID: core.BindingID(binding), ServerID: server, PanePID: pid,
	}
}

func uniqueObject(data []byte) map[string]json.RawMessage {
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	open, err := decoder.Token()
	if err != nil || open != json.Delim('{') {
		return nil
	}
	object := make(map[string]json.RawMessage)
	for decoder.More() {
		key, err := decoder.Token()
		name, ok := key.(string)
		if _, exists := object[name]; err != nil || !ok || exists {
			return nil
		}
		var value json.RawMessage
		if decoder.Decode(&value) != nil {
			return nil
		}
		object[name] = value
	}
	close, err := decoder.Token()
	if err != nil || close != json.Delim('}') {
		return nil
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil
	}
	return object
}
