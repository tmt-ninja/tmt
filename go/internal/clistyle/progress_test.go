package clistyle

import (
	"bufio"
	"strings"
	"testing"
	"time"
)

func TestProgressSnapshot(t *testing.T) {
	progress := NewProgress("Installing example 0.1.0-alpha.2", false)
	progress.Update(StepProgress{
		Step: StepDownload, State: ProgressDone,
		Transfer: &Transfer{ReceivedBytes: 6_400_000, TotalBytes: 6_400_000, Elapsed: 2 * time.Second},
	})
	progress.Update(StepProgress{Step: StepVerify, State: ProgressDone, Detail: "checksum matches the release record; archive checked"})
	progress.Update(StepProgress{Step: StepActivate, State: ProgressRunning, Detail: "settling bundled agent skills"})
	width := 96
	renderGolden(t, `  Installing example 0.1.0-alpha.2
  ✓ Download     ━━━━━━━━━━━━━━━━━━━━━━━━  6.4 MB of 6.4 MB
  ✓ Verify       checksum matches the release record; archive checked
  ⠹ Activate     settling bundled agent skills
`, func(out *strings.Builder) error {
		return progress.Write(out, Terminal{Width: &width})
	})
}

func TestProgressReportsOnlyObservedTransferCounts(t *testing.T) {
	progress := NewProgress("Installing example", false)
	progress.SetFrame(11)
	var out strings.Builder
	for _, tc := range []struct {
		transfer Transfer
		want     string
	}{
		{Transfer{ReceivedBytes: 4_000_000, TotalBytes: 6_400_000, Elapsed: 2 * time.Second}, "4.0 MB of 6.4 MB · 2.0 MB/s"},
		{Transfer{ReceivedBytes: 42}, "42 B downloaded"},
	} {
		progress.Update(StepProgress{Step: StepDownload, State: ProgressRunning, Transfer: &tc.transfer})
		out.Reset()
		if err := progress.Write(&out, Terminal{}); err != nil {
			t.Fatal(err)
		}
		got := out.String()
		if strings.ContainsRune(got, '\x1b') || !strings.Contains(got, tc.want) || !strings.Contains(got, "⠙ Download") || !progress.Running() {
			t.Fatalf("progress = %q, want plain progress including %q", got, tc.want)
		}
	}
}

func TestProgressFitsEscapedDataOnNarrowOutput(t *testing.T) {
	progress := NewProgress("Installing\x1b[2J", false)
	progress.Update(StepProgress{Step: StepActivate, State: ProgressWarning, Detail: "skills warning\nretry"})
	width := 26
	var out strings.Builder
	if err := progress.Write(&out, Terminal{Width: &width}); err != nil {
		t.Fatal(err)
	}
	text := out.String()
	if strings.ContainsRune(text, '\x1b') || strings.Count(text, "\n") != 4 {
		t.Fatalf("narrow progress = %q", text)
	}
	for line := range strings.SplitSeq(strings.TrimSuffix(text, "\n"), "\n") {
		if DisplayWidth(line) > width {
			t.Errorf("progress line exceeded %d columns: %q", width, line)
		}
	}
}

func TestLiveProgressRepaintsAndFlushesItsOwnRows(t *testing.T) {
	progress := NewProgress("Installing example", true)
	var out strings.Builder
	buffer := bufio.NewWriter(&out)
	if err := HideCursor(buffer); err != nil {
		t.Fatal(err)
	}
	if out.String() != "\x1b[?25l" {
		t.Fatalf("hide sequence = %q", out.String())
	}
	out.Reset()
	if err := progress.Write(buffer, Terminal{}); err != nil {
		t.Fatal(err)
	}
	initial := out.String()
	if strings.Contains(initial, "\x1b[4A") || strings.Count(initial, "\r\x1b[2K") != 4 {
		t.Fatalf("initial progress = %q", initial)
	}
	out.Reset()
	if err := progress.Write(buffer, Terminal{}); err != nil {
		t.Fatal(err)
	}
	if out.String() != "\x1b[4A"+initial {
		t.Fatalf("repaint = %q", out.String())
	}
	out.Reset()
	if err := ShowCursor(buffer); err != nil {
		t.Fatal(err)
	}
	if out.String() != "\x1b[?25h" {
		t.Fatalf("show sequence = %q", out.String())
	}
}

func TestInteractionUsesTheStreamsForEachMode(t *testing.T) {
	for _, tc := range []struct {
		facts  Interaction
		view   Mode
		prompt Mode
		color  bool
	}{
		{Interaction{Stdin: true, Stdout: true, Stderr: true}, Interactive, Interactive, true},
		{Interaction{JSON: true, Stdin: true, Stdout: true, Stderr: true}, Plain, Plain, false},
		{Interaction{Stdin: true, Stderr: true}, Plain, Interactive, true},
		{Interaction{Stdin: true, Stdout: true}, Interactive, Plain, true},
		{Interaction{Stdout: true, Stderr: true}, Plain, Plain, true},
		{Interaction{Dumb: true, Stdin: true, Stdout: true, Stderr: true}, Plain, Interactive, true},
		{Interaction{}, Plain, Plain, false},
	} {
		if tc.facts.View() != tc.view || tc.facts.Prompt() != tc.prompt || tc.facts.MayColor() != tc.color {
			t.Errorf("unexpected modes for %+v", tc.facts)
		}
	}
	t.Setenv("TERM", "dumb")
	if got := DetectInteraction(false, nil, nil, nil); got != (Interaction{Dumb: true}) {
		t.Errorf("DetectInteraction = %+v", got)
	}
}
