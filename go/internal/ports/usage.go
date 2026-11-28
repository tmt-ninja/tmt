package ports

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

// UsageStore reads retained usage evidence. Each result uses one snapshot.
type UsageStore interface {
	ConsumptionHistory(context.Context, core.ConsumptionHistoryQuery) (core.ConsumptionHistoryPage, error)
	RetiredWithRollup(context.Context, core.RetiredRollupQuery) (core.RetiredRollupPage, error)
	WakeTurns(context.Context, core.WakeTurnQuery) (core.WakeTurnPage, error)
}
