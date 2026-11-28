package parity

import (
	"bytes"
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestHumanOutputMatchesNative(t *testing.T) {
	native := nativeExecutable(t)
	world := t.TempDir()
	goBinary := filepath.Join(world, "tmt-go")
	build := exec.CommandContext(t.Context(), "go", "build", "-o", goBinary, "../../cmd/tmt-go")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build tmt-go: %v\n%s", err, out)
	}
	run := func(t *testing.T, status int, diagnostic bool, args ...string) {
		t.Helper()
		want := humanOutput(t, world, native, status, diagnostic, args)
		got := humanOutput(t, world, goBinary, status, diagnostic, args)
		got = bytes.ReplaceAll(got, []byte("tmt-go"), []byte("tmt"))
		if !bytes.Equal(want, got) {
			t.Errorf("%q\nnative: %q\n    Go: %q", args, want, got)
		}
	}
	t.Run("empty identity list", func(t *testing.T) { run(t, 0, false, "ls") })
	t.Run("talk refusals", func(t *testing.T) {
		run(t, 3, true, "talk", "Missing", "hello")
		run(t, 1, true, "talk", "Missing", "hello", "--timeout", "nope")
		run(t, 1, true, "talk", "Missing", "hello", "--delay", "nope")
		run(t, 1, true, "talk", "Missing", "hello", "--wait")
	})

	const request = "req_7fa83dd5-d96b-4e55-8671-98c0dee1da14"
	seedHumanWorld(t, world, core.RequestID(request))
	t.Run("offline identities", func(t *testing.T) { run(t, 0, false, "ls") })
	t.Run("identity details", func(t *testing.T) { run(t, 0, false, "ls", "Sender") })
	t.Run("expanded offline identities", func(t *testing.T) { run(t, 0, false, "ls", "--all") })
	t.Run("empty inbox", func(t *testing.T) { run(t, 0, false, "inbox", "--identity", "sender") })
	t.Run("pending inbox", func(t *testing.T) { run(t, 0, false, "inbox", "--identity", "receiver") })
	t.Run("empty history", func(t *testing.T) { run(t, 0, false, "x", "ls", "--identity", "receiver") })
	t.Run("outgoing history", func(t *testing.T) { run(t, 0, false, "x", "ls", "--identity", "sender") })
	t.Run("exchange details", func(t *testing.T) { run(t, 0, false, "x", "show", request, "--identity", "sender") })
}

type fixtureClock int64

func (c fixtureClock) NowMs() int64 { return int64(c) }

func seedHumanWorld(t *testing.T, world string, request core.RequestID) {
	t.Helper()
	root, err := home.Resolve(func(key string) (string, bool) {
		if key == home.EnvHome {
			return filepath.Join(world, "go"), true
		}
		return "", false
	}, world)
	if err != nil {
		t.Fatal(err)
	}
	// Native and Go both render this as "just now" independent of command
	// startup latency. The fixture never advances the workstation clock.
	now := time.Now().Add(time.Minute)
	sender := core.Identity{ID: "c18d436d-6bd7-4c13-a397-4a9e36ad3dc3", Name: "Sender", CanonicalName: "sender", Lifetime: core.LifetimeSaved}
	receiver := core.Identity{ID: "36d70ad9-4cac-47d1-ad98-e350b044b488", Name: "Receiver", CanonicalName: "receiver", Lifetime: core.LifetimeTemporary}
	store, err := storage.Open(t.Context(), root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.Write(t.Context(), func(tx ports.StoreTx) error {
		for _, identity := range []core.Identity{sender, receiver} {
			if err := tx.Identities().Insert(identity, uint64(now.UnixMilli())); err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	requests := storage.NewRequestService(store, fixtureClock(now.UnixMilli()))
	if _, err := requests.Enqueue(t.Context(), core.PrepareRequest{
		RequestID: request, AttemptID: "c564e597-932f-44e2-8f49-fd9c4b72369b",
		Kind: core.RequestKindRequest, Origin: core.RequestOriginPerson,
		Originator: core.Originator{Kind: core.OriginatorExplicit, IdentityID: &sender.ID},
		Route:      core.RequestRoute{Kind: core.RequestRouteInbox, Recipient: &receiver.ID},
		Recipient:  &receiver.ID, ExpiresAtMs: uint64(now.Add(time.Minute).UnixMilli()),
		Message: "verify café\nsecond line", RetentionDays: 7,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(root.Database)
	if err != nil {
		t.Fatal(err)
	}
	// The parity oracle gets its own copy of the private fixture, including
	// identical identities, request IDs and timestamps.
	if err := os.WriteFile(filepath.Join(world, "native", "tmt.db"), data, 0600); err != nil {
		t.Fatal(err)
	}
}

func humanOutput(t *testing.T, world, binary string, status int, diagnostic bool, args []string) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, args...)
	cmd.Dir = world
	cmd.Env = []string{
		"PATH=/usr/bin:/bin",
		"HOME=" + world,
		"TMT_HOME=" + filepath.Join(world, "native"),
		"TMT_GO_HOME=" + filepath.Join(world, "go"),
		"XDG_CONFIG_HOME=" + filepath.Join(world, ".config"),
		"TMUX_TMPDIR=" + world,
		"NO_COLOR=1",
		"COLUMNS=80",
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	stdout, err := cmd.Output()
	if status == 0 && err != nil {
		t.Fatalf("%s %q: %v, stderr %q", binary, args, err, &stderr)
	}
	if status != 0 {
		var exit *exec.ExitError
		if !errors.As(err, &exit) || exit.ExitCode() != status {
			t.Fatalf("%s %q: expected exit %d, got %v, stderr %q", binary, args, status, err, &stderr)
		}
	}
	output, unused := stdout, stderr.Bytes()
	if diagnostic {
		output, unused = unused, output
	}
	if len(unused) != 0 || len(output) == 0 {
		t.Fatalf("%s %q: stdout %q, stderr %q", binary, args, stdout, &stderr)
	}
	return output
}
