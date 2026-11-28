package ptyprotocol

import (
	"strings"
	"testing"
)

func TestRawC1AndEscapeIntermediatesCannotLeakContents(t *testing.T) {
	raw := []byte("a\x9d52;hidden\x9cb\x1b(Bc\x9b31md\x90payload\x1b\\e\xc5\x9df")
	if got := SanitizeOutput(raw); got != "abcdeŝf" {
		t.Errorf("SanitizeOutput = %q, want %q", got, "abcdeŝf")
	}
	var out OutputSanitizer
	var b strings.Builder
	for _, ch := range raw {
		b.WriteString(out.Push([]byte{ch}))
	}
	if got := b.String(); got != "abcdeŝf" {
		t.Errorf("byte-by-byte OutputSanitizer = %q, want %q", got, "abcdeŝf")
	}
}

func TestEveryByteBoundaryKeepsEscapePayloadsOutAndCompleteGlyphsIn(t *testing.T) {
	raw := []byte("first\r\n\x1b]52;clipboard\x1bXstill-hidden\x1b\\\x1b[31m界\u202e\t\u009dhidden\u009cend")
	var out OutputSanitizer
	var b strings.Builder
	for _, ch := range raw {
		b.WriteString(out.Push([]byte{ch}))
	}
	const want = "first\n界    end"
	if got := b.String(); got != want {
		t.Errorf("byte-by-byte = %q, want %q", got, want)
	}
	if got := SanitizeOutput(raw); got != want {
		t.Errorf("SanitizeOutput = %q, want %q", got, want)
	}
	if got := SanitizeOutput([]byte("end\xe7")); got != "end\ufffd" {
		t.Errorf("truncated UTF-8 = %q, want %q", got, "end\ufffd")
	}
	if got := out.Push([]byte("\xffnext")); got != "\ufffdnext" {
		t.Errorf("invalid byte + next = %q, want %q", got, "\ufffdnext")
	}
}
