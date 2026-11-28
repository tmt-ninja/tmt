//go:build darwin || linux

package e2e

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/home"
)

// Set TMT_GO_E2E_RUST_DIGEST to an absolute path to a built Rust tmt-digest.
func TestRustDigestCompanionIsolation(t *testing.T) {
	digest := os.Getenv("TMT_GO_E2E_RUST_DIGEST")
	if digest == "" {
		t.Skip("requires the Rust tmt-digest binary")
	}
	if !filepath.IsAbs(digest) {
		t.Fatal("TMT_GO_E2E_RUST_DIGEST must name an absolute executable")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 60*time.Second)
	defer cancel()
	work := t.TempDir()
	userHome := filepath.Join(work, "home")
	native := filepath.Join(userHome, ".config", "tmt")
	goHome := filepath.Join(work, "go state")
	bin := filepath.Join(work, "bin")
	for _, path := range []string{native, goHome, bin} {
		if err := os.MkdirAll(path, 0700); err != nil {
			t.Fatal(err)
		}
	}
	binary := filepath.Join(bin, "tmt-go")
	build := exec.CommandContext(ctx, "go", "build", "-o", binary, "../../cmd/tmt-go")
	if output, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build tmt-go: %v\n%s", err, output)
	}
	if err := os.Symlink(digest, filepath.Join(bin, "tmt-digest")); err != nil {
		t.Fatal(err)
	}
	const sentinel = "fixture native store, never opened or modified"
	nativeStore := filepath.Join(native, "tmt.db")
	if err := os.WriteFile(nativeStore, []byte(sentinel), 0600); err != nil {
		t.Fatal(err)
	}

	call := func(args ...string) []byte {
		t.Helper()
		cmd := exec.CommandContext(ctx, binary, args...)
		cmd.Dir = work
		cmd.Env = []string{
			"HOME=" + userHome, "PATH=" + bin, "TMT_HOME=" + native, home.EnvHome + "=" + goHome,
			"TMT_EXECUTABLE=" + filepath.Join(native, "forbidden-native-tmt"),
		}
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		out, err := cmd.Output()
		if err != nil || stderr.Len() != 0 {
			t.Fatalf("tmt-go %v: %v\nstdout: %s\nstderr: %s", args, err, out, stderr.String())
		}
		return out
	}
	var created struct{ Identity struct{ ID string } }
	memberJSON := call("identity", "create", "PrivateWorker", "--json")
	if err := json.Unmarshal(memberJSON, &created); err != nil || created.Identity.ID == "" {
		t.Fatalf("create member: %s, %v", memberJSON, err)
	}
	at := time.Now().Add(-time.Second).UnixMilli()
	goHistory := seedDigestDecision(t, goHome, created.Identity.ID, at)
	nativeHistory := seedDigestDecision(t, native, "30000000-0000-4000-8000-000000000003", at)
	before := map[string][]byte{}
	for _, path := range []string{nativeStore, nativeHistory, goHistory} {
		body, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		before[path] = body
	}

	var doc struct {
		Version   uint64
		Decisions []struct {
			AtMs       int64
			IdentityID string
			Name       string
			Rule       string
		}
	}
	result := call("digest", "decisions", "--json")
	if err := json.Unmarshal(result, &doc); err != nil || doc.Version != 1 || len(doc.Decisions) != 1 ||
		doc.Decisions[0].IdentityID != created.Identity.ID || doc.Decisions[0].Name != "PrivateWorker" ||
		doc.Decisions[0].AtMs != at || doc.Decisions[0].Rule != "not_due" {
		t.Fatalf("Rust Digest did not read only the Go root and callback through tmt-go: %s, %v", result, err)
	}
	for path, old := range before {
		body, err := os.ReadFile(path)
		if err != nil || !bytes.Equal(body, old) {
			t.Fatalf("read-only companion changed %s: %v", path, err)
		}
	}
	if _, err := os.Stat(filepath.Join(native, home.DatabaseName)); !os.IsNotExist(err) {
		t.Fatalf("Go database appeared in the private native fixture: %v", err)
	}
}

func seedDigestDecision(t *testing.T, root, identity string, at int64) string {
	t.Helper()
	dir := filepath.Join(root, "digest", "history")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "history.sqlite")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// Native Digest decisions schema. The command reads this version without migrating it.
	if _, err := db.Exec(`PRAGMA user_version=1;
		CREATE TABLE decisions(id INTEGER PRIMARY KEY, at_ms INTEGER NOT NULL, identity_id TEXT NOT NULL,
		interval_ms INTEGER, flush_count INTEGER NOT NULL, rule TEXT NOT NULL, held INTEGER NOT NULL,
		oldest_age_ms INTEGER, outcome TEXT)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO decisions(at_ms,identity_id,interval_ms,flush_count,rule,held,oldest_age_ms)
		VALUES(?,?,300000,5,'not_due',2,5000)`, at, identity); err != nil {
		t.Fatal(err)
	}
	return path
}
