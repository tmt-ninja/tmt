package ptyprotocol

import (
	"encoding/binary"
	"math"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	ctrlInspect        byte = 0x20
	ctrlPublish        byte = 0x21
	ctrlClear          byte = 0x22
	ctrlCapture        byte = 0x23
	ctrlPaste          byte = 0x24
	ctrlEnter          byte = 0x25
	ctrlAwaitLaunch    byte = 0x26
	ctrlLaunchReady    byte = 0x27
	ctrlWaitLauncher   byte = 0x28
	ctrlPublishIf      byte = 0x29
	ctrlCapabilities   byte = 0x2a
	ctrlResume         byte = 0x2b
	ctrlRelaunch       byte = 0x2c
	ctrlClose          byte = 0x2d
	ctrlTerminal       byte = 0x2e
	ctrlTerminalDetail byte = 0x2f
	ctrlTerminalRun    byte = 0x30

	replyState           byte = 0xa0
	replyApplied         byte = 0xa1
	replyScreen          byte = 0xa2
	replyError           byte = 0xa3
	replyLaunched        byte = 0xa4
	replyCapabilityFlags byte = 0xa5
	replyTerminalOwner   byte = 0xa6
	replyTerminalDetails byte = 0xa7
	replyTerminalRan     byte = 0xa8

	flagResume         byte = 0x01
	flagRelaunch       byte = 0x02
	flagClose          byte = 0x04
	flagTerminal       byte = 0x08
	flagTerminalDetail byte = 0x10
	flagTerminalRun    byte = 0x20

	// CommandLimit is the maximum bytes in a human-confirmed, single-line terminal command.
	CommandLimit = 4096
	// NameLimit bounds a shell or program display name in bytes.
	NameLimit = 64

	ownerLimit   = 128
	programWords = 256
	keyLimit     = 128
	markerLimit  = 2048
)

// ValidCommand reports whether command is non-blank, within CommandLimit bytes, and free of
// control characters, line breaks, and hidden Unicode formatting.
func ValidCommand(command string) bool {
	if strings.TrimSpace(command) == "" || len(command) > CommandLimit {
		return false
	}
	for _, r := range command {
		if unicode.IsControl(r) || isHiddenCommandChar(r) {
			return false
		}
	}
	return true
}

func isHiddenCommandChar(r rune) bool {
	switch {
	case r == '\u00ad', r == '\u034f', r == '\u061c', r == '\u180e', r == '\ufeff':
		return true
	case r >= '\u200b' && r <= '\u200f':
		return true
	case r >= '\u2028' && r <= '\u202e':
		return true
	case r >= '\u2060' && r <= '\u206f':
		return true
	case r >= '\ufff9' && r <= '\ufffb':
		return true
	default:
		return false
	}
}

// DisplayName cleans a process or shell name for display: drops control characters and
// bidirectional overrides, trims space, and truncates to NameLimit bytes on a rune boundary.
func DisplayName(raw string) (string, bool) {
	var b strings.Builder
	for _, r := range strings.TrimSpace(raw) {
		if unicode.IsControl(r) || (r >= '\u202a' && r <= '\u202e') || (r >= '\u2066' && r <= '\u2069') {
			continue
		}
		if b.Len()+utf8.RuneLen(r) > NameLimit {
			break
		}
		b.WriteRune(r)
	}
	name := strings.TrimRightFunc(b.String(), unicode.IsSpace)
	if name == "" {
		return "", false
	}
	return name, true
}

// TerminalRunResult is the closed result of an atomic ownership/foreground check and submission.
type TerminalRunResult uint8

const (
	TerminalRunSubmitted TerminalRunResult = 0
	TerminalRunStale     TerminalRunResult = 1
	TerminalRunBusy      TerminalRunResult = 2
	TerminalRunEnded     TerminalRunResult = 3
)

// RelaunchKind identifies what a relaunch starts.
type RelaunchKind uint8

const (
	RelaunchResume RelaunchKind = 0
	RelaunchNew    RelaunchKind = 1
	RelaunchShell  RelaunchKind = 2
)

