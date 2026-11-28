package tmux

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const operationTimeout = time.Second

// Client runs bounded tmux commands through the process port.
type Client struct {
	Process ports.Process
	Path    string // absolute path to the tmux client
}

func (c Client) run(ctx context.Context, socket string, limit int, input []byte, args ...string) (string, error) {
	if !validSocket(socket) {
		return "", errors.New("tmux socket must be an explicit absolute path")
	}
	if c.Process == nil || !filepath.IsAbs(c.Path) {
		return "", errors.New("tmux client requires a process runner and an absolute executable path")
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	var env []string
	for _, entry := range os.Environ() {
		if !strings.HasPrefix(entry, "TMUX=") && !strings.HasPrefix(entry, "TMUX_PANE=") {
			env = append(env, entry)
		}
	}
	result, err := c.Process.Run(ctx, ports.ProcessSpec{
		Path: c.Path, Args: append([]string{"-u", "-S", socket}, args...), Env: env,
		Stdin: input, Timeout: operationTimeout, MaxOut: limit,
	})
	if err != nil {
		return "", fmt.Errorf("tmux %s: %w", args[0], err)
	}
	if result.ExitCode != 0 {
		return "", fmt.Errorf("tmux %s exited with status %d: %s", args[0], result.ExitCode, strings.TrimSpace(string(result.Stderr)))
	}
	if result.Truncated {
		return "", fmt.Errorf("tmux %s exceeded its output limit", args[0])
	}
	return string(result.Stdout), nil
}

func validPane(id string) bool {
	return strings.HasPrefix(id, "%") && decimal(id[1:])
}

func decimal(value string) bool {
	return value != "" && strings.IndexFunc(value, func(r rune) bool { return r < '0' || r > '9' }) == -1
}

func validSocket(socket string) bool {
	return filepath.IsAbs(socket) && !strings.ContainsRune(socket, 0)
}
