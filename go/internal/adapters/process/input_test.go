//go:build darwin || linux

package process

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestReadInputFileBoundsOpenedRegularFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "body")
	body := []byte{0, 255, '\r', '\n', 'x'}
	if err := os.WriteFile(path, body, 0600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if got, err := ReadInputFile(link, 3); err != nil || !bytes.Equal(got, body[:4]) {
		t.Fatalf("bounded file = %q, %v", got, err)
	}
	fifo := filepath.Join(dir, "fifo")
	if output, err := exec.CommandContext(t.Context(), "/usr/bin/mkfifo", fifo).CombinedOutput(); err != nil {
		t.Fatalf("create private FIFO: %v, %s", err, output)
	}
	for _, path := range []string{fifo, dir, filepath.Join(dir, "missing")} {
		if _, err := ReadInputFile(path, 3); !errors.Is(err, ErrInputFile) {
			t.Fatalf("ReadInputFile(%q) error = %v", path, err)
		}
	}
}

func TestReadInputStdinRequiresEOFUnlessOverflowed(t *testing.T) {
	for _, tc := range []struct {
		name    string
		maximum int
		close   bool
		want    string
		err     error
	}{
		{"complete", 3, true, "abc", nil},
		{"overflow", 2, false, "abc", nil},
		{"missing EOF", 3, false, "", ErrInputTimeout},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reader, writer, err := os.Pipe()
			if err != nil {
				t.Fatal(err)
			}
			defer reader.Close()
			defer writer.Close()
			if _, err := writer.WriteString("abc"); err != nil {
				t.Fatal(err)
			}
			if tc.close {
				if err := writer.Close(); err != nil {
					t.Fatal(err)
				}
			}
			timeout := time.Second
			if tc.err != nil {
				timeout = 25 * time.Millisecond
			}
			got, err := readInputStdin(reader, tc.maximum, timeout, time.Now)
			if string(got) != tc.want || !errors.Is(err, tc.err) {
				t.Fatalf("read = %q, %v, want %q, %v", got, err, tc.want, tc.err)
			}
			if _, err := reader.Stat(); err != nil {
				t.Fatalf("borrowed reader was closed: %v", err)
			}
		})
	}
}

func TestReadInputStdinDeadlineDoesNotRestartAfterProgress(t *testing.T) {
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	if _, err := writer.WriteString("partial body"); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	// Stage a successful payload read before the deadline, followed by an
	// EOF check at the original deadline. The read must not reset the budget.
	start := time.Now()
	elapsed := []time.Duration{0, 2 * time.Second, 3 * time.Second, 4 * time.Second, 5 * time.Second}
	now := func() time.Time {
		offset := elapsed[0]
		if len(elapsed) > 1 {
			elapsed = elapsed[1:]
		}
		return start.Add(offset)
	}
	got, err := readInputStdin(reader, 128, 5*time.Second, now)
	if got != nil || !errors.Is(err, ErrInputTimeout) {
		t.Fatalf("read with progress = %q, %v; want whole-read timeout and no partial bytes", got, err)
	}
}
