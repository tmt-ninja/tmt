package storage

import (
	"errors"
	"slices"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type roomRows struct{ records }

func (r roomRows) ListActive() ([]core.MeetingRoom, error) {
	rooms, err := scanRows(r.records, `SELECT room_id,name,revision,retired
		FROM office_meeting_rooms WHERE retired=0 ORDER BY name,room_id`, decodeRoom)
	if err != nil {
		return nil, err
	}
	for i := range rooms {
		rooms[i].MemberIDs, err = r.members(rooms[i].ID)
		if err != nil {
			return nil, err
		}
	}
	return rooms, nil
}

func (r roomRows) FindActive(id core.RoomID) (*core.MeetingRoom, error) {
	room, err := r.FindHistorical(id)
	if err != nil || room == nil || room.Retired {
		return nil, err
	}
	return room, nil
}

func (r roomRows) FindHistorical(id core.RoomID) (*core.MeetingRoom, error) {
	if !core.ValidUUID(string(id)) {
		return nil, &core.RoomFailure{Code: "ROOM_INVALID"}
	}
	row := r.one("SELECT room_id,name,revision,retired FROM office_meeting_rooms WHERE room_id=?", id)
	room, err := decodeRoom(row)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	room.MemberIDs, err = r.members(id)
	if err != nil {
		return nil, err
	}
	return &room, nil
}

func decodeRoom(row scanner) (core.MeetingRoom, error) {
	var room core.MeetingRoom
	if err := row.Scan(&room.ID, &room.Name, &room.Revision, &room.Retired); err != nil {
		return core.MeetingRoom{}, err
	}
	if !core.ValidUUID(string(room.ID)) || !safeTime(room.Revision) {
		return core.MeetingRoom{}, errors.New("invalid stored meeting room definition")
	}
	return room, nil
}

func (r roomRows) members(id core.RoomID) ([]core.IdentityID, error) {
	return scanRows(r.records, `SELECT m.identity_id FROM office_meeting_members m
		JOIN identities i ON i.id=m.identity_id
		WHERE m.room_id=? AND i.retired_at_ms IS NULL ORDER BY m.identity_id`, func(row scanner) (core.IdentityID, error) {
		var member core.IdentityID
		err := row.Scan(&member)
		return member, err
	}, id)
}

func (r roomRows) Put(id core.RoomID, input core.RoomWrite) (core.MeetingRoom, error) {
	input, valid := input.Normalize()
	if !valid || !core.ValidUUID(string(id)) {
		return core.MeetingRoom{}, &core.RoomFailure{Code: "ROOM_INVALID"}
	}
	current, err := r.FindHistorical(id)
	if err != nil {
		return core.MeetingRoom{}, err
	}
	return r.writeRoom(id, input, current)
}

func (r roomRows) Retire(id core.RoomID, expectedRevision uint64) (core.MeetingRoom, error) {
	if !safeTime(expectedRevision) {
		return core.MeetingRoom{}, &core.RoomFailure{Code: "ROOM_INVALID"}
	}
	current, err := r.FindHistorical(id)
	if err != nil {
		return core.MeetingRoom{}, err
	}
	if current == nil {
		return core.MeetingRoom{}, &core.RoomFailure{Code: "ROOM_NOT_FOUND"}
	}
	if current.Retired && (current.Revision == expectedRevision || current.Revision == expectedRevision+1) {
		return *current, nil
	}
	if current.Retired || current.Revision != expectedRevision || expectedRevision == core.MaxJSSafeInteger {
		return core.MeetingRoom{}, &core.RoomFailure{Code: "ROOM_REVISION_CONFLICT"}
	}
	if _, err := r.exec("UPDATE office_meeting_rooms SET retired=1,revision=revision+1 WHERE room_id=?", id); err != nil {
		return core.MeetingRoom{}, err
	}
	current.Retired = true
	current.Revision++
	return *current, nil
}

func (r roomRows) ChangeMembership(id core.RoomID, member core.IdentityID, change core.RoomMembershipChange) (core.MeetingRoom, error) {
	if !core.ValidUUID(string(member)) || change != core.RoomMembershipJoin && change != core.RoomMembershipLeave {
		return core.MeetingRoom{}, &core.RoomFailure{Code: "ROOM_INVALID"}
	}
	current, err := r.FindActive(id)
	if err != nil {
		return core.MeetingRoom{}, err
	}
	if current == nil {
		return core.MeetingRoom{}, &core.RoomFailure{Code: "ROOM_NOT_FOUND"}
	}
	members := slices.Clone(current.MemberIDs)
	switch change {
	case core.RoomMembershipJoin:
		if !slices.Contains(members, member) {
			members = append(members, member)
		}
	case core.RoomMembershipLeave:
		members = slices.DeleteFunc(members, func(id core.IdentityID) bool { return id == member })
	}
	input, valid := (core.RoomWrite{
		ExpectedRevision: current.Revision, Name: current.Name, MemberIDs: members,
	}).Normalize()
	if !valid {
		return core.MeetingRoom{}, &core.RoomFailure{Code: "ROOM_INVALID"}
	}
	return r.writeRoom(id, input, current)
}

func (r roomRows) writeRoom(id core.RoomID, input core.RoomWrite, current *core.MeetingRoom) (core.MeetingRoom, error) {
	var revision uint64
	if current != nil {
		if current.Retired {
			return core.MeetingRoom{}, &core.RoomFailure{Code: "ROOM_RETIRED"}
		}
		revision = current.Revision
	}
	if revision != input.ExpectedRevision {
		return core.MeetingRoom{}, &core.RoomFailure{Code: "ROOM_REVISION_CONFLICT"}
	}
	for _, member := range input.MemberIDs {
		var active bool
		err := r.one("SELECT EXISTS(SELECT 1 FROM identities WHERE id=? AND retired_at_ms IS NULL)", member).Scan(&active)
		if err != nil {
			return core.MeetingRoom{}, err
		}
		if !active {
			return core.MeetingRoom{}, &core.RoomFailure{Code: "ROOM_IDENTITY_INACTIVE"}
		}
	}
	if current != nil && current.Name == input.Name && slices.Equal(current.MemberIDs, input.MemberIDs) {
		return *current, nil
	}
	revision++
	if _, err := r.exec(`INSERT INTO office_meeting_rooms(room_id,name,revision) VALUES (?,?,?)
		ON CONFLICT(room_id) DO UPDATE SET name=excluded.name,revision=excluded.revision`,
		id, input.Name, revision); err != nil {
		return core.MeetingRoom{}, err
	}
	if _, err := r.exec("DELETE FROM office_meeting_members WHERE room_id=?", id); err != nil {
		return core.MeetingRoom{}, err
	}
	for _, member := range input.MemberIDs {
		if _, err := r.exec("INSERT INTO office_meeting_members(room_id,identity_id) VALUES (?,?)", id, member); err != nil {
			return core.MeetingRoom{}, err
		}
	}
	return core.MeetingRoom{ID: id, Name: input.Name, Revision: revision, MemberIDs: input.MemberIDs}, nil
}
