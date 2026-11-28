package cli

import (
	"context"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type exchangeFake struct {
	ports.RequestService
	ack      func(core.IdentityID, core.XDirection, core.RequestID, uint64) (core.AckResult, error)
	ackAll   func(core.IdentityID, core.XDirection) (uint64, error)
	withdraw func(core.IdentityID, core.RequestID, string) (core.WithdrawResult, error)
}

func (f exchangeFake) AckX(_ context.Context, identity core.IdentityID, direction core.XDirection, request core.RequestID, revision uint64) (core.AckResult, error) {
	return f.ack(identity, direction, request, revision)
}

func (f exchangeFake) AckAllX(_ context.Context, identity core.IdentityID, direction core.XDirection) (uint64, error) {
	return f.ackAll(identity, direction)
}

func (f exchangeFake) Withdraw(_ context.Context, identity core.IdentityID, request core.RequestID, reason string) (core.WithdrawResult, error) {
	return f.withdraw(identity, request, reason)
}

func TestExchangeMutationsUseObservedRevisionAndSelectedIdentity(t *testing.T) {
	t.Setenv(flavor.EnvHome, t.TempDir())
	store, me, _ := requestIdentitiesFixture()
	identity := map[string]any{"id": string(me.ID), "name": "Worker", "canonicalName": "worker", "lifetime": "saved"}
	const request = "req_exact"
	const reason = "obsolete\nrequest"
	service := exchangeFake{
		ack: func(id core.IdentityID, direction core.XDirection, req core.RequestID, rev uint64) (core.AckResult, error) {
			if id != me.ID || direction != core.XIncoming || req != request || rev != 7 {
				t.Fatalf("acknowledgment input: %s %v %s %d", id, direction, req, rev)
			}
			return core.AckResult{RequestID: req, Revision: rev, Changed: false}, nil
		},
		ackAll: func(id core.IdentityID, direction core.XDirection) (uint64, error) {
			if id != me.ID || direction != core.XOutgoing {
				t.Fatalf("acknowledge all input: %s %v", id, direction)
			}
			return 19, nil
		},
		withdraw: func(id core.IdentityID, req core.RequestID, why string) (core.WithdrawResult, error) {
			if id != me.ID || req != request || why != reason {
				t.Fatalf("withdraw input: %s %s %q", id, req, why)
			}
			return core.WithdrawResult{RequestID: req, Withdrawal: core.Withdrawal{Reason: why, WithdrawnAtMs: 13}, Changed: true}, nil
		},
	}
	app := application{store: store, requests: service}
	assertResponse(t, app, []string{"x", "--identity", "worker", "ack", request, "--incoming", "--revision", "7", "--json"}, 0, map[string]any{
		"identity": identity, "requestId": request, "revision": float64(7), "acknowledged": true, "changed": false,
	})
	assertResponse(t, app, []string{"x", "ackall", "--identity", "worker", "--json"}, 0, map[string]any{
		"identity": identity, "acknowledgedThrough": float64(19),
	})
	assertResponse(t, app, []string{"x", "withdraw", request, "--reason", reason, "--identity", "worker", "--json"}, 0, map[string]any{
		"identity": identity, "status": "withdrawn", "requestId": request, "reason": reason, "withdrawnAtMs": float64(13), "changed": true,
	})
}

func TestExchangeAckRejectsUnsafeOrStaleRevision(t *testing.T) {
	t.Setenv(flavor.EnvHome, t.TempDir())
	store, _, _ := requestIdentitiesFixture()
	const stale = "Exchange attention revision changed after observation."
	service := exchangeFake{ack: func(_ core.IdentityID, _ core.XDirection, _ core.RequestID, revision uint64) (core.AckResult, error) {
		if revision != 7 {
			t.Fatalf("unexpected call with invalid revision %d", revision)
		}
		return core.AckResult{}, &core.RequestFailure{Code: "X_REVISION_CONFLICT", Message: stale, Status: 5}
	}}
	app := application{store: store, requests: service}
	assertResponse(t, app, []string{"x", "ack", "req", "--identity", "worker", "--revision", "9007199254740992", "--json"}, 1, map[string]any{
		"error": map[string]any{"code": "USAGE_ERROR", "message": "--revision must be a decimal integer between 1 and 9007199254740991."},
	})
	assertResponse(t, app, []string{"x", "ack", "req", "--identity", "worker", "--revision", "7", "--json"}, 5, map[string]any{
		"error": map[string]any{"code": "X_REVISION_CONFLICT", "message": stale},
	})
}
