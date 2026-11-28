package mcp

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/framedstdio"
)

func TestInputBoundExcludesLF(t *testing.T) {
	for _, tc := range []struct {
		name  string
		size  int
		err   error
		calls int
	}{
		{"at bound", 6_365_184, nil, 1},
		{"over bound", 6_365_185, framedstdio.ErrInputBound, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ping := []byte(`{"jsonrpc":"2.0","id":1,"method":"ping"}`)
			frame := make([]byte, 0, tc.size+1)
			frame = append(frame, ping...)
			frame = append(frame, bytes.Repeat([]byte(" "), tc.size-len(ping))...)
			frame = append(frame, '\n')
			input, output := transportFiles(t, frame)
			calls := 0
			err := ServeTransport(input, output, func(got []byte) ([]byte, error) {
				calls++
				if !bytes.Equal(got, frame) {
					t.Fatalf("MCP frame = %d bytes; want %d bytes including LF", len(got), len(frame))
				}
				return []byte(`{"jsonrpc":"2.0","id":1,"result":{}}`), nil
			})
			if !errors.Is(err, tc.err) || calls != tc.calls {
				t.Fatalf("transport returned %v with %d calls", err, calls)
			}
		})
	}
}

func TestTransportDoesNotRespondToNotificationsAndRejectsPartialEOF(t *testing.T) {
	input, output := transportFiles(t, []byte("notification\nrequest\npartial"))
	err := ServeTransport(input, output, func(frame []byte) ([]byte, error) {
		switch string(frame) {
		case "notification\n":
			return nil, nil
		case "request\n":
			return []byte(`{}`), nil
		default:
			t.Fatalf("unexpected frame %q", frame)
			return nil, nil
		}
	})
	if !errors.Is(err, framedstdio.ErrIncomplete) {
		t.Fatalf("transport returned %v", err)
	}
	data, err := os.ReadFile(output.Name())
	if err != nil || string(data) != "{}\n" {
		t.Fatalf("stdout = %q, %v", data, err)
	}
}

func TestOutputBoundIncludesLF(t *testing.T) {
	input, output := transportFiles(t, []byte("at bound\nover bound\n"))
	atBound := bytes.Repeat([]byte(" "), 38_010_879)
	overBound := append(bytes.Clone(atBound), ' ')
	err := ServeTransport(input, output, func(frame []byte) ([]byte, error) {
		if strings.HasPrefix(string(frame), "at") {
			return atBound, nil
		}
		return overBound, nil
	})
	if !errors.Is(err, framedstdio.ErrInvalidOutput) {
		t.Fatalf("over-bound output returned %v", err)
	}
	info, err := output.Stat()
	if err != nil || info.Size() != 38_010_880 {
		t.Fatalf("output = %v, %v; want one frame at the inclusive limit", info, err)
	}
	last := []byte{0}
	if _, err := output.ReadAt(last, 38_010_879); err != nil || last[0] != '\n' {
		t.Fatalf("frame did not end at its LF: %q, %v", last, err)
	}
}

func transportFiles(t *testing.T, frames []byte) (*os.File, *os.File) {
	t.Helper()
	dir := t.TempDir()
	inputPath := filepath.Join(dir, "stdin")
	if err := os.WriteFile(inputPath, frames, 0600); err != nil {
		t.Fatal(err)
	}
	input, err := os.Open(inputPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = input.Close() })
	output, err := os.Create(filepath.Join(dir, "stdout"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = output.Close() })
	return input, output
}
