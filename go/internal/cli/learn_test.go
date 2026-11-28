package cli

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/skills"
)

func TestLearnReadsBundledGuidanceWithoutState(t *testing.T) {
	root := filepath.Join(t.TempDir(), "unused")
	t.Setenv("TMT_GO_HOME", root)

	for _, tc := range []struct {
		skill  string
		option []string
	}{
		{"tmt", []string{"--skill"}},
		{"tmt", []string{"--skill=tmt"}},
		{"tmt-inbox", []string{"--skill", "tmt-inbox"}},
	} {
		var stdout, stderr bytes.Buffer
		args := append([]string{"learn"}, tc.option...)
		status := (application{}).run(t.Context(), args, &stdout, &stderr)
		want, err := skills.ReadGuide(tc.skill)
		if err != nil || status != 0 || stderr.Len() != 0 || !bytes.Equal(stdout.Bytes(), want) {
			t.Fatalf("%v exit %d, stderr %q, guide match %v, guide error %v", args, status, &stderr, bytes.Equal(stdout.Bytes(), want), err)
		}
	}
	for _, tc := range []struct {
		args           []string
		stdout, stderr string
		status         int
	}{
		{[]string{"--json"}, `{"error":{"code":"JSON_UNSUPPORTED","message":"This command does not support --json."}}` + "\n", "", 1},
		{[]string{"--skill", "tmt-inbox", "--topics"}, "", "The tmt-inbox skill has no reference topics", 1},
		{[]string{"--topics"}, "", "the following required arguments were not provided:", 1},
		{[]string{"--skill", "tmt", "--topics", "run"}, "", "the argument '--topics' cannot be used with '[TOPIC]'", 1},
	} {
		var stdout, stderr bytes.Buffer
		args := append([]string{"learn"}, tc.args...)
		if status := (application{}).run(t.Context(), args, &stdout, &stderr); status != tc.status || stdout.String() != tc.stdout || !strings.Contains(stderr.String(), tc.stderr) {
			t.Fatalf("%v exit %d, stdout %q, stderr %q", args, status, &stdout, &stderr)
		}
	}
	var quickStart, stderr bytes.Buffer
	if status := (application{}).run(t.Context(), []string{"learn"}, &quickStart, &stderr); status != 0 || stderr.Len() != 0 ||
		!strings.Contains(quickStart.String(), "tmt-go learn --skill") {
		t.Fatalf("quick start: exit %d, stdout %q, stderr %q", status, &quickStart, &stderr)
	}
	if _, err := os.Stat(root); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("learn touched the data root: %v", err)
	}
}
