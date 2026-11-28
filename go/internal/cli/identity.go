package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func withIdentityStore(ctx context.Context, root home.Root, store ports.Store, unavailable *output.Failure, run func(ports.Store) output.Report) output.Report {
	return withIdentityStoreError(ctx, root, store, func(error) *output.Failure { return unavailable }, run)
}

func withIdentityStoreError(ctx context.Context, root home.Root, store ports.Store, unavailable func(error) *output.Failure, run func(ports.Store) output.Report) (report output.Report) {
	if store != nil {
		return run(store)
	}
	opened, err := storage.Open(ctx, root)
	if err != nil {
		return unavailable(err)
	}
	defer func() {
		if err := opened.Close(); err != nil {
			if _, failed := report.(*output.Failure); !failed {
				report = bindingFailure("CLEANUP_ERROR", "Could not clean up command resources. Effects may already have occurred.", 1)
			}
		}
	}()
	return run(opened)
}

func identityOperationFailure() *output.Failure {
	return bindingFailure("IDENTITY_ERROR", "Could not complete the identity operation.", 1)
}

func (app application) runIdentity(ctx context.Context, root home.Root, inv invocation) output.Report {
	if len(inv.path) == 1 {
		return talkUsage("An identity subcommand is required.")
	}
	switch inv.path[1] {
	case "mv":
		inv.path = []string{"mv"}
		return app.runBinding(ctx, root, inv)
	case "meta":
		return app.runMetadata(ctx, root, inv)
	case "status":
		return app.runIdentityStatus(ctx, root, inv)
	}
	var selection identitySelection
	if inv.path[1] == "show" && !inv.has("expect-name") {
		if len(inv.operands) == 1 {
			selection.explicit = &inv.operands[0]
		} else {
			var failed *output.Failure
			selection, failed = app.caller.selectIdentity(ctx, inv)
			if failed != nil {
				return identityShowFailure(failed)
			}
		}
	}
	return withIdentityStore(ctx, root, app.store, identityOperationFailure(), func(store ports.Store) output.Report {
		app.store = store
		switch inv.path[1] {
		case "create":
			return createIdentity(ctx, store, inv.operands[0])
		case "show":
			if inv.has("expect-name") {
				return app.showPinnedIdentity(ctx, inv.operands[0], inv.options["expect-name"])
			}
			return app.showIdentity(ctx, selection)
		case "ls":
			filters, failed := metadataFilters(inv)
			if failed != nil {
				return failed
			}
			var rows []core.Identity
			err := store.Read(ctx, func(tx ports.StoreTx) error {
				var err error
				if len(filters) > 0 {
					rows, err = tx.Identities().ListMatchingMetadata(filters)
				} else {
					rows, err = tx.Identities().List()
				}
				return err
			})
			if err != nil {
				return metadataFailure(err)
			}
			return identityListReport(rows)
		default:
			return talkUsage("An identity subcommand is required.")
		}
	})
}

func identityShowFailure(failure *output.Failure) *output.Failure {
	if failure.Code == "IDENTITY_REQUIRED" {
		return bindingFailure("IDENTITY_REQUIRED", "An identity is required; use identity show <name> or run from a verified bound pane.", 1)
	}
	if failure.Code == "IDENTITY_ERROR" {
		return identityOperationFailure()
	}
	return failure
}

func (app application) showIdentity(ctx context.Context, selected identitySelection) output.Report {
	if selected.explicit == nil {
		identity, _, failure := app.requestIdentities(ctx, selected, nil)
		if failure != nil {
			return identityShowFailure(failure)
		}
		return identityDetailReport{identity: *identity}
	}
	var member *core.Identity
	err := app.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		member, err = core.ResolveIdentity(tx.Identities(), *selected.explicit)
		return err
	})
	if err != nil {
		failure := bindingRejected(err)
		if failure.Code == "INVALID_NAME" {
			return failure
		}
		return identityOperationFailure()
	}
	if member == nil {
		return identityMissing(*selected.explicit)
	}
	return identityDetailReport{identity: *member}
}

func createIdentity(ctx context.Context, store ports.Store, raw string) output.Report {
	name, err := core.ValidateName(raw)
	if err != nil {
		return bindingRejected(err)
	}
	var report identityCreatedReport
	err = store.Write(ctx, func(tx ports.StoreTx) error {
		repo := tx.Identities()
		current, err := repo.FindByCanonicalName(name.CanonicalName())
		if err != nil {
			return err
		}
		now := uint64(wallClock{}.NowMs())
		switch {
		case current == nil:
			report.identity = core.Identity{ID: core.IdentityID(talkUUID()), Name: name.DisplayName(), CanonicalName: name.CanonicalName(), Lifetime: core.LifetimeSaved}
			report.created = true
			return repo.Insert(report.identity, now)
		case current.Lifetime == core.LifetimeTemporary:
			if err := repo.Promote(current.ID, now); err != nil {
				return err
			}
			current.Lifetime = core.LifetimeSaved
		}
		report.identity = *current
		return nil
	})
	if err != nil {
		return identityOperationFailure()
	}
	return report
}

