package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"slices"
	"strconv"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func (app application) runRoom(ctx context.Context, root home.Root, inv invocation) output.Report {
	action := inv.path[1]
	if action == "send" || action == "broadcast" {
		return app.runRoomDispatch(ctx, root, inv)
	}
	var selection identitySelection
	if action == "join" || action == "leave" {
		var failure *output.Failure
		selection, failure = app.caller.selectIdentity(ctx, inv)
		if failure != nil {
			return failure
		}
	}
	return withIdentityStoreError(ctx, root, app.store, func(err error) *output.Failure {
		if errors.Is(err, os.ErrPermission) {
			return identityStorageNotWritable(root, "No room was changed.")
		}
		return roomFailure(err)
	}, func(store ports.Store) output.Report {
		transact := store.Write
		if action == "ls" || action == "show" {
			transact = store.Read
		}
		var report roomReport
		if err := transact(ctx, func(tx ports.StoreTx) error {
			rooms := tx.Rooms()
			switch action {
			case "ls":
				listed, err := rooms.ListActive()
				report.rooms = listed
				return err
			case "create":
				room, err := rooms.Put(core.RoomID(talkUUID()), core.RoomWrite{Name: inv.operands[0]})
				report.room = &room
				return err
			}
			room, err := resolveRoom(rooms, inv.operands[0], action == "show" || action == "rm")
			if err != nil {
				return err
			}
			switch action {
			case "show":
				report.room = room
				return nil
			case "rm":
				result, err := rooms.Retire(room.ID, room.Revision)
				report.room = &result
				return err
			case "join", "leave":
				member, err := resolveSelectedIdentity(tx, selection)
				if err != nil {
					return err
				}
				change := core.RoomMembershipJoin
				if action == "leave" {
					change = core.RoomMembershipLeave
				}
				result, err := rooms.ChangeMembership(room.ID, member.ID, change)
				report.room = &result
				return err
			}
			return errors.New("unknown room operation")
		}); err != nil {
			return roomFailure(err)
		}
		return report
	})
}

func resolveRoom(repo ports.RoomRepo, selector string, historical bool) (*core.MeetingRoom, error) {
	if core.ValidUUID(selector) && selector != "00000000-0000-0000-0000-000000000000" {
		find := repo.FindActive
		if historical {
			find = repo.FindHistorical
		}
		room, err := find(core.RoomID(selector))
		if err != nil || room != nil {
			return room, err
		}
	} else {
		rooms, err := repo.ListActive()
		if err != nil {
			return nil, err
		}
		matches := slices.DeleteFunc(rooms, func(room core.MeetingRoom) bool { return room.Name != selector })
		switch len(matches) {
		case 0:
		case 1:
			return &matches[0], nil
		default:
			ids := make([]string, 0, len(matches))
			for _, room := range matches {
				ids = append(ids, string(room.ID))
			}
			return nil, bindingFailure("ROOM_AMBIGUOUS", fmt.Sprintf("Room name '%s' is ambiguous. Use one of these UUIDs: %s.", selector, strings.Join(ids, ", ")), 1)
		}
	}
	return nil, bindingFailure("ROOM_NOT_FOUND", fmt.Sprintf("Room '%s' was not found.", selector), 3)
}

func roomFailure(err error) *output.Failure {
	var failure *output.Failure
	if errors.As(err, &failure) {
		return failure
	}
	var state *core.RoomFailure
	if errors.As(err, &state) {
		switch state.Code {
		case "ROOM_INVALID":
			return bindingFailure(state.Code, "Invalid room name, identifier or membership.", 1)
		case "ROOM_NOT_FOUND":
			return bindingFailure(state.Code, "Room was not found.", 3)
		case "ROOM_REVISION_CONFLICT":
			return bindingFailure(state.Code, "Room changed; refresh before retrying.", 1)
		case "ROOM_IDENTITY_INACTIVE":
			return bindingFailure(state.Code, "A selected identity is no longer active.", 3)
		case "ROOM_RETIRED":
			return bindingFailure(state.Code, "Room is retired; history is retained but new work is disabled.", 1)
		}
	}
	return bindingFailure("STORAGE_UNAVAILABLE", "Could not access room storage.", 1)
}

type roomDocument struct {
	ID        core.RoomID       `json:"id"`
	Name      string            `json:"name"`
	Revision  uint64            `json:"revision"`
	Retired   bool              `json:"retired"`
	MemberIDs []core.IdentityID `json:"memberIds"`
}

func roomJSON(room core.MeetingRoom) roomDocument {
	return roomDocument{room.ID, room.Name, room.Revision, room.Retired,
		append([]core.IdentityID{}, room.MemberIDs...)}
}

type roomReport struct {
	room  *core.MeetingRoom
	rooms []core.MeetingRoom
}

func (r roomReport) JSON() any {
	if r.room != nil {
		return struct {
			Room roomDocument `json:"room"`
		}{roomJSON(*r.room)}
	}
	rooms := make([]roomDocument, 0, len(r.rooms))
	for _, room := range r.rooms {
		rooms = append(rooms, roomJSON(room))
	}
	return struct {
		Rooms []roomDocument `json:"rooms"`
	}{rooms}
}

func (roomReport) HumanStream() output.Stream { return output.Stdout }
func (roomReport) ExitStatus() int            { return 0 }
func (r roomReport) Human(w io.Writer) error {
	term := outputTerminal(w)
	if r.room != nil {
		members := make([]string, 0, len(r.room.MemberIDs))
		for _, id := range r.room.MemberIDs {
			members = append(members, string(id))
		}
		memberLabels := "-"
		if len(members) != 0 {
			memberLabels = strings.Join(members, ", ")
		}
		state := "active"
		if r.room.Retired {
			state = "retired"
		}
		return clistyle.WriteDetail(w, term, r.room.Name, []clistyle.DetailField{
			{Label: "state", Value: state},
			{Label: "revision", Value: strconv.FormatUint(r.room.Revision, 10)},
			{Label: "id", Value: string(r.room.ID)},
			{Label: "members", Value: memberLabels},
		})
	}
	if len(r.rooms) == 0 {
		if _, err := fmt.Fprintln(w, "No rooms."); err != nil {
			return err
		}
		return clistyle.WriteHint(w, term, flavor.Binary+" room create <name>")
	}
	rooms := slices.Clone(r.rooms)
	slices.SortStableFunc(rooms, func(a, b core.MeetingRoom) int { return strings.Compare(a.Name, b.Name) })
	sections := make([]clistyle.ListSection, 0, 2)
	for _, retired := range []bool{false, true} {
		count := 0
		title := "active"
		if retired {
			title = "retired"
		}
		table := clistyle.NewTable(clistyle.ColumnName, clistyle.ColumnFixed, clistyle.ColumnFixed)
		for _, room := range rooms {
			if room.Retired != retired {
				continue
			}
			count++
			members := fmt.Sprintf("%d members", len(room.MemberIDs))
			if len(room.MemberIDs) == 1 {
				members = "1 member"
			}
			table.AddRow(clistyle.Cell{Text: room.Name}, clistyle.Cell{Text: members},
				clistyle.Cell{Text: clistyle.ShortID(string(room.ID)), Token: clistyle.TokenDim})
		}
		if count != 0 {
			sections = append(sections, clistyle.ListSection{Title: title, Count: &count, Rows: table})
		}
	}
	return clistyle.WriteList(w, term, sections)
}
