package clistyle

import (
	"io"
	"strings"
)

func WriteSuccess(output io.Writer, term Terminal, text string) error {
	return writeMessageLine(output, term, MarkDone.Token(), MarkDone.Symbol(), text)
}

func WriteError(output io.Writer, term Terminal, text, hint string) error {
	return writeDiagnostic(output, term, TokenError, "error:", text, hint)
}

func WriteWarning(output io.Writer, term Terminal, text, hint string) error {
	return writeDiagnostic(output, term, TokenWarn, "warning:", text, hint)
}

func WriteHint(output io.Writer, term Terminal, text string) error {
	return writeMessageLine(output, term, TokenAccent, "hint:", text)
}

func WriteFix(output io.Writer, term Terminal, text string) error {
	return writeMessageLine(output, term, TokenAccent, "fix:", text)
}

func writeDiagnostic(output io.Writer, term Terminal, token Token, label, text, hint string) error {
	if err := writeMessageLine(output, term, token, label, text); err != nil {
		return err
	}
	if hint != "" {
		return WriteHint(output, term, hint)
	}
	return nil
}

func writeMessageLine(output io.Writer, term Terminal, token Token, label, text string) error {
	if !strings.HasSuffix(text, "..") {
		text = strings.TrimSuffix(text, ".")
	}
	_, err := io.WriteString(output, term.Paint(token, label)+" "+Escape(text)+"\n")
	return err
}
