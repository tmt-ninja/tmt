//go:build darwin || linux

package channel

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"testing"
)

type codexFrameHeaderFixture struct {
	*bytes.Reader
}

func (r codexFrameHeaderFixture) Write([]byte) (int, error) { return 0, io.ErrClosedPipe }
func (r codexFrameHeaderFixture) Close() error              { return nil }

func TestCodexOversizedFrameIsRefusedFromTheHeader(t *testing.T) {
	header := [10]byte{0x81, 127}
	binary.BigEndian.PutUint64(header[2:], codexFrameLimit+1)
	body := &codexFrameBody{ReadWriteCloser: codexFrameHeaderFixture{bytes.NewReader(header[:])}}
	for range 2 {
		if data, err := io.ReadAll(body); len(data) != 0 || !errors.Is(err, errCodexFrameLimit) {
			t.Fatalf("oversized frame read %d bytes with %v", len(data), err)
		}
	}
}
