//go:build darwin || linux

package channel

import (
	"context"
	"errors"
	"io/fs"
	"net"
	"os"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const (
	claudeReadinessWait = 3 * time.Second
	claudeReadinessPoll = 50 * time.Millisecond
)

type SendFault string

const (
	ChannelUnverifiable  SendFault = "unverifiable"
	ChannelInvalidRecord SendFault = "invalid_record"
	ChannelMismatch      SendFault = "mismatch"
	ChannelStale         SendFault = "stale"
	ChannelNotReady      SendFault = "not_ready"
	ChannelUnreachable   SendFault = "unreachable"
	ChannelRefused       SendFault = "refused"
	ChannelTooLarge      SendFault = "too_large"
)

type SendResult struct {
	Outcome SendOutcome
	Fault   SendFault
}

type ClaudeDelivery struct {
	Root     home.Root
	Binding  core.Binding
	Identity core.Identity
	Probe    core.EndpointProbe
	Content  string
}

// SendClaude routes one already-claimed delivery through the exact binding's
// channel. Unsupported permits only the separate pane-level paste guard; all
// other outcomes forbid paste or a second channel attempt.
func SendClaude(ctx context.Context, runner ports.Process, in ClaudeDelivery) SendResult {
	if in.Binding.ID == "" {
		return SendResult{Outcome: SendUnsupported}
	}
	evidence, pane := core.EvaluateBinding(in.Identity, &in.Binding, in.Probe)
	if !validClaudeDirectory(in.Root) || evidence != core.BindingActive || pane == nil ||
		pane.Incarnation == nil || in.Binding.PaneIncarnation == nil || *pane.Incarnation != *in.Binding.PaneIncarnation ||
		!core.ValidUUID(string(in.Binding.ID)) {
		return denied(ChannelUnverifiable)
	}
	dir, err := openChannelDir(in.Root, false)
	if errors.Is(err, errNoChannelDirectory) {
		return SendResult{Outcome: SendUnsupported}
	}
	if err != nil {
		return denied(ChannelInvalidRecord)
	}
	defer dir.close()
	bindingID := string(in.Binding.ID)
	record, err := dir.readClaude(bindingID)
	if err != nil {
		return denied(ChannelInvalidRecord)
	}
	if record == nil {
		return SendResult{Outcome: SendUnsupported}
	}
	if record.IdentityID != string(in.Identity.ID) || record.Pane == nil || *record.Pane != recordedPane(in.Binding) {
		return denied(ChannelMismatch)
	}
	session := in.Binding.Session
	if session.LaunchOwner == nil {
		return denied(ChannelMismatch)
	}
	observer := runtime.Observer{Process: runner}
	currentOwner := storedProcess(*session.LaunchOwner)
	ownerState := processState(ctx, observer, currentOwner)
	if currentOwner != record.LaunchOwner {
		if ownerState == runtime.Alive {
			return SendResult{Outcome: SendUnsupported}
		}
		return denied(ChannelMismatch)
	}
	switch ownerState {
	case runtime.Gone:
		if record.Claude != nil && record.Claude.incarnation().Valid() && session.Runtime != nil {
			current := storedProcess(*session.Runtime)
			if current != *record.Claude && processState(ctx, observer, current) == runtime.Alive {
				return SendResult{Outcome: SendUnsupported}
			}
		}
		return denied(ChannelStale)
	case runtime.Alive:
	default:
		return denied(ChannelUnverifiable)
	}
	if len(in.Content) > claudeContentLimit || !utf8.ValidString(in.Content) {
		return denied(ChannelTooLarge)
	}
	record, fault := awaitClaudeReady(ctx, dir, *record, claudeReadinessWait)
	if fault != "" {
		return denied(fault)
	}
	if session.RuntimeState != "running" || session.PlainProgram != nil || session.Runtime == nil ||
		*record.Claude != storedProcess(*session.Runtime) || processState(ctx, observer, *record.Claude) != runtime.Alive {
		return denied(ChannelMismatch)
	}
	if err := checkChannelPath(dir, in.Root); err != nil {
		return denied(ChannelUnverifiable)
	}
	if err := checkSocket(dir, bindingID); errors.Is(err, fs.ErrNotExist) {
		return denied(ChannelUnreachable)
	} else if err != nil {
		return denied(ChannelRefused)
	}
	connectCtx, cancel := context.WithTimeout(ctx, claudeConnectionBudget)
	conn, err := (&net.Dialer{}).DialContext(connectCtx, "unix", socketPath(in.Root, bindingID))
	cancel()
	if errors.Is(err, fs.ErrNotExist) || sys.SocketConnectionRefused(err) {
		return denied(ChannelUnreachable)
	}
	if err != nil {
		return denied(ChannelRefused)
	}
	defer conn.Close()
	outcome := exchangeClaude(ctx, conn, record.Generation, in.Content)
	if outcome == SendDenied {
		return denied(ChannelRefused)
	}
	return SendResult{Outcome: outcome}
}

func denied(fault SendFault) SendResult {
	return SendResult{Outcome: SendDenied, Fault: fault}
}

func awaitClaudeReady(ctx context.Context, dir *channelDir, record claudeRecord, wait time.Duration) (*claudeRecord, SendFault) {
	if record.Claude != nil {
		return &record, ""
	}
	deadline, cancel := context.WithTimeout(ctx, wait)
	defer cancel()
	tick := time.NewTicker(claudeReadinessPoll)
	defer tick.Stop()
	for {
		select {
		case <-deadline.Done():
			return nil, ChannelNotReady
		case <-tick.C:
			if deadline.Err() != nil {
				return nil, ChannelNotReady
			}
			current, err := dir.readClaude(record.BindingID)
			if err != nil {
				return nil, ChannelInvalidRecord
			}
			if current == nil || !sameClaudeEnrollment(record, *current) {
				return nil, ChannelMismatch
			}
			if current.Claude != nil {
				return current, ""
			}
		}
	}
}

func sameClaudeEnrollment(a, b claudeRecord) bool {
	aPane, bPane := a.Pane, b.Pane
	if (aPane == nil) != (bPane == nil) || aPane != nil && *aPane != *bPane {
		return false
	}
	a.Pane, a.Foreground, a.Claude = nil, nil, nil
	b.Pane, b.Foreground, b.Claude = nil, nil, nil
	return a == b
}

func checkSocket(dir *channelDir, bindingID string) error {
	info, err := dir.root.Lstat(bindingID + ".sock")
	if err != nil {
		return err
	}
	if info.Mode()&fs.ModeSocket == 0 || info.Mode().Perm() != 0600 || !sys.FileOwnedByEffectiveUser(info) {
		return errors.New("channel socket is not private")
	}
	return nil
}

func checkChannelPath(dir *channelDir, root home.Root) error {
	observed, err := os.Lstat(ClaudeDirectory(root))
	if err != nil {
		return err
	}
	opened, err := dir.file.Stat()
	if err != nil {
		return err
	}
	if !observed.IsDir() || observed.Mode().Perm() != 0700 || !sys.FileOwnedByEffectiveUser(observed) ||
		!os.SameFile(observed, opened) {
		return errors.New("channel directory changed")
	}
	return nil
}
