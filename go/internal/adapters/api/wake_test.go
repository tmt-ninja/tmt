package api

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/home"
)

func TestWakeStepStrictBoundsAndEmptyStore(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "unopened")
	server := Server{Root: home.Root{Dir: dir, Database: filepath.Join(dir, home.DatabaseName)}}
	serve := func(doc string) (int, string, error) {
		request := fmt.Sprintf(`{"version":1,"operation":"digest.wake.step","input":%s}`, doc)
		input, _ := sessionFiles(t, []byte(request))
		var output bytes.Buffer
		status, err := server.ServeOnce(input, &output)
		return status, output.String(), err
	}
	for _, doc := range []string{
		`{}`, `{"budgetMs":0,"limit":1}`, `{"budgetMs":60001,"limit":1}`,
		`{"budgetMs":2.5,"limit":1}`, `{"budgetMs":1,"limit":257}`, `{"budgetMs":1,"limit":0}`,
		`{"budgetMs":1,"limit":1,"identityId":"worker"}`,
	} {
		status, response, err := serve(doc)
		if err != nil || status != 1 || !bytes.Contains([]byte(response), []byte(`"code":"API_INPUT_INVALID"`)) {
			t.Fatalf("input %s -> %d %s %v", doc, status, response, err)
		}
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("invalid wake opened storage: %v", err)
	}
	for _, doc := range []string{`{"budgetMs":60000,"limit":256}`, `{"budgetMs":500,"limit":1}`} {
		status, response, err := serve(doc)
		const empty = `{"schemaVersion":1,"state":"nothing_due","identityId":null,"projection":"incoming_summary","nextAtMs":null}` + "\n"
		if err != nil || status != 0 || response != empty {
			t.Fatalf("empty wake %s -> %d %s %v", doc, status, response, err)
		}
	}
}
