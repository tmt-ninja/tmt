//go:build darwin || linux

package process

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const probeGroupFixture = "TMT_TEST_PRIVATE_PROBE_GROUP"

func TestSupervisedProbeInheritsOwnedWorkerGroup(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	out, err := (Runner{}).Run(t.Context(), ports.ProcessSpec{
		Path: executable, Args: []string{"-test.run=^TestSupervisedProbeWorkerFixture$"},
		Env: []string{probeGroupFixture + "=1"}, Timeout: 5 * time.Second, MaxOut: 4096,
	})
	if err != nil || out.ExitCode != 0 || !strings.Contains(string(out.Stdout), "worker-and-probe-share-group") {
		t.Fatalf("owned worker = %+v, %v", out, err)
	}
}

func TestSupervisedProbeWorkerFixture(t *testing.T) {
	if os.Getenv(probeGroupFixture) != "1" {
		return
	}
	runner, err := SupervisedProbes()
	if err != nil {
		t.Fatal(err)
	}
	out, err := runner.Run(t.Context(), ports.ProcessSpec{
		Path: "/bin/sh", Args: []string{"-c", "exec /bin/ps -o pgid= -p $$"},
		Timeout: time.Second, MaxOut: 128,
	})
	if err != nil || out.ExitCode != 0 || strings.TrimSpace(string(out.Stdout)) != strconv.Itoa(os.Getpid()) {
		t.Fatalf("probe PGID = %q, exit = %d, err = %v, want %d", out.Stdout, out.ExitCode, err, os.Getpid())
	}
	fmt.Println("worker-and-probe-share-group")
}
