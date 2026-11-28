package tick

import "github.com/tmt-ninja/tmt/go/internal/core"

const (
	minuteMillis      int64 = 60_000
	observationMillis int64 = 5 * minuteMillis
)

// Window tracks one clock lifetime's admission and slot observation. A new
// foreground clock starts at its current time, and a finite clock scans the
// preceding minute on its first pass.
type Window struct {
	previous int64
	minute   uint64
	begun    bool
}

func NewWindow(now uint64, foreground bool) (*Window, error) {
	if now == 0 || !core.ValidJSSafeInteger(now) {
		return nil, ErrInvalid
	}
	previous := int64(now)
	if !foreground {
		previous -= minuteMillis
	}
	return &Window{previous: previous}, nil
}

// BeginMinute admits jobs, Digest and capture together at most once for each
// strictly increasing wall minute.
func (w *Window) BeginMinute(now uint64) bool {
	if now == 0 || !core.ValidJSSafeInteger(now) {
		return false
	}
	minute := now / uint64(minuteMillis)
	if w.begun && minute <= w.minute {
		return false
	}
	w.minute, w.begun = minute, true
	return true
}

// Observe returns the exclusive lower slot boundary for a pass at now. A
// backwards clock starts a fresh baseline. A stalled clock drops older slots.
func (w *Window) Observe(now uint64) (int64, error) {
	if now == 0 || !core.ValidJSSafeInteger(now) {
		return 0, ErrInvalid
	}
	through := int64(now)
	after := min(through, max(w.previous, through-observationMillis))
	w.previous = through
	return after, nil
}
