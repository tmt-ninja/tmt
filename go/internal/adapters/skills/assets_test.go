package skills

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

func TestInstallPublishesPrivateGuidesAndRefusesChanges(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "go-home")
	root := home.Root{Dir: dir}
	generation, err := Install(root)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Dir(generation) != filepath.Join(dir, "skill-assets") {
		t.Fatalf("generation outside managed store: %s", generation)
	}
	for _, name := range names {
		entry := filepath.Join(generation, name, "SKILL.md")
		bytes, err := os.ReadFile(entry)
		if err != nil || !strings.Contains(string(bytes), "`"+flavor.Binary+" ") {
			t.Fatalf("read %s: expected isolated CLI guidance (%v)", entry, err)
		}
		info, err := os.Stat(entry)
		if err != nil || info.Mode().Perm() != 0600 {
			t.Fatalf("managed guide is not private: %v, %v", info, err)
		}
	}
	if again, err := Install(root); err != nil || again != generation {
		t.Fatalf("second Install = %q, %v", again, err)
	}
	extra := filepath.Join(generation, "tmt", "EXTRA.md")
	if err := os.WriteFile(extra, []byte("user addition"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := Install(root); err == nil {
		t.Fatal("accepted unexpected provider-readable file")
	}
	if _, err := os.Stat(extra); err != nil {
		t.Fatalf("modified generation was changed: %v", err)
	}
}

func TestInstallRefusesSymlinkedStore(t *testing.T) {
	root := home.Root{Dir: t.TempDir()}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root.Dir, "skill-assets")); err != nil {
		t.Fatal(err)
	}
	if _, err := Install(root); err == nil {
		t.Fatal("accepted a symlinked skill store")
	}
	entries, err := os.ReadDir(outside)
	if err != nil || len(entries) != 0 {
		t.Fatalf("wrote outside tmt-go home: %v, %v", entries, err)
	}
}
