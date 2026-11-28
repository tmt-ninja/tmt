//go:build darwin || linux

package codex

import (
	"errors"
	"io"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/pelletier/go-toml/v2"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const settingsLimit = 1024 * 1024

var ErrHookSources = errors.New("Codex hook sources cannot be composed safely.")

type providerPaths struct {
	home, cwd, system string
}

func currentProviderPaths() (providerPaths, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return providerPaths{}, ErrHookSources
	}
	explicit, found := os.LookupEnv("CODEX_HOME")
	if !found || explicit == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return providerPaths{}, ErrHookSources
		}
		explicit = filepath.Join(home, ".codex")
	}
	return providerPaths{home: resolve(cwd, explicit), cwd: cwd, system: "/etc/codex"}, nil
}

func resolve(cwd, path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(cwd, path)
}

func readSettings(dir, name string) ([]byte, error) {
	return readCodexFile(dir, name, settingsLimit)
}

func readCodexFile(dir, name string, limit int64) ([]byte, error) {
	root, err := os.OpenRoot(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, ErrHookSources
	}
	defer root.Close()
	base, err := root.Open(".")
	if err != nil {
		return nil, ErrHookSources
	}
	defer base.Close()
	file, err := sys.OpenEntryNoFollow(base, name, os.O_RDONLY, 0)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, ErrHookSources
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > limit {
		return nil, ErrHookSources
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil || int64(len(data)) > limit || !utf8.Valid(data) {
		return nil, ErrHookSources
	}
	return data, nil
}

func hookSettings(data []byte) (map[string]any, bool, error) {
	var doc map[string]any
	if err := toml.Unmarshal(data, &doc); err != nil {
		return nil, false, ErrHookSources
	}
	for _, key := range []string{"profile", "plugins"} {
		if _, present := doc[key]; present {
			return nil, false, ErrHookSources
		}
	}
	if features, ok := doc["features"].(map[string]any); ok {
		for _, key := range []string{"hooks", "codex_hooks"} {
			if value, present := features[key]; present && value != true {
				return nil, false, ErrHookSources
			}
		}
	}
	if mode, present := doc["allow_managed_hooks_only"]; present && mode != false {
		return nil, false, ErrHookSources
	}
	if _, present := doc["hooks"]; !present {
		return map[string]any{}, false, nil
	}
	hooks, ok := doc["hooks"].(map[string]any)
	if !ok {
		return nil, false, ErrHookSources
	}
	for _, key := range []string{"managed_dir", "windows_managed_dir"} {
		if _, present := hooks[key]; present {
			return nil, false, ErrHookSources
		}
	}
	state, present := hooks["state"]
	if present {
		records, ok := state.(map[string]any)
		if !ok {
			return nil, false, ErrHookSources
		}
		for _, value := range records {
			fields, ok := value.(map[string]any)
			if !ok || len(fields) != 1 {
				return nil, false, ErrHookSources
			}
			if _, ok := fields["trusted_hash"].(string); !ok {
				return nil, false, ErrHookSources
			}
		}
		delete(hooks, "state")
	}
	return hooks, present, nil
}

func persistentSources(paths providerPaths, cwd string) ([]hookDocument, error) {
	var sources []hookDocument
	check := func(root string, names ...string) error {
		for _, name := range names {
			data, err := readSettings(root, name)
			if err != nil {
				return err
			}
			if data == nil {
				continue
			}
			if name == "hooks.json" {
				doc, err := decodeHookDocument(data)
				if err != nil {
					return err
				}
				sources = append(sources, doc)
			} else {
				hooks, _, err := hookSettings(data)
				if err != nil || len(hooks) != 0 {
					return ErrHookSources
				}
			}
		}
		return nil
	}
	for _, root := range []string{paths.system, paths.home} {
		if err := check(root, "hooks.json", "config.toml", "requirements.toml"); err != nil {
			return nil, err
		}
	}
	for depth, root := 0, cwd; ; depth, root = depth+1, filepath.Dir(root) {
		if depth >= 128 {
			return nil, ErrHookSources
		}
		project := filepath.Join(root, ".codex")
		if project != paths.home {
			data, err := readSettings(project, "hooks.json")
			if err != nil || data != nil {
				return nil, ErrHookSources
			}
			if err := check(project, "config.toml"); err != nil {
				return nil, err
			}
		}
		if root == filepath.Dir(root) {
			return sources, nil
		}
	}
}

func invocationSettings(args []string, cwd string) (map[string]any, string, error) {
	hooks := make(map[string]any)
	base := cwd
	for i := 0; i < len(args) && args[i] != "--"; i++ {
		arg := args[i]
		if !utf8.ValidString(arg) {
			return nil, "", ErrHookSources
		}
		key, value, inline := strings.Cut(arg, "=")
		if len(arg) > 2 {
			switch arg[:2] {
			case "-p":
				return nil, "", ErrHookSources
			case "-c", "-C":
				key, value, inline = arg[:2], strings.TrimPrefix(arg[2:], "="), true
			}
		}
		switch key {
		case "--ignore-user-config", "--ignore-config", "--profile", "-p", "--dangerously-bypass-hook-trust":
			return nil, "", ErrHookSources
		case "-c", "--config", "--enable", "--disable", "-C", "--cd", "-m", "--model", "-a", "--ask-for-approval", "-s", "--sandbox":
		default:
			continue
		}
		if !inline {
			i++
			if i == len(args) {
				return nil, "", ErrHookSources
			}
			value = args[i]
		}
		if !utf8.ValidString(value) {
			return nil, "", ErrHookSources
		}
		switch key {
		case "-C", "--cd":
			cwd = resolve(base, value)
		case "--disable":
			if value == "hooks" || value == "codex_hooks" {
				return nil, "", ErrHookSources
			}
		case "-c", "--config":
			entries, trust, err := hookSettings([]byte(value))
			if err != nil || trust {
				return nil, "", ErrHookSources
			}
			for event, group := range entries {
				if _, duplicate := hooks[event]; duplicate {
					return nil, "", ErrHookSources
				}
				hooks[event] = group
			}
		}
	}
	return hooks, cwd, nil
}

// AddLaunchHooks composes the native Codex invocation-only hook override.
func AddLaunchHooks(command ports.ProcessSpec, launcher string) (ports.ProcessSpec, error) {
	paths, err := currentProviderPaths()
	if err != nil {
		return ports.ProcessSpec{}, err
	}
	return addLaunchHooks(command, launcher, paths)
}

func addLaunchHooks(command ports.ProcessSpec, launcher string, paths providerPaths) (ports.ProcessSpec, error) {
	if !filepath.IsAbs(launcher) || !utf8.ValidString(launcher) || strings.ContainsFunc(launcher, unicode.IsControl) {
		return ports.ProcessSpec{}, ErrHookSources
	}
	hooks, cwd, err := invocationSettings(command.Args, paths.cwd)
	if err != nil {
		return ports.ProcessSpec{}, err
	}
	sources, err := persistentSources(paths, cwd)
	if err != nil {
		return ports.ProcessSpec{}, err
	}
	value, err := composeHooks(hooks, sources, launcher)
	if err != nil {
		return ports.ProcessSpec{}, err
	}
	position := slices.Index(command.Args, "--")
	if position < 0 {
		position = len(command.Args)
	}
	if len(command.Args) > 0 && command.Args[0] == "resume" {
		position = 1
	}
	command.Args = slices.Insert(slices.Clone(command.Args), position, "-c", "hooks="+value)
	return command, nil
}

func finite(value float64) bool { return !math.IsInf(value, 0) && !math.IsNaN(value) }
