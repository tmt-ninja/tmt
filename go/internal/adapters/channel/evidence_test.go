//go:build darwin || linux

package channel

import (
	"context"
	"errors"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const otherBinding = "30000000-0000-4000-8000-000000000003"

func TestClaudePasteEvidenceSurvivesBindingReplacement(t *testing.T) {
	in := fixtureEnrollment(t)
	address := PaneAddress{Server: in.Binding.Server, PaneID: in.Binding.PaneID, PanePID: in.Binding.PanePID}
	dir, record := fixtureChannelRecord(t, in)
	// An unattributed record must not block an unrelated pane.
	unknown := record
	unknown.BindingID = otherBinding
	unknown.Pane = nil
	if err := dir.writeClaude(unknown); err != nil {
		t.Fatal(err)
	}

	calls := 0
	runner := testRunner(func(context.Context, ports.ProcessSpec) (ports.Bounded, error) {
		calls++
		return ports.Bounded{Stdout: []byte("Sat Jan  1 00:00:00 2000 T\n")}, nil
	})
	for _, binding := range []string{"", otherBinding} {
		got, err := ClaudePaneEvidence(t.Context(), runner, in.Root, address, core.BindingID(binding))
		if err != nil || !got.Enrolled || got.Record != recordPath(in.Root, testBinding) {
			t.Fatalf("paste evidence for %q = %+v, %v", binding, got, err)
		}
	}
	if calls != 2 {
		t.Fatalf("probed %d records, want only the attributed stopped process per call", calls)
	}
	other := address
	other.Server.StartTime += "1"
	got, err := ClaudePaneEvidence(t.Context(), runner, in.Root, other, "")
	if err != nil || got.Enrolled || calls != 2 || !slices.Equal(got.Skipped, []string{recordPath(in.Root, otherBinding)}) {
		t.Fatalf("other server evidence = %+v, %v, probes=%d", got, err, calls)
	}
}

func TestClaudePasteEvidenceDistinguishesEndedAndUnconfirmed(t *testing.T) {
	in := fixtureEnrollment(t)
	dir, current := fixtureChannelRecord(t, in)
	address := PaneAddress{Server: in.Binding.Server, PaneID: in.Binding.PaneID, PanePID: in.Binding.PanePID}
	ended := reusedProcess()
	_, err := ClaudePaneEvidence(t.Context(), ended, in.Root, address, "")
	if err == nil || !strings.Contains(err.Error(), recoverCommand(testBinding, current.Generation)) {
		t.Fatalf("unconfirmed record allowed paste: %v", err)
	}
	// A recorded Claude parent stands in for the unpublished foreground.
	current.Claude = &processRecord{PID: 9876, Start: testStart}
	if err := dir.writeClaude(current); err != nil {
		t.Fatal(err)
	}
	if got, err := ClaudePaneEvidence(t.Context(), ended, in.Root, address, ""); err != nil || got.Enrolled {
		t.Fatalf("ended evidence = %+v, %v", got, err)
	}
	if err := os.WriteFile(recordPath(in.Root, testBinding), []byte("invalid"), 0600); err != nil {
		t.Fatal(err)
	}
	check, err := ClaudePaneEvidence(t.Context(), ended, in.Root, address, testBinding)
	var evidenceErr *EvidenceError
	if check.Enrolled || !errors.As(err, &evidenceErr) || evidenceErr.Fault != ChannelInvalidRecord {
		t.Fatalf("invalid current record permitted paste: %+v, %v", check, err)
	}
}

func TestClaudeRecoveryPreservesLiveUnknownAndChangedEnrollments(t *testing.T) {
	in := fixtureEnrollment(t)
	dir, record := fixtureChannelRecord(t, in)
	observe := func(line string) testRunner {
		return func(context.Context, ports.ProcessSpec) (ports.Bounded, error) {
			return ports.Bounded{Stdout: []byte(line)}, nil
		}
	}
	for _, tc := range []struct {
		runner testRunner
		want   error
	}{
		{observe("Sat Jan  1 00:00:00 2000 T\n"), ErrEnrollmentLive},
		{observe("invalid output"), ErrEnrollmentUnverifiable},
	} {
		if result, err := RecoverClaude(t.Context(), tc.runner, in.Root, testBinding, record.Generation); result.Recovered || !errors.Is(err, tc.want) {
			t.Fatalf("recover = %+v, %v, want %v", result, err, tc.want)
		}
	}
	replaced := record
	replaced.Foreground = &processRecord{PID: 9876, Start: testStart}
	calls := 0
	replacing := testRunner(func(ctx context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
		calls++
		if calls == 1 {
			if err := dir.writeClaude(replaced); err != nil {
				t.Fatal(err)
			}
		}
		return reusedProcess().Run(ctx, spec)
	})
	if got, err := RecoverClaude(t.Context(), replacing, in.Root, testBinding, record.Generation); got.Recovered || !errors.Is(err, ErrEnrollmentChanged) {
		t.Fatalf("recovery ignored update: %+v, %v", got, err)
	}
	if got, err := dir.readClaude(testBinding); err != nil || got == nil || !sameRecord(*got, replaced) {
		t.Fatalf("updated record = %+v, %v", got, err)
	}
}

func TestRecoveryRemovesOnlyTheNamedEnrollmentAndSocket(t *testing.T) {
	for _, socket := range []bool{false, true} {
		name := "regular file"
		if socket {
			name = "socket"
		}
		t.Run(name, func(t *testing.T) {
			in := fixtureEnrollment(t)
			dir, record := fixtureChannelRecord(t, in)
			path := socketPath(in.Root, testBinding)
			if socket {
				listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
				if err != nil {
					t.Fatal(err)
				}
				listener.SetUnlinkOnClose(false)
				if err := listener.Close(); err != nil {
					t.Fatal(err)
				}
			} else if err := os.WriteFile(path, []byte("keep"), 0600); err != nil {
				t.Fatal(err)
			}
			runner := reusedProcess()
			inspection, err := InspectClaude(t.Context(), runner, in.Root, testBinding)
			if err != nil || inspection == nil || inspection.State != EnrollmentUnconfirmed || inspection.Recover == nil ||
				!strings.Contains(inspection.Verification, "pane %7") || inspection.ForegroundRecorded ||
				inspection.Processes[0].State != "gone" {
				t.Fatalf("inspect = %+v, %v", inspection, err)
			}
			if _, err := dir.root.Lstat(lockName); !errors.Is(err, fs.ErrNotExist) {
				t.Fatalf("inspection touched lock: %v", err)
			}
			if _, err := RecoverClaude(t.Context(), runner, in.Root, testBinding, otherBinding); !errors.Is(err, ErrEnrollmentChanged) {
				t.Fatalf("wrong generation recovered: %v", err)
			}
			result, err := RecoverClaude(t.Context(), runner, in.Root, testBinding, record.Generation)
			if err != nil || !result.Recovered || !slices.Equal(result.Removed, inspection.Removes) ||
				result.Kept == nil || !slices.Equal(*result.Kept, inspection.Keeps) {
				t.Fatalf("recovery = %+v, %v", result, err)
			}
			_, err = dir.root.Lstat(filepath.Base(path))
			if socket && !errors.Is(err, fs.ErrNotExist) || !socket && err != nil {
				t.Fatalf("socket name %s: %v", name, err)
			}
			if _, err := dir.root.Lstat(lockName); err != nil {
				t.Fatalf("recovery removed lock: %v", err)
			}
			if result, err := RecoverClaude(t.Context(), runner, in.Root, testBinding, record.Generation); err != nil || result.Recovered {
				t.Fatalf("repeat recovery = %+v, %v", result, err)
			}
		})
	}
}

func fixtureChannelRecord(t *testing.T, in ClaudeEnrollment) (*channelDir, claudeRecord) {
	t.Helper()
	dir, err := openChannelDir(in.Root, true)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(dir.close)
	pane := recordedPane(in.Binding)
	record := claudeRecord{
		Version: 1, BindingID: testBinding, IdentityID: testIdentity, Generation: launchGeneration(),
		LaunchOwner: storedProcess(in.LaunchOwner), Pane: &pane,
	}
	if err := dir.writeClaude(record); err != nil {
		t.Fatal(err)
	}
	return dir, record
}

func reusedProcess() testRunner {
	return func(context.Context, ports.ProcessSpec) (ports.Bounded, error) {
		return ports.Bounded{Stdout: []byte("Mon Jan  1 00:00:00 2001 S\n")}, nil
	}
}
