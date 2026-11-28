package config

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

type Scope uint8

const (
	Global Scope = iota
	Local
)

var (
	ErrConsentRequired = errors.New("configuration write requires consent")
	ErrChanged         = errors.New("configuration changed since preview")
)

type Document map[string]json.RawMessage

// Files resolves the same global and workspace documents for reads and edits.
type Files struct {
	global string
	local  string
}

func Resolve(root home.Root, workspace string) (Files, error) {
	if !filepath.IsAbs(root.Dir) || root.Config != filepath.Join(root.Dir, "config.json") {
		return Files{}, errors.New("configuration requires a resolved " + flavor.Binary + " home")
	}
	dir, err := filepath.Abs(workspace)
	if err != nil {
		return Files{}, err
	}
	local := filepath.Join(dir, flavor.WorkspaceFile)
	for {
		candidate := filepath.Join(dir, flavor.WorkspaceFile)
		if _, err := os.Lstat(candidate); err == nil {
			local = candidate
			break
		} else if !errors.Is(err, fs.ErrNotExist) {
			return Files{}, err
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return Files{global: root.Config, local: local}, nil
}

func (f Files) Path(scope Scope) string {
	switch scope {
	case Global:
		return f.global
	case Local:
		return f.local
	default:
		return ""
	}
}

func (f Files) Read(scope Scope) (Document, error) {
	path := f.Path(scope)
	current, err := read(path)
	if err != nil {
		return nil, err
	}
	return parse(path, scope, current.data)
}

// Plan pins the exact prior and proposed bytes for one consented write.
type Plan struct {
	path   string
	scope  Scope
	before []byte
	after  []byte
}

func (p Plan) Path() string { return p.path }

// Preview returns the bytes that will be published on approval.
func (p Plan) Preview() []byte { return bytes.Clone(p.after) }

// Prepare previews a workspace or global edit without creating any files.
// The caller validates typed setting values before editing the raw document.
func (f Files) Prepare(scope Scope, edit func(Document) error) (Plan, error) {
	path := f.Path(scope)
	current, err := read(path)
	if err != nil {
		return Plan{}, err
	}
	doc, err := parse(path, scope, current.data)
	if err != nil {
		return Plan{}, err
	}
	if err := edit(doc); err != nil {
		return Plan{}, err
	}
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(doc); err != nil {
		return Plan{}, err
	}
	if _, err := parse(path, scope, encoded.Bytes()); err != nil {
		return Plan{}, err
	}
	return Plan{path: path, scope: scope, before: current.data, after: encoded.Bytes()}, nil
}

// Apply acquires a directory lock and publishes only the previewed change.
func (p Plan) Apply(ctx context.Context, approved bool) error {
	if !approved {
		return ErrConsentRequired
	}
	if p.path == "" {
		return errors.New("missing configuration preview")
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	parent, name := filepath.Dir(p.path), filepath.Base(p.path)
	if p.scope == Global {
		if err := os.MkdirAll(parent, 0700); err != nil {
			return err
		}
	}
	dir, err := os.OpenRoot(parent)
	if err != nil {
		return err
	}
	defer dir.Close()
	lock, err := dir.Open(".")
	if err != nil {
		return err
	}
	defer lock.Close()
	if err := lockDirectory(ctx, lock); err != nil {
		return err
	}
	current, err := readAt(dir, name)
	if err != nil {
		return err
	}
	if !sameSnapshot(current.data, p.before) {
		return fmt.Errorf("%w: %s", ErrChanged, p.path)
	}
	if bytes.Equal(current.data, p.after) {
		return nil
	}

	stage := "." + name + ".stage-" + rand.Text()
	file, err := dir.OpenFile(stage, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer dir.Remove(stage)
	defer file.Close()
	if _, err := file.Write(p.after); err != nil {
		return err
	}
	if err := file.Chmod(current.mode); err != nil {
		return err
	}
	if err := file.Sync(); err != nil {
		return err
	}
	if err := file.Close(); err != nil {
		return err
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	latest, err := readAt(dir, name)
	if err != nil {
		return err
	}
	if !sameSnapshot(latest.data, p.before) || latest.mode != current.mode {
		return fmt.Errorf("%w: %s", ErrChanged, p.path)
	}
	if err := dir.Rename(stage, name); err != nil {
		return err
	}
	if err := lock.Sync(); err != nil {
		return fmt.Errorf("%s was replaced but its directory could not be synced: %w", p.path, err)
	}
	return nil
}

func lockDirectory(ctx context.Context, file *os.File) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		locked, err := sys.TryLockExclusive(file)
		if err != nil || locked {
			return err
		}
		timer := time.NewTimer(10 * time.Millisecond)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
}

func sameSnapshot(a, b []byte) bool {
	return (a == nil) == (b == nil) && bytes.Equal(a, b)
}

type snapshot struct {
	data []byte
	mode fs.FileMode
}

func read(path string) (snapshot, error) {
	if path == "" {
		return snapshot{}, errors.New("invalid configuration scope")
	}
	dir, err := os.OpenRoot(filepath.Dir(path))
	if errors.Is(err, fs.ErrNotExist) {
		return snapshot{mode: 0600}, nil
	}
	if err != nil {
		return snapshot{}, err
	}
	defer dir.Close()
	return readAt(dir, filepath.Base(path))
}

func readAt(dir *os.Root, name string) (snapshot, error) {
	info, err := dir.Lstat(name)
	if errors.Is(err, fs.ErrNotExist) {
		return snapshot{mode: 0600}, nil
	}
	if err != nil {
		return snapshot{}, err
	}
	path := filepath.Join(dir.Name(), name)
	if !info.Mode().IsRegular() {
		return snapshot{}, fmt.Errorf("configuration is not a regular file: %s", path)
	}
	file, err := dir.Open(name)
	if err != nil {
		return snapshot{}, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return snapshot{}, err
	}
	if !os.SameFile(info, opened) {
		return snapshot{}, fmt.Errorf("%w: %s", ErrChanged, path)
	}
	content, err := io.ReadAll(file)
	// Distinguish an empty file (invalid JSON) from a missing one.
	if content == nil {
		content = []byte{}
	}
	return snapshot{data: content, mode: opened.Mode().Perm()}, err
}

func parse(path string, scope Scope, content []byte) (Document, error) {
	doc := make(Document)
	if content == nil {
		return doc, nil
	}
	if !utf8.Valid(content) {
		return nil, fmt.Errorf("Invalid JSON in %s: invalid UTF-8", path)
	}
	if err := json.Unmarshal(content, &doc); err != nil {
		var kind *json.UnmarshalTypeError
		if errors.As(err, &kind) {
			return nil, objectError(path, "<root>")
		}
		return nil, fmt.Errorf("Invalid JSON in %s: %w", path, err)
	}
	if doc == nil {
		return nil, objectError(path, "<root>")
	}
	containers := []string{"$config"}
	if scope == Global {
		containers = []string{"defaults", "exchange", "ui", "notifications", "notes", "workspace", "experimental", "user"}
	}
	for _, name := range containers {
		if field, ok := doc[name]; ok {
			var object Document
			if err := json.Unmarshal(field, &object); err != nil || object == nil {
				return nil, objectError(path, name)
			}
		}
	}
	return doc, nil
}

func objectError(path, field string) error {
	return fmt.Errorf("Invalid configuration in %s (%s): must be a non-null object.", path, field)
}
