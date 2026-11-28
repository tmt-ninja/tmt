package channel

import (
	"errors"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/home"
)

func TestClaudeServerArgumentsPinInvocationRoot(t *testing.T) {
	root := home.Root{Dir: "/tmp/tmt-go-fixture"}
	args := []string{"claude", testBinding, otherBinding, ClaudeDirectory(root)}
	want := ClaudeServeRequest{Root: root, BindingID: testBinding, Generation: otherBinding, Build: "fixture"}
	if got, err := ParseClaudeServeRequest(root, args, "fixture"); err != nil || got != want {
		t.Fatalf("server coordinates = %+v, %v", got, err)
	}
	for _, args := range [][]string{
		{"claude", testBinding, otherBinding, "/tmp/native-root/channels"},
		{"claude", testBinding, otherBinding, ClaudeDirectory(root) + "/../channels"},
		{"codex", testBinding, otherBinding, ClaudeDirectory(root)},
		{"claude", "../binding", otherBinding, ClaudeDirectory(root)},
	} {
		if _, err := ParseClaudeServeRequest(root, args, "fixture"); !errors.Is(err, ErrEnrollment) {
			t.Fatalf("accepted mismatched coordinates %q: %v", args, err)
		}
	}
}
