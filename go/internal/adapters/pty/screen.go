//go:build darwin || linux

package pty

import (
	"bytes"
	"io"

	"github.com/tmt-ninja/tmt/go/internal/ptyprotocol"
)

const initialScreenLimit = 1024 * 1024
const clearScreen = "\x1b[0m\x1b[2J\x1b[H"

type attachPaint uint8

const (
	paintWaiting attachPaint = iota
	paintSnapshot
	paintDiscard
	paintLive
)

type attachScreen struct {
	paint                             attachPaint
	snapshotBytes                     int
	local                             ptyprotocol.Size
	away, retried, outstanding, again bool
	switches                          screenSwitches
}

func (s *attachScreen) repaint(send func(ptyprotocol.ClientMessage) error) error {
	if s.outstanding {
		s.again = true
		return nil
	}
	s.outstanding = true
	return send(ptyprotocol.ClientMessage{Tag: ptyprotocol.ClientSnapshot})
}

func (s *attachScreen) frame(frame ptyprotocol.ServerMessage, output io.Writer, send func(ptyprotocol.ClientMessage) error) error {
	switch frame.Tag {
	case ptyprotocol.ServerSnapshotStart:
		s.paint, s.snapshotBytes = paintSnapshot, 0
		s.switches.held = nil
		return fullWrite(output, []byte(clearScreen))
	case ptyprotocol.ServerSnapshotData:
		switch s.paint {
		case paintDiscard:
			return nil
		case paintSnapshot:
			s.snapshotBytes += len(frame.Data)
			if s.snapshotBytes > initialScreenLimit {
				s.paint = paintDiscard
				s.switches.held = nil
				return fullWrite(output, []byte(clearScreen))
			}
			data, _ := s.switches.filter(frame.Data)
			return fullWrite(output, data)
		}
		return errTerminalProtocol
	case ptyprotocol.ServerSnapshotEnd:
		if s.paint != paintSnapshot && s.paint != paintDiscard {
			return errTerminalProtocol
		}
		if err := fullWrite(output, s.switches.held); err != nil {
			return err
		}
		s.switches.held = nil
		s.paint, s.outstanding, s.away = paintLive, false, frame.Size != s.local
		if s.away && !s.retried {
			s.retried, s.again, s.away = true, false, false
			if err := send(ptyprotocol.ClientMessage{Tag: ptyprotocol.ClientResize, Size: s.local}); err != nil {
				return err
			}
			return s.repaint(send)
		}
		if s.again {
			s.again = false
			return s.repaint(send)
		}
	case ptyprotocol.ServerOutput:
		switch s.paint {
		case paintWaiting:
			return nil
		case paintLive:
			data, removed := s.switches.filter(frame.Data)
			if removed {
				if err := s.repaint(send); err != nil {
					return err
				}
			}
			return fullWrite(output, data)
		default:
			return errTerminalProtocol
		}
	case ptyprotocol.ServerResized:
		back := s.away && frame.Size == s.local
		s.away = frame.Size != s.local
		if back {
			return s.repaint(send)
		}
	default:
		return errTerminalProtocol
	}
	return nil
}

// screenSwitches preserves terminal output byte for byte except for private
// alternate-screen modes, which belong to the outer attach invocation.
type screenSwitches struct{ held []byte }

func (s *screenSwitches) filter(input []byte) ([]byte, bool) {
	result := make([]byte, 0, len(input))
	removed := false
	for _, ch := range input {
		var fits bool
		switch len(s.held) {
		case 0:
			fits = ch == 0x1b
		case 1:
			fits = ch == '['
		case 2:
			fits = ch == '?'
		default:
			fits = len(s.held) < 32 && (ch >= '0' && ch <= '9' || ch == ';')
		}
		if fits {
			s.held = append(s.held, ch)
			continue
		}
		if len(s.held) >= 3 && (ch == 'h' || ch == 'l') {
			var kept [][]byte
			changed := false
			for param := range bytes.SplitSeq(s.held[3:], []byte{';'}) {
				switch string(param) {
				case "47", "1047", "1049":
					changed = true
				default:
					kept = append(kept, param)
				}
			}
			if len(kept) > 0 {
				result = append(result, s.held[:3]...)
				result = append(result, bytes.Join(kept, []byte{';'})...)
				result = append(result, ch)
			}
			removed = removed || changed
			s.held = s.held[:0]
			continue
		}
		result = append(result, s.held...)
		s.held = s.held[:0]
		if ch == 0x1b {
			s.held = append(s.held, ch)
		} else {
			result = append(result, ch)
		}
	}
	return result, removed
}
