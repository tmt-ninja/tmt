package config

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

func TestWorkspaceConfigUsesNearestGoDocument(t *testing.T) {
	workspace := t.TempDir()
	child := filepath.Join(workspace, "child")
	if err := os.Mkdir(child, 0700); err != nil {
		t.Fatal(err)
	}
	alternate := "tmt.json"
	if flavor.NativeCompatible {
		alternate = "tmt-go.json"
	}
	native := filepath.Join(child, alternate)
	write(t, native, `{"untouched":true}`)
	path := filepath.Join(workspace, flavor.WorkspaceFile)
	write(t, path, `{"$config":{"preambleMode":"always"},"opaque":{"integer":9007199254740993}}`)
	files, err := Resolve(privateRoot(t), child)
	if err != nil {
		t.Fatal(err)
	}
	if files.Path(Local) != path {
		t.Fatalf("local config = %q, want %q", files.Path(Local), path)
	}
	plan, err := files.Prepare(Local, func(doc Document) error {
		doc["$config"] = json.RawMessage(`{"preambleMode":"disabled"}`)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := plan.Apply(t.Context(), false); !errors.Is(err, ErrConsentRequired) {
		t.Fatalf("unapproved change: %v", err)
	}
	if got := readString(t, path); got != `{"$config":{"preambleMode":"always"},"opaque":{"integer":9007199254740993}}` {
		t.Fatalf("unapproved plan changed file: %q", got)
	}
	if err := plan.Apply(t.Context(), true); err != nil {
		t.Fatal(err)
	}
	if got := readString(t, path); got != string(plan.Preview()) {
		t.Fatalf("published %q, want preview %q", got, plan.Preview())
	}
	if got := readString(t, native); got != `{"untouched":true}` {
		t.Fatalf("native config changed: %q", got)
	}
}

func TestCompetingPreviewsOnlyPublishOneChange(t *testing.T) {
	root := privateRoot(t)
	files, err := Resolve(root, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	values := []json.RawMessage{json.RawMessage(`"always"`), json.RawMessage(`"disabled"`)}
	plans := make([]Plan, len(values))
	for i, value := range values {
		plans[i], err = files.Prepare(Global, func(doc Document) error {
			doc["preambleMode"] = value
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if _, err := os.Lstat(root.Dir); !os.IsNotExist(err) {
		t.Fatalf("preview initialized state: %v", err)
	}
	var wg sync.WaitGroup
	results := make([]error, len(plans))
	start := make(chan struct{})
	for i, plan := range plans {
		wg.Go(func() {
			<-start
			results[i] = plan.Apply(t.Context(), true)
		})
	}
	close(start)
	wg.Wait()

	successes := 0
	for i, err := range results {
		switch {
		case err == nil:
			successes++
			if got := readString(t, root.Config); got != string(plans[i].Preview()) {
				t.Fatalf("global config did not retain the successful preview: %q", got)
			}
		case !errors.Is(err, ErrChanged):
			t.Fatalf("expected a stale preview error, got %v", err)
		}
	}
	if successes != 1 {
		t.Fatalf("expected one competing write to succeed, got %v", results)
	}
}

func TestWorkspaceConfigDoesNotFollowSymlink(t *testing.T) {
	workspace := t.TempDir()
	native := filepath.Join(workspace, "other-settings.json")
	write(t, native, `{}`)
	if err := os.Symlink(native, filepath.Join(workspace, flavor.WorkspaceFile)); err != nil {
		t.Fatal(err)
	}
	files, err := Resolve(privateRoot(t), workspace)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := files.Read(Local); err == nil {
		t.Fatal("read through a native config symlink")
	}
}

func privateRoot(t *testing.T) home.Root {
	dir := filepath.Join(t.TempDir(), "go-home")
	return home.Root{Dir: dir, Config: filepath.Join(dir, "config.json")}
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
}

func readString(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func TestPreviewOfMissingConfigRefusesAnEmptyFileCreatedLater(t *testing.T) {
	root := privateRoot(t)
	files, err := Resolve(root, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	plan, err := files.Prepare(Global, func(doc Document) error {
		doc["preambleMode"] = json.RawMessage(`"always"`)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(root.Dir, 0700); err != nil {
		t.Fatal(err)
	}
	write(t, root.Config, "")
	if err := plan.Apply(t.Context(), true); !errors.Is(err, ErrChanged) {
		t.Fatalf("apply over a newly created file: %v", err)
	}
	if got := readString(t, root.Config); got != "" {
		t.Fatalf("newly created file changed to %q", got)
	}
}
