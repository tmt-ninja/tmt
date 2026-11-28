package ports

import (
	"context"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

type OrchReader interface {
	ReadPlans(context.Context) (core.OrchPlansPage, error)
	ReadPolicySnapshot(context.Context, core.OrchSnapshotQuery) (core.OrchSnapshotPage, error)
	ReadTalkFacts(context.Context, core.OrchTalkFactsQuery) (core.OrchTalkFactsPage, error)
	ReadJournal(context.Context, core.OrchJournalQuery) (core.OrchJournalPage, error)
	ReadJobs(context.Context, core.OrchJobQuery) (core.OrchJobReadPage, error)
	SchemaVersion(context.Context) (uint64, error)
	WakeAdmissionMs(context.Context) (uint64, error)
}