// ControlKind identifies which variant a Control holds.
type ControlKind uint8

const (
	ControlInspect ControlKind = iota
	ControlCapabilities
	ControlPublish
	ControlPublishIf
	ControlClear
	ControlCapture
	ControlPaste
	ControlEnter
	ControlAwaitLaunch
	ControlWaitLauncher
	ControlLaunchReady
	ControlResume
	ControlRelaunch
	ControlClose
	ControlTerminal
	ControlTerminalDetail
	ControlTerminalRun
)

// Control is a Core-internal control frame on the supervisor socket.
type Control struct {
	Tag          ControlKind
	PanePID      uint32
	Key          string
	ExpectedKey  *string
	Marker       string
	Data         []byte
	RelaunchKind RelaunchKind
	Program      []string
	Owner        string
	MemberPID    uint64
	MemberStart  string
	Command      string
}

// Kind returns the wire kind byte of the control frame.
func (c Control) Kind() byte {
	switch c.Tag {
	case ControlInspect:
		return ctrlInspect
	case ControlCapabilities:
		return ctrlCapabilities
	case ControlPublish:
		return ctrlPublish
	case ControlPublishIf:
		return ctrlPublishIf
	case ControlClear:
		return ctrlClear
	case ControlCapture:
		return ctrlCapture
	case ControlPaste:
		return ctrlPaste
	case ControlEnter:
		return ctrlEnter
	case ControlAwaitLaunch:
		return ctrlAwaitLaunch
	case ControlWaitLauncher:
		return ctrlWaitLauncher
	case ControlLaunchReady:
		return ctrlLaunchReady
	case ControlResume:
		return ctrlResume
	case ControlRelaunch:
		return ctrlRelaunch
	case ControlClose:
		return ctrlClose
	case ControlTerminal:
		return ctrlTerminal
	case ControlTerminalDetail:
		return ctrlTerminalDetail
	case ControlTerminalRun:
		return ctrlTerminalRun
	default:
		return 0
	}
}

// WritePayload appends the control payload bytes to out.
func (c Control) WritePayload(out *[]byte) {
	switch c.Tag {
	case ControlPublish:
		*out = binary.BigEndian.AppendUint32(*out, c.PanePID)
		putString(out, c.Key)
		putString(out, c.Marker)
	case ControlPublishIf:
		*out = binary.BigEndian.AppendUint32(*out, c.PanePID)
		putString(out, c.Key)
		putString(out, c.Marker)
		expected := ""
		if c.ExpectedKey != nil {
			expected = *c.ExpectedKey
		}
		putString(out, expected)
	case ControlTerminalRun:
		putString(out, c.Owner)
		*out = binary.BigEndian.AppendUint64(*out, c.MemberPID)
		putString(out, c.MemberStart)
		putString(out, c.Command)
	case ControlClear:
		putString(out, c.Key)
	case ControlPaste:
		*out = append(*out, c.Data...)
	case ControlLaunchReady:
		*out = binary.BigEndian.AppendUint32(*out, c.PanePID)
	case ControlRelaunch:
		*out = append(*out, byte(c.RelaunchKind))
		*out = binary.BigEndian.AppendUint16(*out, uint16(len(c.Program)))
		for _, word := range c.Program {
			putString(out, word)
		}
	}
}

// Encode serializes the full control frame.
func (c Control) Encode() []byte {
	return encodeFrame(c.Kind(), c.WritePayload)
}

