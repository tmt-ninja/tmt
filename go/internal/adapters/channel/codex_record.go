//go:build darwin || linux

package channel

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"math"
	"path/filepath"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

const codexRecordLimit = 8 * 1024

type codexAttribution struct {
	IdentityID string        `json:"identityId"`
	Host       string        `json:"host"`
	ServerID   string        `json:"serverId"`
	SocketPath string        `json:"socketPath"`
	Server     processRecord `json:"server"`
	PaneID     string        `json:"paneId"`
	PanePID    uint64        `json:"panePid"`
}

type codexForeground struct {
	State   string         `json:"state"`
	Process *processRecord `json:"process,omitempty"`
}

type codexFresh struct {
	Server processRecord `json:"server"`
	Port   uint16        `json:"port"`
	CWD    string        `json:"cwd"`
	Thread *string       `json:"thread"`
}

type codexReady struct {
	Server processRecord `json:"server"`
	Port   uint16        `json:"port"`
	Thread string        `json:"thread"`
}

type codexRecord struct {
	Foreground  codexForeground   `json:"foreground"`
	Attribution *codexAttribution `json:"attribution"`
	Version     uint8             `json:"version"`
	BindingID   string            `json:"bindingId"`
	Generation  string            `json:"generation"`
	LaunchOwner processRecord     `json:"launchOwner"`
	Ready       *codexReady       `json:"ready"`
	Fresh       *codexFresh       `json:"fresh,omitempty"`
}

func newCodexRecord(identity core.Identity, binding core.Binding, owner core.ProcessIncarnation) codexRecord {
	return codexRecord{
		Version: 1, BindingID: string(binding.ID), Generation: launchGeneration(), LaunchOwner: storedProcess(owner),
		Foreground:  codexForeground{State: "unknown"},
		Attribution: codexAttributionFor(identity, binding),
	}
}

func codexAttributionFor(identity core.Identity, binding core.Binding) *codexAttribution {
	return &codexAttribution{
		IdentityID: string(identity.ID), Host: binding.Server.Host, ServerID: binding.Server.ID,
		SocketPath: binding.Server.Socket, Server: processRecord{PID: binding.Server.PID, Start: binding.Server.StartTime},
		PaneID: binding.PaneID, PanePID: binding.PanePID,
	}
}

func (r codexRecord) valid(binding string) bool {
	if r.Version != 1 || r.BindingID != binding || !core.ValidUUID(binding) || !core.ValidUUID(r.Generation) ||
		!r.LaunchOwner.incarnation().Valid() {
		return false
	}
	switch r.Foreground.State {
	case "", "unknown":
		if r.Foreground.Process != nil {
			return false
		}
	case "known":
		if r.Foreground.Process == nil || !r.Foreground.Process.incarnation().Valid() {
			return false
		}
	default:
		return false
	}
	if a := r.Attribution; a != nil {
		if !core.ValidUUID(a.IdentityID) || a.Host != "tmux" || !core.ValidUUID(a.ServerID) ||
			!a.Server.present() || !validLaunchPath(a.SocketPath) || a.PaneID == "" ||
			a.PanePID == 0 || a.PanePID > math.MaxInt32 {
			return false
		}
	}
	if ready := r.Ready; ready != nil && (ready.Port == 0 || !ready.Server.incarnation().Valid() || !core.ValidUUID(ready.Thread)) {
		return false
	}
	if fresh := r.Fresh; fresh != nil {
		if fresh.Port == 0 || !fresh.Server.incarnation().Valid() || !validLaunchPath(fresh.CWD) ||
			fresh.Thread != nil && !core.ValidUUID(*fresh.Thread) {
			return false
		}
		if ready := r.Ready; ready != nil && (ready.Server != fresh.Server || ready.Port != fresh.Port ||
			fresh.Thread == nil || ready.Thread != *fresh.Thread) {
			return false
		}
	}
	return true
}

func (r codexRecord) sameLease(other codexRecord) bool {
	return r.BindingID == other.BindingID && r.Generation == other.Generation && r.LaunchOwner == other.LaunchOwner
}

