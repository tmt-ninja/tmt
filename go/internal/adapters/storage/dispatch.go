package storage

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"slices"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

var _ ports.RoomDispatcher = (*RequestService)(nil)

const maxDispatchReceiptBytes = 16_384

var errInvalidDispatchReceipt = errors.New("invalid stored dispatch receipt")

func (s *RequestService) DispatchRoom(ctx context.Context, input core.RoomDispatchInput) (core.DispatchReceipt, error) {
	in, valid := input.Normalize()
	if !valid {
		return core.DispatchReceipt{}, invalidRoomDispatch()
	}
	digest, err := roomDispatchDigest(in)
	if err != nil {
		return core.DispatchReceipt{}, err
	}
	calendar, err := s.store.loadDigestCalendar(ctx)
	if err != nil {
		return core.DispatchReceipt{}, err
	}

	var receipt core.DispatchReceipt
	err = s.store.transact(ctx, false, func(r records) error {
		var err error
		receipt, err = s.dispatchRoom(r, in, digest, calendar)
		return err
	})
	if err != nil {
		return core.DispatchReceipt{}, err
	}
	return receipt, nil
}

func invalidRoomDispatch() error {
	return requestFailure("DISPATCH_INVALID", "Invalid message, operation ID or room audience.", 1)
}

func (s *RequestService) dispatchRoom(r records, in core.RoomDispatchInput, digest string, cal digestCalendar) (core.DispatchReceipt, error) {
	replayed, err := replayRoomDispatch(r, in, digest)
	if err != nil {
		return core.DispatchReceipt{}, err
	}
	if replayed != nil {
		return *replayed, nil
	}
	room, err := (roomRows{r}).FindActive(in.RoomID)
	if err != nil {
		return core.DispatchReceipt{}, err
	}
	if room == nil || room.Revision != in.Revision || !roomContainsAudience(room.MemberIDs, in.RecipientIDs) {
		return core.DispatchReceipt{}, requestFailure("ROOM_ROSTER_CHANGED", "Room membership changed before enqueue. Refresh the room before retrying.", 1)
	}
	now, err := requestNow(s.clock)
	if err != nil {
		return core.DispatchReceipt{}, invalidRoomDispatch()
	}
	expires, ok := core.CheckedDeadline(now, core.RequestMinExpiryMs)
	if !ok {
		return core.DispatchReceipt{}, invalidRoomDispatch()
	}
	sending, err := readRoomSending(r, in, cal, now)
	if err != nil {
		return core.DispatchReceipt{}, err
	}
	receipt := core.DispatchReceipt{OperationID: in.OperationID, CreatedAtMs: now, Items: make([]core.DispatchItem, 0, len(in.RecipientIDs))}
	for _, recipient := range in.RecipientIDs {
		item, err := composeRoomRecipient(r, in, recipient, sending, cal, now, expires)
		if err != nil {
			return core.DispatchReceipt{}, err
		}
		receipt.Items = append(receipt.Items, item)
	}
	encoded, err := json.Marshal(receipt)
	if err != nil {
		return core.DispatchReceipt{}, err
	}
	_, err = r.exec("INSERT INTO office_dispatch_operations(operation_id,intent_digest,receipt) VALUES (?,?,?)",
		receipt.OperationID, digest, string(encoded))
	return receipt, err
}

func roomContainsAudience(members, recipients []core.IdentityID) bool {
	for _, id := range recipients {
		if !slices.Contains(members, id) {
			return false
		}
	}
	return true
}

func replayRoomDispatch(r records, in core.RoomDispatchInput, digest string) (*core.DispatchReceipt, error) {
	var storedDigest string
	var encoded []byte
	err := r.one("SELECT intent_digest,receipt FROM office_dispatch_operations WHERE operation_id=?", in.OperationID).
		Scan(&storedDigest, &encoded)
	if isNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	receipt, err := decodeDispatchReceipt(encoded, in.OperationID)
	if err != nil {
		return nil, err
	}
	if storedDigest != digest {
		return nil, requestFailure("DISPATCH_IDEMPOTENCY_CONFLICT", "This operation ID already belongs to a different sender, message or room audience.", 1)
	}
	if len(receipt.Items) != len(in.RecipientIDs) {
		return nil, errInvalidDispatchReceipt
	}
	for i, item := range receipt.Items {
		if item.RecipientID != in.RecipientIDs[i] {
			return nil, errInvalidDispatchReceipt
		}
	}
	return &receipt, nil
}

