package ptyprotocol

import (
	"encoding/binary"
	"fmt"
	"slices"
)

const (
	// Version is the only protocol version this package speaks; Hello and Welcome carry it.
	Version uint16 = 1
	// MaxPayload is the largest payload of any frame.
	MaxPayload = 64 * 1024
	// MaxInput is the largest chunk of keystrokes one Input frame carries.
	MaxInput = 16 * 1024
	// MaxOutput is the largest chunk of program output one Output or SnapshotData frame carries.
	MaxOutput = 16 * 1024
	// MaxDimension is the largest window size, in columns and in rows.
	MaxDimension uint16 = 1000

	headerSize = 5
)

// Size is a validated pseudo-terminal window size.
type Size struct {
	Cols uint16
	Rows uint16
}

// NewSize constructs a Size with both dimensions in 1..=MaxDimension.
func NewSize(cols, rows uint16) (Size, error) {
	if cols >= 1 && cols <= MaxDimension && rows >= 1 && rows <= MaxDimension {
		return Size{Cols: cols, Rows: rows}, nil
	}
	return Size{}, &ProtocolError{Kind: ErrMalformed, Reason: "a window dimension is out of range"}
}

// ExitKind distinguishes normal exit codes from terminating signals.
type ExitKind uint8

const (
	ExitCode ExitKind = iota
	ExitSignal
)

// Exit describes how a member's program ended.
type Exit struct {
	Kind  ExitKind
	Value int32
}

// Eviction explains why a client was disconnected by the supervisor.
type Eviction uint8

const (
	EvictionTakenOver Eviction = 0
	EvictionTooSlow   Eviction = 1
)

// Refusal explains why a connection was refused before it was attached.
type Refusal uint8

const (
	RefusalVersion   Refusal = 0
	RefusalHandshake Refusal = 1
	RefusalOwner     Refusal = 2
	RefusalFull      Refusal = 3
)

// ProtocolErrorKind classifies why bytes are not a valid frame.
type ProtocolErrorKind uint8

const (
	ErrOversized ProtocolErrorKind = iota
	ErrUnknownKind
	ErrMalformed
)

// ProtocolError reports why a frame or byte stream broke the wire protocol.
type ProtocolError struct {
	Kind        ProtocolErrorKind
	UnknownKind byte
	Reason      string
}

func (e *ProtocolError) Error() string {
	switch e.Kind {
	case ErrOversized:
		return "a frame is larger than the protocol allows"
	case ErrUnknownKind:
		return fmt.Sprintf("unknown frame kind %#04x", e.UnknownKind)
	case ErrMalformed:
		return fmt.Sprintf("malformed frame: %s", e.Reason)
	default:
		return "protocol error"
	}
}

const (
	kindHello         byte = 0x01
	kindInput         byte = 0x02
	kindResize        byte = 0x03
	kindTakeSole      byte = 0x04
	kindDetach        byte = 0x05
	kindSnapshot      byte = 0x06
	kindWelcome       byte = 0x81
	kindOutput        byte = 0x82
	kindExited        byte = 0x83
	kindEvicted       byte = 0x84
	kindRefused       byte = 0x85
	kindResized       byte = 0x86
	kindSnapshotStart byte = 0x87
	kindSnapshotData  byte = 0x88
	kindSnapshotEnd   byte = 0x89
)

// ClientMessageKind identifies which variant a ClientMessage holds.
type ClientMessageKind uint8

const (
	ClientControl ClientMessageKind = iota
	ClientHello
	ClientInput
	ClientResize
	ClientTakeSole
	ClientDetach
	ClientSnapshot
)

// ClientMessage is a frame from a client to the supervisor.
type ClientMessage struct {
	Tag     ClientMessageKind
	Control *Control
	Version uint16
	Data    []byte
	Size    Size
}

// Kind returns the wire kind byte of the client message.
func (m ClientMessage) Kind() byte {
	switch m.Tag {
	case ClientControl:
		return m.Control.Kind()
	case ClientHello:
		return kindHello
	case ClientInput:
		return kindInput
	case ClientResize:
		return kindResize
	case ClientTakeSole:
		return kindTakeSole
	case ClientDetach:
		return kindDetach
	case ClientSnapshot:
		return kindSnapshot
	default:
		return 0
	}
}

