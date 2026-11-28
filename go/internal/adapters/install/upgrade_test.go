package install

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type fakeRelease []byte

func (f fakeRelease) Latest(context.Context, string, string) (ports.Artifact, error) {
	return ports.Artifact{}, nil
}

func (f fakeRelease) Fetch(context.Context, ports.Artifact) ([]byte, error) { return f, nil }

func TestReplaceExecutableVerifiesBeforeAtomicReplacement(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "tmt-go")
	native := filepath.Join(dir, "tmt")
	for _, path := range []string{target, native} {
		if err := os.WriteFile(path, []byte("original"), 0755); err != nil {
			t.Fatal(err)
		}
	}
	original, err := os.Open(target)
	if err != nil {
		t.Fatal(err)
	}
	defer original.Close()
	binary := fakeRelease("replacement")
	artifact := ports.Artifact{
		Version: "0.0.0-go.12+aaaaaaaaaa", OS: runtime.GOOS, Arch: runtime.GOARCH,
		SHA256: fmt.Sprintf("%x", sha256.Sum256(binary)),
	}
	if err := replaceExecutable(t.Context(), fakeRelease("corrupt"), artifact, "0.0.0-go-dev", target); err == nil {
		t.Fatal("accepted a corrupt artifact")
	}
	assertFile(t, target, "original")
	if err := replaceExecutable(t.Context(), binary, artifact, "0.0.0-go.9+bbbbbbbbbb", target); err != nil {
		t.Fatal(err)
	}
	assertFile(t, target, string(binary))
	assertFile(t, native, "original")
	old := make([]byte, len("original"))
	if _, err := original.Read(old); err != nil || string(old) != "original" {
		t.Fatalf("open executable changed to %q: %v", old, err)
	}
	info, err := os.Stat(target)
	if err != nil || info.Mode().Perm() != 0755 {
		t.Fatalf("replacement mode = %v, %v", info, err)
	}
}

func assertFile(t *testing.T, path, want string) {
	t.Helper()
	got, err := os.ReadFile(path)
	if err != nil || string(got) != want {
		t.Fatalf("%s = %q, %v; want %q", path, got, err, want)
	}
}

func TestReplaceExecutableRejectsOlderAndSameWorkflowRuns(t *testing.T) {
	target := filepath.Join(t.TempDir(), "tmt-go")
	if err := os.WriteFile(target, []byte("original"), 0755); err != nil {
		t.Fatal(err)
	}
	for _, version := range []string{"0.0.0-go.9+aaaaaaaaaa", "0.0.0-go.12+aaaaaaaaaa"} {
		t.Run(version, func(t *testing.T) {
			artifact := ports.Artifact{Version: version, OS: runtime.GOOS, Arch: runtime.GOARCH}
			// A nil source also proves the rejected artifact never reaches Fetch.
			err := replaceExecutable(t.Context(), nil, artifact, "0.0.0-go.12+bbbbbbbbbb", target)
			if !errors.Is(err, ErrNoNewerBuild) {
				t.Fatalf("same or older run returned %v", err)
			}
			assertFile(t, target, "original")
		})
	}
}
