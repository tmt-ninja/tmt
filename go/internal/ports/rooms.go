package ports

import "github.com/tmt-ninja/tmt/go/internal/core"

// RoomRepo is scoped to one Store transaction. Roster mutations require a writer.
type RoomRepo interface {
	ListActive() ([]core.MeetingRoom, error)
	FindActive(core.RoomID) (*core.MeetingRoom, error)
	FindHistorical(core.RoomID) (*core.MeetingRoom, error)
	Put(core.RoomID, core.RoomWrite) (core.MeetingRoom, error)
	Retire(core.RoomID, uint64) (core.MeetingRoom, error)
	ChangeMembership(core.RoomID, core.IdentityID, core.RoomMembershipChange) (core.MeetingRoom, error)
}
