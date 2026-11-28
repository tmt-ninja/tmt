package cli

import (
	"bytes"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

func TestOrchTalkReportsMatchNativeHumanRows(t *testing.T) {
	limit, at := uint32(1), uint64(1_795_880_043_764)
	held := orchestration.TalkPair{
		Members: [2]orchestration.TalkMember{{Name: "alpha"}, {Name: "bravo"}},
		Count:   1, Limit: &limit, LastAtMs: &at, State: "held", HeldCount: 22,
	}
	routes := []orchestration.RouteRow{
		{FromName: "alpha", ToName: "bravo", Verdict: "needs_person"},
		{FromName: "bravo", ToName: "alpha", Verdict: "blocked"},
	}
	for _, sample := range []struct {
		name   string
		report output.Report
		want   string
	}{
		{"empty talks", talksReport{}, "hint: No agent pair talked in the last hour\n"},
		{"empty routes", routesReport{}, ""},
		{"held pair", talksReport{view: orchestration.TalksView{Pairs: []orchestration.TalkPair{held}}},
			"  alpha ↔ bravo  1/1  2026-11-28 15:34:03.764 +00:00:00  ◆ Held · needs a person (22)\n"},
		{"verdicts", routesReport{view: orchestration.RoutesView{Routes: routes}},
			"  alpha  bravo  ◆ Needs a person\n  bravo  alpha  ■ Blocked\n"},
	} {
		t.Run(sample.name, func(t *testing.T) {
			var plain bytes.Buffer
			if err := sample.report.Human(&plain); err != nil || plain.String() != sample.want {
				t.Fatalf("human = %q, want %q, err = %v", plain.String(), sample.want, err)
			}
		})
	}
}
