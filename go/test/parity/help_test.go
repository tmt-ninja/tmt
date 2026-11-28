package parity

import (
	"bytes"
	"context"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestHelpMatchesNative(t *testing.T) {
	native := nativeExecutable(t)
	world := t.TempDir()
	goBinary := filepath.Join(world, "tmt-go")
	build := exec.CommandContext(t.Context(), "go", "build", "-o", goBinary, "../../cmd/tmt-go")
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("build tmt-go: %v\n%s", err, out)
	}

	for _, columns := range []string{"80", "120"} {
		t.Run(columns, func(t *testing.T) {
			var visit func([]string)
			visit = func(path []string) {
				name := strings.Join(path, " ")
				if name == "" {
					name = "root"
				}
				t.Run(name, func(t *testing.T) {
					args := append(slices.Clone(path), "--help")
					want := helpOutput(t, world, native, columns, args)
					got := helpOutput(t, world, goBinary, columns, args)
					got = bytes.ReplaceAll(got, []byte("tmt-go"), []byte("tmt"))
					if !bytes.Equal(got, want) {
						reportHelpDifference(t, string(want), string(got))
					}
					for _, child := range helpSubcommands(t, string(want)) {
						visit(append(slices.Clone(path), child))
					}
				})
			}
			visit(nil)
		})
	}
}

func helpOutput(t *testing.T, world, binary, columns string, args []string) []byte {
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
		"COLUMNS=" + columns,
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil || stderr.Len() != 0 || len(out) == 0 {
		t.Fatalf("%s %q: %v, stdout %q, stderr %q", binary, args, err, out, &stderr)
	}
	return out
}

func helpSubcommands(t *testing.T, help string) []string {
	t.Helper()
	_, table, found := strings.Cut(help, "\nCommands:\n")
	if !found {
		return nil
	}
	var children []string
	for row := range strings.SplitSeq(table, "\n") {
		if !strings.HasPrefix(row, "  ") {
			break
		}
		fields := strings.Fields(row)
		if len(fields) == 0 {
			t.Fatalf("missing command name in native help row %q", row)
		}
		children = append(children, fields[0])
	}
	if len(children) == 0 {
		t.Fatal("native help has an empty Commands section")
	}
	return children
}

func reportHelpDifference(t *testing.T, want, got string) {
	t.Helper()
	wantLines := strings.Split(want, "\n")
	gotLines := strings.Split(got, "\n")
	for index := range max(len(wantLines), len(gotLines)) {
		if index >= len(wantLines) || index >= len(gotLines) {
			t.Errorf("help has %d lines, native has %d", len(gotLines), len(wantLines))
			return
		}
		if wantLines[index] != gotLines[index] {
			t.Errorf("help differs at line %d\nnative: %q\nGo:     %q", index+1, wantLines[index], gotLines[index])
			return
		}
	}
}
