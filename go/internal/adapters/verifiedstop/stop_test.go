//go:build darwin || linux

package verifiedstop

import (
	"context"
	"errors"
	"os/exec"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
)

type scriptedObserver struct {
	t    *testing.T
	rows []runtime.Observation
}

func (o *scriptedObserver) Observe(_ context.Context, pid int) (runtime.Observation, error) {
	o.t.Helper()
	if len(o.rows) == 0 || pid != 42 {
		o.t.Fatalf("unexpected observation of PID %d", pid)
	}
	row := o.rows[0]
	o.rows = o.rows[1:]
	return row, nil
}

func TestVerifiedStopChecksOwnershipAndOnlySignalsOnce(t *testing.T) {
	expected := runtime.Incarnation{PID: 42, Start: "ps-v1:Sat Jan 1 00:00:00 2000"}
	other := runtime.Incarnation{PID: 42, Start: "ps-v1:Sun Jan 2 00:00:00 2000"}
	alive := runtime.Observation{State: runtime.Alive, Incarnation: expected}
	reused := runtime.Observation{State: runtime.Alive, Incarnation: other}
	gone := runtime.Observation{State: runtime.Gone}
	unknown := runtime.Observation{}
	suspended := runtime.Observation{State: runtime.Suspended, Incarnation: expected}
	for _, tc := range []struct {
		name    string
		panePID int
		proof   runtime.Incarnation
		rows    []runtime.Observation
		send    bool
		refuse  bool
	}{
		{"already gone", 41, expected, []runtime.Observation{gone}, false, false},
		{"pane process", 42, expected, []runtime.Observation{alive}, false, true},
		{"suspended", 41, expected, []runtime.Observation{suspended}, false, true},
		{"shared or nested", 41, runtime.Incarnation{}, []runtime.Observation{alive}, false, true},
		{"changed proof", 41, other, []runtime.Observation{alive}, false, true},
		{"reused after proof", 41, expected, []runtime.Observation{alive, reused}, false, false},
		{"unknown after proof", 41, expected, []runtime.Observation{alive, unknown}, false, true},
		{"gone after TERM", 41, expected, []runtime.Observation{alive, alive, alive, gone}, true, false},
		{"unknown after TERM", 41, expected, []runtime.Observation{alive, alive, unknown}, true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			o := &scriptedObserver{t: t, rows: tc.rows}
			signals, releases := 0, 0
			pending, err := request(t.Context(), o, expected, tc.panePID, func(context.Context) (runtime.Incarnation, error) {
				return tc.proof, nil
			}, func(pid int) (target, error) {
				if pid != expected.PID {
					t.Fatalf("opened unexpected PID %d", pid)
				}
				return target{term: func() error { signals++; return nil }, release: func() { releases++ }}, nil
			})
			if err == nil {
				err = pending.Wait(t.Context())
			}
			if pending.Signalled() != tc.send || (signals == 1) != tc.send || signals > 1 || releases != 1 {
				t.Fatalf("Signalled = %t, sent = %d, releases = %d", pending.Signalled(), signals, releases)
			}
			if (tc.refuse && !errors.Is(err, ErrUnverified)) || (!tc.refuse && err != nil) || len(o.rows) != 0 {
				t.Fatalf("stop error = %v, remaining observations = %d", err, len(o.rows))
			}
		})
	}
}

func TestVerifiedStopOfOwnedChild(t *testing.T) {
	child := exec.Command("/bin/sleep", "30")
	if err := child.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = child.Process.Kill()
		if child.ProcessState == nil {
			_ = child.Wait()
		}
	})

	o := runtime.Observer{Process: process.Runner{}}
	got, err := o.Observe(t.Context(), child.Process.Pid)
	if err != nil || got.State != runtime.Alive || !got.Incarnation.Valid() {
		t.Fatalf("owned child observation = %+v, %v", got, err)
	}
	pending, err := (Stopper{Observer: o}).Request(t.Context(), got.Incarnation, 1,
		func(context.Context) (runtime.Incarnation, error) { return got.Incarnation, nil })
	if err != nil || !pending.Signalled() {
		t.Fatalf("Request = %t, %v", pending.Signalled(), err)
	}
	if err := pending.Wait(t.Context()); err != nil {
		t.Fatal(err)
	}
	if err := child.Wait(); err == nil || child.ProcessState.Exited() {
		t.Fatalf("child wait = %v, state %v", err, child.ProcessState)
	}
}
