//go:build darwin || linux

package process

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"testing"
	"time"
)

func TestWriteHandoffPublishesExactBytes(t *testing.T) {
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer read.Close()
	defer write.Close()
	ctx, cancel := context.WithTimeout(t.Context(), time.Second)
	defer cancel()
	body := []byte(`{"decision":"block"}`)
	if n, err := WriteHandoff(ctx, write, body); err != nil || n != len(body) {
		t.Fatalf("complete handoff = %d, %v", n, err)
	}
	if err := write.Close(); err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(read)
	if err != nil || !bytes.Equal(got, body) {
		t.Fatalf("handoff bytes = %q, %v", got, err)
	}
}

func TestWriteHandoffDistinguishesBlockedPartialAndExpired(t *testing.T) {
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer read.Close()
	defer write.Close()
	expired, cancel := context.WithDeadline(t.Context(), time.Now())
	defer cancel()
	if n, err := WriteHandoff(expired, write, []byte("nothing")); n != 0 || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expired handoff = %d, %v", n, err)
	}
	ctx, stop := context.WithTimeout(t.Context(), 80*time.Millisecond)
	defer stop()
	payload := bytes.Repeat([]byte("x"), 4*1024*1024)
	n, err := WriteHandoff(ctx, write, payload)
	if n <= 0 || n >= len(payload) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("blocked handoff = %d, %v", n, err)
	}
	if err := write.Close(); err != nil {
		t.Fatal(err)
	}
	got, err := io.ReadAll(read)
	if err != nil || !bytes.Equal(got, payload[:n]) {
		t.Fatalf("reader got %d bytes, writer reported %d: %v", len(got), n, err)
	}
}
