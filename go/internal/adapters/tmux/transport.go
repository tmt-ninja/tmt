package tmux

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const sendMaxBytes = 64 * 1024

var paneInput = strings.NewReplacer("\x1b[200~", "␛[200~", "\x1b[201~", "␛[201~", "!", "！")

// Deliver sends a bracketed paste and then the submit plan. Once paste starts,
// every failure is uncertain, including a canceled pause before a submit key.
func (c Client) Deliver(ctx context.Context, pane ports.PaneRef, in ports.DeliveryInput) (ports.DeliveryOutcome, error) {
	if err := ctx.Err(); err != nil {
		return ports.DeliveryNotStarted, err
	}
	if !validSocket(pane.Server) || !validPane(pane.PaneID) || strings.ContainsRune(in.Text, 0) {
		return ports.DeliveryNotStarted, errors.New("invalid tmux pane or delivery text")
	}
	if in.Submit == nil {
		in.Submit = []ports.KeyStep{{Key: "Enter"}}
	}
	for _, step := range in.Submit {
		if (step.Key == "") == (step.Literal == "") || step.Pause < 0 ||
			strings.ContainsAny(step.Key, ";\t\r\n\x00") ||
			strings.IndexFunc(step.Literal, unicode.IsControl) >= 0 {
			return ports.DeliveryNotStarted, errors.New("invalid tmux submit step")
		}
	}

	text := paneInput.Replace(in.Text)
	if !strings.HasSuffix(text, "\n") {
		text += "\n"
	}
	var nonce [16]byte
	rand.Read(nonce[:])
	buffer := "tmt-go-" + hex.EncodeToString(nonce[:])
	cleanup := func() {
		// The buffer is ours, and removing it cannot deliver any pane input.
		_, _ = c.run(context.WithoutCancel(ctx), pane.Server, sendMaxBytes, nil, "delete-buffer", "-b", buffer)
	}
	if _, err := c.run(ctx, pane.Server, sendMaxBytes, []byte(text), "load-buffer", "-b", buffer, "-"); err != nil {
		cleanup()
		return ports.DeliveryNotStarted, err
	}
	if err := ctx.Err(); err != nil {
		cleanup()
		return ports.DeliveryNotStarted, err
	}
	if _, err := c.run(ctx, pane.Server, sendMaxBytes, nil, "paste-buffer", "-d", "-p", "-b", buffer, "-t", pane.PaneID); err != nil {
		cleanup()
		return ports.DeliveryUncertain, err
	}
	for _, step := range in.Submit {
		args := []string{"send-keys", "-t", pane.PaneID}
		if step.Key != "" {
			args = append(args, "--", step.Key)
		} else {
			args = append(args, "-l", "--", tmuxArg(paneInput.Replace(step.Literal)))
		}
		if _, err := c.run(ctx, pane.Server, sendMaxBytes, nil, args...); err != nil {
			return ports.DeliveryUncertain, err
		}
		if step.Pause != 0 {
			timer := time.NewTimer(step.Pause)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ports.DeliveryUncertain, ctx.Err()
			case <-timer.C:
			}
		}
	}
	return ports.DeliveryDelivered, nil
}

// Launch opens a window in an existing, exact session on the selected socket.
// NOT PORTED (#6938): creating a missing session requires a private-server
// guarantee that the current launch port cannot express.
func (c Client) Launch(ctx context.Context, spec ports.LaunchSpec) (ports.PaneRef, error) {
	id, err := c.launchWindow(ctx, spec, "#{pane_id}")
	if err != nil {
		return ports.PaneRef{}, err
	}
	if !validPane(id) {
		return ports.PaneRef{}, errors.New("tmux launch returned an invalid pane ID")
	}
	return ports.PaneRef{Server: spec.Server, PaneID: id}, nil
}

func (c Client) launchWindow(ctx context.Context, spec ports.LaunchSpec, format string) (string, error) {
	if spec.Session == "" || strings.ContainsAny(spec.Session, ":.\x00") ||
		strings.IndexFunc(spec.Session, unicode.IsControl) >= 0 {
		return "", errors.New("invalid tmux session name")
	}
	if !filepath.IsAbs(spec.Command.Path) || len(spec.Command.Stdin) != 0 {
		return "", errors.New("launch requires an absolute executable and no redirected input")
	}
	dir := spec.Dir
	if dir == "" {
		dir = spec.Command.Dir
	}
	if dir != "" && (!filepath.IsAbs(dir) || strings.ContainsAny(dir, "#\x00") || strings.HasSuffix(dir, ";")) {
		return "", errors.New("invalid tmux launch directory")
	}
	if strings.ContainsAny(spec.Window, "#\x00") || strings.HasSuffix(spec.Window, ";") ||
		strings.IndexFunc(spec.Window, unicode.IsControl) >= 0 {
		return "", errors.New("invalid tmux launch window")
	}

	// Give tmux the environment overlay separately so it keeps the pane's
	// TMUX/TMUX_PANE values and never records the overlay in pane_start_command.
	args := []string{"new-window", "-d", "-P", "-F", format, "-t", "=" + spec.Session + ":"}
	for _, entry := range spec.Command.Env {
		name, _, ok := strings.Cut(entry, "=")
		if !ok || name == "" || strings.HasPrefix(name, "-") || strings.ContainsRune(entry, 0) {
			return "", errors.New("invalid child environment entry")
		}
		if name != "TMUX" && name != "TMUX_PANE" {
			args = append(args, "-e", tmuxArg(entry))
		}
	}

	// A single command is passed to the session shell. Quote each word so
	// whitespace and metacharacters are preserved in the original argv.
	argv := append([]string{spec.Command.Path}, spec.Command.Args...)
	for i, arg := range argv {
		if strings.ContainsRune(arg, 0) {
			return "", errors.New("launch arguments cannot contain NUL")
		}
		argv[i] = "'" + strings.ReplaceAll(arg, "'", "'\\''") + "'"
	}
	if spec.Window != "" {
		args = append(args, "-n", spec.Window)
	}
	if dir != "" {
		args = append(args, "-c", dir)
	}
	args = append(args, "--", "exec "+strings.Join(argv, " "))
	output, err := c.run(ctx, spec.Server, 1024, nil, args...)
	if err != nil {
		return "", fmt.Errorf("launch in %q: %w", spec.Session, err)
	}
	return strings.TrimSuffix(output, "\n"), nil
}

// A trailing semicolon otherwise starts a new tmux command, even after --.
func tmuxArg(s string) string {
	if text, found := strings.CutSuffix(s, ";"); found {
		return text + `\;`
	}
	return s
}

var _ ports.Host = Client{}
