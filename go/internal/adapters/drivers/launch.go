// Package drivers contains shared launch preparation and diagnostic screen parsing.
package drivers

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/invoke"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// Command prepares a plain foreground command without starting the provider.
func Command(provider, executable string, launch ports.AgentLaunch, args []string) (ports.ProcessSpec, error) {
	if executable == "" {
		var err error
		executable, err = exec.LookPath(provider)
		if err != nil {
			return ports.ProcessSpec{}, fmt.Errorf("find %s: %w", provider, err)
		}
	}
	if !filepath.IsAbs(executable) || !invoke.IsExecutable(executable) {
		return ports.ProcessSpec{}, fmt.Errorf("%s executable must be an absolute executable file", provider)
	}
	if !absolutePath(launch.HomeDir) || (launch.Dir != "" && !absolutePath(launch.Dir)) {
		return ports.ProcessSpec{}, errors.New("driver launch requires an absolute tmt-go root and working directory")
	}
	for _, arg := range args {
		if strings.ContainsRune(arg, 0) {
			return ports.ProcessSpec{}, errors.New("driver launch argument contains NUL")
		}
	}

	return ports.ProcessSpec{
		Path: executable, Args: args, Dir: launch.Dir,
		Env: invoke.OverlayEnv(os.Environ(), []string{home.EnvHome + "=" + launch.HomeDir, "TMT_AGENT=1"}),
	}, nil
}

func absolutePath(value string) bool {
	return filepath.IsAbs(value) && strings.IndexFunc(value, unicode.IsControl) == -1
}

// ExactSession reports whether a provider session has the UUID shape used by
// Claude and Codex. It deliberately excludes provider aliases such as latest.
func ExactSession(id string) bool {
	if len(id) != 36 {
		return false
	}
	for i, ch := range id {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if ch != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", ch) {
			return false
		}
	}
	return true
}

func Enter() []ports.KeyStep { return []ports.KeyStep{{Key: "Enter"}} }
