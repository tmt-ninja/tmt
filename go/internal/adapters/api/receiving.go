package api

import (
	"context"
	"encoding/json/jsontext"
	"errors"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/core"
)

const digestReceivingSync = "digest.receiving.sync"

func decodeReceivingSync(raw jsontext.Value) (core.DigestReceivingWrite, bool) {
	var wire struct {
		ExpectedRevision *uint64        `json:"expectedRevision"`
		Enabled          *bool          `json:"enabled"`
		Default          jsontext.Value `json:"defaultReceiving"`
		Members          []struct {
			IdentityID core.IdentityID `json:"identityId"`
			Receiving  jsontext.Value  `json:"receiving"`
		} `json:"members"`
	}
	if !decodeObject(raw, &wire) || wire.Enabled == nil || wire.ExpectedRevision == nil ||
		!core.ValidJSSafeInteger(*wire.ExpectedRevision) || wire.Members == nil || len(wire.Members) > core.OrchMaxMembers {
		return core.DigestReceivingWrite{}, false
	}
	defaultReceiving, valid := orchestration.DecodeReceiving(wire.Default, true)
	if !valid {
		return core.DigestReceivingWrite{}, false
	}
	write := core.DigestReceivingWrite{
		ExpectedRevision: *wire.ExpectedRevision, Enabled: *wire.Enabled, Default: defaultReceiving,
		Members: make([]core.DigestReceivingMember, 0, len(wire.Members)),
	}
	seen := make(map[core.IdentityID]bool, len(wire.Members))
	for _, member := range wire.Members {
		id := member.IdentityID
		mode, ok := orchestration.DecodeReceiving(member.Receiving, true)
		if !ok || !core.ValidUUID(string(id)) || id == "00000000-0000-0000-0000-000000000000" || seen[id] {
			return core.DigestReceivingWrite{}, false
		}
		seen[id] = true
		write.Members = append(write.Members, core.DigestReceivingMember{IdentityID: id, Receiving: mode})
	}
	return write, true
}

type receivingPublication struct {
	Revision   uint64                     `json:"revision"`
	Projection orchestration.OverviewView `json:"projection"`
}

func (s *requestSession) syncReceiving(ctx context.Context, write core.DigestReceivingWrite) (receivingPublication, *Fault) {
	revision, err := s.store.SyncReceiving(ctx, write)
	if err != nil {
		return receivingPublication{}, receivingSyncFault(err)
	}
	projection, failure := orchestration.ReadOverview(ctx, s.store, orchestration.OverviewQuery{RangeDays: 1}, uint64(time.Now().UnixMilli()))
	if failure != nil {
		return receivingPublication{}, receivingSyncFault(failure)
	}
	return receivingPublication{Revision: revision, Projection: projection}, nil
}

func receivingSyncFault(err error) *Fault {
	var failure *core.RequestFailure
	if errors.As(err, &failure) {
		switch failure.Code {
		case "ORCH_CONFLICT":
			return &Fault{Code: failure.Code, Message: "Orchestration changed or a plan name or priority conflicts. Preview again before saving."}
		case "ORCH_LIMIT":
			return &Fault{Code: failure.Code, Message: "Orchestration query exceeds its bounded expansion."}
		case "ORCH_STORAGE_UNAVAILABLE":
			// The commit may have succeeded before projection failed.
		default:
			return operationFault(failure)
		}
	}
	return &Fault{Code: "ORCH_STORAGE_UNAVAILABLE", Message: "Orchestration write could not be confirmed; inspect its configuration revision before retrying."}
}
