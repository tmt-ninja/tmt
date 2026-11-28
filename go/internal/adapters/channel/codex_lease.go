//go:build darwin || linux

package channel

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type codexEnrollment struct {
	root     home.Root
	identity core.Identity
	binding  core.Binding
	probe    core.EndpointProbe
	owner    core.ProcessIncarnation
	plan     CodexPlan
	build    string
}

// NOT PORTED (#6938): supervisor control with EOF cleanup on launcher death.
// codexLease is adapter-internal until the supervisor owns the app-server.
type codexLease struct {
	root     home.Root
	record   codexRecord
	server   *ownedCodexServer
	observer runtime.Observer
	command  ports.ProcessSpec
	cwd      string
	build    string
}

func startCodexLease(ctx context.Context, runner ports.Process, req codexEnrollment) (*codexLease, error) {
	state, pane := core.EvaluateBinding(req.identity, &req.binding, req.probe)
	if state != core.BindingActive || pane == nil || pane.Incarnation == nil || req.binding.PaneIncarnation == nil ||
		*pane.Incarnation != *req.binding.PaneIncarnation {
		return nil, ErrEnrollment
	}
	ctx, cancel := context.WithTimeout(ctx, codexStartupBudget)
	defer cancel()
	if err := PreflightCodex(ctx, runner, req.root, req.plan.selected.Path); err != nil {
		return nil, err
	}
	cwd, err := filepath.EvalSymlinks(req.plan.cwd)
	if err != nil || !validLaunchPath(cwd) {
		return nil, ErrEnrollment
	}
	record := newCodexRecord(req.identity, req.binding, req.owner)
	observer := runtime.Observer{Process: runner}
	if err := beginCodexRecord(ctx, req.root, observer, record); err != nil {
		return nil, err
	}
	l := &codexLease{root: req.root, record: record, observer: observer, cwd: cwd, build: req.build}
	l.server, err = startOwnedCodex(ctx, req.root, record.Generation, req.plan, observer)
	if err == nil {
		err = l.prepare(ctx, req.plan)
	}
	if err == nil {
		return l, nil
	}
	if errors.Is(err, errCodexCleanup) {
		return nil, err
	}
	if l.server != nil {
		if cleanupErr := l.server.stop(); cleanupErr != nil {
			return nil, errors.Join(err, cleanupErr)
		}
	}
	cleanup, cancelCleanup := context.WithTimeout(context.WithoutCancel(ctx), lockWait)
	defer cancelCleanup()
	return nil, errors.Join(err, retireCodexRecord(cleanup, l.root, l.record))
}

func (l *codexLease) prepare(ctx context.Context, plan CodexPlan) error {
	client, err := l.connect(ctx)
	if err != nil {
		return err
	}
	defer client.close()
	if plan.resume != "" {
		response, err := codexCall(ctx, client, "thread/resume", plan.resumeParams())
		if err != nil || !exactResumedCodexThread(response, l.cwd, plan.resume) {
			return ErrEnrollment
		}
	} else {
		thread, err := codexLoadedThread(ctx, client)
		if err != nil || thread != "" {
			return ErrEnrollment
		}
	}
	command, err := plan.remoteForeground(l.server.endpoint.address, l.server.endpoint.token)
	if err != nil {
		return err
	}
	err = withCodexRecord(ctx, l.root, l.record, func(dir *channelDir, record *codexRecord) error {
		if record.Fresh != nil || record.Ready != nil || record.Foreground.Process != nil ||
			processState(ctx, l.observer, record.LaunchOwner) != runtime.Alive ||
			processState(ctx, l.observer, l.server.process) != runtime.Alive {
			return ErrEnrollmentChanged
		}
		if plan.resume != "" {
			record.Ready = &codexReady{Server: l.server.process, Port: l.server.endpoint.address.Port(), Thread: plan.resume}
		} else {
			record.Fresh = &codexFresh{Server: l.server.process, Port: l.server.endpoint.address.Port(), CWD: l.cwd}
		}
		return dir.writeCodex(*record)
	})
	if err == nil {
		l.command = command
	}
	return err
}

func (l *codexLease) connect(ctx context.Context) (*codexClient, error) {
	if processState(ctx, l.observer, l.server.process) != runtime.Alive {
		return nil, ErrEnrollment
	}
	deadline, _ := ctx.Deadline()
	return connectCodex(ctx, l.server.endpoint, deadline, l.build)
}

// foregroundStarted persists the original child before discovering the one
// fresh thread it created. Discovery never creates, resumes or sends input.
func (l *codexLease) foregroundStarted(ctx context.Context, foreground core.ProcessIncarnation) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	child := storedProcess(foreground)
	if processState(ctx, l.observer, child) != runtime.Alive {
		return "", ErrEnrollment
	}
	thread := ""
	err := withCodexRecord(ctx, l.root, l.record, func(dir *channelDir, record *codexRecord) error {
		if !l.ownsEndpoint(*record) || record.Foreground.Process != nil ||
			processState(ctx, l.observer, record.LaunchOwner) != runtime.Alive {
			return ErrEnrollmentChanged
		}
		record.Foreground = codexForeground{State: "known", Process: &child}
		if record.Ready != nil {
			thread = record.Ready.Thread
		}
		return dir.writeCodex(*record)
	})
	if err != nil || thread != "" {
		return thread, err
	}
	thread, err = l.discoverThread(ctx)
	if err != nil {
		return "", err
	}
	err = withCodexRecord(ctx, l.root, l.record, func(dir *channelDir, record *codexRecord) error {
		if !l.ownsEndpoint(*record) || record.Fresh == nil || record.Fresh.Thread != nil ||
			record.Foreground.Process == nil || *record.Foreground.Process != child ||
			processState(ctx, l.observer, record.LaunchOwner) != runtime.Alive ||
			processState(ctx, l.observer, child) != runtime.Alive ||
			processState(ctx, l.observer, l.server.process) != runtime.Alive {
			return ErrEnrollmentChanged
		}
		record.Fresh.Thread = &thread
		return dir.writeCodex(*record)
	})
	if err != nil {
		return "", err
	}
	return thread, nil
}

