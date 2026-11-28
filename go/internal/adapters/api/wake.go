package api

import (
	"context"
	"encoding/json/jsontext"
	"errors"
	"os/exec"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/digest"
	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/adapters/tmux"
	"github.com/tmt-ninja/tmt/go/internal/core"
)

type wakeInput struct {
	BudgetMs uint64 `json:"budgetMs"`
	Limit    uint64 `json:"limit"`
}

func decodeWake(input jsontext.Value) (wakeInput, bool) {
	var wire wakeInput
	ok := decodeObject(input, &wire) && wire.BudgetMs >= 1 && wire.BudgetMs <= 60_000 && wire.Limit >= 1 && wire.Limit <= 256
	return wire, ok
}

func (s *requestSession) wake(ctx context.Context, input wakeInput) (digest.WakeResult, error) {
	prepare := func(ctx context.Context, id core.IdentityID) (*digest.IdleDelivery, error) {
		path, err := exec.LookPath("tmux")
		if errors.Is(err, exec.ErrNotFound) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		client := tmux.Client{Path: path, Process: process.Runner{}}
		return digest.TmuxIdleGuard(s.root, client, s.store.DigestIdleBinding).Prepare(ctx, id)
	}
	return digest.WakeStep(ctx, s.store, prepare, func() uint64 {
		return uint64(time.Now().UnixMilli())
	}, time.Duration(input.BudgetMs)*time.Millisecond, input.Limit)
}
