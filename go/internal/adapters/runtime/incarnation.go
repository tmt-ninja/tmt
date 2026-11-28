//go:build darwin || linux

package runtime

import (
	"context"
	"errors"
	"fmt"
	"math"
	"os"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

// Incarnation is a local process ID paired with its observed UTC start token.
type Incarnation struct {
	PID   int
	Start string
}

func (i Incarnation) Valid() bool {
	stamp, found := strings.CutPrefix(i.Start, "ps-v1:")
	fields := strings.Fields(stamp)
	return validPID(i.PID) && found && validStart(fields) && strings.Join(fields, " ") == stamp
}

type State uint8

const (
	Unknown State = iota
	Alive
	Suspended
	Gone
)

type Observation struct {
	State       State
	Incarnation Incarnation
}

// Match classifies the recorded incarnation. Reuse proves it gone, while an
// unobserved or suspended match grants no authority to act.
func (o Observation) Match(expected Incarnation) State {
	if !expected.Valid() {
		return Unknown
	}
	switch o.State {
	case Alive, Suspended:
		if o.Incarnation.PID != expected.PID || !o.Incarnation.Valid() {
			return Unknown
		}
		if o.Incarnation != expected {
			return Gone
		}
		if o.State == Alive {
			return Alive
		}
	case Gone:
		return Gone
	}
	return Unknown
}

type Observer struct {
	Process ports.Process
}

const probeLimit = 512

// Observe takes a fixed-path, fixed-locale ps observation with a bounded
// runner. ps-v1 is second-resolution evidence. It does not establish ownership.
// NOT PORTED (#6938): native process-table reads before the bounded ps fallback.
func (o Observer) Observe(ctx context.Context, pid int) (Observation, error) {
	if !validPID(pid) {
		return Observation{}, nil
	}
	if o.Process == nil {
		return Observation{}, errors.New("process observer requires a process runner")
	}
	ctx, cancel := context.WithTimeout(ctx, time.Second)
	defer cancel()
	spec := ports.ProcessSpec{
		Path: "/bin/ps", Args: []string{"-p", strconv.Itoa(pid), "-o", "lstart=", "-o", "stat="},
		Env: []string{"LC_ALL=C", "TZ=UTC"}, Timeout: time.Second, MaxOut: probeLimit,
	}
	got, err := o.Process.Run(ctx, spec)
	if errors.Is(err, os.ErrNotExist) && ctx.Err() == nil {
		spec.Path = "/usr/bin/ps"
		got, err = o.Process.Run(ctx, spec)
	}
	if err != nil {
		return Observation{}, fmt.Errorf("observe process %d: %w", pid, err)
	}
	if err := ctx.Err(); err != nil {
		return Observation{}, err
	}
	if got.Truncated {
		return Observation{}, fmt.Errorf("process %d observation exceeded its output limit", pid)
	}
	if got.ExitCode != 0 {
		if sys.ProcessGone(pid) {
			return Observation{State: Gone}, nil
		}
		return Observation{}, nil
	}
	return parse(pid, got.Stdout), nil
}

func validPID(pid int) bool {
	return pid > 0 && pid <= math.MaxInt32
}

func parse(pid int, output []byte) Observation {
	if !validPID(pid) || len(output) > probeLimit || !utf8.Valid(output) {
		return Observation{}
	}
	fields := strings.Fields(string(output))
	if len(fields) != 6 || !validStart(fields[:5]) {
		return Observation{}
	}
	state := fields[5]
	if strings.ContainsRune("ZXx", rune(state[0])) || strings.ContainsRune(state[1:], 'E') {
		return Observation{State: Gone}
	}
	var observed State
	switch state[0] {
	case 'T', 't':
		observed = Suspended
	case 'R', 'S', 'I', 'D', 'U':
		observed = Alive
	default:
		return Observation{}
	}
	return Observation{State: observed, Incarnation: Incarnation{PID: pid, Start: "ps-v1:" + strings.Join(fields[:5], " ")}}
}

func validStart(fields []string) bool {
	if len(fields) != 5 || len(fields[3]) != 8 || len(fields[4]) != 4 {
		return false
	}
	_, err := time.Parse("Mon Jan 2 15:04:05 2006", strings.Join(fields, " "))
	return err == nil
}
