package ports

import "github.com/tmt-ninja/tmt/go/internal/core"

// ProfileRepo operates only on profiles of active identities in this transaction.
type ProfileRepo interface {
	Get(kind core.ProfileKind, id core.IdentityID) (*core.TextProfile, error)
	List(kind core.ProfileKind) ([]core.TextProfile, error)
	Put(kind core.ProfileKind, id core.IdentityID, content string, nowMs uint64) (*core.TextProfile, error)
	Remove(kind core.ProfileKind, id core.IdentityID) (bool, error)
}