// WritePayload appends the frame's payload bytes to out.
func (m ClientMessage) WritePayload(out *[]byte) {
	switch m.Tag {
	case ClientControl:
		m.Control.WritePayload(out)
	case ClientHello:
		*out = binary.BigEndian.AppendUint16(*out, m.Version)
	case ClientInput:
		*out = append(*out, m.Data...)
	case ClientResize:
		putSize(out, m.Size)
	case ClientTakeSole, ClientDetach, ClientSnapshot:
	}
}

// Encode serializes the full frame (5-byte header + payload).
func (m ClientMessage) Encode() []byte {
	return encodeFrame(m.Kind(), m.WritePayload)
}

// ReadClientMessage decodes one client frame given its kind byte and payload bytes.
func ReadClientMessage(kind byte, payload []byte) (ClientMessage, error) {
	if kind >= 0x20 && kind <= 0x30 {
		ctrl, err := ReadControl(kind, payload)
		if err != nil {
			return ClientMessage{}, err
		}
		return ClientMessage{Tag: ClientControl, Control: &ctrl}, nil
	}
	switch kind {
	case kindHello:
		if len(payload) != 2 {
			return ClientMessage{}, &ProtocolError{Kind: ErrMalformed, Reason: "a hello is two bytes"}
		}
		return ClientMessage{Tag: ClientHello, Version: binary.BigEndian.Uint16(payload)}, nil
	case kindInput:
		data, err := boundedBytes(payload, MaxInput)
		if err != nil {
			return ClientMessage{}, err
		}
		return ClientMessage{Tag: ClientInput, Data: data}, nil
	case kindResize:
		size, err := readSize(payload)
		if err != nil {
			return ClientMessage{}, err
		}
		return ClientMessage{Tag: ClientResize, Size: size}, nil
	case kindTakeSole:
		if err := requireEmpty(payload); err != nil {
			return ClientMessage{}, err
		}
		return ClientMessage{Tag: ClientTakeSole}, nil
	case kindDetach:
		if err := requireEmpty(payload); err != nil {
			return ClientMessage{}, err
		}
		return ClientMessage{Tag: ClientDetach}, nil
	case kindSnapshot:
		if err := requireEmpty(payload); err != nil {
			return ClientMessage{}, err
		}
		return ClientMessage{Tag: ClientSnapshot}, nil
	default:
		return ClientMessage{}, &ProtocolError{Kind: ErrUnknownKind, UnknownKind: kind}
	}
}

// ServerMessageKind identifies which variant a ServerMessage holds.
type ServerMessageKind uint8

const (
	ServerControl ServerMessageKind = iota
	ServerWelcome
	ServerOutput
	ServerResized
	ServerExited
	ServerEvicted
	ServerRefused
	ServerSnapshotStart
	ServerSnapshotData
	ServerSnapshotEnd
)

// ServerMessage is a frame from the supervisor to a client.
type ServerMessage struct {
	Tag      ServerMessageKind
	Control  *ControlReply
	Version  uint16
	Size     Size
	Data     []byte
	Exit     Exit
	Eviction Eviction
	Refusal  Refusal
}

// Kind returns the wire kind byte of the server message.
func (m ServerMessage) Kind() byte {
	switch m.Tag {
	case ServerControl:
		return m.Control.Kind()
	case ServerWelcome:
		return kindWelcome
	case ServerOutput:
		return kindOutput
	case ServerResized:
		return kindResized
	case ServerExited:
		return kindExited
	case ServerEvicted:
		return kindEvicted
	case ServerRefused:
		return kindRefused
	case ServerSnapshotStart:
		return kindSnapshotStart
	case ServerSnapshotData:
		return kindSnapshotData
	case ServerSnapshotEnd:
		return kindSnapshotEnd
	default:
		return 0
	}
}

