package framedstdio

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"testing"
	"time"
)

func TestPipelinedFramesHaveIndependentDeadlines(t *testing.T) {
	input, client := pipe(t)
	reader := NewReader(input, 64)
	now := time.Now()
	reader.now = func() time.Time { return now }
	put(t, client, "0\n1")
	expectFrame(t, reader, "0\n")
	for i := 1; i < 8; i++ {
		now = now.Add(4 * time.Second)
		put(t, client, fmt.Sprintf("\n%d", i+1))
		expectFrame(t, reader, fmt.Sprintf("%d\n", i))
	}
	now = now.Add(ioTimeout + 4*time.Second)
	put(t, client, "\n")
	expectFrame(t, reader, "8\n")
	closeFile(t, client)
	expectReadError(t, reader, io.EOF)
}

func TestPartialFrameTimesOutAtItsOwnDeadline(t *testing.T) {
	for _, elapsed := range []time.Duration{ioTimeout, ioTimeout - time.Millisecond} {
		t.Run(elapsed.String(), func(t *testing.T) {
			input, client := pipe(t)
			reader := NewReader(input, 64)
			put(t, client, "0\n1")
			expectFrame(t, reader, "0\n")
			if elapsed < ioTimeout {
				put(t, client, "\n")
			}
			closeFile(t, client)

			start := time.Now()
			first := true
			reader.now = func() time.Time {
				if first {
					first = false
					return start
				}
				return start.Add(elapsed)
			}
			if elapsed == ioTimeout {
				expectReadError(t, reader, ErrDeadline)
				return
			}
			expectFrame(t, reader, "1\n")
		})
	}
}

func TestFrameBoundsAndEOF(t *testing.T) {
	t.Run("empty frame at zero byte bound", func(t *testing.T) {
		input, client := pipe(t)
		reader := NewReader(input, 0)
		put(t, client, "\n")
		closeFile(t, client)
		expectFrame(t, reader, "\n")
		expectReadError(t, reader, io.EOF)
	})
	t.Run("exact and oversized", func(t *testing.T) {
		input, client := pipe(t)
		reader := NewReader(input, 4)
		put(t, client, "1234\n12345\n")
		expectFrame(t, reader, "1234\n")
		expectReadError(t, reader, ErrInputBound)
	})
	t.Run("oversized without delimiter", func(t *testing.T) {
		input, client := pipe(t)
		put(t, client, "12345")
		expectReadError(t, NewReader(input, 4), ErrInputBound)
	})
	t.Run("partial EOF", func(t *testing.T) {
		input, client := pipe(t)
		reader := NewReader(input, 4)
		put(t, client, "1\n2")
		closeFile(t, client)
		expectFrame(t, reader, "1\n")
		expectReadError(t, reader, ErrIncomplete)
	})
	t.Run("empty EOF", func(t *testing.T) {
		input, client := pipe(t)
		closeFile(t, client)
		expectReadError(t, NewReader(input, 4), io.EOF)
	})
}

func TestPublishRejectsInvalidFramesBeforeWriting(t *testing.T) {
	input, output := pipe(t)
	if err := RequireRedirected(input, output); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range [][]byte{[]byte("12345"), []byte("a\nb")} {
		if err := Publish(output, invalid, 4); !errors.Is(err, ErrInvalidOutput) {
			t.Fatalf("invalid Publish = %v", err)
		}
	}
	if err := PublishProgress(t.Context(), output, []byte("1234"), 4, time.Now().Add(-time.Second)); !errors.Is(err, ErrDeadline) {
		t.Fatalf("expired PublishProgress = %v", err)
	}
	if err := Publish(output, []byte("1234"), 4); err != nil {
		t.Fatal(err)
	}
	closeFile(t, output)
	got, err := io.ReadAll(input)
	if err != nil || string(got) != "1234\n" {
		t.Fatalf("published %q, %v", got, err)
	}
}

func TestProgressCancellationDistinguishesPartialPublication(t *testing.T) {
	t.Run("before writing", func(t *testing.T) {
		input, output := pipe(t)
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		err := PublishProgress(ctx, output, []byte("progress"), 64, time.Now().Add(ioTimeout))
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("PublishProgress = %v", err)
		}
		closeFile(t, output)
		if got, err := io.ReadAll(input); len(got) != 0 || err != nil {
			t.Fatalf("cancellation published %q: %v", got, err)
		}
	})

	t.Run("after a chunk", func(t *testing.T) {
		input, output := pipe(t)
		body := bytes.Repeat([]byte("a"), pipeChunk+1)
		calls := 0
		err := publishFrame(output, body, len(body), func() error {
			calls++
			if calls > 1 {
				return context.Canceled
			}
			return nil
		})
		if !errors.Is(err, ErrIncomplete) {
			t.Fatalf("partial PublishProgress = %v", err)
		}
		closeFile(t, output)
		if got, err := io.ReadAll(input); !bytes.Equal(got, body[:pipeChunk]) || err != nil {
			t.Fatalf("partial publication wrote %d bytes: %v", len(got), err)
		}
	})
}

func pipe(t *testing.T) (*os.File, *os.File) {
	t.Helper()
	input, output, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = input.Close()
		_ = output.Close()
	})
	return input, output
}

func put(t *testing.T, client *os.File, content string) {
	t.Helper()
	if _, err := client.WriteString(content); err != nil {
		t.Fatal(err)
	}
}

func closeFile(t *testing.T, file *os.File) {
	t.Helper()
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

func expectFrame(t *testing.T, reader *Reader, want string) {
	t.Helper()
	got, err := reader.ReadFrame()
	if err != nil || string(got) != want {
		t.Fatalf("ReadFrame = %q, %v; want %q", got, err, want)
	}
}

func expectReadError(t *testing.T, reader *Reader, want error) {
	t.Helper()
	got, err := reader.ReadFrame()
	if got != nil || !errors.Is(err, want) {
		t.Fatalf("ReadFrame = %q, %v; want %v", got, err, want)
	}
}
