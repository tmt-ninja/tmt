package cli

import (
	"bytes"
	"context"
	"encoding/json/v2"
	"os"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

const hookStart = "ps-v1:Sat Jan 1 00:00:00 2000"

func TestHookCoordinatesRejectUnknownAndDuplicateFields(t *testing.T) {
	coords := hookCoordinates{IdentityID: "identity", BindingID: "binding",
		Owner: core.ProcessIncarnation{PID: 42, StartIdentity: hookStart}, StartupInput: true}
	raw, err := json.Marshal(coords)
	if err != nil {
		t.Fatal(err)
	}
	if got, ok := decodeHookCoordinates(string(raw)); !ok || got != coords {
		t.Fatalf("decodeHookCoordinates = %+v, %t", got, ok)
	}
	for _, value := range []string{
		string(raw) + "{}",
		strings.TrimSuffix(string(raw), "}") + `,"binding_id":"duplicate"}`,
		strings.TrimSuffix(string(raw), "}") + `,"provider":"codex"}`,
		strings.Replace(string(raw), hookStart, "unknown", 1),
	} {
		if _, ok := decodeHookCoordinates(value); ok {
			t.Errorf("accepted invalid coordinates %q", value)
		}
	}
}

func TestNonStartupHookDoesNotProbeHostOrOpenStorage(t *testing.T) {
	const payload = `{"hook_event_name":"Stop","session_id":"fixture"}`
	raw, err := json.Marshal(hookCoordinates{IdentityID: "identity", BindingID: "binding",
		Owner: core.ProcessIncarnation{PID: 42, StartIdentity: hookStart}})
	if err != nil {
		t.Fatal(err)
	}
	reader, writer, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer reader.Close()
	defer writer.Close()
	if _, err := writer.WriteString(payload); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	app := application{stdin: reader, caller: callerSelector{
		lookup: func(name string) (string, bool) {
			if name != hookLaunchEnv {
				t.Fatalf("hook queried host environment key %s", name)
			}
			return string(raw), true
		},
		probe: func(context.Context, ports.PaneRef) (core.EndpointProbe, error) {
			t.Fatal("non-start hook probed a host")
			return core.EndpointProbe{}, nil
		},
	}, store: refusingHookStore{t: t}}
	report := app.runHook(t.Context(), home.Root{}, invocation{operands: []string{"claude"}})
	var output bytes.Buffer
	if err := report.Human(&output); err != nil || report.ExitStatus() != 0 || output.Len() != 0 {
		t.Fatalf("hook response = %q, status %d, error %v", output.String(), report.ExitStatus(), err)
	}
}

type refusingHookStore struct {
	ports.Store
	t *testing.T
}

func (store refusingHookStore) Read(context.Context, func(ports.StoreTx) error) error {
	store.t.Fatal("non-start hook opened storage")
	return nil
}
