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

// OutputTerminal decides how a human output stream renders. JSON is plain
// and unbounded. A terminal with no usable width also leaves values whole.
func OutputTerminal(stream *os.File, json bool, theme *Theme) Terminal {
	if json {
		return Terminal{}
	}
	result := streamTerminal(stream, theme)
	if columns, ok := ProbeWidth(stream); ok {
		result.Width = &columns
	}
	return result
}

// DiagnosticTerminal styles diagnostic text without constraining its width.
func DiagnosticTerminal(stream *os.File, theme *Theme) Terminal {
	return streamTerminal(stream, theme)
}

func streamTerminal(stream *os.File, theme *Theme) Terminal {
	depth := streamDepth(isTerminal(stream), os.LookupEnv)
	if depth == NoColor {
		return Terminal{}
	}
	return Terminal{Depth: depth, Theme: theme}
}

func streamDepth(isTerm bool, lookup func(string) (string, bool)) Depth {
	noColor, _ := lookup("NO_COLOR")
	if noColor != "" {
		return NoColor
	}
	force, _ := lookup("CLICOLOR_FORCE")
	if force == "" {
		if !isTerm {
			return NoColor
		}
		cliColor, cliColorSet := lookup("CLICOLOR")
		if cliColorSet && cliColor == "0" {
			return NoColor
		}
		term, termSet := lookup("TERM")
		_, ci := lookup("CI")
		if !cliColorSet && !ci && (!termSet || term == "dumb") {
			return NoColor
		}
	}
	depth, _ := lookup("COLORTERM")
	if depth == "24bit" || depth == "truecolor" {
		return TrueColor
	}
	return ANSI16
}
