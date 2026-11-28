package cli

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/process"
	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

const completionStartupLimit = 1024 * 1024

var completionShells = []string{"bash", "zsh", "fish"}

type completionReport struct {
	Shell     string   `json:"shell"`
	Detected  *string  `json:"detectedShell"`
	Installed bool     `json:"installed"`
	Evidence  string   `json:"evidence"`
	File      string   `json:"file"`
	Line      string   `json:"line"`
	Warnings  []string `json:"warnings"`
}

func (r completionReport) JSON() any                  { return r }
func (r completionReport) HumanStream() output.Stream { return output.Stdout }
func (r completionReport) ExitStatus() int            { return 0 }

func (r completionReport) Human(w io.Writer) error {
	term := outputTerminal(w)
	detected := "unknown"
	if r.Detected != nil {
		detected = *r.Detected
	}
	configured := "not installed (startup-file evidence)"
	if r.Installed {
		configured = "already installed (startup-file evidence)"
	}
	if err := clistyle.WriteDetail(w, term, "Shell completion", []clistyle.DetailField{
		{Label: "shell", Value: r.Shell}, {Label: "detected", Value: detected},
		{Label: "file", Value: r.File}, {Label: "line", Value: r.Line},
		{Label: "configured", Value: configured},
	}); err != nil {
		return err
	}
	if _, err := fmt.Fprintln(w, "This checks startup-file text, not functions loaded in your current shell."); err != nil {
		return err
	}
	if r.Shell == "zsh" {
		if _, err := fmt.Fprintln(w, "Place the line after zsh completion initialization (compinit or your shell framework)."); err != nil {
			return err
		}
	}
	for _, warning := range r.Warnings {
		if err := clistyle.WriteHint(w, term, warning); err != nil {
			return err
		}
	}
	return nil
}

func completionSetupLine(shell string) string {
	if shell == "fish" {
		return "tmt-go __completion-script fish | source"
	}
	return "source <(tmt-go __completion-script " + shell + ")"
}

func inspectCompletion(inv invocation, lookup func(string) (string, bool)) output.Report {
	envShell, _ := lookup("SHELL")
	report := completionReport{Evidence: "startup-file", Warnings: []string{}}
	if detected := filepath.Base(envShell); slices.Contains(completionShells, detected) {
		report.Detected = &detected
		report.Shell = detected
	}
	if len(inv.operands) == 1 {
		report.Shell = inv.operands[0]
	}
	if report.Shell == "" {
		return bindingFailure("COMPLETION_SHELL_UNKNOWN", "Cannot detect a supported shell from SHELL; specify bash, zsh, or fish.", 1)
	}
	userHome, err := os.UserHomeDir()
	if err != nil {
		return bindingFailure("COMPLETION_ERROR", "Cannot determine the home directory", 1)
	}
	path, err := completionStartup(report.Shell, userHome, lookup)
	if err != nil {
		return bindingFailure("COMPLETION_ERROR", err.Error(), 1)
	}
	report.File, report.Line = path, completionSetupLine(report.Shell)
	data, err := process.ReadInputFile(path, completionStartupLimit)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return bindingFailure("COMPLETION_ERROR", fmt.Sprintf("Cannot inspect %s: %v", path, err), 1)
	}
	if len(data) > completionStartupLimit {
		return bindingFailure("COMPLETION_ERROR", fmt.Sprintf("Cannot inspect %s: startup file exceeds 1048576 bytes.", path), 1)
	}
	if !utf8.Valid(data) {
		return bindingFailure("COMPLETION_ERROR", fmt.Sprintf("Cannot inspect %s: startup file must be valid UTF-8.", path), 1)
	}
	report.inspectText(string(data))
	return report
}

func completionStartup(shell, home string, lookup func(string) (string, bool)) (string, error) {
	switch shell {
	case "bash":
		return filepath.Abs(filepath.Join(home, ".bashrc"))
	case "zsh":
		base, _ := lookup("ZDOTDIR")
		if base == "" {
			base = home
		}
		return filepath.Abs(filepath.Join(base, ".zshrc"))
	case "fish":
		base, _ := lookup("XDG_CONFIG_HOME")
		if base == "" {
			base = filepath.Join(home, ".config")
		}
		return filepath.Abs(filepath.Join(base, "fish", "config.fish"))
	default:
		panic("completion shell not validated")
	}
}

