package ports

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type OrchReader interface {
	ReadJobs(context.Context, core.OrchJobQuery) (core.OrchJobReadPage, error)
	SchemaVersion(context.Context) (uint64, error)
	WakeAdmissionMs(context.Context) (uint64, error)
}
