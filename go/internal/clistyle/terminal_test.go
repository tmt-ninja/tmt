package clistyle

import (
	"os"
	"testing"
)

func TestTerminalWidthFallback(t *testing.T) {
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = read.Close()
		_ = write.Close()
	})
	for _, stream := range []*os.File{nil, write} {
		if cols, known := ProbeWidth(stream); cols != 0 || known {
			t.Errorf("ProbeWidth = %d, %t", cols, known)
		}
		if cols := TerminalWidth(stream); cols != 80 {
			t.Errorf("TerminalWidth = %d, want 80", cols)
		}
	}
}
