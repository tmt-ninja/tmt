//go:build darwin || linux

package channel

import (
	"context"
	"errors"
	"io/fs"
	"net/netip"
	"path/filepath"
	"reflect"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type CodexDelivery struct {
	Root     home.Root
	Binding  core.Binding
	Identity core.Identity
	Probe    core.EndpointProbe
	Content  string
	Build    string
}

// SendCodex consumes one queue attempt for an already-claimed delivery.
// Unsupported permits only the independent pane-level paste guard.
func SendCodex(ctx context.Context, runner ports.Process, in CodexDelivery) SendResult {
	if in.Binding.ID == "" {
		return SendResult{Outcome: SendUnsupported}
	}
	state, pane := core.EvaluateBinding(in.Identity, &in.Binding, in.Probe)
	if state != core.BindingActive || pane == nil || pane.Incarnation == nil ||
		in.Binding.PaneIncarnation == nil || *pane.Incarnation != *in.Binding.PaneIncarnation ||
		!core.ValidUUID(string(in.Binding.ID)) {
		return denied(ChannelUnverifiable)
	}
	preparation, cancel := context.WithTimeout(ctx, codexStageBudget)
	defer cancel()
	dir, err := openCodexDir(in.Root, false)
	if errors.Is(err, errNoChannelDirectory) || errors.Is(err, fs.ErrNotExist) {
		return SendResult{Outcome: SendUnsupported}
	}
	if err != nil {
		return denied(ChannelInvalidRecord)
	}
	defer dir.close()
	id := string(in.Binding.ID)
	record, err := dir.readCodex(id)
	if err != nil {
		return denied(ChannelInvalidRecord)
	}
	if record == nil {
		return SendResult{Outcome: SendUnsupported}
	}
	if record.Attribution == nil || *record.Attribution != *codexAttributionFor(in.Identity, in.Binding) {
		return denied(ChannelMismatch)
	}
	observer := runtime.Observer{Process: runner}
	applicable, fault := codexApplicable(preparation, observer, *record, in.Binding.Session)
	if fault != "" {
		return denied(fault)
	}
	if !applicable {
		return SendResult{Outcome: SendUnsupported}
	}
	request, err := newCodexQueueRequest(record.Ready.Thread, in.Content)
	if err != nil {
		return denied(ChannelTooLarge)
	}
	base := filepath.Join(ClaudeDirectory(in.Root), codexDirectory)
	endpoint, err := readCodexEndpoint(dir, base, record.Generation, record.Ready.Port)
	if err != nil {
		return denied(ChannelInvalidRecord)
	}
	deadline, _ := preparation.Deadline()
	client, err := connectCodex(preparation, endpoint, deadline, in.Build)
	if errors.Is(err, errCodexUnreachable) {
		return denied(ChannelUnreachable)
	}
	if err != nil {
		return denied(ChannelNotReady)
	}
	defer client.close()

	if applicable, fault := codexApplicable(preparation, observer, *record, in.Binding.Session); fault != "" {
		return denied(fault)
	} else if !applicable {
		return denied(ChannelMismatch)
	}
	if currentEndpoint, err := readCodexEndpoint(dir, base, record.Generation, record.Ready.Port); err != nil ||
		currentEndpoint != endpoint {
		return denied(ChannelMismatch)
	}
	current, err := dir.readCodex(id)
	if err != nil || !reflect.DeepEqual(current, record) {
		return denied(ChannelMismatch)
	}
	if preparation.Err() != nil {
		return denied(ChannelNotReady)
	}
	switch client.queue(ctx, request, time.Now().Add(codexStageBudget)).outcome {
	case codexQueueAccepted:
		return SendResult{Outcome: SendQueued}
	case codexQueueRefused:
		return denied(ChannelRefused)
	default:
		return SendResult{Outcome: SendUncertain}
	}
}

func codexApplicable(ctx context.Context, observer runtime.Observer, record codexRecord, session core.BindingSessionState) (bool, SendFault) {
	if session.LaunchOwner == nil || storedProcess(*session.LaunchOwner) != record.LaunchOwner {
		if record.Foreground.Process != nil && session.LaunchOwner != nil &&
			processState(ctx, observer, storedProcess(*session.LaunchOwner)) == runtime.Alive {
			ended := true
			for _, process := range record.processes() {
				if processState(ctx, observer, process) != runtime.Gone {
					ended = false
					break
				}
			}
			if ended {
				return false, ""
			}
		}
		return false, ChannelMismatch
	}
	switch processState(ctx, observer, record.LaunchOwner) {
	case runtime.Gone:
		return false, ChannelStale
	case runtime.Alive:
	default:
		return false, ChannelUnverifiable
	}
	if session.RuntimeState != "running" || session.PlainProgram != nil || session.Runtime == nil || record.Ready == nil {
		return false, ChannelNotReady
	}
	if record.Foreground.Process == nil {
		return false, ChannelUnverifiable
	}
	if session.ProviderSessionID == nil || *session.ProviderSessionID != record.Ready.Thread ||
		storedProcess(*session.Runtime) != *record.Foreground.Process || *record.Foreground.Process == record.Ready.Server {
		return false, ChannelMismatch
	}
	if processState(ctx, observer, *record.Foreground.Process) != runtime.Alive ||
		processState(ctx, observer, record.Ready.Server) != runtime.Alive {
		return false, ChannelUnverifiable
	}
	return true, ""
}

func readCodexEndpoint(dir *channelDir, base, generation string, port uint16) (codexEndpoint, error) {
	if err := checkPrivatePath(dir, base); err != nil {
		return codexEndpoint{}, err
	}
	child, err := openPrivateChannelChild(dir.root, generation, false)
	if err != nil {
		return codexEndpoint{}, err
	}
	defer child.close()
	token, err := child.readPrivate(codexCapabilityFile, 64)
	if err != nil || !validCodexToken(string(token)) {
		return codexEndpoint{}, ErrEnrollment
	}
	if err := checkPrivatePath(child, filepath.Join(base, generation)); err != nil {
		return codexEndpoint{}, err
	}
	address := netip.AddrPortFrom(netip.AddrFrom4([4]byte{127, 0, 0, 1}), port)
	return newCodexEndpoint(address, string(token))
}
