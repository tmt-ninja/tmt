//go:build darwin || linux

package channel

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

const (
	pruneRecordLimit = 64
	pruneEntryLimit  = 4 * pruneRecordLimit
)

// pruneEnded works under the same lock as enrollment and socket publication.
// A failed read or incomplete snapshot grants no authority to remove a record.
func (dir *channelDir) pruneEnded(ctx context.Context, observer runtime.Observer, root home.Root, keep string) {
	candidates := make([]claudeRecord, 0)
	for scanned := 0; scanned < pruneEntryLimit && len(candidates) < pruneRecordLimit && ctx.Err() == nil; {
		names, err := dir.file.Readdirnames(min(32, pruneEntryLimit-scanned))
		if err != nil && !errors.Is(err, io.EOF) {
			return
		}
		scanned += len(names)
		for _, name := range names {
			binding, ok := strings.CutSuffix(name, ".json")
			if !ok || binding == keep || !core.ValidUUID(binding) || ctx.Err() != nil {
				continue
			}
			record, err := dir.readClaude(binding)
			if err == nil && record != nil && record.foregroundRecorded() {
				candidates = append(candidates, *record)
				if len(candidates) == pruneRecordLimit {
					break
				}
			}
		}
		if errors.Is(err, io.EOF) {
			break
		}
	}
	if len(candidates) == 0 || ctx.Err() != nil || checkChannelPath(dir, root) != nil {
		return
	}
	pids, err := observer.ProcessIDs(ctx)
	if err != nil {
		return
	}
	for _, record := range candidates {
		if ctx.Err() != nil {
			return
		}
		if !absentFromSnapshot(record, pids) {
			continue
		}
		remove, _, err := recoveryPaths(root, dir, record.BindingID)
		if err != nil {
			continue
		}
		if len(remove) > 1 {
			if err := dir.root.Remove(record.BindingID + ".sock"); err != nil && !errors.Is(err, fs.ErrNotExist) {
				continue
			}
		}
		_ = dir.root.Remove(record.BindingID + ".json")
	}
}

func absentFromSnapshot(record claudeRecord, pids map[uint64]struct{}) bool {
	for _, entry := range record.processes() {
		if _, found := pids[entry.process.PID]; found {
			return false
		}
	}
	return true
}
