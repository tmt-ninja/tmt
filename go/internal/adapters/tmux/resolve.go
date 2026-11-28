package tmux

import (
	"context"
	"errors"
	"strings"
	"unicode"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

// ErrPaneNotFound means the lookup completed without a valid pane on the
// selected socket. Execution errors remain distinct.
var ErrPaneNotFound = errors.New("tmux pane target did not resolve")

// ResolvePane converts a native tmux target to the stable pane ID reported by
// the explicit socket. A missing or mismatched target never selects a fallback.
func (c Client) ResolvePane(ctx context.Context, socket, target string) (ports.PaneRef, error) {
	target = core.TargetText(target)
	if !core.IsPaneTarget(target) || (!validPane(target) && !strings.ContainsRune(target, '.')) ||
		strings.IndexFunc(target, unicode.IsControl) >= 0 {
		return ports.PaneRef{}, ErrPaneNotFound
	}
	output, err := c.run(ctx, socket, 1024, nil, "display-message", "-p", "-t", target,
		fields("socket_path", "pane_id"))
	if err != nil {
		return ports.PaneRef{}, err
	}
	row, ok := decodeRow(strings.TrimSuffix(output, "\n"), 2)
	if !ok || row[0] != socket || !validPane(row[1]) || (validPane(target) && target != row[1]) {
		return ports.PaneRef{}, ErrPaneNotFound
	}
	return ports.PaneRef{Server: socket, PaneID: row[1]}, nil
}
