package channel

import (
	"encoding/json"
	"errors"
	"net/netip"
	"path/filepath"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/invoke"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const codexTokenEnv = "TMT_CODEX_ENDPOINT_TOKEN"

var ErrCodexLaunchArguments = errors.New("unsupported Codex channel launch arguments")

// CodexPlan validates only the invocation's selected executable, cwd,
// arguments and exact resume session. No provider configuration is read.
type CodexPlan struct {
	selected   ports.ProcessSpec
	cwd        string
	resume     string
	foreground []string
	server     []string
	sandbox    string
	approval   string
	model      string
}

func PlanCodexLaunch(command ports.ProcessSpec, cwd, resume string) (CodexPlan, error) {
	if !validLaunchPath(cwd) || !validLaunchPath(command.Path) || len(command.Stdin) != 0 {
		return CodexPlan{}, ErrCodexLaunchArguments
	}
	command.Args = slices.Clone(command.Args)
	command.Env = slices.Clone(command.Env)
	plan := CodexPlan{selected: command, cwd: cwd, resume: resume}
	args := command.Args
	if resume != "" {
		var ok bool
		args, ok = exactCodexResume(args, resume)
		if !ok {
			return CodexPlan{}, ErrCodexLaunchArguments
		}
	}
	for i := 0; i < len(args); i++ {
		if !validLaunchValue(args[i]) {
			return CodexPlan{}, ErrCodexLaunchArguments
		}
		name, value, inline := strings.Cut(args[i], "=")
		switch name {
		case "--strict-config", "--no-alt-screen":
			if inline {
				return CodexPlan{}, ErrCodexLaunchArguments
			}
			plan.foreground = append(plan.foreground, name)
			if name == "--strict-config" {
				plan.server = append(plan.server, name)
			}
			continue
		case "-c", "--config", "--enable", "--disable", "-m", "--model", "-s", "--sandbox", "-a", "--ask-for-approval", "-C", "--cd":
		default:
			return CodexPlan{}, ErrCodexLaunchArguments
		}
		if !inline {
			i++
			if i == len(args) {
				return CodexPlan{}, ErrCodexLaunchArguments
			}
			value = args[i]
		}
		if !validLaunchValue(value) || !plan.option(name, value, cwd) {
			return CodexPlan{}, ErrCodexLaunchArguments
		}
	}
	return plan, nil
}

func exactCodexResume(args []string, resume string) ([]string, bool) {
	if !core.ValidUUID(resume) || len(args) < 2 || args[0] != "resume" {
		return nil, false
	}
	pos := 1
	for pos < len(args) {
		switch args[pos] {
		case "-m", "--model", "-c", "--config":
			pos += 2
		default:
			tail := args[pos:]
			return args[1:pos], tail[0] == resume && (len(tail) == 1 || len(tail) == 2 && tail[1] == "--no-daemon")
		}
	}
	return nil, false
}

func (p *CodexPlan) option(name, value, cwd string) bool {
	switch name {
	case "-C", "--cd":
		if strings.IndexFunc(value, unicode.IsControl) >= 0 {
			return false
		}
		p.cwd = value
		if !filepath.IsAbs(value) {
			p.cwd = filepath.Join(cwd, value)
		}
		return true
	case "-s", "--sandbox":
		if !slices.Contains([]string{"read-only", "workspace-write", "danger-full-access"}, value) {
			return false
		}
		p.sandbox = value
		p.serverConfig("sandbox_mode", value)
		return true
	case "-a", "--ask-for-approval":
		if !slices.Contains([]string{"untrusted", "on-request", "never"}, value) {
			return false
		}
		p.approval = value
		p.serverConfig("approval_policy", value)
		return true
	case "-c", "--config":
		if !validCodexOverride(value) {
			return false
		}
	case "-m", "--model":
		if p.model == "" {
			p.model = value
		}
		p.foreground = append(p.foreground, name, value)
		p.serverConfig("model", value)
		return true
	}
	p.foreground = append(p.foreground, name, value)
	p.server = append(p.server, name, value)
	return true
}

func validCodexOverride(value string) bool {
	key, _, ok := strings.Cut(value, "=")
	if !ok {
		return false
	}
	key = strings.TrimSpace(key)
	for part := range strings.SplitSeq(key, ".") {
		if part == "" {
			return false
		}
		for _, r := range part {
			if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
				return false
			}
		}
	}
	root, _, _ := strings.Cut(key, ".")
	switch root {
	case "approval_policy", "approvals_reviewer", "sandbox_mode", "default_permissions", "permissions", "network", "sandbox_workspace_write":
		return false
	default:
		return true
	}
}

func (p *CodexPlan) serverConfig(key, value string) {
	raw, _ := json.Marshal(value)
	p.server = append(p.server, "-c", key+"="+string(raw))
}

// serverCommand is used only with a capability file in an owned generation
// directory. The app-server itself binds the ephemeral loopback port.
func (p CodexPlan) serverCommand(capabilityFile string) ports.ProcessSpec {
	command := p.selected
	command.Dir = p.cwd
	command.Args = append(slices.Clone(p.server), "app-server", "--listen", "ws://127.0.0.1:0",
		"--ws-auth", "capability-token", "--ws-token-file", capabilityFile)
	base := slices.DeleteFunc(slices.Clone(command.Env), func(entry string) bool {
		return strings.HasPrefix(entry, codexTokenEnv+"=")
	})
	command.Env = invoke.OverlayEnv(base, []string{"NO_COLOR=1", "RUST_LOG=error"})
	return command
}

// remoteForeground uses a capability from the owned endpoint. The token
// value travels only in the foreground child's environment.
func (p CodexPlan) remoteForeground(endpoint netip.AddrPort, token string) (ports.ProcessSpec, error) {
	if endpoint.Addr() != netip.AddrFrom4([4]byte{127, 0, 0, 1}) || endpoint.Port() == 0 || !validCodexToken(token) {
		return ports.ProcessSpec{}, ErrEnrollment
	}
	command := p.selected
	command.Dir = p.cwd
	var args []string
	if p.resume != "" {
		args = append(args, "resume")
	}
	args = append(args, "--remote", "ws://"+endpoint.String(), "--remote-auth-token-env", codexTokenEnv, "-C", p.cwd)
	args = append(args, p.foreground...)
	if p.resume != "" {
		args = append(args, p.resume)
	} else {
		if p.sandbox != "" {
			args = append(args, "--sandbox", p.sandbox)
		}
		if p.approval != "" {
			args = append(args, "--ask-for-approval", p.approval)
		}
	}
	command.Args = args
	command.Env = invoke.OverlayEnv(command.Env, []string{codexTokenEnv + "=" + token})
	return command, nil
}

func validCodexToken(token string) bool {
	if len(token) != 64 {
		return false
	}
	for _, c := range token {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}

func (p CodexPlan) resumeParams() map[string]string {
	params := map[string]string{"threadId": p.resume, "cwd": p.cwd}
	if p.model != "" {
		params["model"] = p.model
	}
	return params
}

func validLaunchPath(path string) bool {
	return filepath.IsAbs(path) && utf8.ValidString(path) && strings.IndexFunc(path, unicode.IsControl) < 0
}

func validLaunchValue(value string) bool {
	return utf8.ValidString(value) && !strings.ContainsRune(value, 0)
}
