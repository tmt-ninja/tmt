package cli

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

type profileReport struct {
	kind    core.ProfileKind
	member  core.Identity
	profile *core.TextProfile
	status  string
}

func (r profileReport) HumanStream() output.Stream { return output.Stdout }
func (r profileReport) ExitStatus() int            { return 0 }

func (r profileReport) JSON() any {
	if r.kind == core.ProfileRole {
		var role any
		if r.profile != nil {
			role = map[string]string{"content": r.profile.Content, "updatedAt": time.UnixMilli(int64(r.profile.UpdatedAtMs)).UTC().Format("2006-01-02T15:04:05.000Z")}
		}
		return map[string]any{"identity": identityJSON(&r.member), "role": role}
	}
	doc := map[string]any{"agent": r.member.Name}
	if r.status == "" || r.status == "set" {
		doc["preamble"] = nil
		if r.profile != nil {
			doc["preamble"] = r.profile.Content
		}
	}
	if r.status != "" {
		doc["status"] = r.status
	}
	return doc
}

func (r profileReport) Human(w io.Writer) error {
	name := clistyle.Escape(string(r.member.Name))
	if r.kind == core.ProfileRole {
		switch r.status {
		case "set":
			return success(w, fmt.Sprintf("Set role profile for '%s'", r.member.Name))
		case "cleared", "not_set":
			return success(w, fmt.Sprintf("Cleared role profile for '%s'", r.member.Name))
		default:
			content := "No role profile is set."
			if r.profile != nil {
				content = r.profile.Content
			}
			_, err := fmt.Fprintf(w, "Identity '%s'\n%s\n", name, content)
			return err
		}
	}
	switch r.status {
	case "set":
		return success(w, fmt.Sprintf("Set preamble for %s", r.member.Name))
	case "cleared":
		return success(w, fmt.Sprintf("Cleared preamble for %s", r.member.Name))
	case "not_set":
		_, err := fmt.Fprintf(w, "No preamble was set for %s\n", name)
		return err
	default:
		if r.profile == nil {
			_, err := fmt.Fprintf(w, "No preamble set for %s\n", name)
			return err
		}
		_, err := fmt.Fprintf(w, "Preamble for %s:\n%s\n", name, r.profile.Content)
		return err
	}
}

type preambleRow struct {
	Agent    core.Name `json:"agent"`
	Preamble string    `json:"preamble"`
}

type preambleListReport struct {
	Preambles []preambleRow `json:"preambles"`
}

func (r preambleListReport) JSON() any                  { return r }
func (r preambleListReport) HumanStream() output.Stream { return output.Stdout }
func (r preambleListReport) ExitStatus() int            { return 0 }
func (r preambleListReport) Human(w io.Writer) error {
	if len(r.Preambles) == 0 {
		_, err := fmt.Fprintln(w, "No preambles configured")
		return err
	}
	term := outputTerminal(w)
	for _, row := range r.Preambles {
		title := "─── " + clistyle.Escape(string(row.Agent)) + " ───"
		if _, err := fmt.Fprintf(w, "%s\n%s\n\n", term.Paint(clistyle.TokenTitle, title), row.Preamble); err != nil {
			return err
		}
	}
	return nil
}

