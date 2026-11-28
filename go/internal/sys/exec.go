//go:build darwin || linux

package sys

import "syscall"

// Exec replaces the current process with path, using argv (including argv[0])
// and env as supplied. It returns only if replacement fails.
func Exec(path string, argv, env []string) error {
	return syscall.Exec(path, argv, env)
}
