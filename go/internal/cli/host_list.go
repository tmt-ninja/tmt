package cli

import (
	"encoding/json/jsontext"
	"encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

const driverRegistryLimit = 64 * 1024

type driverListReport struct{}

func (driverListReport) JSON() any                  { return map[string][]any{"drivers": {}} }
func (driverListReport) HumanStream() output.Stream { return output.Stdout }
func (driverListReport) ExitStatus() int            { return 0 }
func (driverListReport) Human(w io.Writer) error {
	_, err := fmt.Fprintln(w, "No host drivers are approved.")
	return err
}

func listDrivers(root home.Root) output.Report {
	if failure := checkDriverInventory(root); failure != nil {
		return failure
	}
	return driverListReport{}
}

func checkDriverInventory(root home.Root) *output.Failure {
	const name = "drivers.json"
	invalid := func(message string) *output.Failure {
		return bindingFailure("DRIVER_REGISTRY_INVALID", message, 1)
	}
	unavailable := func() *output.Failure {
		return bindingFailure("DRIVER_REGISTRY_UNAVAILABLE", "The driver registry is unavailable.", 1)
	}
	dir, err := os.OpenRoot(root.Dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return unavailable()
	}
	defer dir.Close()
	info, err := dir.Lstat(name)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil || !info.Mode().IsRegular() || info.Size() > driverRegistryLimit {
		return unavailable()
	}
	file, err := dir.Open(name)
	if err != nil {
		return unavailable()
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		return unavailable()
	}
	raw, err := io.ReadAll(io.LimitReader(file, driverRegistryLimit+1))
	if err != nil || len(raw) > driverRegistryLimit {
		return unavailable()
	}
	var doc struct {
		Version  *uint8           `json:"version"`
		Drivers  []jsontext.Value `json:"drivers"`
		Declined []string         `json:"declined"`
	}
	if err := json.Unmarshal(raw, &doc, json.RejectUnknownMembers(true)); err != nil || doc.Version == nil || doc.Drivers == nil {
		return invalid("The driver registry is not valid.")
	}
	if *doc.Version != 1 {
		return invalid("The driver registry uses an unsupported version.")
	}
	if len(doc.Drivers) != 0 {
		// NOT PORTED (CLI-42): External approval verification and driver registry admission.
		return bindingUnavailable("external driver approvals")
	}
	return nil
}

type hostLaunchDocument struct {
	Argv         []string `json:"argv"`
	Placeholders []string `json:"placeholders"`
}

type builtinHostDocument struct {
	Host   string             `json:"host"`
	State  string             `json:"state"`
	Launch hostLaunchDocument `json:"launch"`
}

type hostListReport struct {
	Version    int                   `json:"version"`
	Hosts      []builtinHostDocument `json:"hosts"`
	CallerHost *string               `json:"callerHost"`
}

// Display-only templates. A standalone shell template does not grant Go
// binding ownership: only the tmux adapter can publish that evidence.
const tmuxHostLaunch = `[ -n "$1" ] && [ -n "$2" ] || { echo 'tmt-launch: a session and a command are required' >&2; exit 2; }; if tmux has-session -t "=$1" 2>/dev/null; then p=$(tmux new-window -d -P -F '#{pane_id}' -t "=$1:" -- "$2"); else p=$(tmux new-session -d -P -F '#{pane_id}' -s "$1" -- "$2"); fi && printf '%s\n' "$p"`
const ptyHostLaunch = `[ -n "$2" ] || { echo 'tmt-launch: a command is required' >&2; exit 2; }; exec sh -c "$2"`

func builtinHost(name, command string) builtinHostDocument {
	return builtinHostDocument{Host: name, State: "builtin", Launch: hostLaunchDocument{
		Argv: []string{"sh", "-c", command, "tmt-launch", "{session}", "{command}"}, Placeholders: []string{"session", "command"},
	}}
}

// NOT PORTED (CLI-44): Remaining native host launch templates.
func listHostTemplates(root home.Root, lookup func(string) (string, bool)) output.Report {
	if failure := checkDriverInventory(root); failure != nil {
		return failure
	}
	value := func(name string) string {
		text, _ := lookup(name)
		return text
	}
	var caller *string
	if value("TMT_PTY_PANE") != "" || value("TMT_PTY_SOCKET") != "" {
		host := "pty"
		caller = &host
	} else if value("TMUX") != "" || value("TMUX_PANE") != "" {
		host := "tmux"
		caller = &host
	}
	return hostListReport{Version: 1, Hosts: []builtinHostDocument{
		builtinHost("tmux", tmuxHostLaunch), builtinHost("pty", ptyHostLaunch),
	}, CallerHost: caller}
}

func (r hostListReport) JSON() any                  { return r }
func (r hostListReport) HumanStream() output.Stream { return output.Stdout }
func (r hostListReport) ExitStatus() int            { return 0 }
func (r hostListReport) Human(w io.Writer) error {
	term := outputTerminal(w)
	for i, host := range r.Hosts {
		if i > 0 {
			if _, err := fmt.Fprintln(w); err != nil {
				return err
			}
		}
		words := make([]string, 0, len(host.Launch.Argv))
		for _, word := range host.Launch.Argv {
			if word == "{session}" || word == "{command}" {
				words = append(words, word)
			} else {
				words = append(words, core.CommandWord(word))
			}
		}
		if err := clistyle.WriteDetail(w, term, "Host "+host.Host, []clistyle.DetailField{
			{Label: "source", Value: "built in"}, {Label: "opens a pane with", Value: strings.Join(words, " ")},
		}); err != nil {
			return err
		}
	}
	return nil
}
