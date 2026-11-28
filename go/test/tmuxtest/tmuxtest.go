// Package tmuxtest starts a private tmux server for one test. It is the only
// way Go tests reach tmux (AGENTS.md host tmux safety): TMUX and TMUX_PANE are
// removed, the socket lives in t.TempDir(), it is asserted not to be the host
// default before any server command, and only this server is ever killed.
// Owner: tmt-go-lead.
package tmuxtest

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Server is one private tmux server.
type Server struct {
	Socket string
	t      *testing.T
}

// HostDefaultSocket is the socket a bare tmux would reach for this user.
func HostDefaultSocket() string {
	dir := os.Getenv("TMUX_TMPDIR")
	if dir == "" {
		dir = "/tmp"
	}
	return filepath.Join(dir, "tmux-"+strconv.Itoa(os.Getuid()), "default")
}

func sameFile(a, b string) bool {
	ra, errA := filepath.EvalSymlinks(filepath.Dir(a))
	rb, errB := filepath.EvalSymlinks(filepath.Dir(b))
	if errA != nil || errB != nil {
		return filepath.Clean(a) == filepath.Clean(b)
	}
	return filepath.Join(ra, filepath.Base(a)) == filepath.Join(rb, filepath.Base(b))
}

// Start creates a detached session "t" on a private socket; Cleanup kills it.
func Start(t *testing.T) *Server {
	t.Helper()
	if _, err := exec.LookPath("tmux"); err != nil {
		t.Skip("tmux not installed")
	}
	dir, err := os.MkdirTemp("", "tmtgo-tmux-") // short path: socket paths are length-limited
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	s := &Server{Socket: filepath.Join(dir, "s"), t: t}
	if sameFile(s.Socket, HostDefaultSocket()) || sameFile(s.Socket, "/private/tmp/tmux-"+strconv.Itoa(os.Getuid())+"/default") {
		t.Fatalf("refusing host default socket %s", s.Socket)
	}
	s.Run("-f", "/dev/null", "new-session", "-d", "-s", "t", "-x", "120", "-y", "40")
	t.Cleanup(func() { _, _ = s.cmd("kill-server").CombinedOutput() })
	return s
}

// Env is the environment for any child that must reach this server only.
func Env() []string {
	var env []string
	for _, kv := range os.Environ() {
		if strings.HasPrefix(kv, "TMUX=") || strings.HasPrefix(kv, "TMUX_PANE=") {
			continue
		}
		env = append(env, kv)
	}
	return env
}

func (s *Server) cmd(args ...string) *exec.Cmd {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	s.t.Cleanup(cancel)
	c := exec.CommandContext(ctx, "tmux", append([]string{"-S", s.Socket}, args...)...)
	c.Env = Env()
	return c
}

// Run runs one tmux command on this server and fails the test on error.
func (s *Server) Run(args ...string) string {
	s.t.Helper()
	out, err := s.cmd(args...).CombinedOutput()
	if err != nil {
		s.t.Fatalf("tmux %v: %v: %s", args, err, out)
	}
	return string(out)
}