func readPinnedIdentity(records ports.IdentityRepo, id core.IdentityID, expected string) (*core.Identity, error) {
	identity, err := records.FindByID(id)
	if err != nil {
		return nil, err
	}
	if identity == nil {
		retired, err := records.IsRetired(id)
		if err != nil {
			return nil, err
		}
		if retired {
			return nil, bindingFailure("IDENTITY_CHANGED", fmt.Sprintf("The identity %s has been retired.", id), 5)
		}
		return nil, identityMissing(string(id))
	}
	if identity.CanonicalName != core.NormalizeName(expected) {
		return nil, bindingFailure("IDENTITY_CHANGED", fmt.Sprintf("The identity %s is now named '%s', not '%s'.", id, identity.Name, expected), 5)
	}
	return identity, nil
}

func (app application) showPinnedIdentity(ctx context.Context, selector, expected string) output.Report {
	var entry bindingEntry
	err := app.store.Read(ctx, func(tx ports.StoreTx) error {
		var err error
		entry.identity, err = readPinnedIdentity(tx.Identities(), core.IdentityID(selector), expected)
		if err != nil {
			return err
		}
		entry.binding, err = tx.Bindings().FindByIdentity(entry.identity.ID)
		return err
	})
	if err != nil {
		var failure *output.Failure
		if errors.As(err, &failure) {
			return failure
		}
		return identityOperationFailure()
	}
	cli := newBindingCLI(app.store, app.caller.lookup)
	return identityDetailReport{identity: *entry.identity, presence: cli.presence(ctx, entry).presence}
}

type identityCreatedReport struct {
	identity core.Identity
	created  bool
}

func (r identityCreatedReport) HumanStream() output.Stream { return output.Stdout }
func (r identityCreatedReport) ExitStatus() int            { return 0 }
func (r identityCreatedReport) JSON() any {
	return struct {
		Identity identityDocument `json:"identity"`
		Created  bool             `json:"created"`
	}{identityJSON(&r.identity), r.created}
}
func (r identityCreatedReport) Human(w io.Writer) error {
	if r.created {
		return success(w, fmt.Sprintf("Created saved identity '%s' (%s)", r.identity.Name, r.identity.ID))
	}
	_, err := fmt.Fprintf(w, "Saved identity '%s' already exists (%s)\n", clistyle.Escape(string(r.identity.Name)), r.identity.ID)
	return err
}

type identityDetailReport struct {
	identity core.Identity
	presence string
}

func (r identityDetailReport) HumanStream() output.Stream { return output.Stdout }
func (r identityDetailReport) ExitStatus() int            { return 0 }
func (r identityDetailReport) JSON() any {
	type detail struct {
		identityDocument
		Presence string `json:"presence,omitempty"`
	}
	return struct {
		Identity detail `json:"identity"`
	}{detail{identityJSON(&r.identity), r.presence}}
}
func (r identityDetailReport) Human(w io.Writer) error {
	fields := []clistyle.DetailField{
		{Label: "lifetime", Value: string(r.identity.Lifetime)},
		{Label: "canonical", Value: r.identity.CanonicalName},
		{Label: "id", Value: string(r.identity.ID)},
	}
	if r.presence != "" {
		fields = append(fields, clistyle.DetailField{Label: "presence", Value: r.presence})
	}
	return clistyle.WriteDetail(w, outputTerminal(w), string(r.identity.Name), fields)
}

type identityListReport []core.Identity

func (r identityListReport) HumanStream() output.Stream { return output.Stdout }
func (r identityListReport) ExitStatus() int            { return 0 }
func (r identityListReport) JSON() any {
	rows := make([]identityDocument, 0, len(r))
	for _, identity := range r {
		rows = append(rows, identityJSON(&identity))
	}
	return struct {
		Identities []identityDocument `json:"identities"`
	}{rows}
}
func (r identityListReport) Human(w io.Writer) error {
	term := outputTerminal(w)
	if len(r) == 0 {
		if _, err := fmt.Fprintln(w, "No identities found."); err != nil {
			return err
		}
		return clistyle.WriteHint(w, term, flavor.Binary+" name <name>")
	}
	sorted := slices.Clone(r)
	slices.SortFunc(sorted, func(a, b core.Identity) int { return strings.Compare(a.CanonicalName, b.CanonicalName) })
	var sections []clistyle.ListSection
	for _, lifetime := range []core.Lifetime{core.LifetimeSaved, core.LifetimeTemporary} {
		rows := clistyle.NewTable(clistyle.ColumnName, clistyle.ColumnFixed)
		count := 0
		for _, identity := range sorted {
			if identity.Lifetime == lifetime {
				rows.AddRow(clistyle.Cell{Text: string(identity.Name)}, clistyle.Cell{Text: clistyle.ShortID(string(identity.ID)), Token: clistyle.TokenDim})
				count++
			}
		}
		if count > 0 {
			sections = append(sections, clistyle.ListSection{Title: string(lifetime), Count: &count, Rows: rows})
		}
	}
	return clistyle.WriteList(w, term, sections)
}
