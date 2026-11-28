package cli

import (
	"slices"
	"testing"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func TestIdentityMetadataGrammarKeepsAllFilters(t *testing.T) {
	inv, failure := parse([]string{"identity", "ls", "--where=team=ops", "--where", "team=infra", "--has", "user", "--has", "color"})
	if failure != nil || !slices.Equal(inv.repeated["where"], []string{"team=ops", "team=infra"}) ||
		!slices.Equal(inv.repeated["has"], []string{"user", "color"}) {
		t.Fatalf("filters: %+v, %v", inv, failure)
	}
	inv, failure = parse([]string{"identity", "status", "set", "Reviewing", "--mood", "ready", "--for", "30m"})
	if failure != nil || inv.options["mood"] != "ready" || inv.options["for"] != "30m" {
		t.Fatalf("status: %+v, %v", inv, failure)
	}
	inv, failure = parse([]string{"identity", "meta", "get", "team", "--identity", "worker"})
	if failure != nil || !slices.Equal(inv.path, []string{"identity", "meta", "show"}) || inv.options["identity"] != "worker" {
		t.Fatalf("metadata alias: %+v, %v", inv, failure)
	}
}

func TestDecodeMetadataInputRetainsExactExpectationsAndRejectsAmbiguity(t *testing.T) {
	changes, err := decodeMetadataInput([]byte(`[
		{"key":"literal","expect":{"value":"absent"},"then":{"set":"remove"}},
		{"key":"guard","expect":"a\u006ey","then":"remove"},
		{"key":"new","expect":"absent","then":{"set":"café"}}
	]`))
	if err != nil || len(changes) != 3 || changes[0].Expect.Mode != core.MetadataExact || changes[0].Expect.Value != "absent" || *changes[0].Value != "remove" ||
		changes[1].Expect.Mode != core.MetadataAny || changes[1].Value != nil || changes[2].Expect.Mode != core.MetadataAbsent ||
		*changes[2].Value != "café" {
		t.Fatalf("decoded: %+v, %v", changes, err)
	}
	for _, body := range []string{
		`null`, `[]`, `{}`, `[{}]`,
		`[{"key":"a","key":"b","expect":"any","then":"remove"}]`,
		`[{"key":"a","expect":{"value":"b","other":1},"then":"remove"}]`,
		`[{"key":"a","expect":"any","then":"remove","other":1}]`,
		`[{"key":"a","expect":"any","then":{"set":null}}]`,
		`[{"key":"a","expect":"absent","then":"remove"},{"key":"a","expect":"any","then":"remove"}]`,
	} {
		if _, err := decodeMetadataInput([]byte(body)); err == nil {
			t.Errorf("accepted %s", body)
		}
	}
}
