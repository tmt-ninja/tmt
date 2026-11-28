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

// WriteFailure renders f on the error stream.
func WriteFailure(w io.Writer, f *Failure, asJSON bool) {
	if asJSON {
		_ = json.NewEncoder(w).Encode(map[string]any{"error": f})
		return
	}
	fmt.Fprintf(w, "tmt-go: %s\n", f.Message)
}
