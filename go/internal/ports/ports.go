// Package ports holds the interfaces and value types that cross layers:
// cli composes use cases over these ports, adapters implement them, and core
// supplies the domain types they carry. Owner: tmt-go-lead. Members propose
// changes by detached talk; the lead commits them.
package ports

import (
	"context"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

// Clock is the explicit time source; nothing below cli reads the wall clock.
type Clock interface {
	NowMs() int64
}

// ---------- storage (go-1) ----------

// Store owns the single SQLite connection. Every write is one IMMEDIATE
// transaction; repositories are valid only inside the callback.
type Store interface {
	Read(ctx context.Context, fn func(StoreTx) error) error
	Write(ctx context.Context, fn func(StoreTx) error) error
	Close() error
}

// StoreTx exposes the repositories of one transaction. go-1 defines each
// repository interface in this package (ports/storage.go) as it ports them.
type StoreTx interface {
	Identities() IdentityRepo
	Bindings() BindingRepo
	Requests() RequestRepo
	Responses() ResponseRepo
}

// The repository method sets are filled in by go-1 in ports/storage.go
// (lead review on each change). They start empty so the skeleton compiles.
type (
	IdentityRepo interface{}
	BindingRepo  interface{}
	RequestRepo  interface{}
	ResponseRepo interface{}
)

// ---------- process (go-2) ----------

// ProcessSpec is one bounded child process.
type ProcessSpec struct {
	Path    string   // absolute executable
	Args    []string // argv after Path
	Dir     string
	Env     []string // full environment; callers build it, never inherit implicitly
	Stdin   []byte
	Timeout time.Duration
	MaxOut  int // stdout and stderr byte caps each
}

// Bounded is a finished process with capped output.
type Bounded struct {
	ExitCode  int
	Stdout    []byte
	Stderr    []byte
	Truncated bool
}

type Process interface {
	Run(ctx context.Context, spec ProcessSpec) (Bounded, error)
}

// ---------- host / tmux transport (go-2) ----------

// PaneRef names one host pane; Server is the tmux socket path (never empty
// in tests: always a private -S socket).
type PaneRef struct {
	Server string
	PaneID string // "%13"
}

// PaneEvidence is what the host reports about a pane without changing it.
type PaneEvidence struct {
	Pane       PaneRef
	Session    string
	Window     string
	Command    string // current foreground command
	PID        int
	CurrentDir string
	Active     bool
}

type CaptureOpts struct {
	Lines  int  // tail lines; 0 means the visible screen
	Escape bool // keep SGR escapes
}

// Screen is one bounded capture.
type Screen struct {
	Pane  PaneRef
	Text  string
	Lines int
	Cols  int
}

// DeliveryInput is the text a request delivers, with the driver's submit plan.
type DeliveryInput struct {
	Text   string
	Submit []KeyStep
}

// KeyStep is one host input step: literal text or a named key, then a pause.
type KeyStep struct {
	Literal string
	Key     string // tmux key name, e.g. "Enter"
	Pause   time.Duration
}

// DeliveryOutcome reports what is known after delivery. Uncertain is
// terminal: once input may have reached a terminal it is never replayed.
type DeliveryOutcome int

const (
	DeliveryNotStarted DeliveryOutcome = iota
	DeliveryDelivered
	DeliveryUncertain
)

type LaunchSpec struct {
	Server  string
	Session string // exact target session; created only on a private server
	Window  string
	Dir     string
	Command ProcessSpec
}

type Host interface {
	Panes(ctx context.Context, server string) ([]PaneEvidence, error)
	Capture(ctx context.Context, pane PaneRef, opt CaptureOpts) (Screen, error)
	Deliver(ctx context.Context, pane PaneRef, in DeliveryInput) (DeliveryOutcome, error)
	Launch(ctx context.Context, spec LaunchSpec) (PaneRef, error)
}

// ---------- agent drivers (go-2) ----------

type DriverState int

const (
	DriverUnknown DriverState = iota
	DriverIdle
	DriverBusy
	DriverPrompt // waiting on a permission or choice prompt
)

// AgentLaunch is a Core-resolved request to start one agent for an identity.
type AgentLaunch struct {
	Identity core.IdentityID
	Name     core.Name
	Dir      string
	Model    string
	Effort   string
	Resume   string // provider session to resume, if any
	HomeDir  string // tmt-go root; per-launch hook and channel files live under it
	Extra    []string
}

// Driver adapts one provider CLI. Hooks and channel config are per launch:
// a driver never writes provider directories or global provider settings.
type Driver interface {
	Name() string // "claude", "codex", "gemini"
	LaunchCommand(spec AgentLaunch) (ProcessSpec, error)
	Classify(s Screen) DriverState
	SubmitPlan(text string) []KeyStep
}

// ---------- installation (go-4) ----------

// Artifact is one installable tmt-go build.
type Artifact struct {
	Version string
	OS      string
	Arch    string
	URL     string
	SHA256  string
}

type ReleaseSource interface {
	Latest(ctx context.Context, osName, arch string) (Artifact, error)
	Fetch(ctx context.Context, a Artifact) ([]byte, error) // verified against SHA256
}