func decodeDispatchReceipt(data []byte, operation core.DispatchOperationID) (core.DispatchReceipt, error) {
	var receipt core.DispatchReceipt
	if len(data) > maxDispatchReceiptBytes ||
		json.Unmarshal(data, &receipt, json.RejectUnknownMembers(true)) != nil ||
		receipt.OperationID != operation || !receipt.Valid() {
		return core.DispatchReceipt{}, errInvalidDispatchReceipt
	}
	return receipt, nil
}

func roomDispatchDigest(in core.RoomDispatchInput) (string, error) {
	type room struct {
		Kind     string      `json:"kind"`
		RoomID   core.RoomID `json:"roomId"`
		Revision uint64      `json:"revision"`
	}
	type originator struct {
		Kind       core.OriginatorKind `json:"kind"`
		IdentityID core.IdentityID     `json:"identityId"`
	}
	// Keep native field order and omit request kind, person origin, and
	// request delivery mode for compatibility with its existing ledger.
	wire := struct {
		OperationID  core.DispatchOperationID `json:"operationId"`
		RecipientIDs []core.IdentityID        `json:"recipientIds"`
		Message      string                   `json:"message"`
		Room         room                     `json:"room"`
		Kind         core.RequestKind         `json:"kind,omitempty"`
		Originator   *originator              `json:"originator,omitempty"`
	}{
		OperationID:  in.OperationID,
		RecipientIDs: in.RecipientIDs,
		Message:      in.Message,
		Room:         room{"roster", in.RoomID, in.Revision},
	}
	if in.Kind == core.RequestKindAnnouncement {
		wire.Kind = in.Kind
	}
	if in.Originator.IdentityID != nil {
		wire.Originator = &originator{Kind: in.Originator.Kind, IdentityID: *in.Originator.IdentityID}
	}
	encoded, err := json.Marshal(wire)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	hash.Write([]byte("tmt:office:dispatch:v1\x00"))
	hash.Write(binary.BigEndian.AppendUint64(nil, uint64(len(encoded))))
	hash.Write(encoded)
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func composeRoomRecipient(r records, intent core.RoomDispatchInput, recipient core.IdentityID, sending *roomSendingPolicy, cal digestCalendar, now, expires uint64) (core.DispatchItem, error) {
	requestUUID, err := newStorageUUID()
	if err != nil {
		return core.DispatchItem{}, err
	}
	item := core.DispatchItem{RecipientID: recipient, RequestID: core.RequestID("req_" + requestUUID), Acceptance: core.DispatchQueued}
	decision, err := sending.admit(r, recipient, cal, now)
	if err != nil {
		return core.DispatchItem{}, err
	}
	if decision.acceptance == core.DispatchRestricted {
		item.Acceptance = core.DispatchRestricted
		return item, sending.record(r, decision, item, now)
	}
	attemptUUID, err := newStorageUUID()
	if err != nil {
		return core.DispatchItem{}, err
	}
	roomID := intent.RoomID
	in := core.PrepareRequest{
		RequestID: item.RequestID, AttemptID: core.AttemptID(attemptUUID), Kind: intent.Kind,
		Origin: core.RequestOriginPerson, Originator: intent.Originator, RoomID: &roomID,
		Route: core.RequestRoute{Kind: core.RequestRouteInbox, Recipient: &recipient}, Recipient: &recipient,
		Message: intent.Message, ExpiresAtMs: expires, RetentionDays: intent.RetentionDays,
		DeliveryPolicy: &core.RequestDeliveryPolicy{Automatic: true, Kind: core.DigestKindFyi, Mode: core.RequestDeliveryRequest},
	}
	attempt, err := prepareAttempt(in, now)
	if err != nil {
		return core.DispatchItem{}, err
	}
	var hold *digestHoldAdmission
	if decision.acceptance != core.DispatchHeld {
		hold, err = incomingDigestHold(r, in, cal, now)
		if err != nil {
			return core.DispatchItem{}, err
		}
	}
	_, unavailable, err := prepareRequestRows(r, in, attempt, hold, decision.acceptance != core.DispatchHeld)
	if err != nil {
		return core.DispatchItem{}, err
	}
	if unavailable {
		item.Acceptance = core.DispatchUnavailable
		return item, nil
	}
	if decision.acceptance == core.DispatchHeld {
		item.Acceptance = core.DispatchHeld
	}
	return item, sending.record(r, decision, item, now)
}
