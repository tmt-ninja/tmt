package core

import (
	"slices"
	"strings"
)

const MaxDispatchRecipients = 64

type DispatchOperationID string

func (id DispatchOperationID) Valid() bool { return validDispatchUUID(string(id)) }

func validDispatchUUID(id string) bool {
	return ValidUUID(id) && id != "00000000-0000-0000-0000-000000000000"
}

// RoomDispatchInput is a roster revision and its caller-selected audience.
type RoomDispatchInput struct {
	OperationID   DispatchOperationID
	RoomID        RoomID
	Revision      uint64
	RecipientIDs  []IdentityID
	Originator    Originator
	Kind          RequestKind
	Message       string
	RetentionDays uint64
}

func (in RoomDispatchInput) Normalize() (RoomDispatchInput, bool) {
	if !in.OperationID.Valid() || !validDispatchUUID(string(in.RoomID)) ||
		in.Revision == 0 || !ValidJSSafeInteger(in.Revision) ||
		len(in.RecipientIDs) == 0 || len(in.RecipientIDs) > MaxDispatchRecipients ||
		!ValidExchangeText(in.Message) || strings.TrimSpace(in.Message) == "" ||
		!ValidRetentionDays(in.RetentionDays) ||
		in.Kind != RequestKindRequest && in.Kind != RequestKindAnnouncement {
		return RoomDispatchInput{}, false
	}
	switch in.Originator.Kind {
	case OriginatorUnknown:
		if in.Originator.IdentityID != nil {
			return RoomDispatchInput{}, false
		}
	case OriginatorExplicit, OriginatorVerified:
		if in.Originator.IdentityID == nil || !validDispatchUUID(string(*in.Originator.IdentityID)) {
			return RoomDispatchInput{}, false
		}
	default:
		return RoomDispatchInput{}, false
	}
	for _, id := range in.RecipientIDs {
		if !validDispatchUUID(string(id)) {
			return RoomDispatchInput{}, false
		}
	}
	in.RecipientIDs = slices.Clone(in.RecipientIDs)
	slices.Sort(in.RecipientIDs)
	in.RecipientIDs = slices.Compact(in.RecipientIDs)
	return in, true
}

// DispatchReceipt describes immutable acceptance, independent of delivery.
type DispatchReceipt struct {
	OperationID DispatchOperationID `json:"operationId"`
	CreatedAtMs uint64              `json:"createdAtMs"`
	Items       []DispatchItem      `json:"items"`
}

type DispatchItem struct {
	RecipientID IdentityID         `json:"recipientId"`
	RequestID   RequestID          `json:"requestId"`
	Acceptance  DispatchAcceptance `json:"acceptance"`
}

type DispatchAcceptance string

const (
	DispatchQueued      DispatchAcceptance = "queued"
	DispatchUnavailable DispatchAcceptance = "recipientUnavailable"
	DispatchRestricted  DispatchAcceptance = "routeRestricted"
	DispatchHeld        DispatchAcceptance = "heldForPerson"
)

func (a DispatchAcceptance) Valid() bool {
	switch a {
	case DispatchQueued, DispatchUnavailable, DispatchRestricted, DispatchHeld:
		return true
	default:
		return false
	}
}

func (r DispatchReceipt) Valid() bool {
	if !r.OperationID.Valid() || r.CreatedAtMs == 0 || !ValidJSSafeInteger(r.CreatedAtMs) ||
		len(r.Items) == 0 || len(r.Items) > MaxDispatchRecipients {
		return false
	}
	for i, item := range r.Items {
		uuid, prefixed := strings.CutPrefix(string(item.RequestID), "req_")
		if !validDispatchUUID(string(item.RecipientID)) || !prefixed || !validDispatchUUID(uuid) ||
			!item.Acceptance.Valid() || i > 0 && r.Items[i-1].RecipientID >= item.RecipientID {
			return false
		}
	}
	return true
}
