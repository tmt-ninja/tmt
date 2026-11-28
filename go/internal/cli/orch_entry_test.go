package cli

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
)

func TestOrchWhyUsesSharedReport(t *testing.T) {
	t.Setenv(flavor.EnvHome, t.TempDir())
	const request = "req_11111111-1111-4111-8111-111111111111"
	var stdout, stderr bytes.Buffer
	if status := Main([]string{"orch", "why", request, "--limit", "2", "--before", "4", "--json"}, &stdout, &stderr); status != 0 || stderr.Len() != 0 {
		t.Fatalf("exit %d, stdout %q, stderr %q", status, &stdout, &stderr)
	}
	var page orchestration.JournalView
	if err := json.Unmarshal(stdout.Bytes(), &page); err != nil || page.Subject.Kind != "request" ||
		page.Subject.ID != request || page.Items == nil || len(page.Items) != 0 || page.NextBefore != nil ||
		!page.Coverage.LiveProducers {
		t.Fatalf("empty response = %s, %v", &stdout, err)
	}

	stdout.Reset()
	if status := Main([]string{"orch", "why", "job:example"}, &stdout, &stderr); status != 0 || stderr.Len() != 0 ||
		stdout.String() != "hint: No recorded decision. Slice 1 provides the journal; live producers arrive in slices 2–4\n" {
		t.Fatalf("exit %d, stdout %q, stderr %q", status, &stdout, &stderr)
	}
}
