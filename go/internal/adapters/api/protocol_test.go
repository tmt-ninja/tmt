package api

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/home"
)

func TestDecodeGuardsVersionAndAttribution(t *testing.T) {
	for _, tc := range []struct {
		name, input, code string
	}{
		{"read", `{"version":1,"operation":"capabilities","input":{}}`, ""},
		{"identified write", `{"version":1,"operation":"dispatch.create","input":{},"identity":"Worker"}`, ""},
		{"anonymous write", `{"version":1,"operation":"requests.ack","input":{},"originator":"anonymous"}`, ""},
		{"unsupported", `{"version":0,"operation":"capabilities","input":{}}`, "API_VERSION_UNSUPPORTED"},
		{"missing version", `{"operation":"capabilities","input":{}}`, "API_INPUT_INVALID"},
		{"missing input", `{"version":1,"operation":"capabilities"}`, "API_INPUT_INVALID"},
		{"unknown field", `{"version":1,"operation":"capabilities","input":{},"extra":false}`, "API_INPUT_INVALID"},
		{"wrong case", `{"Version":1,"operation":"capabilities","input":{}}`, "API_INPUT_INVALID"},
		{"duplicate version", `{"version":1,"version":1,"operation":"capabilities","input":{}}`, "API_INPUT_INVALID"},
		{"both originators", `{"version":1,"operation":"dispatch.create","input":{},"originator":"anonymous","identity":"Worker"}`, "API_INPUT_INVALID"},
		{"no originator", `{"version":1,"operation":"dispatch.create","input":{}}`, "API_INPUT_INVALID"},
		{"blank identity", `{"version":1,"operation":"dispatch.create","input":{},"identity":" "}`, "API_INPUT_INVALID"},
		{"read with originator", `{"version":1,"operation":"storage.root","input":{},"identity":"Worker"}`, "API_INPUT_INVALID"},
		{"trailing document", `{"version":1,"operation":"capabilities","input":{}} {}`, "API_INPUT_INVALID"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request, fault := Decode([]byte(tc.input))
			if tc.code == "" {
				if fault != nil || request.Operation == "" || len(request.Input) == 0 {
					t.Fatalf("decode = %+v, %v", request, fault)
				}
				return
			}
			if fault == nil || fault.Code != tc.code {
				t.Fatalf("decode fault = %+v, want %s", fault, tc.code)
			}
		})
	}
}

func TestServerDiscoveryAndVersionFaultCreateNoState(t *testing.T) {
	root := filepath.Join(t.TempDir(), "go-home")
	server := Server{Root: home.Root{Dir: root}}
	input, _ := sessionFiles(t, []byte(`{"version":2,"operation":"capabilities","input":{}}`))
	var output bytes.Buffer
	status, err := server.ServeOnce(input, &output)
	var fault struct {
		Error struct {
			Code, Message string
			Supported     versionRange
		}
	}
	if err != nil || status != 1 || json.Unmarshal(output.Bytes(), &fault) != nil ||
		fault.Error.Code != "API_VERSION_UNSUPPORTED" || fault.Error.Supported != supported {
		t.Fatalf("unsupported = %d, %v, %s", status, err, output.String())
	}
	input, responses := sessionFiles(t, []byte(
		"{bad}\n"+
			`{"version":1,"operation":"capabilities","input":{}}`+"\n"+
			`{"version":1,"operation":"storage.root","input":{}}`+"\n"))
	status, err = server.ServeSession(input, responses)
	result, readErr := os.ReadFile(responses.Name())
	lines := strings.Split(string(result), "\n")
	if err != nil || readErr != nil || status != 0 || len(lines) != 4 || lines[3] != "" {
		t.Fatalf("session = %d, %v, %v; stdout = %q", status, err, readErr, result)
	}
	if !strings.Contains(lines[0], `"code":"API_INPUT_INVALID"`) {
		t.Fatalf("bad request result = %s", lines[0])
	}
	var caps struct {
		Operations []string
		Limits     struct{ InputBytes, OutputBytes int }
	}
	if err := json.Unmarshal([]byte(lines[1]), &caps); err != nil || strings.Join(caps.Operations, ",") != strings.Join(append(append([]string{"capabilities", "storage.root", "digest.wake.step"}, digestOperations...), usageOperations...), ",") ||
		caps.Limits.InputBytes != 6_299_648 || caps.Limits.OutputBytes != 12_648_448 {
		t.Fatalf("capabilities = %s, %v", lines[1], err)
	}
	var data struct{ DataRoot string }
	if err := json.Unmarshal([]byte(lines[2]), &data); err != nil || data.DataRoot != root {
		t.Fatalf("storage root = %s, %v", lines[2], err)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("discovery created state: %v", err)
	}
}

func TestOpenAPISessionFencesObservedSchemaAdvance(t *testing.T) {
	dir := t.TempDir()
	root := home.Root{Dir: dir, Database: filepath.Join(dir, home.DatabaseName)}
	session := requestSession{root: root}
	if fault := session.open(t.Context()); fault != nil {
		t.Fatal(fault)
	}
	t.Cleanup(func() {
		if err := session.close(); err != nil {
			t.Error(err)
		}
	})
	db, err := sql.Open("sqlite", root.Database)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(t.Context(), "INSERT INTO _migrations VALUES (?, 'future-schema', 'future')", storage.SchemaVersion+1); err != nil {
		t.Fatal(err)
	}
	response, err := session.respond([]byte(`{"version":1,"operation":"capabilities","input":{}}`))
	if err != nil || !response.Stale || response.Status != 1 || !bytes.Contains(response.Body, []byte(`"code":"API_SESSION_STALE"`)) {
		t.Fatalf("stale response = %+v (%s), %v", response, response.Body, err)
	}
}
