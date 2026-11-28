//go:build darwin || linux

package channel

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const evidenceBudget = 3 * time.Second

// PaneAddress is the fresh host evidence for a paste target, independent of
// whether storage still binds any identity to that pane.
type PaneAddress struct {
	Server  core.ServerEvidence
	PaneID  string
	PanePID uint64
}

func (p PaneAddress) record() paneRecord {
	return paneRecord{
		Host: p.Server.Host, ServerID: p.Server.ID, SocketPath: p.Server.Socket, ServerPID: p.Server.PID,
		ServerStartTime: p.Server.StartTime, PaneID: p.PaneID, PanePID: p.PanePID,
	}
}

// PaneEvidence describes the Claude enrollment check at the paste boundary.
// Paste requires a nil error and Enrolled false.
type PaneEvidence struct {
	Enrolled bool
	Record   string
	Skipped  []string
}

type EvidenceError struct {
	Fault  SendFault
	Path   string
	Detail string
}

func (e *EvidenceError) Error() string {
	text := fmt.Sprintf("Channel evidence %s at %q.", e.Fault, e.Path)
	if e.Detail != "" {
		text += " " + e.Detail
	}
	return text
}

// ClaudePaneEvidence scans Claude's own record names. A live or unconfirmed
// launch still protects its pane after a binding is removed or replaced.
func ClaudePaneEvidence(ctx context.Context, runner ports.Process, root home.Root, pane PaneAddress, bindingID core.BindingID) (PaneEvidence, error) {
	var found PaneEvidence
	ctx, cancel := context.WithTimeout(ctx, evidenceBudget)
	defer cancel()
	unknown := func() (PaneEvidence, error) {
		return found, &EvidenceError{Fault: ChannelUnverifiable, Path: ClaudeDirectory(root)}
	}
	if ctx.Err() != nil {
		return unknown()
	}
	dir, err := openChannelDir(root, false)
	if errors.Is(err, errNoChannelDirectory) {
		return found, nil
	}
	address := pane.record()
	if err != nil {
		return unknown()
	}
	defer dir.close()
	if !address.complete() {
		return unknown()
	}
	observer := runtime.Observer{Process: runner}
	for ctx.Err() == nil {
		names, readErr := dir.file.Readdirnames(32)
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			return unknown()
		}
		for _, name := range names {
			if ctx.Err() != nil {
				return unknown()
			}
			stem, ok := strings.CutSuffix(name, ".json")
			if !ok || !core.ValidUUID(stem) {
				continue
			}
			path := recordPath(root, stem)
			record, err := dir.readClaude(stem)
			if err != nil {
				if stem == string(bindingID) {
					return found, invalidRecord(root, stem)
				}
				found.Skipped = append(found.Skipped, path)
				continue
			}
			if record == nil {
				continue
			}
			if record.Pane == nil {
				found.Skipped = append(found.Skipped, path)
				continue
			}
			if *record.Pane != address {
				continue
			}
			for _, entry := range record.processes() {
				switch observeRecorded(ctx, observer, entry.process) {
				case runtime.Alive, runtime.Suspended:
					found.Enrolled = true
					found.Record = path
					return found, nil
				case runtime.Gone:
				default:
					return found, &EvidenceError{Fault: ChannelUnverifiable, Path: path, Detail: fmt.Sprintf(
						"Process %d could not be verified. Retry or run %s.", entry.process.PID, inspectCommand(stem))}
				}
			}
			if !record.foregroundRecorded() {
				return found, &EvidenceError{Fault: ChannelUnverifiable, Path: path, Detail: fmt.Sprintf(
					"Launch owner %d ended before recording its foreground in pane %s. After confirming its provider process is gone, run %s.",
					record.LaunchOwner.PID, address.PaneID, recoverCommand(stem, record.Generation))}
			}
		}
		if errors.Is(readErr, io.EOF) {
			if ctx.Err() != nil || checkChannelPath(dir, root) != nil {
				return unknown()
			}
			return found, nil
		}
	}
	return unknown()
}

func recordPath(root home.Root, binding string) string {
	return filepath.Join(ClaudeDirectory(root), binding+".json")
}

func inspectCommand(binding string) string { return "tmt-go channel inspect --binding " + binding }

func recoverCommand(binding, generation string) string {
	return "tmt-go channel recover --binding " + binding + " --generation " + generation
}

func invalidRecord(root home.Root, binding string) *EvidenceError {
	return &EvidenceError{Fault: ChannelInvalidRecord, Path: recordPath(root, binding), Detail: "Confirm the provider session is gone before manually removing its unreadable enrollment."}
}

type recordedProcess struct {
	role    string
	process processRecord
}

func (r claudeRecord) processes() []recordedProcess {
	processes := []recordedProcess{{"launchOwner", r.LaunchOwner}}
	if r.Foreground != nil {
		processes = append(processes, recordedProcess{"foreground", *r.Foreground})
	}
	if r.Claude != nil {
		processes = append(processes, recordedProcess{"provider", *r.Claude})
	}
	return processes
}

func (r claudeRecord) foregroundRecorded() bool {
	return r.Foreground != nil || r.Claude != nil
}

// observeRecorded also treats an exact stopped incarnation as present. The
// send path requires a running process and still uses processState.
func observeRecorded(ctx context.Context, observer runtime.Observer, process processRecord) runtime.State {
	expected := process.incarnation()
	if !expected.Valid() || ctx.Err() != nil {
		return runtime.Unknown
	}
	seen, err := observer.Observe(ctx, expected.PID)
	if err != nil || ctx.Err() != nil {
		return runtime.Unknown
	}
	if seen.State == runtime.Suspended && seen.Incarnation == expected {
		return runtime.Suspended
	}
	return seen.Match(expected)
}
