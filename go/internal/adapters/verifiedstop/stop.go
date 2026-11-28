//go:build darwin || linux

package verifiedstop

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const allowance = 3 * time.Second

var (
	ErrUnverified = errors.New("the agent's process incarnation could not be verified")
	ErrTimedOut   = errors.New("the agent did not conclusively exit within the stop allowance")
)

// PrivateMainProof rechecks binding ownership and the driver's private main
// foreground in the caller's binding writer. A shared or nested runtime cannot
// produce a proof. The process must not be the pane itself.
type PrivateMainProof func(context.Context) (runtime.Incarnation, error)

type observer interface {
	Observe(context.Context, int) (runtime.Observation, error)
}

// Stopper sends one TERM after an exact recheck. It has no escalation path.
type Stopper struct {
	Observer runtime.Observer
}

// Request may send TERM. The caller must first verify the captured binding and
// supply its pane PID. Request runs inside the binding writer that serializes
// replacement, and Wait runs after releasing it. A gone result proves only
// process loss and cannot authorize a binding mutation by itself.
func (s Stopper) Request(ctx context.Context, expected runtime.Incarnation, panePID int, prove PrivateMainProof) (Pending, error) {
	return request(ctx, s.Observer, expected, panePID, prove, openTarget)
}

type target struct {
	term    func() error
	release func()
}

func openTarget(pid int) (target, error) {
	process, err := os.FindProcess(pid)
	if err != nil {
		return target{}, err
	}
	return target{
		term:    func() error { return sys.TerminateProcess(process) },
		release: func() { _ = process.Release() },
	}, nil
}

// Pending is observation-only after Request returns.
type Pending struct {
	signalled bool
	observer  observer
	expected  runtime.Incarnation
	deadline  time.Time
}

func request(ctx context.Context, o observer, expected runtime.Incarnation, panePID int, prove PrivateMainProof, open func(int) (target, error)) (Pending, error) {
	if !expected.Valid() || panePID <= 0 || prove == nil {
		return Pending{}, ErrUnverified
	}
	ctx, cancel := context.WithTimeout(ctx, allowance)
	defer cancel()
	deadline, _ := ctx.Deadline()
	if err := ctx.Err(); err != nil {
		return Pending{}, stopError(err)
	}

	// On Linux this pins the target through pidfd before the last observation.
	// Darwin uses the PID, so keep the last observation adjacent to the signal.
	child, err := open(expected.PID)
	if err != nil {
		return Pending{}, err
	}
	defer child.release()

	observation, err := o.Observe(ctx, expected.PID)
	if err != nil {
		return Pending{}, stopError(err)
	}
	switch observation.Match(expected) {
	case runtime.Gone:
		return Pending{}, nil
	case runtime.Alive:
		if expected.PID == panePID {
			return Pending{}, ErrUnverified
		}
	default:
		return Pending{}, ErrUnverified
	}

	incarnation, err := prove(ctx)
	if err != nil {
		return Pending{}, stopError(err)
	}
	if incarnation != expected {
		return Pending{}, ErrUnverified
	}

	observation, err = o.Observe(ctx, expected.PID)
	if err != nil {
		return Pending{}, stopError(err)
	}
	if err := ctx.Err(); err != nil {
		return Pending{}, stopError(err)
	}
	switch observation.Match(expected) {
	case runtime.Gone:
		return Pending{}, nil
	case runtime.Alive:
	default:
		return Pending{}, ErrUnverified
	}
	err = child.term()
	if errors.Is(err, os.ErrProcessDone) {
		return Pending{}, nil
	}
	if err != nil {
		return Pending{}, fmt.Errorf("send TERM to verified process %d: %w", expected.PID, err)
	}
	return Pending{signalled: true, observer: o, expected: expected, deadline: deadline}, nil
}

// Signalled reports whether Request successfully sent its one TERM.
func (p Pending) Signalled() bool { return p.signalled }

// Wait observes until the exact incarnation is conclusively gone.
func (p Pending) Wait(ctx context.Context) error {
	if !p.signalled {
		return nil
	}
	ctx, cancel := context.WithDeadline(ctx, p.deadline)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return stopError(err)
	}
	tick := time.NewTicker(25 * time.Millisecond)
	defer tick.Stop()
	for {
		got, err := p.observer.Observe(ctx, p.expected.PID)
		if err != nil {
			return stopError(err)
		}
		if err := ctx.Err(); err != nil {
			return stopError(err)
		}
		switch got.Match(p.expected) {
		case runtime.Gone:
			return nil
		case runtime.Alive:
		default:
			return ErrUnverified
		}
		select {
		case <-ctx.Done():
			return stopError(ctx.Err())
		case <-tick.C:
		}
	}
}

func stopError(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.Join(ErrTimedOut, err)
	}
	return err
}
