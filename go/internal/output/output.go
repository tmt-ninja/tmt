// Package output is the Go port of tmt-command-output: typed command results,
// failures and stream selection between human and JSON presentation.
// Owner: go-3.
package output

import (
	"encoding/json"
	"fmt"
	"io"
)

// Report is what every ordinary command returns.
type Report interface {
	Human(w io.Writer) error
	JSON() any
}

// Failure is a typed command error; Status is the process exit status.
type Failure struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Status  int            `json:"-"`
	Details map[string]any `json:"details,omitempty"`
}

func (f *Failure) Error() string { return f.Message }

// Write renders r as one JSON document or as human text.
func Write(w io.Writer, r Report, asJSON bool) error {
	if !asJSON {
		return r.Human(w)
	}
	enc := json.NewEncoder(w)
	return enc.Encode(r.JSON())
}

// Publish writes a JSON failure to stdout or a human failure to stderr.
func (f *Failure) Publish(stdout, stderr io.Writer, asJSON bool) int {
	var err error
	if asJSON {
		err = json.NewEncoder(stdout).Encode(struct {
			Error *Failure `json:"error"`
		}{Error: f})
	} else {
		_, err = fmt.Fprintf(stderr, "error: %s\n", f.Message)
	}
	if err != nil {
		fmt.Fprintf(stderr, "error: Could not write CLI output: %s\n", err)
		return 1
	}
	return f.Status
}
