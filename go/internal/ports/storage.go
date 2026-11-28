package ports

import "github.com/tmt-ninja/tmt/go/internal/core"

// IdentityRepo reads active identities. Insert and Promote take the explicit
// write time. The timestamps on the returned Identity reflect stored values.
type IdentityRepo interface {
	core.IdentityReader
	List() ([]core.Identity, error)
	Insert(identity core.Identity, nowMs uint64) error
	Promote(id core.IdentityID, nowMs uint64) error
}

// BindingRepo reads recorded bindings. Presence requires separate evidence.
type BindingRepo interface {
	FindByIdentity(core.IdentityID) (*core.Binding, error)
	FindByEndpoint(core.EndpointKey) (*core.Binding, error)
	List() ([]core.Binding, error)
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
