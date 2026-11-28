package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

func (app application) runIdentityStatus(ctx context.Context, root home.Root, inv invocation) output.Report {
	if len(inv.path) != 3 {
		return talkUsage("An identity status subcommand is required.")
	}
	action := inv.path[2]
	ttl := uint64(core.DefaultStatusTTLms)
	if inv.has("for") {
		seconds, failure := durationSeconds(inv.options["for"])
		if failure != nil {
			return failure
		}
		millis := seconds * 1000
		if millis < core.MinStatusTTLms || millis > core.MaxStatusTTLms {
			return talkUsage("Status duration must be 1 second through 24 hours.")
		}
		ttl = uint64(math.Round(millis))
	}
	selected, failure := app.caller.selectIdentity(ctx, inv)
	if failure != nil {
		return failure
	}
	return withIdentityStore(ctx, root, app.store, identityOperationFailure(), func(store ports.Store) output.Report {
		transact := store.Read
		if action != "show" {
			transact = store.Write
		}
		report := statusReport{clear: action == "rm"}
		err := transact(ctx, func(tx ports.StoreTx) error {
			member, err := resolveSelectedIdentity(tx, selected)
			if err != nil {
				return err
			}
			report.id = member.ID
			report.now = uint64(wallClock{}.NowMs())
			repo := tx.Identities()
			switch action {
			case "show":
				report.status, err = repo.ReadStatus(member.ID)
				return err
			case "set":
				var mood *string
				if text, ok := inv.options["mood"]; ok {
					mood = &text
				}
				status, err := core.NewIdentityStatus(inv.operands[0], mood, report.now, ttl)
				if err != nil {
					return err
				}
				report.status = &status
				return repo.PutStatus(member.ID, status)
			default:
				report.removed, err = repo.RemoveStatus(member.ID)
				return err
			}
		})
		if err != nil {
			return statusFailure(err)
		}
		return report
	})
}

func statusFailure(err error) *output.Failure {
	var message string
	switch {
	case errors.Is(err, core.ErrIdentityInactive):
		return bindingFailure("NAME_NOT_FOUND", "The selected identity is not active.", 3)
	case errors.Is(err, core.ErrStatusActivity):
		message = "Status activity must contain 1-160 UTF-8 bytes of nonblank text without controls."
	case errors.Is(err, core.ErrStatusMood):
		message = "Status mood must contain 1-32 UTF-8 bytes of nonblank text without controls."
	case errors.Is(err, core.ErrStatusDuration):
		message = "Status duration must be 1 second through 24 hours."
	case errors.Is(err, core.ErrStatusClock):
		message = "Status timestamps must be positive safe integers with a valid expiry."
	default:
		var failure *output.Failure
		if errors.As(err, &failure) {
			return failure
		}
		return identityOperationFailure()
	}
	return bindingFailure("IDENTITY_STATUS_INVALID", message, 1)
}

type statusReport struct {
	id      core.IdentityID
	status  *core.IdentityStatus
	now     uint64
	clear   bool
	removed bool
}

type statusDocument struct {
	Activity    string  `json:"activity"`
	Mood        *string `json:"mood"`
	UpdatedAtMs uint64  `json:"updatedAtMs"`
	ExpiresAtMs uint64  `json:"expiresAtMs"`
	Stale       bool    `json:"stale"`
}

func (r statusReport) HumanStream() output.Stream { return output.Stdout }
func (r statusReport) ExitStatus() int            { return 0 }
func (r statusReport) JSON() any {
	if r.clear {
		return map[string]any{"identityId": r.id, "removed": r.removed}
	}
	var status *statusDocument
	if s := r.status; s != nil {
		status = &statusDocument{s.Activity, s.Mood, s.UpdatedAtMs, s.ExpiresAtMs, s.Stale(r.now)}
	}
	return map[string]any{"identityId": r.id, "status": status}
}

func (r statusReport) Human(w io.Writer) error {
	if r.clear {
		if r.removed {
			return success(w, "Cleared self-reported status")
		}
		_, err := fmt.Fprintln(w, "No self-reported status to clear.")
		return err
	}
	if r.status == nil {
		_, err := fmt.Fprintln(w, "No self-reported status.")
		return err
	}
	kind := "Self-reported status"
	if r.status.Stale(r.now) {
		kind = "Stale status"
	}
	term := outputTerminal(w)
	if _, err := fmt.Fprintf(w, "%s: %s\n", term.Paint(clistyle.TokenTitle, kind), clistyle.Escape(r.status.Activity)); err != nil {
		return err
	}
	if r.status.Mood != nil {
		if _, err := fmt.Fprintf(w, "Mood: %s\n", clistyle.Escape(*r.status.Mood)); err != nil {
			return err
		}
	}
	_, err := fmt.Fprintf(w, "Updated: %d ms since epoch; expires: %d ms since epoch.\n", r.status.UpdatedAtMs, r.status.ExpiresAtMs)
	return err
}