func (app application) runProfile(ctx context.Context, root home.Root, inv invocation) output.Report {
	kind := core.ProfileKind(inv.path[0])
	action := "show"
	if len(inv.path) == 2 {
		action = inv.path[1]
	} else if kind == core.ProfileRole {
		return talkUsage("A role subcommand is required.")
	}
	unavailable := bindingFailure(strings.ToUpper(string(kind))+"_ERROR", "Could not access profile storage.", 1)
	if kind == core.ProfilePreamble && action == "show" && len(inv.operands) == 0 {
		return withIdentityStore(ctx, root, app.store, unavailable, func(store ports.Store) output.Report {
			return listPreambles(ctx, store, unavailable)
		})
	}

	var selected identitySelection
	if kind == core.ProfilePreamble {
		selected.explicit = &inv.operands[0]
	} else {
		if action == "set" && inv.has("file") == (len(inv.operands) != 0) {
			return talkUsage("Usage: select exactly one inline content, --file, or supported --stdin source.")
		}
	}
	var content string
	if action == "set" {
		var failure *output.Failure
		content, failure = profileInput(kind, inv)
		if failure != nil {
			return failure
		}
	}
	if kind == core.ProfileRole {
		var failure *output.Failure
		selected, failure = app.caller.selectIdentity(ctx, inv)
		if failure != nil {
			return failure
		}
	}
	return withIdentityStore(ctx, root, app.store, unavailable, func(store ports.Store) output.Report {
		var report profileReport
		report.kind = kind
		transact := store.Read
		if action != "show" {
			transact = store.Write
		}
		err := transact(ctx, func(tx ports.StoreTx) error {
			member, err := resolveSelectedIdentity(tx, selected)
			if err != nil {
				return err
			}
			report.member = *member
			profiles := tx.Profiles()
			switch action {
			case "show":
				report.profile, err = profiles.Get(kind, member.ID)
			case "set":
				report.profile, err = profiles.Put(kind, member.ID, content, uint64(wallClock{}.NowMs()))
				if err != nil {
					if errors.Is(err, core.ErrProfileTooLarge) || errors.Is(err, core.ErrProfileEmpty) ||
						errors.Is(err, core.ErrProfileControl) || errors.Is(err, core.ErrProfileEncoding) {
						return profileInputFailure(kind, err)
					}
					return err
				}
				if report.profile == nil {
					return identityMissing(string(member.Name))
				}
				report.status = "set"
			case "rm":
				var removed bool
				removed, err = profiles.Remove(kind, member.ID)
				report.status = "not_set"
				if removed {
					report.status = "cleared"
				}
			}
			return err
		})
		if err != nil {
			var failure *output.Failure
			if errors.As(err, &failure) {
				return failure
			}
			return unavailable
		}
		return report
	})
}

func resolveSelectedIdentity(tx ports.StoreTx, selected identitySelection) (*core.Identity, error) {
	if selected.explicit != nil {
		member, err := core.ResolveIdentity(tx.Identities(), *selected.explicit)
		if err != nil {
			return nil, err
		}
		if member == nil {
			return nil, identityMissing(*selected.explicit)
		}
		return member, nil
	}
	member, err := verifiedCaller(tx, selected.claim, selected.probe)
	if err != nil {
		return nil, err
	}
	if member == nil {
		return nil, identityRequired()
	}
	return member, nil
}

func listPreambles(ctx context.Context, store ports.Store, unavailable *output.Failure) output.Report {
	report := preambleListReport{Preambles: []preambleRow{}}
	err := store.Read(ctx, func(tx ports.StoreTx) error {
		profiles, err := tx.Profiles().List(core.ProfilePreamble)
		if err != nil {
			return err
		}
		members, err := tx.Identities().List()
		if err != nil {
			return err
		}
		byID := make(map[core.IdentityID]core.Name, len(members))
		for _, member := range members {
			byID[member.ID] = member.Name
		}
		for _, profile := range profiles {
			report.Preambles = append(report.Preambles, preambleRow{byID[profile.IdentityID], profile.Content})
		}
		return nil
	})
	if err != nil {
		return unavailable
	}
	return report
}

func profileInput(kind core.ProfileKind, inv invocation) (string, *output.Failure) {
	if kind == core.ProfilePreamble {
		return strings.Join(inv.operands[1:], " "), nil
	}
	if !inv.has("file") {
		return inv.operands[0], nil
	}
	data, err := process.ReadInputFile(inv.options["file"], core.MaxProfileBytes)
	if err != nil {
		return "", bindingFailure("ROLE_FILE_ERROR", "Could not read a regular role file.", 1)
	}
	if len(data) > core.MaxProfileBytes {
		return "", profileInputFailure(kind, core.ErrProfileTooLarge)
	}
	if !utf8.Valid(data) {
		return "", bindingFailure("ROLE_INPUT_INVALID", "Role file must be valid UTF-8.", 1)
	}
	return string(data), nil
}

func profileInputFailure(kind core.ProfileKind, err error) *output.Failure {
	suffix := "_INPUT_INVALID"
	if errors.Is(err, core.ErrProfileTooLarge) {
		suffix = "_INPUT_TOO_LARGE"
	}
	return bindingFailure(strings.ToUpper(string(kind))+suffix, err.Error(), 1)
}