func (r *completionReport) inspectText(text string) {
	lines := strings.Split(text, "\n")
	compinit := slices.IndexFunc(lines, isCompinitLine)
	candidates := 0
	for index, raw := range lines {
		line, _, _ := strings.Cut(raw, "#")
		tokens := strings.FieldsFunc(line, func(ch rune) bool {
			return unicode.IsSpace(ch) || strings.ContainsRune("();|<>", ch)
		})
		found := false
		for i := 1; i < len(tokens); i++ {
			if tokens[i] == "__completion-script" && filepath.Base(strings.Trim(tokens[i-1], "\"'")) == "tmt-go" {
				found = true
				break
			}
		}
		if !found {
			continue
		}
		candidates++
		normalized := strings.Join(strings.Fields(line), " ")
		if normalized == r.Line || r.Shell != "fish" && normalized == strings.Replace(r.Line, "source ", ". ", 1) {
			r.Installed = true
			if r.Shell == "zsh" && compinit >= 0 && index < compinit {
				r.Warnings = append(r.Warnings, fmt.Sprintf("Line %d precedes any recognized compinit call; place completion after compinit.", index+1))
			}
		} else {
			r.Warnings = append(r.Warnings, fmt.Sprintf("Line %d mentions completion but is not a recognized setup line for this shell; inspect it manually.", index+1))
		}
	}
	if candidates > 1 {
		r.Warnings = append(r.Warnings, "Multiple completion lines found; remove duplicates manually.")
	}
	if r.Shell == "zsh" && compinit < 0 {
		r.Warnings = append(r.Warnings, "No literal compinit call recognized; your shell framework may initialize completion. Place the displayed line after completion initialization.")
	}
}

func isCompinitLine(raw string) bool {
	line, _, _ := strings.Cut(raw, "#")
	for _, command := range strings.FieldsFunc(line, func(ch rune) bool { return ch == ';' || ch == '&' }) {
		words := strings.Fields(command)
		if len(words) > 0 && words[0] == "compinit" || len(words) > 1 && words[0] == "command" && words[1] == "compinit" {
			return true
		}
	}
	return false
}

const bashCompletion = `_tmt_go_complete() {
    local candidate
    COMPREPLY=()
    while IFS= read -r candidate; do
        COMPREPLY+=("$candidate")
    done < <(tmt-go __complete -- "${COMP_WORDS[@]:1:COMP_CWORD}")
}
complete -o default -F _tmt_go_complete tmt-go
`

const zshCompletion = `_tmt_go_complete() {
    local -a candidates
    candidates=("${(@f)$(tmt-go __complete -- "${(@)words[2,CURRENT]}")}")
    if (( ${#candidates} )); then
        compadd -a candidates
    else
        _files
    fi
}
compdef _tmt_go_complete tmt-go
`

const fishCompletion = `function __tmt_go_complete
    set -l prior (commandline -opc)
    tmt-go __complete -- $prior[2..-1] (commandline -ct | string collect --allow-empty)
end
complete -c tmt-go -a '(__tmt_go_complete)'
`

func writeCompletionScript(w io.Writer, shell string) error {
	scripts := map[string]string{"bash": bashCompletion, "zsh": zshCompletion, "fish": fishCompletion}
	_, err := io.WriteString(w, scripts[shell])
	return err
}

// NOT PORTED (CLI-43): Dynamic completion for external commands.
func writeCompletionCandidates(w io.Writer, words []string) error {
	current := ""
	command := &grammar
	var scan argumentScan
	if len(words) > 0 {
		current = words[len(words)-1]
		scan, command = scanArguments(words[:len(words)-1])
	}
	if scan.problem != "" || command.hidden || len(scan.operands) > 0 && command.trailing {
		return nil
	}
	var candidates []string
	if !strings.HasPrefix(current, "-") && len(scan.operands) == 0 {
		for _, child := range command.children {
			if !child.hidden {
				candidates = append(candidates, child.name)
				if child.visibleAlias != "" {
					candidates = append(candidates, child.visibleAlias)
				}
			}
		}
	}
	if strings.HasPrefix(current, "-") {
		for _, opt := range options {
			if !opt.hidden && command.accepts(opt.name) && !(command.humanOnly && opt.name == "json") {
				candidates = append(candidates, "--"+opt.name)
				if opt.short != 0 {
					candidates = append(candidates, "-"+string(opt.short))
				}
			}
		}
	}
	slices.Sort(candidates)
	for _, candidate := range slices.Compact(candidates) {
		if strings.HasPrefix(candidate, current) {
			if _, err := fmt.Fprintln(w, candidate); err != nil {
				return err
			}
		}
	}
	return nil
}
