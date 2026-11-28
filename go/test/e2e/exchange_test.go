//go:build darwin || linux

// Package e2e exercises the compiled Go CLI against a private tmux server.
package e2e

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	_ "modernc.org/sqlite"

	"github.com/tmt-ninja/tmt/go/test/tmuxtest"
)

type identity struct {
	ID       string
	Name     string
	Lifetime string
}

type finalReply struct {
	RequestID     string
	Status        string
	Response      string
	BodyBytes     int
	SubmittedAtMs uint64
}

func TestRequestRoundTripAndAttention(t *testing.T) {
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	tmuxExecutable, err := exec.LookPath("tmux")
	if err != nil {
		t.Skip("tmux not installed")
	}
	binary, fake := buildPrograms(t, ctx)
	fakeBin := filepath.Dir(fake)
	for _, provider := range []string{"claude", "gemini"} {
		if err := os.WriteFile(filepath.Join(fakeBin, provider), []byte("#!/bin/sh\nexit 97\n"), 0700); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(tmuxExecutable, filepath.Join(fakeBin, "tmux")); err != nil {
		t.Fatal(err)
	}
	dataDir, fixtureHome := t.TempDir(), t.TempDir()
	t.Setenv("HOME", fixtureHome)
	t.Setenv("PATH", fakeBin+":/usr/bin:/bin")
	t.Setenv("CODEX_HOME", filepath.Join(fixtureHome, "fake-codex-home"))
	t.Setenv("CLAUDE_CONFIG_DIR", filepath.Join(fixtureHome, "fake-claude-home"))
	t.Setenv("GEMINI_CLI_HOME", filepath.Join(fixtureHome, "fake-gemini-home"))
	t.Setenv("SHELL", "/bin/sh")
	t.Setenv("TMT_HOME", "")
	t.Setenv("XDG_CONFIG_HOME", "")
	t.Setenv("TMT_GO_COMPANION_ROOT", "")
	t.Setenv("TMT_GO_HOME", dataDir)
	t.Setenv("TMT_EXECUTABLE", binary)

	server := tmuxtest.Start(t)
	run := cli{ctx: ctx, binary: binary}
	senderJSON := filepath.Join(dataDir, "sender.json")
	senderStatus := filepath.Join(dataDir, "sender-status")
	senderPane := strings.TrimSpace(server.Run("new-window", "-d", "-t", "t:", "-P", "-F", "#{pane_id}",
		"-n", "sender", "-c", dataDir, "/bin/sh", "-c",
		privateExchangeShell+`"$1" name --save Sender --json > "$2"; printf '%s\n' "$?" > "$3"; exec /bin/sh`,
		"e2e", binary, senderJSON, senderStatus, fakeBin, fixtureHome))
	waitForExit(t, ctx, senderStatus, "sender name")
	document, err := os.ReadFile(senderJSON)
	if err != nil {
		t.Fatal(err)
	}
	var sender struct {
		identity
		Bound bool
		Pane  string
	}
	if err := json.Unmarshal(document, &sender); err != nil {
		t.Fatalf("sender binding JSON = %q: %v", document, err)
	}
	if !sender.Bound || sender.Pane != senderPane || sender.ID == "" || sender.Name != "Sender" || sender.Lifetime != "saved" {
		t.Fatalf("sender binding = %+v", sender)
	}

	exitFile := filepath.Join(dataDir, "run-exit")
	workerPane := strings.TrimSpace(server.Run("new-window", "-d", "-t", "t:", "-P", "-F", "#{pane_id}",
		"-n", "worker", "-c", dataDir, "/bin/sh", "-c",
		privateExchangeShell+`/bin/stty -echo && "$1" run --save Worker "$2"; printf '%s\n' "$?" > "$3"; exec /bin/sh`,
		"e2e", binary, fake, exitFile, fakeBin, fixtureHome))
	db := readOnlyDB(t, dataDir)
	var workerID string
	await(t, ctx, "fake composer and recorded running binding", func() (bool, error) {
		screen := server.Run("capture-pane", "-p", "-t", workerPane)
		if exit, err := os.ReadFile(exitFile); err == nil {
			t.Fatalf("private worker exited before runtime admission: %q\n%s", exit, screen)
		}
		if !strings.Contains(screen, "Ask Codex to do anything") {
			return false, nil
		}
		var state, socket string
		err := db.QueryRowContext(ctx, `
			SELECT i.id, b.runtime_state, b.socket_path
			FROM bindings b JOIN identities i ON i.id = b.identity_id
			WHERE b.pane_id = ? AND i.name = ?`, workerPane, "Worker").Scan(&workerID, &state, &socket)
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return workerID != "" && state == "running" && socket == server.Socket, err
	})

	assertNoNativeOptions(t, server, senderPane, workerPane)
	if server.Run("show-options", "-sqv", "@tmt-go.server-id") == "" ||
		server.Run("show-options", "-pqv", "-t", workerPane, "@tmt-go.agent") == "" {
		t.Fatal("run did not publish Go binding metadata")
	}

	const message = "verify café ; literal"
	const expectedReply = "ack: " + message
	var talk struct {
		finalReply
		Target   string
		Pane     string
		Identity identity
	}
	run.json(t, &talk, "talk", "Worker", message, "--identity", sender.ID, "--timeout", "8s")
	if !requestID.MatchString(talk.RequestID) || talk.Target != "Worker" || talk.Pane != workerPane || talk.Identity.Name != "Worker" {
		t.Fatalf("talk correlation = %+v", talk)
	}
	assertFinal(t, talk.finalReply, talk.RequestID, expectedReply)
	var final finalReply
	run.json(t, &final, "result", talk.RequestID)
	assertFinal(t, final, talk.RequestID, expectedReply)
	if final.SubmittedAtMs != talk.SubmittedAtMs {
		t.Fatalf("result submission time %d differs from talk %d", final.SubmittedAtMs, talk.SubmittedAtMs)
	}

	var body, recipient string
	var size int
	err = db.QueryRowContext(ctx, `
		SELECT body, body_bytes, route_recipient_identity_id FROM request_responses
		WHERE request_id = ? AND route_kind = 'inbox'`, talk.RequestID).Scan(&body, &size, &recipient)
	if err != nil || body != expectedReply || size != len(expectedReply) || recipient != workerID {
		t.Fatalf("stored final = %q, %d, %q, %v", body, size, recipient, err)
	}

	var exchanges struct {
		Identity identity
		Items    []struct {
			RequestID            string
			RecipientIdentityID  string
			PreparedAtMs         uint64
			RetentionExpiresAtMs uint64
			Delivery             string
			Revision             uint64
			Acknowledged         *bool
			Settled              *bool
			Final                struct {
				Status        string
				BodyBytes     int
				SubmittedAtMs uint64
				ExpiresAtMs   uint64
				Response      json.RawMessage
			}
		}
		NextAfter json.RawMessage
	}
	run.json(t, &exchanges, "x", "ls", "--identity", sender.ID)
	if exchanges.Identity != sender.identity || len(exchanges.Items) != 1 || string(exchanges.NextAfter) != "null" {
		t.Fatalf("attention page = %+v", exchanges)
	}
	row := exchanges.Items[0]
	if row.RequestID != talk.RequestID || row.RecipientIdentityID != workerID || row.Delivery != "sent" ||
		row.Revision < 2 || row.PreparedAtMs == 0 || row.RetentionExpiresAtMs < row.PreparedAtMs ||
		row.Acknowledged == nil || *row.Acknowledged || row.Settled == nil || *row.Settled {
		t.Fatalf("attention item = %+v", row)
	}
	if row.Final.Status != "retained" || row.Final.BodyBytes != len(expectedReply) ||
		row.Final.SubmittedAtMs != final.SubmittedAtMs || row.Final.ExpiresAtMs < final.SubmittedAtMs || row.Final.Response != nil {
		t.Fatalf("attention final metadata = %+v", row.Final)
	}
	ackArgs := []string{"x", "ack", talk.RequestID, "--identity", sender.ID, "--revision"}
	run.failure(t, 5, "X_REVISION_CONFLICT", append(ackArgs, strconv.FormatUint(row.Revision-1, 10))...)
	for _, changed := range []bool{true, false} {
		var ack struct {
			Identity     identity
			RequestID    string
			Revision     uint64
			Acknowledged bool
			Changed      *bool
		}
		run.json(t, &ack, append(ackArgs, strconv.FormatUint(row.Revision, 10))...)
		if ack.Identity != sender.identity || ack.RequestID != talk.RequestID || ack.Revision != row.Revision ||
			!ack.Acknowledged || ack.Changed == nil || *ack.Changed != changed {
			t.Fatalf("ack changed=%v: %+v", changed, ack)
		}
	}
	exchanges.Identity, exchanges.Items, exchanges.NextAfter = identity{}, nil, nil
	run.json(t, &exchanges, "x", "ls", "--identity", sender.ID)
	if exchanges.Identity != sender.identity || exchanges.Items == nil || len(exchanges.Items) != 0 || string(exchanges.NextAfter) != "null" {
		t.Fatalf("acknowledged request still on page: %+v", exchanges)
	}

	assertNoNativeOptions(t, server, senderPane, workerPane)
	waitForExit(t, ctx, exitFile, "foreground run")
	run.failure(t, 5, "CONFIRMATION_REQUIRED", "rm", "Worker")
	var removed struct {
		Identity identity
		Removed  bool
	}
	run.json(t, &removed, "rm", "Worker", "--force")
	if !removed.Removed || removed.Identity != (identity{workerID, "Worker", "saved"}) {
		t.Fatalf("remove = %+v", removed)
	}
	var retiredAt uint64
	var bindings int
	err = db.QueryRowContext(ctx, `
		SELECT i.retired_at_ms, (SELECT count(*) FROM bindings WHERE identity_id = i.id)
		FROM identities i WHERE i.id = ?`, workerID).Scan(&retiredAt, &bindings)
	if err != nil || retiredAt == 0 || bindings != 0 {
		t.Fatalf("retirement = %d, bindings = %d, error = %v", retiredAt, bindings, err)
	}
	if marker := server.Run("show-options", "-pqv", "-t", workerPane, "@tmt-go.agent"); marker != "" {
		t.Fatalf("retired worker pane still has a Go marker: %q", marker)
	}
	assertNoNativeOptions(t, server, senderPane, workerPane)
	var retained finalReply
	run.json(t, &retained, "result", talk.RequestID)
	assertFinal(t, retained, talk.RequestID, expectedReply)
}

// Reset the provider environment inside each pane, after shell startup.
const privateExchangeShell = `PATH="$4:/usr/bin:/bin"
HOME="$5"
CODEX_HOME="$5/fake-codex-home"
CLAUDE_CONFIG_DIR="$5/fake-claude-home"
GEMINI_CLI_HOME="$5/fake-gemini-home"
export PATH HOME CODEX_HOME CLAUDE_CONFIG_DIR GEMINI_CLI_HOME
for provider in claude codex gemini; do
  expected="$4/$provider"
  if [ "$(command -v "$provider")" != "$expected" ] || [ ! -f "$expected" ] || [ ! -x "$expected" ] || [ -L "$expected" ]; then
    printf 'fixture executable check failed for %s\n' "$provider" >&2
    printf '98\n' > "$3"
    exit 98
  fi
done
`

var requestID = regexp.MustCompile(`^req_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$`)

func assertFinal(t *testing.T, final finalReply, id, expected string) {
	t.Helper()
	if final.Status != "completed" || final.RequestID != id || final.Response != expected ||
		final.BodyBytes != len(expected) || final.SubmittedAtMs == 0 {
		t.Fatalf("final reply = %+v", final)
	}
}

type cli struct {
	ctx    context.Context
	binary string
}

func (c cli) json(t *testing.T, destination any, args ...string) {
	t.Helper()
	c.invoke(t, 0, destination, args...)
}

func (c cli) failure(t *testing.T, status int, code string, args ...string) {
	t.Helper()
	var failure struct {
		Error struct{ Code, Message string }
	}
	c.invoke(t, status, &failure, args...)
	if failure.Error.Code != code || failure.Error.Message == "" {
		t.Fatalf("%v: error = %+v, want %s", args, failure.Error, code)
	}
}

func (c cli) invoke(t *testing.T, status int, destination any, args ...string) {
	t.Helper()
	cmd := exec.CommandContext(c.ctx, c.binary, append(args, "--json")...)
	cmd.Env = tmuxtest.Env()
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	var exit *exec.ExitError
	if status == 0 && err != nil || status != 0 && (!errors.As(err, &exit) || exit.ExitCode() != status) {
		t.Fatalf("%v: want exit %d, got %v; stdout=%q stderr=%q", args, status, err, stdout.String(), stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("%v: unexpected stderr %q", args, stderr.String())
	}
	if err := json.Unmarshal(stdout.Bytes(), destination); err != nil {
		t.Fatalf("%v: %v; stdout=%q", args, err, stdout.String())
	}
}

func buildPrograms(t *testing.T, ctx context.Context) (binary, fake string) {
	t.Helper()
	binary, fake = filepath.Join(t.TempDir(), "tmt-go"), filepath.Join(t.TempDir(), "codex")
	for _, build := range []struct{ path, source string }{
		{binary, "../../cmd/tmt-go"},
		{fake, "../fixtures/fakeprovider"},
	} {
		cmd := exec.CommandContext(ctx, "go", "build", "-o", build.path, build.source)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("build %s: %v\n%s", build.source, err, out)
		}
	}
	return binary, fake
}

func readOnlyDB(t *testing.T, dir string) *sql.DB {
	t.Helper()
	dsn := (&url.URL{Scheme: "file", Path: filepath.Join(dir, "tmt-go.db"), RawQuery: "mode=ro"}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	return db
}

func waitForExit(t *testing.T, ctx context.Context, path, command string) {
	t.Helper()
	await(t, ctx, command+" exit", func() (bool, error) {
		status, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) || err == nil && !bytes.HasSuffix(status, []byte("\n")) {
			return false, nil
		}
		if err == nil && string(status) != "0\n" {
			t.Fatalf("%s exited %q", command, status)
		}
		return err == nil, err
	})
}

func await(t *testing.T, ctx context.Context, description string, probe func() (bool, error)) {
	t.Helper()
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	tick := time.NewTicker(10 * time.Millisecond)
	defer tick.Stop()
	for {
		ready, err := probe()
		if err != nil {
			t.Fatalf("%s: %v", description, err)
		}
		if ready {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatalf("waiting for %s: %v", description, ctx.Err())
		case <-tick.C:
		}
	}
}

func assertNoNativeOptions(t *testing.T, server *tmuxtest.Server, panes ...string) {
	t.Helper()
	scopes := [][]string{{"-s"}, {"-g"}, {"-t", "t:"}, {"-gw"}}
	for _, pane := range panes {
		scopes = append(scopes, []string{"-w", "-t", pane}, []string{"-p", "-t", pane})
	}
	for _, scope := range scopes {
		options := server.Run(append([]string{"show-options"}, scope...)...)
		for line := range strings.SplitSeq(options, "\n") {
			if strings.HasPrefix(strings.TrimSpace(line), "@tmt.") {
				t.Fatalf("native tmux metadata appeared in scope %v: %q", scope, line)
			}
		}
	}
}
