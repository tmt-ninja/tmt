//go:build darwin || linux

package channel

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"path/filepath"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// ClaudeEnrollment describes an opt-in launch after the caller verified its
// current binding. Probe is the independently read pane evidence.
type ClaudeEnrollment struct {
	Root          home.Root
	Identity      core.Identity
	Binding       core.Binding
	Probe         core.EndpointProbe
	LaunchOwner   core.ProcessIncarnation
	Command       ports.ProcessSpec
	TMTExecutable string
}

// ClaudeLease holds only one launch's authority. Losing the lease leaves the
// enrollment in place.
type ClaudeLease struct {
	root     home.Root
	key      claudeRecord
	observer runtime.Observer
	command  ports.ProcessSpec
}

// EnrollClaude persists the pending enrollment before returning the foreground
// command. The caller checks the selected provider with PreflightClaude first.
// Enrollment performs no spawn and publishes no readiness.
func EnrollClaude(ctx context.Context, runner ports.Process, in ClaudeEnrollment) (*ClaudeLease, error) {
	evidence, pane := core.EvaluateBinding(in.Identity, &in.Binding, in.Probe)
	if evidence != core.BindingActive || pane == nil || pane.Incarnation == nil || in.Binding.PaneIncarnation == nil ||
		*pane.Incarnation != *in.Binding.PaneIncarnation {
		return nil, fmt.Errorf("%w: binding or pane is unverified", ErrEnrollment)
	}
	paneAddress := recordedPane(in.Binding)
	record := claudeRecord{
		Version: 1, BindingID: string(in.Binding.ID), IdentityID: string(in.Identity.ID), Generation: launchGeneration(),
		LaunchOwner: storedProcess(in.LaunchOwner),
		Pane:        &paneAddress,
	}
	if record.IdentityID == "" || !record.valid(record.BindingID) || !record.LaunchOwner.incarnation().Valid() {
		return nil, ErrEnrollment
	}
	command, err := claudeCommand(in.Root, in.Command, in.TMTExecutable, record.BindingID, record.Generation)
	if err != nil {
		return nil, errors.Join(ErrEnrollment, err)
	}
	dir, err := openChannelDir(in.Root, true)
	if err != nil {
		return nil, errors.Join(ErrEnrollment, err)
	}
	defer dir.close()
	lock, err := dir.lock(ctx)
	if err != nil {
		return nil, errors.Join(ErrEnrollment, err)
	}
	defer lock.Close()

	observer := runtime.Observer{Process: runner}
	if processState(ctx, observer, record.LaunchOwner) != runtime.Alive {
		return nil, fmt.Errorf("%w: launch owner is unverified", ErrEnrollment)
	}
	old, err := dir.readClaude(record.BindingID)
	if err != nil {
		return nil, errors.Join(ErrEnrollment, err)
	}
	if old != nil && old.LaunchOwner != record.LaunchOwner && !old.endedFor(ctx, observer, *record.Pane) {
		return nil, ErrOccupied
	}
	if err := ctx.Err(); err != nil {
		return nil, errors.Join(ErrEnrollment, err)
	}
	// NOT PORTED (#6938): bounded pruning of other bindings pending pane evidence and recovery.
	if err := dir.writeClaude(record); err != nil {
		return nil, errors.Join(ErrEnrollment, err)
	}
	return &ClaudeLease{root: in.Root, key: record, observer: observer, command: command}, nil
}

func (l *ClaudeLease) Command() ports.ProcessSpec {
	return l.command
}

// ForegroundStarted records the caller-observed child before launch admission.
func (l *ClaudeLease) ForegroundStarted(ctx context.Context, child core.ProcessIncarnation) error {
	observed := storedProcess(child)
	if !observed.incarnation().Valid() {
		return ErrEnrollment
	}
	return l.withRecord(ctx, func(dir *channelDir, record *claudeRecord) error {
		if record.Foreground != nil && *record.Foreground != observed {
			return ErrOccupied
		}
		record.Foreground = &observed
		return dir.writeClaude(*record)
	})
}

