// Package output is the Go port of tmt-command-output: typed command results,
// failures and stream selection between human and JSON presentation.
// Owner: go-3.
package output

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"unicode"
)

// Stream selects the destination of a human report. JSON always uses stdout.
type Stream uint8

const (
	Stdout Stream = iota
	Stderr
)

// Report gives an ordinary command's two presentations and its exit status.
// A partial result can carry a nonzero exit status with its structured data.
type Report interface {
	Human(w io.Writer) error
	JSON() any
	HumanStream() Stream
	ExitStatus() int
}

// RequestFailure is the public correlation for an unsuccessful exchange.
// It contains no receipt, body or private endpoint evidence.
type RequestFailure struct {
	RequestID     string `json:"requestId"`
	Status        string `json:"status,omitempty"`
	DeliveryState string `json:"deliveryState,omitempty"`
}

// TargetFailure is the optional public projection of a request destination.
type TargetFailure struct {
	Target   string          `json:"target"`
	Pane     string          `json:"pane,omitempty"`
	Identity *TargetIdentity `json:"identity,omitempty"`
}

type TargetIdentity struct {
	Name          string `json:"name"`
	CanonicalName string `json:"canonicalName"`
}

// Failure keeps presentation fields separate from its process exit status.
type Failure struct {
	Code            string
	Message         string
	Status          int
	Reason          string
	Stage           string
	Suggestion      string
	Request         *RequestFailure
	Target          *TargetFailure
	MetadataCurrent map[string]*string
}

func (f *Failure) Error() string { return f.Message }

func (f *Failure) HumanStream() Stream { return Stderr }

func (f *Failure) ExitStatus() int { return f.Status }

type errorFields struct {
	Code       string             `json:"code"`
	Message    string             `json:"message"`
	Reason     string             `json:"reason,omitempty"`
	Stage      string             `json:"stage,omitempty"`
	Suggestion string             `json:"suggestion,omitempty"`
	Current    map[string]*string `json:"current,omitempty"`
}

type failureDocument struct {
	Error errorFields `json:"error"`
	*RequestFailure
	*TargetFailure
}

func (f *Failure) JSON() any {
	return failureDocument{
		Error: errorFields{
			Code: f.Code, Message: f.Message, Reason: f.Reason,
			Stage: f.Stage, Suggestion: f.Suggestion, Current: f.MetadataCurrent,
		},
		RequestFailure: f.Request,
		TargetFailure:  f.Target,
	}
}

func (f *Failure) Human(w io.Writer) error {
	lines := strings.SplitSeq(strings.TrimSuffix(strings.ReplaceAll(f.Message, "\r\n", "\n"), "\n"), "\n")
	var rendered strings.Builder
	first := true
	for line := range lines {
		if first {
			fmt.Fprintln(&rendered, "error: "+escape(messageLine(strings.TrimPrefix(line, "error: "))))
			first = false
		} else {
			fmt.Fprintln(&rendered, escape(line))
		}
	}
	if f.Suggestion != "" {
		hint := strings.TrimPrefix(strings.TrimPrefix(f.Suggestion, "Hint: "), "hint: ")
		fmt.Fprintln(&rendered, "hint: "+escape(messageLine(hint)))
	}
	_, err := io.WriteString(w, rendered.String())
	return err
}

func messageLine(value string) string {
	if strings.HasSuffix(value, "..") {
		return value
	}
	return strings.TrimSuffix(value, ".")
}

func escape(value string) string {
	var rendered strings.Builder
	for _, ch := range value {
		switch ch {
		case 0:
			rendered.WriteString(`\u{0}`)
		case '\t':
			rendered.WriteString(`\t`)
		case '\r':
			rendered.WriteString(`\r`)
		case '\n':
			rendered.WriteString(`\n`)
		default:
			if unicode.IsControl(ch) || ch == '\u2028' || ch == '\u2029' {
				fmt.Fprintf(&rendered, "\\u{%x}", ch)
			} else {
				rendered.WriteRune(ch)
			}
		}
	}
	return rendered.String()
}

// Publish writes a report once and returns its status. A stream failure may
// leave partial output, so it only gets a best-effort diagnostic on stderr.
func Publish(stdout, stderr io.Writer, report Report, asJSON bool) int {
	var err error
	if asJSON {
		encoder := json.NewEncoder(stdout)
		encoder.SetEscapeHTML(false)
		err = encoder.Encode(report.JSON())
	} else if report.HumanStream() == Stderr {
		err = report.Human(stderr)
	} else {
		err = report.Human(stdout)
	}
	if err != nil {
		fmt.Fprintln(stderr, "error: Could not write CLI output: "+escape(err.Error()))
		return 1
	}
	return report.ExitStatus()
}

var requestSenderEscape = strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;", "'", "&apos;")

// RequestFrame appends the reply command to an exact retained message.
// Validated request IDs and receipts are converted to text by the callers.
func RequestFrame(message, sender, requestID, receipt string) string {
	return fmt.Sprintf("%s\n\n<tmt-reply from=\"%s\">\ntmt-go reply %s --receipt %s --message <text>\n</tmt-reply>\n"+
		"Submit your response with the command above. Chat output alone does not complete the request. Your reply is the answer: do not repeat it in your pane or say you replied elsewhere. Report submission errors.",
		message, requestSenderEscape.Replace(sender), requestID, receipt)
}
