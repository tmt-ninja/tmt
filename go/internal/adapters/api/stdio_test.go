package api

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/framedstdio"
)

func TestSessionInputBoundExcludesLF(t *testing.T) {
	for _, tc := range []struct {
		name   string
		size   int
		status int
		err    error
		calls  int
	}{
		{"at bound", 6_299_648, 0, nil, 1},
		{"over bound", 6_299_649, 1, framedstdio.ErrInputBound, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := bytes.Repeat([]byte(" "), tc.size)
			input, output := sessionFiles(t, append(body, '\n'))
			calls := 0
			status, err := ServeSession(input, output, func(got []byte) (SessionResponse, error) {
				calls++
				if !bytes.Equal(got, body) {
					t.Fatalf("body = %d bytes; want %d bytes without LF", len(got), len(body))
				}
				return SessionResponse{Body: []byte("{}")}, nil
			}, nil)
			if status != tc.status || !errors.Is(err, tc.err) || calls != tc.calls {
				t.Fatalf("session returned %d, %v, with %d calls", status, err, calls)
			}
		})
	}
}

func TestSessionPublishesErrorsAndStopsAfterStaleResponse(t *testing.T) {
	input, output := sessionFiles(t, []byte("bad JSON\nnext\nstale\nnever\n"))
	var seen, delivered []string
	status, err := ServeSession(input, output, func(body []byte) (SessionResponse, error) {
		seen = append(seen, string(body))
		switch string(body) {
		case "bad JSON":
			return SessionResponse{Body: []byte(`{"error":{"code":"API_INPUT_INVALID","message":"invalid"}}`)}, nil
		case "stale":
			return SessionResponse{Body: []byte(`{"error":{"code":"API_SESSION_STALE","message":"reopen"}}`), Stale: true}, nil
		default:
			return SessionResponse{Body: []byte(`{}`)}, nil
		}
	}, func() {
		data, err := os.ReadFile(output.Name())
		if err != nil {
			t.Fatal(err)
		}
		lines := strings.Split(strings.TrimSuffix(string(data), "\n"), "\n")
		delivered = append(delivered, lines[len(lines)-1])
	})
	if err != nil || status != 1 || !reflect.DeepEqual(seen, []string{"bad JSON", "next", "stale"}) {
		t.Fatalf("session = %d, %v; requests = %v", status, err, seen)
	}
	want := []string{
		`{"error":{"code":"API_INPUT_INVALID","message":"invalid"}}`,
		`{}`,
		`{"error":{"code":"API_SESSION_STALE","message":"reopen"}}`,
	}
	if !reflect.DeepEqual(delivered, want) {
		t.Fatalf("delivered = %q; want %q", delivered, want)
	}
}

func sessionFiles(t *testing.T, frames []byte) (*os.File, *os.File) {
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
