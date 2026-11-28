//go:build darwin || linux

package tmux

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// EnsureServerID finds or initializes the Go server ID on an explicitly
// selected socket. Read-only callers use ProbeBinding instead.
func (c Client) EnsureServerID(ctx context.Context, socket string) (string, error) {
	read := func() (string, error) {
		value, err := c.run(ctx, socket, 128, nil, "show-options", "-s", "-q", "-v", ServerIDOption)
		return strings.TrimSuffix(value, "\n"), err
	}
	id, err := read()
	if err != nil {
		return "", err
	}
	if id == "" {
		var raw [16]byte
		rand.Read(raw[:])
		raw[6] = raw[6]&0x0f | 0x40
		raw[8] = raw[8]&0x3f | 0x80
		id = fmt.Sprintf("%x-%x-%x-%x-%x", raw[:4], raw[4:6], raw[6:8], raw[8:10], raw[10:])
		if _, err := c.run(ctx, socket, 128, nil, "set-option", "-s", "-o", ServerIDOption, id); err != nil {
			return "", err
		}
		id, err = read()
		if err != nil {
			return "", err
		}
	}
	if !serverID(id) {
		return "", errors.New("invalid Go tmux server identity")
	}
	return id, nil
}

// PublishBinding updates the exact pane's existing Go metadata or installs a
// new Go marker. A changed endpoint or foreign Go marker returns false.
func (c Client) PublishBinding(ctx context.Context, binding core.Binding, identity core.Identity) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	document, raw, err := c.bindingDocument(ctx, binding, identity)
	if err != nil || document == nil {
		return false, err
	}
	marker := binding.Marker(identity)
	document["globalIdentity"], err = json.Marshal(map[string]any{
		"name": marker.Name, "canonicalName": marker.CanonicalName,
		"identityId": marker.IdentityID, "bindingId": marker.BindingID,
		"serverId": marker.ServerID, "panePid": marker.PanePID,
	})
	if err != nil {
		return false, err
	}
	return c.writeBindingDocument(ctx, binding, raw, document)
}

// ClearBinding removes the exact binding marker from Go pane metadata.
// It preserves other fields and returns false for a changed or absent marker.
func (c Client) ClearBinding(ctx context.Context, binding core.Binding, identity core.Identity) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	document, raw, err := c.bindingDocument(ctx, binding, identity)
	if err != nil || document == nil || bindingMarker(raw) == nil {
		return false, err
	}
	delete(document, "globalIdentity")
	if len(document) == 1 {
		document = nil
	}
	return c.writeBindingDocument(ctx, binding, raw, document)
}

func (c Client) bindingDocument(ctx context.Context, binding core.Binding, identity core.Identity) (map[string]json.RawMessage, string, error) {
	name, err := core.ValidateExistingName(string(identity.Name))
	if err != nil || binding.ID == "" || identity.ID == "" || binding.IdentityID != identity.ID ||
		name.CanonicalName() != identity.CanonicalName || binding.PaneIncarnation == nil {
		return nil, "", errors.New("invalid tmux binding")
	}
	pane := ports.PaneRef{Server: binding.Server.Socket, PaneID: binding.PaneID}
	current, err := c.ProbeBinding(ctx, pane)
	if err != nil {
		return nil, "", err
	}
	if current.State != core.EndpointProbeLive || current.Server != binding.Server || len(current.Panes) != 1 {
		return nil, "", nil
	}
	observed := current.Panes[0]
	if observed.PID != binding.PanePID || observed.Incarnation == nil || *observed.Incarnation != *binding.PaneIncarnation {
		return nil, "", nil
	}

	raw, err := c.run(ctx, pane.Server, bindingOptionLimit, nil,
		"show-options", "-q", "-p", "-t", pane.PaneID, "-v", AgentOption)
	if err != nil {
		return nil, "", err
	}
	raw = strings.TrimSuffix(raw, "\n")
	document := map[string]json.RawMessage{"version": json.RawMessage("1")}
	if raw != "" {
		document = uniqueObject([]byte(raw))
		var version uint64
		if json.Unmarshal(document["version"], &version) != nil || version != 1 {
			return nil, "", errors.New("invalid existing Go pane metadata")
		}
		if value := document["globalIdentity"]; len(value) != 0 && string(value) != "null" {
			previous := bindingMarker(raw)
			if previous == nil || previous.BindingID != binding.ID || previous.IdentityID != identity.ID ||
				previous.ServerID != binding.Server.ID || previous.PanePID != binding.PanePID {
				return nil, "", nil
			}
		}
	}
	return document, raw, nil
}

func (c Client) writeBindingDocument(ctx context.Context, binding core.Binding, raw string, document map[string]json.RawMessage) (bool, error) {
	pane := ports.PaneRef{Server: binding.Server.Socket, PaneID: binding.PaneID}
	option := "-p -t " + pane.PaneID + " " + AgentOption
	command := "set-option -u " + option
	if document != nil {
		encoded, err := json.Marshal(document)
		if err != nil {
			return false, err
		}
		if len(encoded) > bindingOptionLimit {
			return false, errors.New("Go pane metadata exceeds its byte limit")
		}
		command = "set-option " + option + " " + tmuxCommandWord(encoded)
	}

	// Compare the host and raw option inside tmux's own command queue, so
	// a changed option cannot be overwritten between the read and mutation.
	condition := formatEqual("pane_id", pane.PaneID)
	for _, equal := range []string{
		formatEqual("pane_pid", strconv.FormatUint(binding.PanePID, 10)),
		formatEqual("pid", strconv.FormatUint(binding.Server.PID, 10)),
		formatEqual("start_time", binding.Server.StartTime),
		formatEqual(ServerIDOption, binding.Server.ID),
		formatEqual(AgentOption, raw),
	} {
		condition = "#{&&:" + condition + "," + equal + "}"
	}
	const refused = "TMT_GO_BIND_REFUSED"
	out, err := c.run(ctx, pane.Server, 1024, nil, "if-shell", "-F", "-t", pane.PaneID,
		condition, command, "display-message -p "+refused)
	return err == nil && strings.TrimSpace(out) != refused, err
}

var formatLiteral = strings.NewReplacer("#", "##", ",", "#,", "}", "#}")

func formatEqual(key, value string) string {
	return "#{==:#{" + key + "}," + formatLiteral.Replace(value) + "}"
}

// tmux parses octal byte escapes inside double quotes. Encoding each byte
// keeps stored text out of its command syntax.
func tmuxCommandWord(value []byte) string {
	var quoted strings.Builder
	quoted.Grow(len(value)*4 + 2)
	quoted.WriteByte('"')
	for _, b := range value {
		quoted.WriteByte('\\')
		quoted.WriteByte('0' + b>>6)
		quoted.WriteByte('0' + (b>>3)&7)
		quoted.WriteByte('0' + b&7)
	}
	quoted.WriteByte('"')
	return quoted.String()
}