func (l *codexLease) discoverThread(ctx context.Context) (string, error) {
	client, err := l.connect(ctx)
	if err != nil {
		return "", err
	}
	defer client.close()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for ctx.Err() == nil {
		thread, err := codexLoadedThread(ctx, client)
		if err != nil {
			return "", err
		}
		if thread != "" {
			response, err := codexCall(ctx, client, "thread/read", map[string]any{"threadId": thread, "includeTurns": false})
			if err != nil || !verifiedFreshCodexThread(response, l.cwd, thread) {
				return "", ErrEnrollment
			}
			return thread, nil
		}
		select {
		case <-ctx.Done():
		case <-tick.C:
		}
	}
	return "", ctx.Err()
}

// foregroundAdmitted publishes fresh readiness only after the caller's
// committed Running binding still agrees with the recorded lease and child.
func (l *codexLease) foregroundAdmitted(ctx context.Context, identity core.Identity, binding core.Binding, probe core.EndpointProbe) error {
	state, pane := core.EvaluateBinding(identity, &binding, probe)
	session := binding.Session
	if state != core.BindingActive || pane == nil || pane.Incarnation == nil || binding.PaneIncarnation == nil ||
		*pane.Incarnation != *binding.PaneIncarnation || session.RuntimeState != "running" ||
		session.Runtime == nil || session.LaunchOwner == nil || session.PlainProgram != nil ||
		string(binding.ID) != l.record.BindingID || storedProcess(*session.LaunchOwner) != l.record.LaunchOwner {
		return ErrEnrollment
	}
	if *codexAttributionFor(identity, binding) != *l.record.Attribution {
		return ErrEnrollment
	}
	child := storedProcess(*session.Runtime)
	return withCodexRecord(ctx, l.root, l.record, func(dir *channelDir, record *codexRecord) error {
		if record.Attribution == nil || *record.Attribution != *l.record.Attribution ||
			!l.ownsEndpoint(*record) || record.Foreground.Process == nil || *record.Foreground.Process != child ||
			processState(ctx, l.observer, record.LaunchOwner) != runtime.Alive ||
			processState(ctx, l.observer, child) != runtime.Alive ||
			processState(ctx, l.observer, l.server.process) != runtime.Alive {
			return ErrEnrollmentChanged
		}
		if record.Ready != nil {
			if session.ProviderSessionID != nil && *session.ProviderSessionID != record.Ready.Thread {
				return ErrEnrollmentChanged
			}
			return nil
		}
		if record.Fresh == nil || record.Fresh.Thread == nil ||
			session.ProviderSessionID != nil && *session.ProviderSessionID != *record.Fresh.Thread {
			return ErrEnrollmentChanged
		}
		record.Ready = &codexReady{Server: record.Fresh.Server, Port: record.Fresh.Port, Thread: *record.Fresh.Thread}
		return dir.writeCodex(*record)
	})
}

func (l *codexLease) ownsEndpoint(record codexRecord) bool {
	if fresh := record.Fresh; fresh != nil {
		return fresh.CWD == l.cwd && fresh.Server == l.server.process && fresh.Port == l.server.endpoint.address.Port()
	}
	return record.Ready != nil && record.Ready.Server == l.server.process && record.Ready.Port == l.server.endpoint.address.Port()
}

// withdraw follows a confirmed foreground wait or a proven no-spawn. It
// leaves the record if process or generation cleanup cannot be confirmed.
func (l *codexLease) withdraw(ctx context.Context) error {
	if err := l.server.stop(); err != nil {
		return err
	}
	return retireCodexRecord(ctx, l.root, l.record)
}

func codexCall(ctx context.Context, client *codexClient, method string, params any) (map[string]json.RawMessage, error) {
	id := launchGeneration()
	reply, err := client.call(ctx, id, map[string]any{"id": id, "method": method, "params": params})
	if err != nil || reply["error"] != nil {
		return nil, ErrEnrollment
	}
	return strictObject(reply["result"])
}

func codexLoadedThread(ctx context.Context, client *codexClient) (string, error) {
	response, err := codexCall(ctx, client, "thread/loaded/list", struct{}{})
	var data []string
	if err != nil || json.Unmarshal(response["data"], &data) != nil || data == nil || len(data) > 1 {
		return "", ErrEnrollment
	}
	if len(data) == 0 {
		return "", nil
	}
	if !core.ValidUUID(data[0]) {
		return "", ErrEnrollment
	}
	return data[0], nil
}

func exactResumedCodexThread(response map[string]json.RawMessage, cwd, thread string) bool {
	meta, err := strictObject(response["thread"])
	if err != nil || codexString(meta["id"]) != thread {
		return false
	}
	returned, err := filepath.EvalSymlinks(codexString(response["cwd"]))
	return err == nil && returned == cwd
}

func verifiedFreshCodexThread(response map[string]json.RawMessage, cwd, thread string) bool {
	meta, err := strictObject(response["thread"])
	return err == nil && codexString(meta["id"]) == thread && codexString(meta["cwd"]) == cwd &&
		string(meta["ephemeral"]) == "false"
}
