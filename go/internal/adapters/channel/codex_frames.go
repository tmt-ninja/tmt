//go:build darwin || linux

package channel

import (
	"encoding/binary"
	"errors"
	"io"
	"net/http"
)

var errCodexFrameLimit = errors.New("Codex WebSocket frame exceeds the inbound limit")

type codexFrameTransport struct {
	*http.Transport
}

func (t codexFrameTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	response, err := t.Transport.RoundTrip(request)
	if err != nil || response.StatusCode != http.StatusSwitchingProtocols {
		return response, err
	}
	if body, ok := response.Body.(io.ReadWriteCloser); ok {
		response.Body = &codexFrameBody{ReadWriteCloser: body}
	}
	return response, nil
}

// codexFrameBody checks lengths at the upgraded stream boundary. It forwards
// the header bytes and payload unchanged for the WebSocket implementation to
// validate. It never reads the body of an oversized frame.
type codexFrameBody struct {
	io.ReadWriteCloser
	header           [14]byte
	headerStart      int
	headerEnd        int
	payloadRemaining int
	headerError      error
}

func (b *codexFrameBody) Read(data []byte) (int, error) {
	if len(data) == 0 {
		return 0, nil
	}
	if b.headerError != nil {
		return 0, b.headerError
	}
	if b.headerStart == b.headerEnd && b.payloadRemaining == 0 {
		if err := b.readHeader(); err != nil {
			b.headerError = err
			return 0, err
		}
	}
	if b.headerStart < b.headerEnd {
		copied := copy(data, b.header[b.headerStart:b.headerEnd])
		b.headerStart += copied
		return copied, nil
	}
	n, err := b.ReadWriteCloser.Read(data[:min(len(data), b.payloadRemaining)])
	b.payloadRemaining -= n
	return n, err
}

func (b *codexFrameBody) readHeader() error {
	if _, err := io.ReadFull(b.ReadWriteCloser, b.header[:2]); err != nil {
		return err
	}
	end := 2
	payload := uint64(b.header[1] & 0x7f)
	switch payload {
	case 126:
		end += 2
		if _, err := io.ReadFull(b.ReadWriteCloser, b.header[2:end]); err != nil {
			return err
		}
		payload = uint64(binary.BigEndian.Uint16(b.header[2:end]))
	case 127:
		end += 8
		if _, err := io.ReadFull(b.ReadWriteCloser, b.header[2:end]); err != nil {
			return err
		}
		payload = binary.BigEndian.Uint64(b.header[2:end])
	}
	if payload > codexFrameLimit {
		return errCodexFrameLimit
	}
	if b.header[1]&0x80 != 0 {
		if _, err := io.ReadFull(b.ReadWriteCloser, b.header[end:end+4]); err != nil {
			return err
		}
		end += 4
	}
	b.headerStart, b.headerEnd = 0, end
	b.payloadRemaining = int(payload)
	return nil
}
