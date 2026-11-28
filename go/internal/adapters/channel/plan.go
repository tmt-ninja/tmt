//go:build darwin || linux

package channel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const (
	channelDirectory     = "channels"
	claudeServerName     = "tmt"
	claudeProductSuffix  = " (Claude Code)"
	claudeChannelFlag    = "--dangerously-load-development-channels"
	maxUnixSocketPath    = 100
	providerVersionLimit = 4096
)

var (
	ErrProviderUnavailable = errors.New("channel provider version could not be read")
	ErrProviderVersion     = errors.New("channel provider version is unsupported")
	ErrProviderUnqualified = errors.New("channel provider build is unqualified")
	ErrEnrollment          = errors.New("channel enrollment failed")
	ErrOccupied            = errors.New("channel enrollment is occupied")
)

type BuildStatus uint8

const (
	BuildUnsupported BuildStatus = iota
	BuildTested
	BuildUntested
)

// ClaudeBuild admits Claude Code 2.x from 2.1.285 on. New builds still
// depend on the actual channel handshake.
func ClaudeBuild(line string) BuildStatus {
	version, ok := strings.CutSuffix(strings.TrimSpace(line), claudeProductSuffix)
	if !ok {
		return BuildUnsupported
	}
	parts, ok := versionParts(version, 32, true)
	if !ok || parts[0] != 2 || parts[1] < 1 || parts[1] == 1 && parts[2] < 285 {
		return BuildUnsupported
	}
	if version == "2.1.285" {
		return BuildTested
	}
	return BuildUntested
}

// CodexBuild checks the pinned channel qualification set. Later 0.159
// builds are untested and fail preflight; they are not admitted by range.
func CodexBuild(line string) BuildStatus {
	version, ok := strings.CutPrefix(strings.TrimSpace(line), "codex-cli ")
	if !ok {
		return BuildUnsupported
	}
	parts, ok := versionParts(version, 64, false)
	switch {
	case !ok || parts[0] != 0:
		return BuildUnsupported
	case parts[1] == 159 && (parts[2] == 2 || parts[2] == 3), parts[1] == 160 && parts[2] == 0:
		return BuildTested
	case parts[1] == 159 && parts[2] > 3:
		return BuildUntested
	default:
		return BuildUnsupported
	}
}

func versionParts(version string, bits int, canonical bool) ([3]uint64, bool) {
	var parsed [3]uint64
	parts := strings.Split(version, ".")
	if len(parts) != len(parsed) {
		return parsed, false
	}
	for i, part := range parts {
		if part == "" || canonical && len(part) > 1 && part[0] == '0' {
			return parsed, false
		}
		for _, digit := range part {
			if digit < '0' || digit > '9' {
				return parsed, false
			}
		}
		value, err := strconv.ParseUint(part, 10, bits)
		if err != nil {
			return parsed, false
		}
		parsed[i] = value
	}
	return parsed, true
}

// PreflightClaude returns an advisory for an accepted, untested build.
// The command and its version probe use the same selected executable.
func PreflightClaude(ctx context.Context, runner ports.Process, root home.Root, executable string) (string, error) {
	if !validClaudeDirectory(root) {
		return "", fmt.Errorf("%w: invalid Claude channel directory or socket path too long", ErrEnrollment)
	}
	line, err := providerVersion(ctx, runner, executable)
	if err != nil {
		return "", err
	}
	switch ClaudeBuild(line) {
	case BuildTested:
		return "", nil
	case BuildUntested:
		version, _ := strings.CutSuffix(line, claudeProductSuffix)
		return fmt.Sprintf("Claude Code %s has not been tested with message channels (tested: 2.1.285). Channel delivery depends on its handshake completing; if it never does, requests to this session fail as not ready and nothing is pasted.", version), nil
	default:
		return "", fmt.Errorf("%w: %q", ErrProviderVersion, line)
	}
}

// PreflightCodex accepts only the builds qualified by the channel contract.
func PreflightCodex(ctx context.Context, runner ports.Process, root home.Root, executable string) error {
	if !filepath.IsAbs(root.Dir) {
		return ErrEnrollment
	}
	line, err := providerVersion(ctx, runner, executable)
	if err != nil {
		return err
	}
	switch CodexBuild(line) {
	case BuildTested:
		return nil
	case BuildUntested:
		return fmt.Errorf("%w: Codex build %q has not been qualified for the message channel", ErrProviderUnqualified, line)
	default:
		return fmt.Errorf("%w: %q", ErrProviderVersion, line)
	}
}

// PreflightCodexPlan qualifies a selected channel instance and returns the
// native informational advisory for its effective working directory.
func PreflightCodexPlan(ctx context.Context, runner ports.Process, root home.Root, plan CodexPlan) (string, error) {
	if err := PreflightCodex(ctx, runner, root, plan.selected.Path); err != nil {
		return "", err
	}
	return codex.FolderTrustAdvisory(plan.cwd), nil
}

func providerVersion(ctx context.Context, runner ports.Process, executable string) (string, error) {
	if runner == nil || !filepath.IsAbs(executable) {
		return "", ErrProviderUnavailable
	}
	const budget = 5 * time.Second
	ctx, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	got, err := runner.Run(ctx, ports.ProcessSpec{
		Path: executable, Args: []string{"--version"}, MaxOut: providerVersionLimit, Timeout: budget,
	})
	if err != nil || ctx.Err() != nil || got.ExitCode != 0 || got.Truncated || len(got.Stdout) > providerVersionLimit {
		return "", ErrProviderUnavailable
	}
	return strings.TrimSpace(string(got.Stdout)), nil
}

func validClaudeDirectory(root home.Root) bool {
	if !filepath.IsAbs(root.Dir) {
		return false
	}
	exampleBinding := strings.Repeat("0", 36)
	return len(socketPath(root, exampleBinding)) <= maxUnixSocketPath
}

func socketPath(root home.Root, bindingID string) string {
	return filepath.Join(root.Dir, channelDirectory, bindingID+".sock")
}

func claudeCommand(root home.Root, command ports.ProcessSpec, executable, bindingID, generation string) (ports.ProcessSpec, error) {
	if !validClaudeDirectory(root) || !filepath.IsAbs(command.Path) || !filepath.IsAbs(executable) ||
		!core.ValidUUID(bindingID) || !core.ValidUUID(generation) {
		return ports.ProcessSpec{}, ErrEnrollment
	}
	if slices.Contains(command.Args, claudeChannelFlag) {
		return ports.ProcessSpec{}, errors.New("Claude command already passes " + claudeChannelFlag)
	}
	config, err := json.Marshal(map[string]any{"mcpServers": map[string]any{
		claudeServerName: map[string]any{
			"command": executable,
			"args":    []string{"__channel-server", "claude", bindingID, generation, filepath.Join(root.Dir, channelDirectory)},
		},
	}})
	if err != nil {
		return ports.ProcessSpec{}, err
	}
	command.Args = append(slices.Clone(command.Args), "--mcp-config", string(config), claudeChannelFlag, "server:"+claudeServerName)
	return command, nil
}
