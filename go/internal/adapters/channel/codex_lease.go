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

// CodexEnrollment carries the proved launch binding and preflight result.
// TMTExecutable names the selected binary for the private supervisor child.
type CodexEnrollment struct {
	Root          home.Root
	Identity      core.Identity
	Binding       core.Binding
	Probe         core.EndpointProbe
	LaunchOwner   core.ProcessIncarnation
	Plan          QualifiedCodexPlan
	TMTExecutable string
	ClientVersion string
}

// codexLease tracks the original endpoint and immutable foreground candidate.
type codexLease struct {
	root            home.Root
	record          codexRecord
	server          *ownedCodexServer
	endpoint        codexEndpoint
	endpointProcess processRecord
	observer        runtime.Observer
	command         ports.ProcessSpec
	cwd             string
	build           string
}

func beginCodexLaunch(ctx context.Context, runner ports.Process, req CodexEnrollment) (codexRecord, runtime.Observer, error) {
	observer := runtime.Observer{Process: runner}
	state, pane := core.EvaluateBinding(req.Identity, &req.Binding, req.Probe)
	if state != core.BindingActive || pane == nil || pane.Incarnation == nil || req.Binding.PaneIncarnation == nil ||
		*pane.Incarnation != *req.Binding.PaneIncarnation {
		return codexRecord{}, observer, ErrEnrollment
	}
	if req.Plan.root != req.Root.Dir || !validLaunchPath(req.Plan.plan.selected.Path) {
		return codexRecord{}, observer, ErrEnrollment
	}
	record := newCodexRecord(req.Identity, req.Binding, req.LaunchOwner)
	return record, observer, beginCodexRecord(ctx, req.Root, observer, record)
}

func startCodexFromRecord(ctx context.Context, root home.Root, record codexRecord, plan CodexPlan, build string, observer runtime.Observer) (*codexLease, error) {
	l := &codexLease{root: root, record: record, observer: observer, build: build}
	var err error
	l.cwd, err = filepath.EvalSymlinks(plan.cwd)
	if err == nil && !validLaunchPath(l.cwd) {
		err = ErrEnrollment
	}
	if err == nil {
		l.server, err = startOwnedCodex(ctx, root, record.Generation, plan, observer)
	}
	if err == nil {
		l.endpoint, l.endpointProcess = l.server.endpoint, l.server.process
		err = l.prepare(ctx, plan)
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
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), lockWait)
	defer cancel()
	return nil, errors.Join(err, retireCodexRecord(cleanup, root, record))
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
	command, err := plan.remoteForeground(l.endpoint.address, l.endpoint.token)
	if err != nil {
		return err
	}
	err = withCodexRecord(ctx, l.root, l.record, func(dir *channelDir, record *codexRecord) error {
		if record.Fresh != nil || record.Ready != nil || record.Foreground.Process != nil ||
			processState(ctx, l.observer, record.LaunchOwner) != runtime.Alive ||
			processState(ctx, l.observer, l.endpointProcess) != runtime.Alive {
			return ErrEnrollmentChanged
		}
		if plan.resume != "" {
			record.Ready = &codexReady{Server: l.endpointProcess, Port: l.endpoint.address.Port(), Thread: plan.resume}
		} else {
			record.Fresh = &codexFresh{Server: l.endpointProcess, Port: l.endpoint.address.Port(), CWD: l.cwd}
		}
		return dir.writeCodex(*record)
	})
	if err == nil {
		l.command = command
	}
	return err
}

func (l *codexLease) connect(ctx context.Context) (*codexClient, error) {
	if processState(ctx, l.observer, l.endpointProcess) != runtime.Alive {
		return nil, ErrEnrollment
	}
	deadline, _ := ctx.Deadline()
	return connectCodex(ctx, l.endpoint, deadline, l.build)
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
			processState(ctx, l.observer, l.endpointProcess) != runtime.Alive {
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
		session.Runtime == nil || session.LaunchOwner == nil || session.ProviderSessionID == nil || session.PlainProgram != nil ||
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
			processState(ctx, l.observer, l.endpointProcess) != runtime.Alive {
			return ErrEnrollmentChanged
		}
		if record.Ready != nil {
			if record.Fresh != nil || *session.ProviderSessionID != record.Ready.Thread {
				return ErrEnrollmentChanged
			}
			return nil
		}
		if record.Fresh == nil || record.Fresh.Thread == nil ||
			*session.ProviderSessionID != *record.Fresh.Thread {
			return ErrEnrollmentChanged
		}
		record.Ready = &codexReady{Server: record.Fresh.Server, Port: record.Fresh.Port, Thread: *record.Fresh.Thread}
		return dir.writeCodex(*record)
	})
}

func (l *codexLease) ownsEndpoint(record codexRecord) bool {
	if fresh := record.Fresh; fresh != nil {
		return fresh.CWD == l.cwd && fresh.Server == l.endpointProcess && fresh.Port == l.endpoint.address.Port()
	}
	return record.Ready != nil && record.Ready.Server == l.endpointProcess && record.Ready.Port == l.endpoint.address.Port()
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
