package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/claude"
	"github.com/tmt-ninja/tmt/go/internal/adapters/drivers/codex"
	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/adapters/storage"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/flavor"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/invoke"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func (app application) runResume(ctx context.Context, root home.Root, inv invocation, stdout, stderr io.Writer) int {
	// Native dispatches --forget only with an explicit name. The nameless
	// form follows ordinary caller selection and exact resume.
	switch {
	case inv.has("show"):
		return publish(stdout, stderr, app.runResumeInspect(ctx, root, inv), false)
	case inv.has("forget-launch"), inv.has("forget") && len(inv.operands) > 0:
		return publish(stdout, stderr, app.runResumeForget(ctx, root, inv), false)
	}
	fail := func(report *output.Failure) int { return publish(stdout, stderr, report, false) }
	for _, option := range []string{"move", "new", "retry", "driver", "save"} {
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
	selection, failure := app.selectResumeIdentity(ctx, inv)
	if failure != nil {
		return fail(failure)
	}
	var claim callerClaim
	if selection.explicit != nil || selection.claim != (callerClaim{}) {
		claim, failure = bindings.callerClaim()
		if failure != nil {
			return fail(failure)
		}
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

func (app application) runResumeForget(ctx context.Context, root home.Root, inv invocation) output.Report {
	selection, failure := app.selectResumeIdentity(ctx, inv)
	if failure != nil {
		return failure
	}
	preset := inv.has("forget-launch")
	return withIdentityStoreError(ctx, root, app.store, func(err error) *output.Failure {
		if !preset && errors.Is(err, os.ErrPermission) {
			return identityStorageNotWritable(root, "No remembered session was changed.")
		}
		return resumeStoreFailure()
	}, func(store ports.Store) output.Report {
		var report resumeForgetReport
		err := store.Write(ctx, func(tx ports.StoreTx) error {
			identity, err := resolveResumeIdentity(tx, selection)
			if err != nil {
				return err
			}
			if preset {
				report.message = fmt.Sprintf("Forgot %s's launch preset.", identity.Name)
				return tx.Bindings().ForgetResumeLaunch(*identity)
			}
			driver, err := tx.Bindings().ForgetResume(*identity)
			if err != nil {
				return err
			}
			if driver == nil {
				report.message = fmt.Sprintf("%s has no remembered session.", identity.Name)
			} else {
				report.message = fmt.Sprintf("Forgot %s's remembered %s session.", identity.Name, *driver)
				report.forgotSession = true
			}
			return nil
		})
		switch {
		case preset && errors.Is(err, core.ErrIdentityInactive):
			return bindingFailure("NAME_NOT_FOUND", "The identity changed before clearing its launch preset.", 3)
		case selection.explicit != nil && errors.Is(err, core.ErrIdentityInactive):
			return identityMissing(*selection.explicit)
		case err != nil:
			return resumeOutputFailure(err)
		default:
			return report
		}
	})
}

type resumeForgetReport struct {
	message       string
	forgotSession bool
}

func (r resumeForgetReport) JSON() any                { return r.message }
func (resumeForgetReport) HumanStream() output.Stream { return output.Stdout }
func (resumeForgetReport) ExitStatus() int            { return 0 }
func (r resumeForgetReport) Human(w io.Writer) error {
	if r.forgotSession {
		return success(w, r.message)
	}
	_, err := fmt.Fprintln(w, r.message)
	return err
}

func (app application) selectResumeIdentity(ctx context.Context, inv invocation) (identitySelection, *output.Failure) {
	if len(inv.operands) > 0 {
		return identitySelection{explicit: &inv.operands[0]}, nil
	}
	selection, failure := app.caller.selectIdentity(ctx, inv)
	if failure != nil && failure.Code == "IDENTITY_REQUIRED" {
		return identitySelection{}, nil
	}
	return selection, failure
}

func resolveResumeIdentity(tx ports.StoreTx, selection identitySelection) (*core.Identity, error) {
	if selection.explicit == nil && selection.claim == (callerClaim{}) {
		return nil, unboundResumeCaller(tx)
	}
	identity, err := resolveSelectedIdentity(tx, selection)
	if failure, ok := err.(*output.Failure); ok && failure.Code == "IDENTITY_REQUIRED" {
		return nil, unboundResumeCaller(tx)
	}
	return identity, err
}

func readResumeSnapshot(ctx context.Context, store ports.Store, selection identitySelection, show bool) (*core.ResumeSnapshot, *output.Failure) {
	var snapshot *core.ResumeSnapshot
	err := store.Read(ctx, func(tx ports.StoreTx) error {
		identity, err := resolveResumeIdentity(tx, selection)
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

// NOT PORTED (CLI-01): Provider session presence and Codex npm launcher ownership.
func prepareExactResume(root home.Root, inv invocation, snapshot *core.ResumeSnapshot) (runPlan, *output.Failure) {
	session := snapshot.Selected
	if session == nil {
		return runPlan{}, resumeConflict()
	}
	dir, err := os.Getwd()
	if err != nil {
		return runPlan{}, bindingFailure("RUN_LAUNCH_FAILED", "Could not resolve the working directory. No agent was launched.", 1)
	}
	var executable string
	if preset := snapshot.ReplayPreset; preset != nil {
		executable = preset.Executable
		if strings.ContainsRune(executable, os.PathSeparator) && !filepath.IsAbs(executable) {
			// Resolve an explicit relative launcher from the requested working
			// directory, preserving traversal through symlink components.
			executable = dir + string(os.PathSeparator) + executable
		}
		executable, err = exec.LookPath(executable)
		if err != nil {
			return runPlan{}, bindingFailure("LAUNCH_FAILED", "Could not start the requested command.", 1)
		}
	}
	var driver ports.Driver
	switch session.Driver {
	case core.DriverClaude:
		driver = claude.Driver{Executable: executable}
	case core.DriverCodex:
		driver = codex.Driver{Executable: executable}
	default:
		return runPlan{}, resumeConflict()
	}
	model, effort := resumeSettings(inv, snapshot, driver.Name())
	command, err := driver.LaunchCommand(ports.AgentLaunch{
		Identity: snapshot.Identity.ID, Name: snapshot.Identity.Name, Dir: dir, HomeDir: root.Dir,
		Resume: session.ProviderSession, Model: model, Effort: effort,
	})
	if err != nil {
		return runPlan{}, bindingFailure("RUNTIME_ERROR", "Could not prepare runtime resume.", 1)
	}
	if preset := snapshot.ReplayPreset; preset != nil {
		command.Env = resumeEnvironment(command.Env, preset.Env)
	}
	return runPlan{
		binding: bindingSelection{id: snapshot.Identity.ID, resume: snapshot}, provider: driver.Name(), command: command,
		resume: &core.ResumeExpectation{
			IdentityID: snapshot.Identity.ID, Driver: session.Driver, ProviderSession: session.ProviderSession, Fence: snapshot.Fence,
		},
	}, nil
}

func resumeSettings(inv invocation, snapshot *core.ResumeSnapshot, executable string) (model, effort string) {
	preset := snapshot.ReplayPreset
	if preset == nil && snapshot.ResumeModel == nil {
		// Native reuses only the model from an unassociated launch of the
		// same executable name, independent of its installation path.
		if launch := snapshot.LaunchPreset; launch != nil && !launch.Associated &&
			filepath.Base(launch.Executable) == filepath.Base(executable) && launch.Model != nil {
			model = *launch.Model
		}
	}
	if preset != nil {
		if preset.Model != nil {
			model = *preset.Model
		}
		if preset.Effort != nil {
			effort = *preset.Effort
		}
	}
	if snapshot.ResumeModel != nil {
		model = *snapshot.ResumeModel
	}
	if inv.has("model") {
		model = inv.options["model"]
	}
	if inv.has("effort") {
		effort = inv.options["effort"]
	}
	return model, effort
}

func resumeEnvironment(base []string, saved map[string]string) []string {
	var additions []string
	for key, value := range saved {
		if _, present := os.LookupEnv(key); !present {
			additions = append(additions, key+"="+value)
		}
	}
	slices.Sort(additions)
	return invoke.OverlayEnv(base, additions)
}

func validResumeSetting(value string) bool {
	return value != "" && len(value) <= 128 && value[0] != '-' &&
		!strings.ContainsFunc(value, func(c rune) bool {
			return !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' ||
				strings.ContainsRune("-._:/[]@", c))
		})
}