// ReadControl decodes a Core-internal control frame from its kind byte and payload.
func ReadControl(kind byte, payload []byte) (Control, error) {
	b := payload
	var c Control
	switch kind {
	case ctrlInspect:
		c = Control{Tag: ControlInspect}
	case ctrlCapabilities:
		c = Control{Tag: ControlCapabilities}
	case ctrlCapture:
		c = Control{Tag: ControlCapture}
	case ctrlEnter:
		c = Control{Tag: ControlEnter}
	case ctrlAwaitLaunch:
		c = Control{Tag: ControlAwaitLaunch}
	case ctrlWaitLauncher:
		c = Control{Tag: ControlWaitLauncher}
	case ctrlResume:
		c = Control{Tag: ControlResume}
	case ctrlClose:
		c = Control{Tag: ControlClose}
	case ctrlTerminal:
		c = Control{Tag: ControlTerminal}
	case ctrlTerminalDetail:
		c = Control{Tag: ControlTerminalDetail}
	case ctrlTerminalRun:
		owner, err := readNonEmptyString(&b, ownerLimit)
		if err != nil {
			return Control{}, err
		}
		pidBytes, err := takeBytes(&b, 8)
		if err != nil {
			return Control{}, err
		}
		memberPID := binary.BigEndian.Uint64(pidBytes)
		memberStart, err := readNonEmptyString(&b, ownerLimit)
		if err != nil {
			return Control{}, err
		}
		command, err := readString(&b, CommandLimit)
		if err != nil {
			return Control{}, err
		}
		if memberPID == 0 || !ValidCommand(command) {
			return Control{}, malformedControl()
		}
		c = Control{
			Tag:         ControlTerminalRun,
			Owner:       owner,
			MemberPID:   memberPID,
			MemberStart: memberStart,
			Command:     command,
		}
	case ctrlRelaunch:
		kb, err := takeBytes(&b, 1)
		if err != nil {
			return Control{}, err
		}
		if kb[0] > 2 {
			return Control{}, malformedControl()
		}
		cb, err := takeBytes(&b, 2)
		if err != nil {
			return Control{}, err
		}
		count := int(binary.BigEndian.Uint16(cb))
		if count == 0 || count > programWords {
			return Control{}, malformedControl()
		}
		program := make([]string, 0, count)
		for range count {
			word, err := readString(&b, MaxPayload)
			if err != nil {
				return Control{}, err
			}
			program = append(program, word)
		}
		if program[0] == "" {
			return Control{}, malformedControl()
		}
		c = Control{Tag: ControlRelaunch, RelaunchKind: RelaunchKind(kb[0]), Program: program}
	case ctrlLaunchReady:
		pb, err := takeBytes(&b, 4)
		if err != nil {
			return Control{}, err
		}
		panePID := binary.BigEndian.Uint32(pb)
		if panePID == 0 {
			return Control{}, malformedControl()
		}
		c = Control{Tag: ControlLaunchReady, PanePID: panePID}
	case ctrlPublish, ctrlPublishIf:
		pb, err := takeBytes(&b, 4)
		if err != nil {
			return Control{}, err
		}
		panePID := binary.BigEndian.Uint32(pb)
		if panePID == 0 {
			return Control{}, malformedControl()
		}
		key, err := readNonEmptyString(&b, keyLimit)
		if err != nil {
			return Control{}, err
		}
		marker, err := readNonEmptyString(&b, markerLimit)
		if err != nil {
			return Control{}, err
		}
		if kind == ctrlPublish {
			c = Control{Tag: ControlPublish, PanePID: panePID, Key: key, Marker: marker}
		} else {
			expected, err := readString(&b, keyLimit)
			if err != nil {
				return Control{}, err
			}
			var expectedPtr *string
			if expected != "" {
				expectedPtr = &expected
			}
			c = Control{Tag: ControlPublishIf, PanePID: panePID, Key: key, ExpectedKey: expectedPtr, Marker: marker}
		}
	case ctrlClear:
		key, err := readNonEmptyString(&b, keyLimit)
		if err != nil {
			return Control{}, err
		}
		c = Control{Tag: ControlClear, Key: key}
	case ctrlPaste:
		if len(b) == 0 || len(b) > MaxPayload {
			return Control{}, malformedControl()
		}
		c = Control{Tag: ControlPaste, Data: slices.Clone(b)}
		b = nil
	default:
		return Control{}, &ProtocolError{Kind: ErrUnknownKind, UnknownKind: kind}
	}
	if len(b) != 0 {
		return Control{}, malformedControl()
	}
	return c, nil
}

// ControlReplyKind identifies which variant a ControlReply holds.
type ControlReplyKind uint8

