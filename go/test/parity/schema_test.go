package parity

import (
	"context"
	"database/sql"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

// EnvNative names an explicit native tmt executable. The parity tests never
// look one up on PATH: an installed host tmt is never run implicitly.
const EnvNative = "TMT_GO_PARITY_NATIVE"

func nativeExecutable(t *testing.T) string {
	t.Helper()
	path := os.Getenv(EnvNative)
	if path == "" {
		t.Skipf("parity not run: set %s to an absolute native tmt executable", EnvNative)
	}
	if !filepath.IsAbs(path) {
		t.Fatalf("%s must be absolute, got %q", EnvNative, path)
	}
	return path
}

// runNative runs the native binary in a fully private world: its own HOME,
// TMT_HOME and XDG root, and an empty TMUX_TMPDIR so no tmux server is reachable.
func runNative(t *testing.T, native, nativeHome string, args ...string) {
	t.Helper()
	world := t.TempDir()
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, native, args...)
	cmd.Dir = world
	cmd.Env = []string{
		"PATH=/usr/bin:/bin",
		"HOME=" + world,
		"TMT_HOME=" + nativeHome,
		"XDG_CONFIG_HOME=" + filepath.Join(world, ".config"),
		"TMUX_TMPDIR=" + world,
	}
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("native %v: %v\n%s", args, err, out)
	}
}

// schema returns the user-visible schema objects, one normalized line each.
func schema(t *testing.T, path string) []string {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows, err := db.QueryContext(t.Context(),
		`SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_master
		 WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var lines []string
	for rows.Next() {
		var kind, name, table, text string
		if err := rows.Scan(&kind, &name, &table, &text); err != nil {
			t.Fatal(err)
		}
		lines = append(lines, kind+" "+name+" on "+table+": "+strings.Join(strings.Fields(text), " "))
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return lines
}

func TestFreshSchemaMatchesNative(t *testing.T) {
	native := nativeExecutable(t)
	nativeHome := t.TempDir()
	runNative(t, native, nativeHome, "ls", "--json")
	want := schema(t, filepath.Join(nativeHome, "tmt.db"))

	user := t.TempDir()
	root, err := home.Resolve(func(k string) (string, bool) {
		if k == home.EnvHome {
			return filepath.Join(user, "go"), true
		}
		return "", false
	}, user)
	if err != nil {
		t.Fatal(err)
	}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	got := schema(t, root.Database)

	wantSet := map[string]bool{}
	for _, line := range want {
		wantSet[line] = true
	}
	gotSet := map[string]bool{}
	for _, line := range got {
		gotSet[line] = true
		if !wantSet[line] {
			t.Errorf("only in Go: %s", line)
		}
	}
	for _, line := range want {
		if !gotSet[line] {
			t.Errorf("only in native: %s", line)
		}
	}
	if len(want) == 0 {
		t.Fatal("native schema is empty")
	}
}
