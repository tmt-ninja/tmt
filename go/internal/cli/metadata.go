package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func metadataFailure(err error) *output.Failure {
	code := "IDENTITY_METADATA_INVALID"
	var message string
	switch {
	case errors.Is(err, core.ErrIdentityInactive):
		return bindingFailure("NAME_NOT_FOUND", "The selected identity was not found.", 3)
	case errors.Is(err, core.ErrMetadataKey):
		message = "Metadata keys must be 1-64 ASCII characters and match [a-z][a-z0-9_.-]*."
	case errors.Is(err, core.ErrMetadataValue):
		message = "Metadata values must be 1-1024 UTF-8 bytes and contain no control characters."
	case errors.Is(err, core.ErrMetadataEntryLimit):
		message = "An identity may have at most 64 metadata entries."
	case errors.Is(err, core.ErrMetadataChanges):
		message = "Metadata apply requires 1-64 changes with distinct keys."
	case errors.Is(err, errMetadataInput), errors.Is(err, errMetadataInputTooLarge):
		message = err.Error()
	default:
		var failure *output.Failure
		if errors.As(err, &failure) {
			return failure
		}
		return identityOperationFailure()
	}
	return bindingFailure(code, message, 1)
}

func metadataFilters(inv invocation) ([]core.MetadataFilter, *output.Failure) {
	var filters []core.MetadataFilter
	for _, expression := range inv.repeated["where"] {
		key, value, found := strings.Cut(expression, "=")
		if !found {
			return nil, talkUsage("--where requires KEY=VALUE.")
		}
		filters = append(filters, core.MetadataFilter{Key: key, Value: &value})
	}
	for _, key := range inv.repeated["has"] {
		filters = append(filters, core.MetadataFilter{Key: key})
	}
	for _, filter := range filters {
		if err := filter.Validate(); err != nil {
			return nil, metadataFailure(err)
		}
	}
	return filters, nil
}

func (app application) runMetadata(ctx context.Context, root home.Root, inv invocation) output.Report {
	if len(inv.path) != 3 {
		return talkUsage("An identity meta subcommand is required.")
	}
	selected, failed := app.caller.selectIdentity(ctx, inv)
	if failed != nil {
		return failed
	}
	report := metadataReport{action: inv.path[2]}
	var changes []core.MetadataChange
	switch report.action {
	case "apply":
		data, err := process.ReadInputStdin(app.stdin, metadataApplyInputLimit)
		if err != nil {
			return bindingFailure("IDENTITY_METADATA_INVALID", "Expected bounded JSON changes on non-terminal stdin, closed within five seconds.", 1)
		}
		changes, err = decodeMetadataInput(data)
		if err != nil {
			return metadataFailure(err)
		}
	case "rm", "set", "show":
		report.key = inv.operands[0]
		if report.action != "show" {
			change := core.MetadataChange{Key: report.key, Expect: core.MetadataExpectation{Mode: core.MetadataAny}}
			if report.action == "set" {
				report.value = inv.operands[1]
				change.Value = &report.value
			}
			changes = []core.MetadataChange{change}
		}
	}

	return withIdentityStore(ctx, root, app.store, identityOperationFailure(), func(store ports.Store) output.Report {
		transact := store.Read
		if len(changes) > 0 {
			transact = store.Write
		}
		err := transact(ctx, func(tx ports.StoreTx) error {
			repo := tx.Identities()
			var member *core.Identity
			var err error
			if report.action == "apply" && selected.explicit != nil && core.IsCanonicalIdentityID(*selected.explicit) {
				member, err = repo.FindByID(core.IdentityID(*selected.explicit))
				if err == nil && member == nil {
					return identityMissing(*selected.explicit)
				}
			} else {
				member, err = resolveSelectedIdentity(tx, selected)
			}
			if err != nil {
				return err
			}
			report.id = member.ID
			switch report.action {
			case "rm", "set", "show":
				if err := core.ValidateMetadataKey(report.key); err != nil {
					return err
				}
			}
			if len(changes) > 0 {
				result, err := repo.ApplyMetadata(member.ID, changes)
				if err != nil {
					return err
				}
				if len(result.Conflicts) > 0 {
					failure := bindingFailure("METADATA_CONFLICT", "Metadata expectations did not match current values; no changes were applied.", 5)
					failure.MetadataCurrent = result.Conflicts
					return failure
				}
				report.changed = result.Changed
				return nil
			}
			report.metadata, err = repo.ReadMetadata(member.ID)
			if err != nil {
				return err
			}
			if report.action == "show" {
				var found bool
				report.value, found = report.metadata[report.key]
				if !found {
					return bindingFailure("METADATA_KEY_NOT_FOUND", "The metadata key was not found.", 3)
				}
			}
			return nil
		})
		if err != nil {
			return metadataFailure(err)
		}
		return report
	})
}

type metadataReport struct {
	action     string
	id         core.IdentityID
	key, value string
	metadata   map[string]string
	changed    bool
}

func (r metadataReport) HumanStream() output.Stream { return output.Stdout }
func (r metadataReport) ExitStatus() int            { return 0 }
func (r metadataReport) JSON() any {
	doc := map[string]any{"identityId": r.id}
	switch r.action {
	case "apply":
		doc["changed"] = r.changed
	case "set":
		doc["key"], doc["value"], doc["changed"] = r.key, r.value, r.changed
	case "show":
		doc["key"], doc["value"] = r.key, r.value
	case "ls":
		doc["metadata"] = r.metadata
	case "rm":
		doc["key"], doc["removed"] = r.key, r.changed
	}
	return doc
}

func (r metadataReport) Human(w io.Writer) error {
	var text string
	switch r.action {
	case "apply":
		text = "Metadata unchanged"
		if r.changed {
			text = "Metadata updated"
		}
	case "set":
		field := r.key + "=" + r.value
		if r.changed {
			return success(w, "Set "+field)
		}
		text = clistyle.Escape(field) + " is unchanged"
	case "show":
		text = r.value
	case "ls":
		if len(r.metadata) == 0 {
			text = "No metadata found."
			break
		}
		fields := make([]clistyle.DetailField, 0, len(r.metadata))
		for _, key := range slices.Sorted(maps.Keys(r.metadata)) {
			fields = append(fields, clistyle.DetailField{Label: key, Value: r.metadata[key]})
		}
		return clistyle.WriteDetail(w, outputTerminal(w), "METADATA", fields)
	case "rm":
		if r.changed {
			return success(w, "Removed "+r.key)
		}
		text = r.key + " was already absent"
	}
	_, err := fmt.Fprintln(w, text)
	return err
}
