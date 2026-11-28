//go:build darwin || linux

package channel

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"os"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func TestEnrollPrunesOnlyEndedAttributedProcessesFromOneSnapshot(t *testing.T) {
	for _, tc := range []struct {
		name, snapshot    string
		truncated, prunes bool
	}{
		{"complete", "1 0\n4321 1\n5002 1\n", false, true},
		{"malformed", "1 0\ninvalid\n", false, false},
		{"truncated", "1 0\n", true, false},
		{"empty", "", false, false},
		{"duplicate PID", "1 0\n1 0\n", false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			in := fixtureEnrollment(t)
			dir, err := openChannelDir(in.Root, true)
			if err != nil {
				t.Fatal(err)
			}
			defer dir.close()
			for i := 1; i <= 3; i++ {
				binding := fmt.Sprintf("90000000-0000-4000-8000-%012d", i)
				record := claudeRecord{Version: 1, BindingID: binding, Generation: launchGeneration(),
					LaunchOwner: processRecord{PID: uint64(5000 + i), Start: testStart}}
				if i != 3 {
					record.Foreground = &processRecord{PID: uint64(6000 + i), Start: testStart}
				}
				if err := dir.writeClaude(record); err != nil {
					t.Fatal(err)
				}
			}
			const endedBinding = "90000000-0000-4000-8000-000000000001"
			path := socketPath(in.Root, endedBinding)
			listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
			if err != nil {
				t.Fatal(err)
			}
			listener.SetUnlinkOnClose(false)
			if err := listener.Close(); err != nil {
				t.Fatal(err)
			}

			snapshots := 0
			runner := testRunner(func(_ context.Context, spec ports.ProcessSpec) (ports.Bounded, error) {
				if spec.Args[0] == "-A" {
					snapshots++
					return ports.Bounded{Stdout: []byte(tc.snapshot), Truncated: tc.truncated}, nil
				}
				return ports.Bounded{Stdout: []byte("Sat Jan  1 00:00:00 2000 S\n")}, nil
			})
			if _, err := EnrollClaude(t.Context(), runner, in); err != nil {
				t.Fatal(err)
			}
			if snapshots != 1 {
				t.Fatalf("process snapshots = %d, want one", snapshots)
			}
			for i := 1; i <= 3; i++ {
				binding := fmt.Sprintf("90000000-0000-4000-8000-%012d", i)
				record, err := dir.readClaude(binding)
				if err != nil || (record == nil) != (i == 1 && tc.prunes) {
					t.Fatalf("record %d = %+v, %v", i, record, err)
				}
			}
			_, statErr := os.Lstat(path)
			if (tc.prunes && !errors.Is(statErr, fs.ErrNotExist)) || (!tc.prunes && statErr != nil) {
				t.Fatalf("ended socket cleanup = %v", statErr)
			}
			if record, err := dir.readClaude(testBinding); err != nil || record == nil {
				t.Fatalf("new enrollment = %+v, %v", record, err)
			}
		})
	}
}
