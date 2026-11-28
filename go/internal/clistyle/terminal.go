package clistyle

import (
	"os"

	"golang.org/x/term"
)

// TerminalWidth returns the stream's column count or 80 when unavailable.
// A renderer that leaves redirected text unbounded can use ProbeWidth.
func TerminalWidth(stream *os.File) int {
	if cols, ok := ProbeWidth(stream); ok {
		return cols
	}
	return SmallWidth
}

// ProbeWidth reports a positive terminal column count when one is available.
func ProbeWidth(stream *os.File) (int, bool) {
	if stream == nil {
		return 0, false
	}
	conn, err := stream.SyscallConn()
	if err != nil {
		return 0, false
	}
	var cols int
	var probeErr error
	err = conn.Control(func(fd uintptr) {
		cols, _, probeErr = term.GetSize(int(fd))
	})
	if err != nil || probeErr != nil || cols <= 0 {
		return 0, false
	}
	return cols, true
}