func (r codexRecord) endedFor(ctx context.Context, observer runtime.Observer, incoming codexRecord) bool {
	if processState(ctx, observer, r.LaunchOwner) != runtime.Gone {
		return false
	}
	if r.Foreground.Process == nil {
		if r.Attribution == nil || incoming.Attribution == nil || *r.Attribution != *incoming.Attribution {
			return false
		}
	} else if processState(ctx, observer, *r.Foreground.Process) != runtime.Gone {
		return false
	}
	if r.Fresh != nil && processState(ctx, observer, r.Fresh.Server) != runtime.Gone {
		return false
	}
	return r.Ready == nil || r.Fresh != nil || processState(ctx, observer, r.Ready.Server) == runtime.Gone
}

func (dir *channelDir) readCodex(binding string) (*codexRecord, error) {
	if !core.ValidUUID(binding) {
		return nil, ErrEnrollment
	}
	data, err := dir.readPrivate(binding+".json", codexRecordLimit)
	if err != nil || data == nil {
		return nil, err
	}
	var record codexRecord
	if !validCodexRecordJSON(data) || json.Unmarshal(data, &record) != nil || !record.valid(binding) {
		return nil, ErrEnrollment
	}
	return &record, nil
}

func validCodexRecordJSON(data []byte) bool {
	object, err := strictObject(data, "foreground", "attribution", "version", "bindingId", "generation", "launchOwner", "ready", "fresh")
	if err != nil {
		return false
	}
	for _, nested := range []struct {
		key        string
		fields     []string
		processKey string
	}{
		{"launchOwner", []string{"pid", "start"}, ""},
		{"foreground", []string{"state", "process"}, "process"},
		{"attribution", []string{"identityId", "host", "serverId", "socketPath", "server", "paneId", "panePid"}, "server"},
		{"ready", []string{"server", "port", "thread"}, "server"},
		{"fresh", []string{"server", "port", "cwd", "thread"}, "server"},
	} {
		raw := object[nested.key]
		if nested.key == "foreground" && bytes.Equal(raw, []byte("null")) {
			return false
		}
		if raw == nil || bytes.Equal(raw, []byte("null")) {
			continue
		}
		fields, err := strictObject(raw, nested.fields...)
		if err != nil || nested.key == "foreground" && codexString(fields["state"]) == "" {
			return false
		}
		if process := fields[nested.processKey]; process != nil && !bytes.Equal(process, []byte("null")) {
			if _, err := strictObject(process, "pid", "start"); err != nil {
				return false
			}
		}
	}
	return true
}

func (dir *channelDir) writeCodex(record codexRecord) error {
	if !record.valid(record.BindingID) {
		return ErrEnrollment
	}
	return dir.writePrivate(record.BindingID+".json", record, codexRecordLimit)
}

func beginCodexRecord(ctx context.Context, root home.Root, observer runtime.Observer, record codexRecord) error {
	if !record.valid(record.BindingID) || record.Attribution == nil {
		return ErrEnrollment
	}
	dir, err := openCodexDir(root, true)
	if err != nil {
		return err
	}
	defer dir.close()
	lock, err := dir.lockNamed(ctx, record.BindingID+".lock")
	if err != nil {
		return err
	}
	defer lock.Close()
	previous, err := dir.readCodex(record.BindingID)
	if err != nil {
		return err
	}
	if processState(ctx, observer, record.LaunchOwner) != runtime.Alive {
		return ErrEnrollment
	}
	if previous != nil && !previous.endedFor(ctx, observer, record) {
		return ErrOccupied
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	return dir.writeCodex(record)
}

func withCodexRecord(ctx context.Context, root home.Root, lease codexRecord, change func(*channelDir, *codexRecord) error) error {
	dir, err := openCodexDir(root, false)
	if err != nil {
		return err
	}
	defer dir.close()
	lock, err := dir.lockNamed(ctx, lease.BindingID+".lock")
	if err != nil {
		return err
	}
	defer lock.Close()
	current, err := dir.readCodex(lease.BindingID)
	if err != nil {
		return err
	}
	if current == nil || !current.sameLease(lease) ||
		current.Attribution == nil || lease.Attribution == nil || *current.Attribution != *lease.Attribution {
		return ErrEnrollmentChanged
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := checkPrivatePath(dir, filepath.Join(ClaudeDirectory(root), codexDirectory)); err != nil {
		return err
	}
	return change(dir, current)
}

func retireCodexRecord(ctx context.Context, root home.Root, lease codexRecord) error {
	return withCodexRecord(ctx, root, lease, func(dir *channelDir, record *codexRecord) error {
		if err := dir.root.Remove(record.BindingID + ".json"); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		return dir.file.Sync()
	})
}
