package core

import (
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"
)

type RoomID string

type MeetingRoom struct {
	ID        RoomID
	Name      string
	Revision  uint64
	Retired   bool
	MemberIDs []IdentityID
}

type RoomWrite struct {
	ExpectedRevision uint64
	Name             string
	MemberIDs        []IdentityID
}

func (w RoomWrite) Normalize() (RoomWrite, bool) {
	const maxMembers = 64
	if w.ExpectedRevision >= MaxJSSafeInteger || len(w.Name) > 80 ||
		strings.TrimSpace(w.Name) == "" || !utf8.ValidString(w.Name) ||
		strings.ContainsFunc(w.Name, unicode.IsControl) || len(w.MemberIDs) > maxMembers {
		return RoomWrite{}, false
	}
	members := make([]IdentityID, len(w.MemberIDs))
	for i, id := range w.MemberIDs {
		if !ValidUUID(string(id)) {
			return RoomWrite{}, false
		}
		members[i] = id
	}
	slices.Sort(members)
	w.MemberIDs = slices.Compact(members)
	return w, true
}

type RoomMembershipChange uint8

const (
	RoomMembershipJoin RoomMembershipChange = iota + 1
	RoomMembershipLeave
)

type RoomFailure struct {
	Code string
}

func (f *RoomFailure) Error() string { return f.Code }
