package driverprotocol

import "time"

const (
	// Protocol is the protocol version this package speaks.
	Protocol uint32 = 1

	// Subcommand is the hidden subcommand every driver executable answers.
	Subcommand = "__tmt-driver"

	// CallEnv is set on every driver call; a tmt that sees it refuses to write, so a
	// driver that runs tmt cannot recurse into itself or change state.
	CallEnv = "TMT_DRIVER_CALL"

	// MaxRequestBytes is the most a request may be; input text is the largest part.
	MaxRequestBytes = 1024 * 1024

	// MaxHookPayloadBytes is the most a provider hook's payload may be for core to decode it.
	MaxHookPayloadBytes = 64 * 1024

	smallOutputBytes = 4 * 1024
	largeOutputBytes = 1024 * 1024
)

// Op is one driver operation: a host driver's, or a runtime driver's from OpLocations on.
// A driver answers unsupported to any it doesn't declare, including the other kind's.
type Op string

const (
	OpCapabilities  Op = "capabilities"
	OpCaller        Op = "caller"
	OpServer        Op = "server"
	OpResolveTarget Op = "resolve-target"
	OpSnapshot      Op = "snapshot"
	OpProbe         Op = "probe"
	OpPublish       Op = "publish"
	OpClear         Op = "clear"
	OpCapture       Op = "capture"
	OpInput         Op = "input"
	OpPrompt        Op = "prompt"
	OpFocus         Op = "focus"
	OpClose         Op = "close"
	OpNameAgent     Op = "name-agent"
	OpLocations     Op = "locations"
	OpResume        Op = "resume"
	OpUsage         Op = "usage"
)

// AllOps lists every protocol-1 operation in canonical order.
var AllOps = [17]Op{
	OpCapabilities,
	OpCaller,
	OpServer,
	OpResolveTarget,
	OpSnapshot,
	OpProbe,
	OpPublish,
	OpClear,
	OpCapture,
	OpInput,
	OpPrompt,
	OpFocus,
	OpClose,
	OpNameAgent,
	OpLocations,
	OpResume,
	OpUsage,
}

// OpLimits specifies how long an operation may take and how much it may print.
// Anything over either is a failure, never a partial answer.
type OpLimits struct {
	Deadline       time.Duration
	MaxOutputBytes int
}

// String returns the operation's name on the command line and in capabilities.ops.
func (op Op) String() string {
	return string(op)
}

// ParseOp parses an operation name.
func ParseOp(name string) (Op, bool) {
	for _, op := range AllOps {
		if string(op) == name {
			return op, true
		}
	}
	return "", false
}

// IsRuntime reports whether op is a runtime driver's operation.
func (op Op) IsRuntime() bool {
	switch op {
	case OpLocations, OpResume, OpUsage:
		return true
	default:
		return false
	}
}

// Bounds returns the deadline and maximum output size for op.
func (op Op) Bounds() OpLimits {
	switch op {
	case OpSnapshot, OpProbe, OpCapture:
		return OpLimits{Deadline: 2000 * time.Millisecond, MaxOutputBytes: largeOutputBytes}
	case OpInput, OpPrompt, OpNameAgent:
		return OpLimits{Deadline: 2000 * time.Millisecond, MaxOutputBytes: smallOutputBytes}
	default:
		return OpLimits{Deadline: 1000 * time.Millisecond, MaxOutputBytes: smallOutputBytes}
	}
}
