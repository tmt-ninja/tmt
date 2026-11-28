package ports

import "github.com/tmt-ninja/tmt/go/internal/core"

// IdentityRepo reads active identities. Insert and Promote take the explicit
// write time. The timestamps on the returned Identity reflect stored values.
type IdentityRepo interface {
	core.IdentityReader
	List() ([]core.Identity, error)
	Insert(identity core.Identity, nowMs uint64) error
	Promote(id core.IdentityID, nowMs uint64) error
	Rename(expected core.Identity, next core.ValidatedName, nowMs uint64) (*core.Identity, error)
	Retire(expected core.Identity, expectedBinding *core.Binding, removeContent bool, nowMs uint64) (bool, error)
}

// BindingRepo reads recorded bindings. Presence requires separate evidence.
type BindingRepo interface {
	FindByIdentity(core.IdentityID) (*core.Binding, error)
	FindByEndpoint(core.EndpointKey) (*core.Binding, error)
	List() ([]core.Binding, error)

	FindReservationByIdentity(core.IdentityID) (*core.BindingReservation, error)
	FindReservationByEndpoint(core.EndpointKey) (*core.BindingReservation, error)
	Reserve(reservation core.BindingReservation, expectedBinding *core.Binding) (bool, error)
	// Activate is called after the caller publishes and re-observes the target marker.
	Activate(reservation core.BindingReservation, expectedBinding *core.Binding, nowMs uint64) (*core.Binding, error)
	ReleaseReservation(expected core.BindingReservation) (bool, error)
	Touch(expected core.Binding, nowMs uint64) (bool, error)
	Detach(expected core.Binding) (bool, error)
	CreateLaunchIntent(LaunchIntent) (bool, error)
	AdmitLaunch(LaunchAdmission) (*core.Binding, error)
	EndLaunch(LaunchEnd) (bool, error)
	// CanClosePane checks the exact ended binding and outstanding launches in
	// a read snapshot. Release the transaction before the verified host close.
	CanClosePane(expected core.Binding, observedAtMs uint64) (bool, error)
	ObserveLaunchActivity(LaunchActivityObservation) (bool, error)
}

// LaunchActivityObservation contains startup evidence verified outside SQLite.
type LaunchActivityObservation struct {
	Expected        core.Binding
	Owner           core.ProcessIncarnation
	Runtime         core.ProcessIncarnation
	ProviderSession string
	Transition      core.LaunchTransition
	InitialIdle     bool
	ObservedAtMs    uint64
}

type RequestRepo interface {
	FindByID(core.RequestID) (*core.RequestAttempt, error)
	FindByAttemptID(core.AttemptID) (*core.RequestAttempt, error)
	Insert(attempt core.RequestAttempt, prompt string) error
	UpdateState(core.AttemptTransition) (bool, error)
	ReleaseWait(id core.AttemptID, nowMs uint64) error
}

type ResponseRepo interface {
	FindByRequest(core.RequestID) (*core.FinalResponse, error)
	Insert(core.FinalResponse) error
}

// LaunchIntent fences one existing binding and the invocation that may launch
// its next foreground runtime. Creating it does not establish runtime state.
type LaunchIntent struct {
	Expected    core.Binding
	Owner       core.ProcessIncarnation
	Driver      core.DriverName
	CreatedAtMs uint64
	ExpiresAtMs uint64
}

// LaunchAdmission supplies live foreground runtime evidence obtained outside
// the write transaction for the exact intent.
type LaunchAdmission struct {
	Intent       LaunchIntent
	Runtime      core.ProcessIncarnation
	ObservedAtMs uint64
}

// LaunchEnd carries verified exit evidence for one admitted foreground
// runtime. Storage rechecks the full binding and both process incarnations.
type LaunchEnd struct {
	Expected       core.Binding
	Owner, Runtime core.ProcessIncarnation
	ObservedAtMs   uint64
}
