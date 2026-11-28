//go:build darwin || linux

package channel

import (
	"context"
	"errors"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestClaudeSocketPathBoundIncludesAllBytes(t *testing.T) {
	suffix := filepath.Join("channels", testBinding+".sock")
	for _, width := range []int{99, 100, 101, 104} {
		root := home.Root{Dir: "/" + strings.Repeat("a", width-len(suffix)-2)}
		path := socketPath(root, testBinding)
		if len(path) != width || filepath.Dir(path) != ClaudeDirectory(root) ||
			validClaudeDirectory(root) != (width <= 100) {
			t.Errorf("path width %d: %q, accepted %v", width, path, validClaudeDirectory(root))
		}
		if width > 100 {
			runner := testRunner(func(context.Context, ports.ProcessSpec) (ports.Bounded, error) {
				t.Fatal("an oversized socket path reached provider preflight")
				return ports.Bounded{}, nil
			})
			if _, err := PreflightClaude(t.Context(), runner, root, "/fake/claude"); !errors.Is(err, ErrEnrollment) {
				t.Errorf("width %d: preflight error = %v", width, err)
			}
		}
	}
}
