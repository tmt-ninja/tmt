package clistyle

import (
	"os"

	"golang.org/x/term"
)

// Mode determines whether an invocation can involve a person.
type Mode uint8

const (
	Plain Mode = iota
	Interactive
)

// Interaction records the stream facts used to choose a view or a prompt.
type Interaction struct {
	JSON   bool
	Stdin  bool
	Stdout bool
	Stderr bool
	Dumb   bool
}

// DetectInteraction observes an invocation's streams once.
func DetectInteraction(json bool, stdin, stdout, stderr *os.File) Interaction {
	return Interaction{
		JSON:   json,
		Stdin:  isTerminal(stdin),
		Stdout: isTerminal(stdout),
		Stderr: isTerminal(stderr),
		Dumb:   os.Getenv("TERM") == "dumb",
	}
}

func isTerminal(file *os.File) bool {
	if file == nil {
		return false
	}
	conn, err := file.SyscallConn()
	if err != nil {
		return false
	}
	var ready bool
	err = conn.Control(func(fd uintptr) { ready = term.IsTerminal(int(fd)) })
	return err == nil && ready
}

// View draws on stdout and reads keys from stdin.
func (i Interaction) View() Mode {
	if !i.JSON && i.Stdin && i.Stdout && !i.Dumb {
		return Interactive
	}
	return Plain
}

// Prompt displays the question on stderr and reads the answer from stdin.
func (i Interaction) Prompt() Mode {
	if !i.JSON && i.Stdin && i.Stderr {
		return Interactive
	}
	return Plain
}

// MayColor reports whether presentation settings could affect a human stream.
func (i Interaction) MayColor() bool {
	return !i.JSON && (i.Stdout || i.Stderr)
}
