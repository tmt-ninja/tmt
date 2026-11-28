package cli

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func (app application) runResumeInspect(ctx context.Context, root home.Root, inv invocation) output.Report {
	if !inv.has("show") {
		// NOT PORTED (CLI-01): Compose the exact resume launch and other resume actions.
		return bindingUnavailable("resume without --show")
	}
	selection, failure := app.selectResumeIdentity(ctx, inv)
	if failure != nil {
		return failure
	}
	return withIdentityStore(ctx, root, app.store, resumeStoreFailure(), func(store ports.Store) output.Report {
		snapshot, failure := readResumeSnapshot(ctx, store, selection)
		if failure != nil {
			return failure
		}
		return resumeInspectReport{snapshot: *snapshot}
	})
}

func (app application) selectResumeIdentity(ctx context.Context, inv invocation) (identitySelection, *output.Failure) {
	if len(inv.operands) > 0 {
		return identitySelection{explicit: &inv.operands[0]}, nil
	}
	return app.caller.selectIdentity(ctx, inv)
}

func readResumeSnapshot(ctx context.Context, store ports.Store, selection identitySelection) (*core.ResumeSnapshot, *output.Failure) {
	var snapshot *core.ResumeSnapshot
	err := store.Read(ctx, func(tx ports.StoreTx) error {
		var identity *core.Identity
		var err error
		if selection.explicit != nil {
			identity, err = core.ResolveIdentity(tx.Identities(), *selection.explicit)
			if err == nil && identity == nil {
				return identityMissing(*selection.explicit)
			}
		} else {
			identity, err = verifiedCaller(tx, selection.claim, selection.probe)
			if err == nil && identity == nil {
				return unboundResumeCaller(tx)
			}
		}
		if err != nil {
			return err
		}
		snapshot, err = tx.Bindings().ReadResume(identity.ID)
		if err != nil {
			return err
		}
		if snapshot == nil {
			return resumeConflict()
		}
		return nil
	})
	if err != nil {
		return nil, resumeOutputFailure(err)
	}
	return snapshot, nil
}

func unboundResumeCaller(tx ports.StoreTx) error {
	identities, err := tx.Identities().List()
	if err != nil {
		return err
	}
	var names []string
	for _, identity := range identities {
		if identity.Lifetime == core.LifetimeSaved {
			names = append(names, string(identity.Name))
		}
	}
	text := strings.Join(names, ", ")
	if text == "" {
		text = "(none)"
	}
	return bindingFailure("IDENTITY_REQUIRED", "No identity is bound to this pane. Specify a saved identity: "+text, 1)
}

func resumeConflict() *output.Failure {
	return bindingFailure("RUNTIME_CONFLICT", "The identity changed before resume. No new agent was launched; check the old pane and retry.", 5)
}

func resumeStoreFailure() *output.Failure {
	return bindingFailure("IDENTITY_ERROR", "Could not access remembered session state.", 1)
}

func resumeOutputFailure(err error) *output.Failure {
	var failure *output.Failure
	if !errors.As(err, &failure) {
		var typed *core.RequestFailure
		if !errors.As(err, &typed) {
			return resumeStoreFailure()
		}
		failure = responseServiceFailure(typed)
	}

	return failure
}

type resumeInspectReport struct {
	snapshot core.ResumeSnapshot
}

type resumeInspectPreset struct {
	Executable string            `json:"executable"`
	Model      *string           `json:"model"`
	Effort     *string           `json:"effort"`
	Env        map[string]string `json:"env"`
	Associated bool              `json:"associated"`
}

type resumeInspectDocument struct {
	Identity core.Name            `json:"identity"`
	Launch   *resumeInspectPreset `json:"launch"`
}

func (r resumeInspectReport) JSON() any {
	doc := resumeInspectDocument{Identity: r.snapshot.Identity.Name}
	if preset := r.snapshot.LaunchPreset; preset != nil {
		doc.Launch = &resumeInspectPreset{
			Executable: preset.Executable, Model: preset.Model, Effort: preset.Effort,
			Env: preset.Env, Associated: preset.Associated,
		}
	}
	return doc
}

func (resumeInspectReport) HumanStream() output.Stream { return output.Stdout }
func (resumeInspectReport) ExitStatus() int            { return 0 }
func (r resumeInspectReport) Human(w io.Writer) error {
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder.Encode(r.JSON())
}
