package storage

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func testStorage(t *testing.T) *Storage {
	t.Helper()
	store, err := Open(t.Context(), testRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := store.Close(); err != nil {
			t.Error(err)
		}
	})
	return store
}

func TestStoreTransactions(t *testing.T) {
	parallelStorageFixture(t)
	store := testStorage(t)
	ctx := t.Context()
	identity := core.Identity{
		ID: "6c57fcc9-96b1-4022-b071-870b81288814", Name: "Worker",
		CanonicalName: "worker", Lifetime: core.LifetimeTemporary, AutoNamed: true,
	}
	abort := errors.New("abort write")
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		if err := tx.Identities().Insert(identity, 1000); err != nil {
			return err
		}
		return abort
	}); !errors.Is(err, abort) {
		t.Fatalf("write error = %v, want rollback cause", err)
	}

	var escaped ports.IdentityRepo
	if err := store.Read(ctx, func(tx ports.StoreTx) error {
		escaped = tx.Identities()
		got, err := escaped.FindByID(identity.ID)
		if err != nil || got != nil {
			t.Fatalf("rolled back identity = %+v, %v", got, err)
		}
		if err := escaped.Insert(identity, 1000); err == nil {
			t.Fatal("read transaction accepted a mutation")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := escaped.List(); err == nil {
		t.Fatal("transaction repository escaped its callback")
	}
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		if err := tx.Identities().Insert(identity, 1000); err != nil {
			return err
		}
		return tx.Identities().Promote(identity.ID, 2000)
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx ports.StoreTx) error {
		got, err := core.ResolveIdentity(tx.Identities(), " WORKER ")
		if err != nil {
			return err
		}
		if got == nil || got.ID != identity.ID || got.Lifetime != core.LifetimeSaved || !got.AutoNamed ||
			got.CreatedAt != "1970-01-01T00:00:01.000Z" || got.UpdatedAt != "1970-01-01T00:00:02.000Z" {
			t.Fatalf("stored identity = %+v", got)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestRequestRepositoryRoundTrip(t *testing.T) {
	parallelStorageFixture(t)
	store := testStorage(t)
	const recipient core.IdentityID = "recipient"
	id := recipient
	route := core.RequestRoute{Kind: core.RequestRouteInbox, Recipient: &id}
	attempt := core.RequestAttempt{
		RequestID: "request", AttemptID: "attempt", Kind: core.RequestKindRequest,
		Originator: core.Originator{Kind: core.OriginatorUnknown}, Route: route, Recipient: &id,
		Status: core.AttemptPrepared, WaitActive: true, PreparedAtMs: 100,
		ExpiresAtMs: 1000, RetentionDays: 1, RetentionExpiresAtMs: 86_401_000,
	}
	body := "exact 😺\x00\r\n "
	final := core.FinalResponse{
		RequestID: attempt.RequestID, AttemptID: attempt.AttemptID, Route: route,
		Body: body, BodyBytes: uint64(len(body)), SubmittedAtMs: 150,
		ResponseExpiresAtMs: 86_400_150,
	}
	ctx := t.Context()
	if err := store.Write(ctx, func(tx ports.StoreTx) error {
		requests := tx.Requests()
		if err := requests.Insert(attempt, body); err != nil {
			return err
		}
		change := core.AttemptTransition{AttemptID: attempt.AttemptID, From: core.AttemptPrepared, To: core.AttemptQueued, AtMs: 110}
		for _, want := range []bool{true, false} {
			got, err := requests.UpdateState(change)
			if err != nil || got != want {
				t.Fatalf("state CAS = %t, %v, want %t", got, err, want)
			}
		}
		if err := requests.ReleaseWait(attempt.AttemptID, 120); err != nil {
			return err
		}
		return tx.Responses().Insert(final)
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.Read(ctx, func(tx ports.StoreTx) error {
		got, err := tx.Requests().FindByAttemptID(attempt.AttemptID)
		if err != nil {
			return err
		}
		if got == nil || got.Status != core.AttemptQueued || got.WaitActive || got.WaitReleasedAtMs == nil || *got.WaitReleasedAtMs != 120 {
			t.Fatalf("stored attempt = %+v", got)
		}
		reply, err := tx.Responses().FindByRequest(attempt.RequestID)
		if err != nil {
			return err
		}
		if reply == nil || reply.Body != body || reply.BodyBytes != uint64(len(body)) ||
			reply.Route.Recipient == nil || *reply.Route.Recipient != recipient {
			t.Fatalf("stored final = %+v", reply)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	var prompt string
	if err := store.db.QueryRowContext(ctx, "SELECT message_text FROM request_attempts").Scan(&prompt); err != nil || prompt != body {
		t.Fatalf("stored prompt = %q, %v", prompt, err)
	}
}

func TestReadSnapshotDoesNotBlockAnotherWriter(t *testing.T) {
	ctx := t.Context()
	root := testRoot(t)
	reader, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	writer, err := Open(ctx, root)
	if err != nil {
		t.Fatal(err)
	}
	defer writer.Close()

	identity := core.Identity{ID: "writer", Name: "Writer", CanonicalName: "writer", Lifetime: core.LifetimeSaved}
	if err := reader.Read(ctx, func(tx ports.StoreTx) error {
		before, err := tx.Identities().FindByID(identity.ID)
		if before != nil || err != nil {
			t.Fatalf("original snapshot identity = %+v, %v", before, err)
		}
		writeCtx, cancel := context.WithTimeout(ctx, time.Second)
		defer cancel()
		if err := writer.Write(writeCtx, func(tx ports.StoreTx) error {
			return tx.Identities().Insert(identity, 1000)
		}); err != nil {
			return err
		}
		after, err := tx.Identities().FindByID(identity.ID)
		if after != nil || err != nil {
			t.Fatalf("read snapshot moved after another writer committed: %+v, %v", after, err)
		}
		return nil
	}); err != nil {
		t.Fatalf("active read blocked another invocation's write: %v", err)
	}
	if err := reader.Read(ctx, func(tx ports.StoreTx) error {
		got, err := tx.Identities().FindByID(identity.ID)
		if got == nil || err != nil {
			t.Fatalf("next snapshot did not observe the other commit: %+v, %v", got, err)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