const (
	ReplyState ControlReplyKind = iota
	ReplyApplied
	ReplyTerminalRan
	ReplyScreen
	ReplyError
	ReplyLaunched
	ReplyCapabilities
	ReplyTerminal
	ReplyTerminalDetail
)

// ControlReply is the supervisor's reply to a Core-internal control frame.
type ControlReply struct {
	Tag           ControlReplyKind
	SupervisorPID uint32
	PanePID       uint32
	KeyIdleMs     *uint64
	Marker        *string
	Paused        bool
	Ended         *Exit
	Shell         bool
	Relaunching   bool
	Applied       bool
	TerminalRan   TerminalRunResult
	Text          string
	CapResume     bool
	CapRelaunch   bool
	CapClose      bool
	CapTerminal   bool
	CapTermDetail bool
	CapTermRun    bool
	Owner         string
	CreatedMs     uint64
	Busy          bool
	ShellName     *string
	ProgramName   *string
}

// Kind returns the wire kind byte of the control reply.
func (r ControlReply) Kind() byte {
	switch r.Tag {
	case ReplyState:
		return replyState
	case ReplyApplied:
		return replyApplied
	case ReplyTerminalRan:
		return replyTerminalRan
	case ReplyScreen:
		return replyScreen
	case ReplyError:
		return replyError
	case ReplyLaunched:
		return replyLaunched
	case ReplyCapabilities:
		return replyCapabilityFlags
	case ReplyTerminal:
		return replyTerminalOwner
	case ReplyTerminalDetail:
		return replyTerminalDetails
	default:
		return 0
	}
}

// WritePayload appends the control reply payload bytes to out.
func (r ControlReply) WritePayload(out *[]byte) {
	switch r.Tag {
	case ReplyState:
		*out = binary.BigEndian.AppendUint32(*out, r.SupervisorPID)
		*out = binary.BigEndian.AppendUint32(*out, r.PanePID)
		idle := uint64(math.MaxUint64)
		if r.KeyIdleMs != nil {
			idle = *r.KeyIdleMs
		}
		*out = binary.BigEndian.AppendUint64(*out, idle)
		marker := ""
		if r.Marker != nil {
			marker = *r.Marker
		}
		putString(out, marker)
		*out = append(*out, boolByte(r.Paused))
		var exitTag byte
		var exitVal int32
		if r.Ended != nil {
			if r.Ended.Kind == ExitCode {
				exitTag = 1
			} else {
				exitTag = 2
			}
			exitVal = r.Ended.Value
		}
		*out = append(*out, exitTag)
		*out = binary.BigEndian.AppendUint32(*out, uint32(exitVal))
		*out = append(*out, boolByte(r.Shell), boolByte(r.Relaunching))
	case ReplyTerminalRan:
		*out = append(*out, byte(r.TerminalRan))
	case ReplyApplied:
		*out = append(*out, boolByte(r.Applied))
	case ReplyCapabilities:
		var flags byte
		if r.CapResume {
			flags |= flagResume
		}
		if r.CapRelaunch {
			flags |= flagRelaunch
		}
		if r.CapClose {
			flags |= flagClose
		}
		if r.CapTerminal {
			flags |= flagTerminal
		}
		if r.CapTermDetail {
			flags |= flagTerminalDetail
		}
		if r.CapTermRun {
			flags |= flagTerminalRun
		}
		*out = append(*out, flags)
	case ReplyTerminal:
		putString(out, r.Owner)
		*out = binary.BigEndian.AppendUint64(*out, r.CreatedMs)
		*out = append(*out, boolByte(r.Busy))
	case ReplyTerminalDetail:
		putString(out, r.Owner)
		*out = binary.BigEndian.AppendUint64(*out, r.CreatedMs)
		*out = append(*out, boolByte(r.Busy))
		shell := ""
		if r.ShellName != nil {
			if clean, ok := DisplayName(*r.ShellName); ok {
				shell = clean
			}
		}
		putString(out, shell)
		program := ""
		if r.Busy && r.ProgramName != nil {
			if clean, ok := DisplayName(*r.ProgramName); ok {
				program = clean
			}
		}
		putString(out, program)
	case ReplyScreen, ReplyError, ReplyLaunched:
		*out = append(*out, r.Text...)
	}
}

