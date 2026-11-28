package api

import (
	"context"
	"encoding/json/jsontext"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/adapters/digest"
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
	return digest.WakeStep(ctx, s.store, s.prepareIdle, func() uint64 {
		return uint64(time.Now().UnixMilli())
	}, time.Duration(input.BudgetMs)*time.Millisecond, input.Limit)
}
