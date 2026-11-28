package framedstdio

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const (
	ioTimeout            = 5 * time.Second
	progressPollInterval = 25 * time.Millisecond
	// A ready pipe accepts a single writer's chunk up to POSIX's minimum PIPE_BUF.
	pipeChunk = 512
)

var (
	ErrTerminal      = errors.New("Protocol requires redirected stdio")
	ErrInputBound    = errors.New("stdio input exceeds its bound")
	ErrInvalidOutput = errors.New("Invalid stdio output frame")
	ErrDeadline      = errors.New("stdio frame deadline exceeded")
	ErrIncomplete    = errors.New("Incomplete stdio frame")
	errOutputClosed  = errors.New("stdio output closed")
)

// RequireRedirected refuses terminal descriptors before protocol handlers run.
func RequireRedirected(input, output *os.File) error {
	if sys.StdioIsTerminal(input) || sys.StdioIsTerminal(output) {
		return ErrTerminal
	}
	return nil
}

// Reader reads bounded newline frames from one invocation-owned descriptor.
type Reader struct {
	input   *os.File
	maximum int
	pending []byte
	now     func() time.Time
}

// NewReader sets a byte limit excluding the newline delimiter.
func NewReader(input *os.File, maximum int) *Reader {
	return &Reader{input: input, maximum: maximum, now: time.Now}
}

// ReadFrame returns one newline-terminated frame, io.EOF for a clean end of
// input, or a transport error. The deadline starts once a frame is partial.
func (r *Reader) ReadFrame() ([]byte, error) {
	var deadline time.Time
	searched := 0
	var chunk [8192]byte
	for {
		if i := bytes.IndexByte(r.pending[searched:], '\n'); i >= 0 {
			end := searched + i
			if end > r.maximum {
				return nil, ErrInputBound
			}
			frame := r.pending[: end+1 : end+1]
			r.pending = r.pending[end+1:]
			if len(r.pending) == 0 {
				r.pending = nil
			}
			return frame, nil
		}
		searched = len(r.pending)
		if searched > r.maximum {
			return nil, ErrInputBound
		}
		if deadline.IsZero() && searched != 0 {
			// Bytes buffered behind the previous frame start a fresh interval.
			deadline = r.now().Add(ioTimeout)
		}
		if err := wait(r.input, false, deadline, r.now); err != nil {
			return nil, err
		}
		n, retry, err := sys.StdioRead(r.input, chunk[:])
		if err != nil {
			return nil, err
		}
		if retry {
			continue
		}
		if !deadline.IsZero() && !r.now().Before(deadline) {
			return nil, ErrDeadline
		}
		if n == 0 {
			if len(r.pending) == 0 {
				return nil, io.EOF
			}
			return nil, ErrIncomplete
		}
		r.pending = append(r.pending, chunk[:n]...)
	}
}

// Publish writes the complete response plus a newline within one deadline.
func Publish(output *os.File, body []byte, maximum int) error {
	deadline := time.Now().Add(ioTimeout)
	return publishFrame(output, body, maximum, func() error {
		return wait(output, true, deadline, time.Now)
	})
}

// PublishProgress uses the command deadline and checks cancellation even when
// the output is backpressured. Cancellation after a partial write is terminal.
func PublishProgress(ctx context.Context, output *os.File, body []byte, maximum int, deadline time.Time) error {
	return publishFrame(output, body, maximum, func() error {
		for {
			if err := ctx.Err(); err != nil {
				return err
			}
			slice := time.Now().Add(progressPollInterval)
			if deadline.IsZero() {
				return ErrDeadline
			}
			if deadline.Before(slice) {
				slice = deadline
			}
			err := wait(output, true, slice, time.Now)
			if errors.Is(err, ErrDeadline) && slice != deadline {
				continue
			}
			if err != nil {
				return err
			}
			return ctx.Err()
		}
	})
}

func publishFrame(output *os.File, body []byte, maximum int, writable func() error) error {
	if len(body) > maximum || bytes.IndexByte(body, '\n') >= 0 {
		return ErrInvalidOutput
	}
	frame := make([]byte, len(body)+1)
	copy(frame, body)
	frame[len(body)] = '\n'
	for offset := 0; offset < len(frame); {
		if err := writable(); err != nil {
			if offset > 0 && (errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)) {
				return ErrIncomplete
			}
			return err
		}
		n, retry, err := sys.StdioWrite(output, frame[offset:min(offset+pipeChunk, len(frame))])
		if err != nil {
			return err
		}
		if retry {
			continue
		}
		if n == 0 {
			return errOutputClosed
		}
		offset += n
	}
	return nil
}

func wait(file *os.File, write bool, deadline time.Time, now func() time.Time) error {
	for {
		timeout := -time.Nanosecond
		if !deadline.IsZero() {
			timeout = deadline.Sub(now())
			if timeout <= 0 {
				return ErrDeadline
			}
		}
		ready, err := sys.StdioReady(file, write, timeout)
		if errors.Is(err, sys.ErrStdioInterrupted) {
			continue
		}
		if err != nil {
			return err
		}
		if !deadline.IsZero() && !now().Before(deadline) {
			return ErrDeadline
		}
		if ready {
			return nil
		}
	}
}
