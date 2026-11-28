package storage

import (
	"database/sql"
	"errors"
	"reflect"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

const reservationColumns = `target_binding_id, identity_id, transport, server_id, socket_path,
	server_pid, server_start_time, pane_id, pane_pid, pane_incarnation, old_binding_id,
	expected_binding_id, publisher_pid, publisher_start, created_at_ms, expires_at_ms`

func readReservation(row scanner) (*core.BindingReservation, error) {
	var reservation core.BindingReservation
	b := &reservation.Target
	if err := row.Scan(&b.ID, &b.IdentityID, &b.Server.Host, &b.Server.ID, &b.Server.Socket,
		&b.Server.PID, &b.Server.StartTime, &b.PaneID, &b.PanePID, &b.PaneIncarnation,
		&reservation.OldBindingID, &reservation.ExpectedBindingID, &reservation.Publisher.PID,
		&reservation.Publisher.StartIdentity, &reservation.CreatedAtMs, &reservation.ExpiresAtMs); err != nil {
		return nil, err
	}
	if !validReservation(reservation) {
		return nil, errors.New("invalid stored binding reservation")
	}
	return &reservation, nil
}

func (r bindingRows) FindReservationByIdentity(id core.IdentityID) (*core.BindingReservation, error) {
	return optional(readReservation(r.one("SELECT "+reservationColumns+" FROM binding_reservations WHERE identity_id = ?", id)))
}

func (r bindingRows) FindReservationByEndpoint(key core.EndpointKey) (*core.BindingReservation, error) {
	return optional(readReservation(r.one("SELECT "+reservationColumns+
		" FROM binding_reservations WHERE transport = ? AND server_id = ? AND pane_id = ?", key.Host, key.ServerID, key.PaneID)))
}

func (r bindingRows) reservationByTarget(id core.BindingID) (*core.BindingReservation, error) {
	return optional(readReservation(r.one("SELECT "+reservationColumns+" FROM binding_reservations WHERE target_binding_id = ?", id)))
}

func validReservation(reservation core.BindingReservation) bool {
	target := reservation.Target
	session := target.Session
	if session.RuntimeState == "unknown" {
		session.RuntimeState = ""
	}
	return canonicalBindingID(string(target.ID)) && canonicalBindingID(string(target.IdentityID)) &&
		target.Server.Host != "" && target.Server.ID != "" && target.Server.Socket != "" && target.Server.StartTime != "" &&
		target.PaneID != "" && safeTime(target.Server.PID) && safeTime(target.PanePID) &&
		(target.PaneIncarnation == nil || validStart(*target.PaneIncarnation)) &&
		session == (core.BindingSessionState{}) &&
		(reservation.OldBindingID == nil || canonicalBindingID(string(*reservation.OldBindingID))) &&
		(reservation.ExpectedBindingID == nil || canonicalBindingID(string(*reservation.ExpectedBindingID))) &&
		safeTime(reservation.Publisher.PID) && validStart(reservation.Publisher.StartIdentity) &&
		reservation.CreatedAtMs <= reservation.ExpiresAtMs && core.ValidJSSafeInteger(reservation.ExpiresAtMs)
}

func canonicalBindingID(id string) bool {
	if len(id) != 36 || id == "00000000-0000-0000-0000-000000000000" {
		return false
	}
	for i, ch := range id {
		switch i {
		case 8, 13, 18, 23:
			if ch != '-' {
				return false
			}
		default:
			if !strings.ContainsRune("0123456789abcdef", ch) {
				return false
			}
		}
	}
	return true
}

func (r bindingRows) Reserve(reservation core.BindingReservation, expected *core.Binding) (bool, error) {
	if !validReservation(reservation) || !matchesOldBinding(reservation, expected) {
		return false, errors.New("invalid binding reservation")
	}
	target := reservation.Target
	active, err := (identityRows{r.records}).FindByID(target.IdentityID)
	if err != nil || active == nil {
		return false, err
	}
	current, err := r.FindByIdentity(target.IdentityID)
	if err != nil || !matchBinding(current, expected, false) {
		return false, err
	}
	occupant, err := r.FindByEndpoint(target.EndpointKey())
	if err != nil || (occupant != nil && !matchBinding(occupant, expected, false)) {
		return false, err
	}
	var reusedID bool
	if err := r.one("SELECT EXISTS(SELECT 1 FROM bindings WHERE id = ?)", target.ID).Scan(&reusedID); err != nil || reusedID {
		return false, err
	}
	if existing, err := r.FindReservationByIdentity(target.IdentityID); err != nil || existing != nil {
		return false, err
	}
	if existing, err := r.FindReservationByEndpoint(target.EndpointKey()); err != nil || existing != nil {
		return false, err
	}
	return affectedOne(r.exec(`INSERT INTO binding_reservations (`+reservationColumns+`)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT DO NOTHING`, target.ID, target.IdentityID, target.Server.Host, target.Server.ID,
		target.Server.Socket, target.Server.PID, target.Server.StartTime, target.PaneID, target.PanePID,
		target.PaneIncarnation, reservation.OldBindingID, reservation.ExpectedBindingID,
		reservation.Publisher.PID, reservation.Publisher.StartIdentity, reservation.CreatedAtMs, reservation.ExpiresAtMs))
}

func matchesOldBinding(reservation core.BindingReservation, expected *core.Binding) bool {
	if expected == nil {
		return reservation.OldBindingID == nil
	}
	return reservation.OldBindingID != nil && *reservation.OldBindingID == expected.ID &&
		expected.IdentityID == reservation.Target.IdentityID
}

func (r bindingRows) Activate(reservation core.BindingReservation, expected *core.Binding, nowMs uint64) (*core.Binding, error) {
	if !validReservation(reservation) || !matchesOldBinding(reservation, expected) {
		return nil, errors.New("invalid binding activation")
	}
	timestamp, err := storedTimestamp(nowMs)
	if err != nil {
		return nil, err
	}
	if nowMs < reservation.CreatedAtMs || nowMs >= reservation.ExpiresAtMs {
		return nil, nil
	}
	target := reservation.Target
	observed, err := r.reservationByTarget(target.ID)
	if err != nil || !sameReservation(observed, reservation) {
		return nil, err
	}
	identity, err := (identityRows{r.records}).FindByID(target.IdentityID)
	if err != nil || identity == nil {
		return nil, err
	}
	current, err := r.FindByIdentity(target.IdentityID)
	if err != nil || !matchBinding(current, expected, true) {
		return nil, err
	}
	occupant, err := r.FindByEndpoint(target.EndpointKey())
	if err != nil || (occupant != nil && !matchBinding(occupant, expected, true)) {
		return nil, err
	}
	if current != nil {
		ok, err := affectedOne(r.exec("DELETE FROM bindings WHERE id = ? AND identity_id = ?", current.ID, current.IdentityID))
		if err != nil || !ok {
			return nil, requiredMutation(ok, err, "binding changed before activation")
		}
	}
	_, err = r.exec(`INSERT INTO bindings (id, identity_id, transport, server_id, socket_path,
		server_pid, server_start_time, pane_id, pane_pid, pane_incarnation, bound_at, last_verified_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, target.ID, target.IdentityID, target.Server.Host,
		target.Server.ID, target.Server.Socket, target.Server.PID, target.Server.StartTime, target.PaneID,
		target.PanePID, target.PaneIncarnation, timestamp, timestamp)
	if err != nil {
		return nil, err
	}
	ok, err := r.ReleaseReservation(reservation)
	if err != nil || !ok {
		return nil, requiredMutation(ok, err, "binding reservation changed during activation")
	}
	return r.FindByIdentity(target.IdentityID)
}

func sameReservation(observed *core.BindingReservation, expected core.BindingReservation) bool {
	if observed == nil {
		return false
	}
	if expected.Target.Session.RuntimeState == "unknown" {
		expected.Target.Session.RuntimeState = ""
	}
	return reflect.DeepEqual(*observed, expected)
}

func matchBinding(current, expected *core.Binding, allowSettled bool) bool {
	if reflect.DeepEqual(current, expected) {
		return true
	}
	if !allowSettled || expected == nil || expected.Session.Runtime == nil || expected.Session.LaunchOwner == nil {
		return false
	}
	settled := *expected
	ended := "ended"
	settled.Session.RuntimeState = ended
	settled.Session.LastTransition = &ended
	settled.Session.PlainProgram = nil
	return reflect.DeepEqual(current, &settled)
}

func (r bindingRows) ReleaseReservation(expected core.BindingReservation) (bool, error) {
	current, err := r.reservationByTarget(expected.Target.ID)
	if err != nil || !sameReservation(current, expected) {
		return false, err
	}
	return affectedOne(r.exec("DELETE FROM binding_reservations WHERE target_binding_id = ?", expected.Target.ID))
}

func (r bindingRows) Touch(expected core.Binding, nowMs uint64) (bool, error) {
	timestamp, err := storedTimestamp(nowMs)
	if err != nil {
		return false, err
	}
	current, err := r.FindByIdentity(expected.IdentityID)
	if err != nil || !matchBinding(current, &expected, false) {
		return false, err
	}
	return affectedOne(r.exec("UPDATE bindings SET last_verified_at = ? WHERE id = ?", timestamp, expected.ID))
}

func (r bindingRows) Detach(expected core.Binding) (bool, error) {
	current, err := r.FindByIdentity(expected.IdentityID)
	if err != nil || !matchBinding(current, &expected, false) {
		return false, err
	}
	reservation, err := r.FindReservationByIdentity(expected.IdentityID)
	if err != nil || reservation != nil {
		return false, err
	}
	// NOT PORTED (#6938): ending a binding's Digest continuation.
	return affectedOne(r.exec("DELETE FROM bindings WHERE id = ? AND identity_id = ?", expected.ID, expected.IdentityID))
}

func affectedOne(result sql.Result, err error) (bool, error) {
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count == 1, err
}

func requiredMutation(ok bool, err error, message string) error {
	if !ok && err == nil {
		return errors.New(message)
	}
	return err
}