// WritePayload appends the frame's payload bytes to out.
func (m ServerMessage) WritePayload(out *[]byte) {
	switch m.Tag {
	case ServerControl:
		m.Control.WritePayload(out)
	case ServerWelcome:
		*out = binary.BigEndian.AppendUint16(*out, m.Version)
		putSize(out, m.Size)
	case ServerOutput:
		*out = append(*out, m.Data...)
	case ServerResized:
		putSize(out, m.Size)
	case ServerExited:
		var tag byte
		if m.Exit.Kind == ExitSignal {
			tag = 1
		}
		*out = append(*out, tag)
		*out = binary.BigEndian.AppendUint32(*out, uint32(m.Exit.Value))
	case ServerEvicted:
		*out = append(*out, byte(m.Eviction))
	case ServerRefused:
		*out = append(*out, byte(m.Refusal))
	case ServerSnapshotStart:
	case ServerSnapshotData:
		*out = append(*out, m.Data...)
	case ServerSnapshotEnd:
		putSize(out, m.Size)
	}
}

// Encode serializes the full frame (5-byte header + payload).
func (m ServerMessage) Encode() []byte {
	return encodeFrame(m.Kind(), m.WritePayload)
}

// ReadServerMessage decodes one server frame given its kind byte and payload bytes.
func ReadServerMessage(kind byte, payload []byte) (ServerMessage, error) {
	if kind >= 0xa0 && kind <= 0xaf {
		reply, err := ReadControlReply(kind, payload)
		if err != nil {
			return ServerMessage{}, err
		}
		return ServerMessage{Tag: ServerControl, Control: &reply}, nil
	}
	switch kind {
	case kindWelcome:
		if len(payload) < 2 {
			return ServerMessage{}, &ProtocolError{Kind: ErrMalformed, Reason: "a welcome is six bytes"}
		}
		size, err := readSize(payload[2:])
		if err != nil {
			return ServerMessage{}, err
		}
		return ServerMessage{
			Tag:     ServerWelcome,
			Version: binary.BigEndian.Uint16(payload[:2]),
			Size:    size,
		}, nil
	case kindOutput:
		data, err := boundedBytes(payload, MaxOutput)
		if err != nil {
			return ServerMessage{}, err
		}
		return ServerMessage{Tag: ServerOutput, Data: data}, nil
	case kindResized:
		size, err := readSize(payload)
		if err != nil {
			return ServerMessage{}, err
		}
		return ServerMessage{Tag: ServerResized, Size: size}, nil
	case kindExited:
		if len(payload) != 5 {
			return ServerMessage{}, &ProtocolError{Kind: ErrMalformed, Reason: "an exit is five bytes"}
		}
		val := int32(binary.BigEndian.Uint32(payload[1:5]))
		switch payload[0] {
		case 0:
			return ServerMessage{Tag: ServerExited, Exit: Exit{Kind: ExitCode, Value: val}}, nil
		case 1:
			return ServerMessage{Tag: ServerExited, Exit: Exit{Kind: ExitSignal, Value: val}}, nil
		default:
			return ServerMessage{}, &ProtocolError{Kind: ErrMalformed, Reason: "an exit is a code or a signal"}
		}
	case kindEvicted:
		if len(payload) != 1 || payload[0] > 1 {
			return ServerMessage{}, &ProtocolError{Kind: ErrMalformed, Reason: "unknown eviction reason"}
		}
		return ServerMessage{Tag: ServerEvicted, Eviction: Eviction(payload[0])}, nil
	case kindRefused:
		if len(payload) != 1 || payload[0] > 3 {
			return ServerMessage{}, &ProtocolError{Kind: ErrMalformed, Reason: "unknown refusal reason"}
		}
		return ServerMessage{Tag: ServerRefused, Refusal: Refusal(payload[0])}, nil
	case kindSnapshotStart:
		if err := requireEmpty(payload); err != nil {
			return ServerMessage{}, err
		}
		return ServerMessage{Tag: ServerSnapshotStart}, nil
	case kindSnapshotData:
		data, err := boundedBytes(payload, MaxOutput)
		if err != nil {
			return ServerMessage{}, err
		}
		return ServerMessage{Tag: ServerSnapshotData, Data: data}, nil
	case kindSnapshotEnd:
		size, err := readSize(payload)
		if err != nil {
			return ServerMessage{}, err
		}
		return ServerMessage{Tag: ServerSnapshotEnd, Size: size}, nil
	default:
		return ServerMessage{}, &ProtocolError{Kind: ErrUnknownKind, UnknownKind: kind}
	}
}

