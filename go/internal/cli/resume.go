package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func (app application) runResume(ctx context.Context, root home.Root, inv invocation, stdout, stderr io.Writer) int {
	if inv.has("show") {
		return publish(stdout, stderr, app.runResumeInspect(ctx, root, inv), false)
	}
	fail := func(report *output.Failure) int { return publish(stdout, stderr, report, false) }
	for _, option := range []string{"move", "new", "retry", "driver", "forget", "forget-launch", "save"} {
		if inv.has(option) {
			// NOT PORTED (CLI-01): Explicit resume mutations outside exact resume.
			return fail(bindingUnavailable("resume --" + option))
		}
	}
	if inv.has("channel") || inv.has("no-channel") {
		// NOT PORTED (CLI-23): Resuming with explicit channel overrides.
		return fail(bindingUnavailable("resume --channel/--no-channel"))
	}
	if host := inv.options["host"]; host != "" && host != "tmux" {
		// NOT PORTED (CLI-25): Resume in built-in or external hosts.
		return fail(bindingFailure("HOST_NOT_AVAILABLE", "The requested launch host is not available in "+flavor.Binary+".", 3))
	}
	for _, option := range []string{"model", "effort"} {
		if inv.has(option) && !validResumeSetting(inv.options[option]) {
			return fail(bindingFailure("RESUME_SETTINGS_INVALID", "Model and effort must be bounded, non-option tokens.", 1))
		}
	}

	bindings := newBindingCLI(app.store, app.caller.lookup)
	claim, failure := bindings.callerClaim()
	if failure != nil {
		return fail(failure)
	}

	selection, failure := app.selectResumeIdentity(ctx, inv)
	if failure != nil {
		return fail(failure)
	}
	if selection.explicit == nil && selection.claim != claim {
		return fail(resumeConflict())
	}

	store := app.store
	if store == nil {
		opened, err := storage.Open(ctx, root)
		if err != nil {
			return fail(resumeStoreFailure())
		}
		defer func() {
			if err := opened.Close(); err != nil {
				_ = warn(stderr, "could not close remembered session state")
			}
		}()
		store = opened
	}
	snapshot, failure := readResumeSnapshot(ctx, store, selection, false)
	if failure != nil {
		return fail(failure)
	}
	if app.launch == nil {
		return fail(bindingFailure("RUN_LAUNCH_FAILED", "Could not prepare the foreground launch. No agent was launched.", 1))
	}
	if failure := preflightResume(ctx, bindings.process, *snapshot); failure != nil {
		return fail(failure)
	}
	plan, failure := prepareExactResume(root, inv, snapshot)
	if failure != nil {
		return fail(failure)
	}
	bindings.store = store
	entry, failure := bindings.bind(ctx, claim.pane, claim.serverPID, plan.binding)
	if failure != nil {
		return fail(resumeOutputFailure(failure))
	}
	return app.launch(ctx, root, store, entry, plan, stdout, stderr)
}

