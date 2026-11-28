//go:build darwin || linux

package process

import (
	"context"
	"errors"
	"io"
	"os"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/sys"
)

// WriteHandoff writes the exact payload to one invocation-owned descriptor by
// its deadline. The byte count distinguishes no output from partial publication.
func WriteHandoff(ctx context.Context, file *os.File, payload []byte) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	deadline, bounded := ctx.Deadline()
	if file == nil || !bounded {
		return 0, errors.New("provider handoff requires an output file and deadline")
	}
	written := 0
	err := sys.WithNonblockingFile(file, func() error {
		for written < len(payload) {
			if err := ctx.Err(); err != nil {
				return err
			}
			n, retry, err := sys.StdioWrite(file, payload[written:])
			if err != nil {
				return err
			}
			if !retry {
				if n == 0 {
					return io.ErrShortWrite
				}
				written += n
				continue
			}
			remaining := time.Until(deadline)
			if remaining <= 0 {
				return context.DeadlineExceeded
			}
			_, err = sys.StdioReady(file, true, min(remaining, 25*time.Millisecond))
			if err != nil && !errors.Is(err, sys.ErrStdioInterrupted) {
				return err
			}
		}
		return nil
	})
	return written, err
}
