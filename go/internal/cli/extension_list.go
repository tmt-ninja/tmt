package cli

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/adapters/extcmd"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

type extensionProduct struct {
	name, description, explore string
	dependencies               []string
}

var officialExtensions = []extensionProduct{
	{name: "ops", description: "Add the terminal workspace", explore: "Explore the terminal workspace"},
	{name: "remote", description: "Add browser connections and cloud setup", explore: "Explore browser connections and cloud setup"},
	{name: "colab", description: "Add browser spaces; needs remote", explore: "Explore browser spaces", dependencies: []string{"remote"}},
	{name: "digest", description: "Add batched agent attention", explore: "Explore batched agent attention"},
}

type extensionListRow struct {
	Name         string   `json:"name"`
	Official     bool     `json:"official"`
	Installed    bool     `json:"installed"`
	Version      *string  `json:"version"`
	Missing      bool     `json:"missing"`
	Dependencies []string `json:"dependencies"`
	Channel      *string  `json:"channel"`
	Pinned       *string  `json:"pinned"`
	Commands     []string `json:"commands"`
	ShadowedBy   []string `json:"shadowedBy"`
}

type extensionAction struct {
	ID          string   `json:"id"`
	Kind        string   `json:"kind"`
	Args        []string `json:"argv"`
	Description string   `json:"description"`
}

type extensionListReport struct {
	Extensions []extensionListRow `json:"extensions"`
	Guidance   struct {
		Actions []extensionAction `json:"actions"`
	} `json:"guidance"`
}

func (r extensionListReport) JSON() any                  { return r }
func (r extensionListReport) HumanStream() output.Stream { return output.Stdout }
func (r extensionListReport) ExitStatus() int            { return 0 }

func (r extensionListReport) Human(w io.Writer) error {
	term := outputTerminal(w)
	count := len(r.Extensions)
	if err := clistyle.WriteList(w, term, []clistyle.ListSection{{Title: "extensions", Count: &count}}); err != nil {
		return err
	}
	width := 0
	for _, row := range r.Extensions {
		width = max(width, clistyle.DisplayWidth(row.Name))
	}
	userHome, _ := os.UserHomeDir()
	for _, row := range r.Extensions {
		padded := clistyle.Fit(row.Name, width, clistyle.AlignLeft, clistyle.TruncateEnd)
		if _, err := fmt.Fprintln(w, "  "+padded+"  "+term.Paint(clistyle.TokenDim, "not installed")); err != nil {
			return err
		}
		for _, path := range row.ShadowedBy {
			note := "shadowed on PATH by " + clistyle.Escape(clistyle.HomePath(path, userHome))
			if _, err := fmt.Fprintln(w, strings.Repeat(" ", width+4)+term.Paint(clistyle.TokenDim, note)); err != nil {
				return err
			}
		}
	}
	return nil
}

func listExtensions(inv invocation, searchPath string) output.Report {
	if inv.has("check") || inv.has("prefix") {
		// NOT PORTED (CLI-40): Official release checking and receipt-based prefix inventory.
		return bindingUnavailable("extension ls --check/--prefix")
	}
	shadowed, err := extensionShadows(searchPath)
	if err != nil {
		return bindingFailure("EXTENSION_LIST_FAILED", "Could not inspect extensions on PATH.", 1)
	}
	report := extensionListReport{}
	report.Guidance.Actions = append(report.Guidance.Actions,
		extensionAction{"setup", "use", []string{"tmt-go", "setup"}, "Set up agents and optional features"})
	if len(shadowed) > 0 {
		report.Guidance.Actions = append(report.Guidance.Actions,
			extensionAction{"upgrade", "use", []string{"tmt-go", "upgrade"}, "Review available updates"})
	}
	for _, product := range officialExtensions {
		// PATH evidence alone never establishes an official managed install.
		// The Go installer currently manages only the tmt-go executable.
		report.Extensions = append(report.Extensions, extensionListRow{
			Name: product.name, Official: true, Missing: true, Dependencies: append([]string{}, product.dependencies...),
			Commands: []string{"tmt-" + product.name}, ShadowedBy: append([]string{}, shadowed[product.name]...),
		})
		if len(shadowed[product.name]) > 0 && len(report.Guidance.Actions) < 5 {
			report.Guidance.Actions = append(report.Guidance.Actions, extensionAction{
				"help-" + product.name, "use", []string{"tmt-go", product.name, "--help"}, product.explore,
			})
		}
	}
	for _, product := range officialExtensions {
		if len(shadowed[product.name]) == 0 {
			report.Guidance.Actions = append(report.Guidance.Actions, extensionAction{
				"install-" + product.name, "install", []string{"tmt-go", "extension", "install", product.name, "--yes"}, product.description,
			})
		}
	}
	return report
}

func extensionShadows(searchPath string) (map[string][]string, error) {
	shadowed := make(map[string][]string)
	seen := make(map[string]bool)
	for directory := range strings.SplitSeq(searchPath, string(os.PathListSeparator)) {
		for _, product := range officialExtensions {
			path, err := extcmd.Resolve(product.name, directory)
			if err != nil {
				return nil, err
			}
			if path != "" && !seen[path] {
				shadowed[product.name] = append(shadowed[product.name], path)
				seen[path] = true
			}
		}
	}
	return shadowed, nil
}