// Encode serializes the full control reply frame.
func (r ControlReply) Encode() []byte {
	return encodeFrame(r.Kind(), r.WritePayload)
}

// ReadControlReply decodes a Core-internal control reply from its kind byte and payload.
func ReadControlReply(kind byte, payload []byte) (ControlReply, error) {
	b := payload
	var r ControlReply
	switch kind {
	case replyState:
		supBytes, err := takeBytes(&b, 4)
		if err != nil {
			return ControlReply{}, err
		}
		paneBytes, err := takeBytes(&b, 4)
		if err != nil {
			return ControlReply{}, err
		}
		supervisorPID := binary.BigEndian.Uint32(supBytes)
		panePID := binary.BigEndian.Uint32(paneBytes)
		if supervisorPID == 0 || panePID == 0 {
			return ControlReply{}, malformedControl()
		}
		idleBytes, err := takeBytes(&b, 8)
		if err != nil {
			return ControlReply{}, err
		}
		idle := binary.BigEndian.Uint64(idleBytes)
		marker, err := readString(&b, markerLimit)
		if err != nil {
			return ControlReply{}, err
		}
		var paused, shell, relaunching bool
		var ended *Exit
		switch len(b) {
		case 0:
		case 1:
			p, err := readFlag(b[0])
			if err != nil {
				return ControlReply{}, err
			}
			paused = p
		case 8:
			p, err := readFlag(b[0])
			if err != nil {
				return ControlReply{}, err
			}
			val := int32(binary.BigEndian.Uint32(b[2:6]))
			switch {
			case b[1] == 0 && val == 0:
			case b[1] == 1:
				e := Exit{Kind: ExitCode, Value: val}
				ended = &e
			case b[1] == 2:
				e := Exit{Kind: ExitSignal, Value: val}
				ended = &e
			default:
				return ControlReply{}, malformedControl()
			}
			sh, err := readFlag(b[6])
			if err != nil {
				return ControlReply{}, err
			}
			rel, err := readFlag(b[7])
			if err != nil {
				return ControlReply{}, err
			}
			paused, shell, relaunching = p, sh, rel
		default:
			return ControlReply{}, malformedControl()
		}
		b = nil
		var keyIdlePtr *uint64
		if idle != math.MaxUint64 {
			keyIdlePtr = &idle
		}
		var markerPtr *string
		if marker != "" {
			markerPtr = &marker
		}
		r = ControlReply{
			Tag:           ReplyState,
			SupervisorPID: supervisorPID,
			PanePID:       panePID,
			KeyIdleMs:     keyIdlePtr,
			Marker:        markerPtr,
			Paused:        paused,
			Ended:         ended,
			Shell:         shell,
			Relaunching:   relaunching,
		}
	case replyTerminalRan:
		tb, err := takeBytes(&b, 1)
		if err != nil {
			return ControlReply{}, err
		}
		if tb[0] > 3 {
			return ControlReply{}, malformedControl()
		}
		r = ControlReply{Tag: ReplyTerminalRan, TerminalRan: TerminalRunResult(tb[0])}
	case replyApplied:
		ab, err := takeBytes(&b, 1)
		if err != nil {
			return ControlReply{}, err
		}
		v, err := readFlag(ab[0])
		if err != nil {
			return ControlReply{}, err
		}
		r = ControlReply{Tag: ReplyApplied, Applied: v}
	case replyCapabilityFlags:
		fb, err := takeBytes(&b, 1)
		if err != nil {
			return ControlReply{}, err
		}
		flags := fb[0]
		r = ControlReply{
			Tag:           ReplyCapabilities,
			CapResume:     flags&flagResume != 0,
			CapRelaunch:   flags&flagRelaunch != 0,
			CapClose:      flags&flagClose != 0,
			CapTerminal:   flags&flagTerminal != 0,
			CapTermDetail: flags&flagTerminalDetail != 0,
			CapTermRun:    flags&flagTerminalRun != 0,
		}
	case replyTerminalOwner, replyTerminalDetails:
		owner, err := readNonEmptyString(&b, ownerLimit)
		if err != nil {
			return ControlReply{}, err
		}
		cb, err := takeBytes(&b, 8)
		if err != nil {
			return ControlReply{}, err
		}
		createdMs := binary.BigEndian.Uint64(cb)
		bb, err := takeBytes(&b, 1)
		if err != nil {
			return ControlReply{}, err
		}
		busy, err := readFlag(bb[0])
		if err != nil {
			return ControlReply{}, err
		}
		if kind == replyTerminalOwner {
			r = ControlReply{Tag: ReplyTerminal, Owner: owner, CreatedMs: createdMs, Busy: busy}
		} else {
			rawShell, err := readString(&b, NameLimit)
			if err != nil {
				return ControlReply{}, err
			}
			rawProg, err := readString(&b, NameLimit)
			if err != nil {
				return ControlReply{}, err
			}
			var shellPtr, progPtr *string
			if clean, ok := DisplayName(rawShell); ok {
				shellPtr = &clean
			}
			if busy {
				if clean, ok := DisplayName(rawProg); ok {
					progPtr = &clean
				}
			}
			r = ControlReply{
				Tag:         ReplyTerminalDetail,
				Owner:       owner,
				CreatedMs:   createdMs,
				Busy:        busy,
				ShellName:   shellPtr,
				ProgramName: progPtr,
			}
		}
	case replyLaunched:
		if len(b) > markerLimit {
			return ControlReply{}, &ProtocolError{Kind: ErrOversized}
		}
		if !utf8.Valid(b) || len(b) == 0 {
			return ControlReply{}, malformedControl()
		}
		r = ControlReply{Tag: ReplyLaunched, Text: string(b)}
		b = nil
	case replyScreen, replyError:
		limit := MaxPayload
		if kind == replyError {
			limit = 256
		}
		if len(b) > limit {
			return ControlReply{}, &ProtocolError{Kind: ErrOversized}
		}
		if !utf8.Valid(b) {
			return ControlReply{}, malformedControl()
		}
		text := string(b)
		b = nil
		if kind == replyScreen {
			r = ControlReply{Tag: ReplyScreen, Text: text}
		} else {
			if text == "" {
				return ControlReply{}, malformedControl()
			}
			r = ControlReply{Tag: ReplyError, Text: text}
		}
	default:
		return ControlReply{}, &ProtocolError{Kind: ErrUnknownKind, UnknownKind: kind}
	}
	if len(b) != 0 {
		return ControlReply{}, malformedControl()
	}
	return r, nil
}

