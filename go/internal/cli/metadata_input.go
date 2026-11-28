package cli

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

// Native accepts up to 64 records, accounting for escaped bytes in two
// maximum-sized metadata values plus a key on every record.
const metadataApplyInputLimit = 64*(64+2*1024)*6 + 4096

var (
	errMetadataInput         = errors.New("Expected a JSON list of metadata changes.")
	errMetadataInputTooLarge = errors.New("Metadata changes exceed the input byte limit.")
)

type metadataWireChange struct {
	Key    *string        `json:"key"`
	Expect jsontext.Value `json:"expect"`
	Then   jsontext.Value `json:"then"`
}

func decodeMetadataInput(data []byte) ([]core.MetadataChange, error) {
	if len(data) > metadataApplyInputLimit {
		return nil, errMetadataInputTooLarge
	}
	var wire []metadataWireChange
	if err := json.Unmarshal(data, &wire, json.RejectUnknownMembers(true)); err != nil || wire == nil {
		return nil, errMetadataInput
	}
	changes := make([]core.MetadataChange, 0, len(wire))
	for _, row := range wire {
		if row.Key == nil {
			return nil, errMetadataInput
		}
		change := core.MetadataChange{Key: *row.Key}
		var expect string
		_ = json.Unmarshal(row.Expect, &expect)
		switch expect {
		case "any":
			change.Expect.Mode = core.MetadataAny
		case "absent":
			change.Expect.Mode = core.MetadataAbsent
		default:
			var exact struct {
				Value *string `json:"value"`
			}
			if err := json.Unmarshal(row.Expect, &exact, json.RejectUnknownMembers(true)); err != nil || exact.Value == nil {
				return nil, errMetadataInput
			}
			change.Expect = core.MetadataExpectation{Mode: core.MetadataExact, Value: *exact.Value}
		}
		var action string
		_ = json.Unmarshal(row.Then, &action)
		if action != "remove" {
			var set struct {
				Set *string `json:"set"`
			}
			if err := json.Unmarshal(row.Then, &set, json.RejectUnknownMembers(true)); err != nil || set.Set == nil {
				return nil, errMetadataInput
			}
			change.Value = set.Set
		}
		changes = append(changes, change)
	}
	return changes, core.ValidateMetadataChanges(changes)
}
