package tui

import (
	"github.com/rivo/uniseg"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
)

// KeyHint is a single key + description pair in a footer.
type KeyHint struct {
	Key         string
	Description string
}

// Footer fits priority-ordered whole hints into width separated by separator.
func Footer(hints []KeyHint, width uint16, separator string) string {
	result := ""
	for _, h := range hints {
		pair := clistyle.Escape(h.Key) + " " + clistyle.Escape(h.Description)
		candidate := pair
		if result != "" {
			candidate = result + separator + pair
		}
		if uniseg.StringWidth(candidate) <= int(width) {
			result = candidate
		}
	}
	return result
}

// KeyHelpEntry is one entry in a KeyHelpSection.
type KeyHelpEntry struct {
	ID          string
	Keys        string
	Description string
}

// KeyHelpSection groups KeyHelpEntries under a section title.
type KeyHelpSection struct {
	ID      string
	Title   string
	Entries []KeyHelpEntry
}

// KeyHelp is the typed model for tmt-key-help.
type KeyHelp struct {
	Sections []KeyHelpSection
}

// KeyHelpSchema returns the binding Schema for KeyHelp.
func KeyHelpSchema() Schema {
	return ObjectSchema(map[string]Schema{
		"sections": CollectionSchema(ObjectSchema(map[string]Schema{
			"id":    StableIDSchema(),
			"title": ScalarSchema(),
			"entries": CollectionSchema(ObjectSchema(map[string]Schema{
				"id":          StableIDSchema(),
				"keys":        ScalarSchema(),
				"description": ScalarSchema(),
			})),
		})),
	})
}

// Value converts KeyHelp into the JSON-like data map expected by Template.Materialize.
func (k KeyHelp) Value() map[string]any {
	sections := make([]any, len(k.Sections))
	for i, sec := range k.Sections {
		entries := make([]any, len(sec.Entries))
		for j, e := range sec.Entries {
			entries[j] = map[string]any{
				"id":          e.ID,
				"keys":        e.Keys,
				"description": e.Description,
			}
		}
		sections[i] = map[string]any{
			"id":      sec.ID,
			"title":   sec.Title,
			"entries": entries,
		}
	}
	return map[string]any{"sections": sections}
}