func (app application) runResumeInspect(ctx context.Context, root home.Root, inv invocation) output.Report {
	selection, failure := app.selectResumeIdentity(ctx, inv)
	if failure != nil {
		return failure
	}
	return withIdentityStore(ctx, root, app.store, resumeStoreFailure(), func(store ports.Store) output.Report {
		snapshot, failure := readResumeSnapshot(ctx, store, selection, true)
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

func readResumeSnapshot(ctx context.Context, store ports.Store, selection identitySelection, show bool) (*core.ResumeSnapshot, *output.Failure) {
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
		if !show {
			// Reuse storage's eligibility policy before any host effect. The
			// binding writers check the original snapshot again before mutation.
			return verifyBindingResume(tx, snapshot)
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
	// Storage emits native command hints. Keep the corresponding actions on
	// this executable while the Go home is isolated.
	report := *failure
	report.Message = strings.NewReplacer(
		"Start fresh with: tmt run ", "Start fresh with: "+flavor.Binary+" run ",
		"Forget it with: tmt resume ", "Forget it with: "+flavor.Binary+" resume ",
		"try it once more with: tmt resume ", "try it once more with: "+flavor.Binary+" resume ",
		"Start fresh from its notes: tmt resume ", "Start fresh from its notes: "+flavor.Binary+" resume ",
	).Replace(report.Message)
	return &report
}

// Admission follows spawn, so even a typed storage refusal must account for a
// foreground command that already started.
func resumeAdmissionFailure(err error) *output.Failure {
	var typed *core.RequestFailure
	switch {
	case errors.As(err, &typed) && typed != nil:
		report := resumeOutputFailure(typed)
		report.Message = strings.ReplaceAll(report.Message,
			"No new agent was launched; check the old pane and retry.",
			"The foreground command started. Inspect its pane before retrying.")
		return report
	case err == nil || errors.Is(err, errHookLaunchChanged):
		return bindingFailure("RUNTIME_CONFLICT", "Resume evidence changed after the foreground command started. Inspect its pane before retrying.", 5)
	default:
		return bindingFailure("RUN_LAUNCH_FAILED", "The foreground command started but its runtime could not be recorded. Inspect its pane before retrying.", 1)
	}
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

func preflightResume(ctx context.Context, observe func(context.Context, int) (runtime.Observation, error), snapshot core.ResumeSnapshot) *output.Failure {
	binding := snapshot.PriorBinding
	if binding == nil || binding.Session.Runtime == nil {
		return nil
	}
	pid := binding.Session.Runtime.PID
	var observed runtime.Observation
	if observe != nil && pid > 0 && pid <= math.MaxInt32 && binding.Server.Host == "tmux" {
		expected := runtime.Incarnation{PID: int(pid), Start: binding.Session.Runtime.StartIdentity}
		var err error
		observed, err = observe(ctx, expected.PID)
		if err == nil && observed.Match(expected) == runtime.Gone {
			return nil
		}
	}
	reason := fmt.Sprintf("TMT cannot confirm that the recorded agent in pane %s has ended.", binding.PaneID)
	if observed.State == runtime.Alive || observed.State == runtime.Suspended {
		reason = fmt.Sprintf("The recorded agent is still attached to pane %s (possibly suspended).", binding.PaneID)
	}
	message := fmt.Sprintf("%s No new agent was launched. Check the old pane and exit the agent, or move it with: "+flavor.Binary+" resume --move -- %s",
		reason, core.CommandWord(string(snapshot.Identity.Name)))
	return bindingFailure("RUNTIME_CONFLICT", message, 5)
}

// NOT PORTED (CLI-01): Provider session presence checks and replay of matching launch presets.
func prepareExactResume(root home.Root, inv invocation, snapshot *core.ResumeSnapshot) (runPlan, *output.Failure) {
	session := snapshot.Selected
	if session == nil {
		return runPlan{}, resumeConflict()
	}
	var driver ports.Driver
	switch session.Driver {
	case core.DriverClaude:
		driver = claude.Driver{}
	case core.DriverCodex:
		driver = codex.Driver{}
	default:
		return runPlan{}, resumeConflict()
	}
	dir, err := os.Getwd()
	if err != nil {
		return runPlan{}, bindingFailure("RUN_LAUNCH_FAILED", "Could not resolve the working directory. No agent was launched.", 1)
	}
	command, err := driver.LaunchCommand(ports.AgentLaunch{
		Identity: snapshot.Identity.ID, Name: snapshot.Identity.Name, Dir: dir, HomeDir: root.Dir,
		Resume: session.ProviderSession, Model: inv.options["model"], Effort: inv.options["effort"],
	})
	if err != nil {
		return runPlan{}, bindingFailure("RUNTIME_ERROR", "Could not prepare runtime resume.", 1)
	}
	return runPlan{
		binding: bindingSelection{id: snapshot.Identity.ID, resume: snapshot}, provider: driver.Name(), command: command,
		resume: &core.ResumeExpectation{
			IdentityID: snapshot.Identity.ID, Driver: session.Driver, ProviderSession: session.ProviderSession, Fence: snapshot.Fence,
		},
	}, nil
}

func validResumeSetting(value string) bool {
	return value != "" && len(value) <= 128 && value[0] != '-' &&
		!strings.ContainsFunc(value, func(c rune) bool {
			return !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' ||
				strings.ContainsRune("-._:/[]@", c))
		})
}
