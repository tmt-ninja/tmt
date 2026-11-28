package release

import (
	"context"
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type processFunc func(context.Context, ports.ProcessSpec) (ports.Bounded, error)

func (f processFunc) Run(ctx context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
	return f(ctx, spec)
}

func TestLatestVerifiesPinnedWorkflowArtifact(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		t.Run(fmt.Sprint(corrupt), func(t *testing.T) {
			binary := []byte("darwin arm64 binary")
			digest := fmt.Sprintf("%x", sha256.Sum256(binary))
			calls := 0
			source := Source{
				ghPath: "/fake/gh",
				process: processFunc(func(_ context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
					calls++
					if calls == 1 {
						want := strings.Fields("run list --workflow go.yml --branch poc/go --status success --limit 1 --json databaseId,headSha,number --repo tmt-ninja/tmt")
						if !reflect.DeepEqual(spec.Args, want) {
							t.Fatalf("listing argv = %v", spec.Args)
						}
						return ports.Bounded{Stdout: []byte(`[{"databaseId":123,"headSha":"abcdef0123456789abcdef0123456789abcdef01","number":5}]`)}, nil
					}
					want := []string{"run", "download", "123", "--name", "tmt-go", "--dir"}
					if calls != 2 || len(spec.Args) != 9 || !reflect.DeepEqual(spec.Args[:6], want) || !reflect.DeepEqual(spec.Args[7:], []string{"--repo", repository}) {
						t.Fatalf("download argv = %v", spec.Args)
					}
					actual := binary
					if corrupt {
						actual = []byte("different bytes")
					}
					chosen := flavor.Binary + "-darwin-arm64"
					other := "tmt-darwin-arm64"
					if flavor.NativeCompatible {
						other = "tmt-go-darwin-arm64"
					}
					otherBytes := []byte("other build flavor")
					manifest := fmt.Sprintf("%s  %s\n%x  %s\n", digest, chosen, sha256.Sum256(otherBytes), other)
					for name, content := range map[string][]byte{
						chosen: actual, other: otherBytes, "SHA256SUMS": []byte(manifest),
					} {
						if err := os.WriteFile(filepath.Join(spec.Args[6], name), content, 0600); err != nil {
							t.Fatal(err)
						}
					}
					return ports.Bounded{}, nil
				}),
			}
			artifact, err := source.Latest(t.Context(), "darwin", "arm64")
			if corrupt {
				if err == nil || !strings.Contains(err.Error(), "SHA256 verification failed") {
					t.Fatalf("corrupt artifact returned %v, %v", artifact, err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if artifact.Version != "0.0.0-go.5+abcdef0123" || artifact.URL != runURL+"123" || artifact.SHA256 != digest {
				t.Fatalf("artifact = %+v", artifact)
			}
			got, err := source.Fetch(t.Context(), artifact)
			if err != nil || string(got) != string(binary) || calls != 2 {
				t.Fatalf("Fetch = %q, %v after %d gh calls", got, err, calls)
			}
		})
	}
}
