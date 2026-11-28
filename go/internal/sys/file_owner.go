//go:build darwin || linux

package sys

import (
	"io/fs"
	"os"
	"syscall"
)

// FileOwnedByEffectiveUser compares the POSIX owner recorded in info with the
// effective user. The caller owns Lstat and any mode or symlink checks.
func FileOwnedByEffectiveUser(info fs.FileInfo) bool {
	if info == nil {
		return false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat != nil && stat.Uid == uint32(os.Geteuid())
}
