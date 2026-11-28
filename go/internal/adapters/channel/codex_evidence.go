//go:build darwin || linux

package channel

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"path/filepath"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// CheckPaneEvidence applies both provider fences before any paste.
func CheckPaneEvidence(ctx context.Context, runner ports.Process, root home.Root, pane PaneAddress, binding core.BindingID) (PaneEvidence, error) {
	ctx, cancel := context.WithTimeout(ctx, evidenceBudget)
	defer cancel()
	claude, err := ClaudePaneEvidence(ctx, runner, root, pane, binding)
	if err != nil || claude.Enrolled {
		return claude, err
	}
	codex, err := codexPaneEvidence(ctx, runner, root, pane.record(), string(binding))
	codex.Skipped = append(claude.Skipped, codex.Skipped...)
	return codex, err
}

func codexPaneEvidence(ctx context.Context, runner ports.Process, root home.Root, pane paneRecord, binding string) (PaneEvidence, error) {
	path := filepath.Join(ClaudeDirectory(root), codexDirectory)
	var result PaneEvidence
	unknown := &EvidenceError{Fault: ChannelUnverifiable, Path: path}
	if ctx.Err() != nil {
		return result, unknown
	}
	dir, err := openCodexDir(root, false)
	if errors.Is(err, errNoChannelDirectory) || errors.Is(err, fs.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return result, unknown
	}
	defer dir.close()
	if !pane.complete() {
		return result, unknown
	}
	observer := runtime.Observer{Process: runner}
	for ctx.Err() == nil {
		names, readErr := dir.file.Readdirnames(32)
		if readErr != nil && !errors.Is(readErr, io.EOF) {
			return result, unknown
		}
		for _, name := range names {
			if ctx.Err() != nil {
				return result, unknown
			}
			id, ok := strings.CutSuffix(name, ".json")
			if !ok || !core.ValidUUID(id) {
				continue
			}
			recordPath := filepath.Join(path, name)
			record, err := dir.readCodex(id)
			if err != nil || record == nil {
				if id == binding {
					return result, &EvidenceError{Fault: ChannelInvalidRecord, Path: recordPath}
				}
				result.Skipped = append(result.Skipped, recordPath)
				continue
			}
			if record.Attribution == nil {
				if id == binding {
					return result, codexUnverified(recordPath, *record)
				}
				result.Skipped = append(result.Skipped, recordPath)
				continue
			}
			if record.Attribution.pane() != pane {
				continue
			}
			ended := record.Foreground.Process != nil
			for _, process := range record.processes() {
				switch observeRecorded(ctx, observer, process) {
				case runtime.Alive, runtime.Suspended:
					result.Enrolled, result.Record = true, recordPath
					return result, nil
				case runtime.Gone:
				default:
					ended = false
				}
			}
			if !ended {
				return result, codexUnverified(recordPath, *record)
			}
		}
		if errors.Is(readErr, io.EOF) {
			if ctx.Err() != nil || checkPrivatePath(dir, path) != nil {
				return result, unknown
			}
			return result, nil
		}
	}
	return result, unknown
}

func codexUnverified(path string, record codexRecord) *EvidenceError {
	return &EvidenceError{Fault: ChannelUnverifiable, Path: path, Detail: fmt.Sprintf(
		"Verify that the original foreground and owned app-server have ended before recovering binding %s generation %s.",
		record.BindingID, record.Generation)}
}

func (a codexAttribution) pane() paneRecord {
	return paneRecord{
		Host: a.Host, ServerID: a.ServerID, SocketPath: a.SocketPath, ServerPID: a.Server.PID,
		ServerStartTime: a.Server.Start, PaneID: a.PaneID, PanePID: a.PanePID,
	}
}

func (r codexRecord) processes() []processRecord {
	processes := []processRecord{r.LaunchOwner}
	if r.Foreground.Process != nil {
		processes = append(processes, *r.Foreground.Process)
	}
	if r.Ready != nil {
		processes = append(processes, r.Ready.Server)
	} else if r.Fresh != nil {
		processes = append(processes, r.Fresh.Server)
	}
	return processes
}