func encodeFrame(kind byte, writePayload func(*[]byte)) []byte {
	out := []byte{kind, 0, 0, 0, 0}
	writePayload(&out)
	length := uint32(len(out) - headerSize)
	binary.BigEndian.PutUint32(out[1:headerSize], length)
	return out
}

func putSize(out *[]byte, size Size) {
	*out = binary.BigEndian.AppendUint16(*out, size.Cols)
	*out = binary.BigEndian.AppendUint16(*out, size.Rows)
}

func readSize(payload []byte) (Size, error) {
	if len(payload) != 4 {
		return Size{}, &ProtocolError{Kind: ErrMalformed, Reason: "a size is four bytes"}
	}
	return NewSize(binary.BigEndian.Uint16(payload[0:2]), binary.BigEndian.Uint16(payload[2:4]))
}

func boundedBytes(payload []byte, limit int) ([]byte, error) {
	if len(payload) == 0 || len(payload) > limit {
		return nil, &ProtocolError{Kind: ErrMalformed, Reason: "a data frame carries 1 to its limit in bytes"}
	}
	return slices.Clone(payload), nil
}

func requireEmpty(payload []byte) error {
	if len(payload) != 0 {
		return &ProtocolError{Kind: ErrMalformed, Reason: "this frame has no payload"}
	}
	return nil
}

// Decoder performs incremental frame decoding over a byte stream.
type Decoder struct {
	buffer []byte
}

// NewDecoder constructs an empty Decoder.
func NewDecoder() *Decoder {
	return &Decoder{}
}

// Push appends received bytes, refusing to grow past two maximum-sized frames.
func (d *Decoder) Push(received []byte) error {
	if len(d.buffer)+len(received) > headerSize+MaxPayload+MaxPayload {
		return &ProtocolError{Kind: ErrOversized}
	}
	d.buffer = append(d.buffer, received...)
	return nil
}

func (d *Decoder) nextRaw() (byte, []byte, bool, error) {
	if len(d.buffer) < headerSize {
		return 0, nil, false, nil
	}
	length := int(binary.BigEndian.Uint32(d.buffer[1:headerSize]))
	if length > MaxPayload {
		return 0, nil, false, &ProtocolError{Kind: ErrOversized}
	}
	if len(d.buffer) < headerSize+length {
		return 0, nil, false, nil
	}
	kind := d.buffer[0]
	payload := d.buffer[headerSize : headerSize+length]
	return kind, payload, true, nil
}

func (d *Decoder) consume(payloadLen int) {
	n := headerSize + payloadLen
	copy(d.buffer, d.buffer[n:])
	d.buffer = d.buffer[:len(d.buffer)-n]
}

// NextClient decodes the next complete ClientMessage, or returns ok=false until more bytes arrive.
func (d *Decoder) NextClient() (ClientMessage, bool, error) {
	kind, payload, ready, err := d.nextRaw()
	if err != nil || !ready {
		return ClientMessage{}, false, err
	}
	msg, err := ReadClientMessage(kind, payload)
	if err != nil {
		return ClientMessage{}, false, err
	}
	d.consume(len(payload))
	return msg, true, nil
}

// NextServer decodes the next complete ServerMessage, or returns ok=false until more bytes arrive.
func (d *Decoder) NextServer() (ServerMessage, bool, error) {
	kind, payload, ready, err := d.nextRaw()
	if err != nil || !ready {
		return ServerMessage{}, false, err
	}
	msg, err := ReadServerMessage(kind, payload)
	if err != nil {
		return ServerMessage{}, false, err
	}
	d.consume(len(payload))
	return msg, true, nil
}