// Withdraw removes the pending lease after the caller proves no child
// spawned or that the same child was reaped.
func (l *ClaudeLease) Withdraw(ctx context.Context) error {
	return l.withRecord(ctx, func(dir *channelDir, record *claudeRecord) error {
		if record.Claude != nil && processState(ctx, l.observer, *record.Claude) != runtime.Gone {
			return ErrOccupied
		}
		if err := checkSocket(dir, record.BindingID); err == nil {
			if err := dir.root.Remove(record.BindingID + ".sock"); err != nil {
				return err
			}
		} else if !errors.Is(err, fs.ErrNotExist) {
			return err
		}
		return dir.root.Remove(record.BindingID + ".json")
	})
}

func (l *ClaudeLease) withRecord(ctx context.Context, change func(*channelDir, *claudeRecord) error) error {
	dir, err := openChannelDir(l.root, false)
	if err != nil {
		return errors.Join(ErrEnrollment, err)
	}
	defer dir.close()
	lock, err := dir.lock(ctx)
	if err != nil {
		return errors.Join(ErrEnrollment, err)
	}
	defer lock.Close()
	record, err := dir.readClaude(l.key.BindingID)
	if err != nil {
		return errors.Join(ErrEnrollment, err)
	}
	if record == nil || record.Generation != l.key.Generation || record.LaunchOwner != l.key.LaunchOwner {
		return ErrOccupied
	}
	if err := ctx.Err(); err != nil {
		return errors.Join(ErrEnrollment, err)
	}
	return change(dir, record)
}

func (r claudeRecord) valid(bindingID string) bool {
	return r.Version == 1 && r.BindingID == bindingID && core.ValidUUID(r.BindingID) && core.ValidUUID(r.Generation) &&
		(r.IdentityID == "" || core.ValidUUID(r.IdentityID)) && r.LaunchOwner.present() &&
		(r.Foreground == nil || r.Foreground.present()) && (r.Claude == nil || r.Claude.present()) &&
		(r.Pane == nil || r.Pane.complete())
}

func (p paneRecord) complete() bool {
	return p.Host != "" && p.ServerID != "" && filepath.IsAbs(p.SocketPath) && p.ServerPID > 0 &&
		p.ServerStartTime != "" && p.PaneID != "" && p.PanePID > 0
}

func (r claudeRecord) endedFor(ctx context.Context, observer runtime.Observer, pane paneRecord) bool {
	if processState(ctx, observer, r.LaunchOwner) != runtime.Gone {
		return false
	}
	if r.Foreground == nil && r.Claude == nil {
		return r.Pane != nil && *r.Pane == pane
	}
	for _, process := range []*processRecord{r.Foreground, r.Claude} {
		if process != nil && processState(ctx, observer, *process) != runtime.Gone {
			return false
		}
	}
	return true
}

func storedProcess(p core.ProcessIncarnation) processRecord {
	return processRecord{PID: p.PID, Start: p.StartIdentity}
}

func (p processRecord) present() bool {
	return p.PID > 0 && p.PID <= math.MaxInt32 && p.Start != ""
}

func (p processRecord) incarnation() runtime.Incarnation {
	if !p.present() {
		return runtime.Incarnation{}
	}
	return runtime.Incarnation{PID: int(p.PID), Start: p.Start}
}

func processState(ctx context.Context, observer runtime.Observer, process processRecord) runtime.State {
	state := observeRecorded(ctx, observer, process)
	if state == runtime.Suspended {
		return runtime.Unknown
	}
	return state
}

func launchGeneration() string {
	var raw [16]byte
	rand.Read(raw[:])
	raw[6] = raw[6]&15 | 64
	raw[8] = raw[8]&63 | 128
	return fmt.Sprintf("%x-%x-%x-%x-%x", raw[:4], raw[4:6], raw[6:8], raw[8:10], raw[10:])
}

func recordedPane(binding core.Binding) paneRecord {
	server := binding.Server
	return paneRecord{
		Host: server.Host, ServerID: server.ID, SocketPath: server.Socket, ServerPID: server.PID,
		ServerStartTime: server.StartTime, PaneID: binding.PaneID, PanePID: binding.PanePID,
	}
}
