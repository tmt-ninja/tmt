package drivers_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/gemini"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestProviderScreenFixtures(t *testing.T) {
	for _, d := range []ports.Driver{claude.Driver{}, codex.Driver{}, gemini.Driver{}} {
		for _, tc := range []struct {
			name string
			want ports.DriverState
		}{
			{"idle", ports.DriverIdle}, {"busy", ports.DriverBusy},
		} {
			name := d.Name() + "-" + tc.name
			t.Run(name, func(t *testing.T) {
				contents, err := os.ReadFile(filepath.Join("testdata", name+".txt"))
				if err != nil {
					t.Fatal(err)
				}
				if got := d.Classify(ports.Screen{Text: string(contents)}); got != tc.want {
					t.Fatalf("Classify = %v, want %v", got, tc.want)
				}
			})
		}
	}
}

func TestCodexComposerMustStillBeVisibleAtBottom(t *testing.T) {
	const prompt = "› Ask Codex to do anything"
	for _, tc := range []struct {
		screen string
		want   ports.DriverState
	}{
		{"\x1b[2m" + prompt + "\x1b[0m\n← for agents · ? for shortcuts\n", ports.DriverIdle},
		{prompt + "\nThe next response starts here.\n", ports.DriverUnknown},
		{"Would you like to run the following command?\n" + prompt, ports.DriverPrompt},
		{"• Working (2m 18s • esc to interrupt)\n" + strings.Repeat("\n", 12) + prompt, ports.DriverIdle},
	} {
		if got := (codex.Driver{}).Classify(ports.Screen{Text: tc.screen}); got != tc.want {
			t.Errorf("Classify(%q) = %v, want %v", tc.screen, got, tc.want)
		}
	}
}
