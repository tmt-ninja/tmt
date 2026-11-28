package cli

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/clistyle"
	"github.com/tmt-ninja/tmt/go/internal/output"
)

func outputTerminal(w io.Writer) clistyle.Terminal {
	file, _ := w.(*os.File)
	return clistyle.OutputTerminal(file, false, nil)
}

func success(w io.Writer, text string) error {
	return clistyle.WriteSuccess(w, outputTerminal(w), text)
}

func warn(w io.Writer, text string) error {
	file, _ := w.(*os.File)
	return clistyle.WriteWarning(w, clistyle.DiagnosticTerminal(file, nil), text, "")
}

func publish(stdout, stderr io.Writer, report output.Report, asJSON bool) int {
	if failure, ok := report.(*output.Failure); ok && !asJSON {
		report = styledFailure{failure}
	}
	return output.Publish(stdout, stderr, report, asJSON)
}

type styledFailure struct{ *output.Failure }

func (f styledFailure) Human(w io.Writer) error {
	file, _ := w.(*os.File)
	term := clistyle.DiagnosticTerminal(file, nil)
	text := strings.TrimSuffix(strings.ReplaceAll(f.Message, "\r\n", "\n"), "\n")
	first, rest, _ := strings.Cut(text, "\n")
	if err := clistyle.WriteError(w, term, strings.TrimPrefix(first, "error: "), ""); err != nil {
		return err
	}
	if strings.Contains(text, "\n") {
		for line := range strings.SplitSeq(rest, "\n") {
			if _, err := fmt.Fprintln(w, clistyle.Escape(line)); err != nil {
				return err
			}
		}
	}
	if f.Suggestion != "" {
		hint := strings.TrimPrefix(strings.TrimPrefix(f.Suggestion, "Hint: "), "hint: ")
		return clistyle.WriteHint(w, term, hint)
	}
	return nil
}