func malformedControl() error {
	return &ProtocolError{Kind: ErrMalformed, Reason: "invalid Core control payload"}
}

func boolByte(v bool) byte {
	if v {
		return 1
	}
	return 0
}

func readFlag(b byte) (bool, error) {
	switch b {
	case 0:
		return false, nil
	case 1:
		return true, nil
	default:
		return false, malformedControl()
	}
}

func takeBytes(b *[]byte, n int) ([]byte, error) {
	if len(*b) < n {
		return nil, malformedControl()
	}
	out := (*b)[:n]
	*b = (*b)[n:]
	return out, nil
}

func readString(b *[]byte, limit int) (string, error) {
	lb, err := takeBytes(b, 2)
	if err != nil {
		return "", err
	}
	size := int(binary.BigEndian.Uint16(lb))
	if size > limit {
		return "", &ProtocolError{Kind: ErrOversized}
	}
	raw, err := takeBytes(b, size)
	if err != nil {
		return "", err
	}
	if !utf8.Valid(raw) {
		return "", malformedControl()
	}
	return string(raw), nil
}

func readNonEmptyString(b *[]byte, limit int) (string, error) {
	s, err := readString(b, limit)
	if err != nil {
		return "", err
	}
	if s == "" {
		return "", malformedControl()
	}
	return s, nil
}

func putString(out *[]byte, text string) {
	*out = binary.BigEndian.AppendUint16(*out, uint16(len(text)))
	*out = append(*out, text...)
}
