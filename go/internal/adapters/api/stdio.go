package api

import (
	"errors"
	"io"
	"os"

	"github.com/tmt-ninja/tmt/go/internal/adapters/framedstdio"
	"github.com/tmt-ninja/tmt/go/internal/adapters/orchestration"
)

// Local extension API byte ceilings. The input allows sixfold JSON expansion
// of the exchange text plus the dispatch and API envelopes.
const (
	InputLimit  = 6_299_648
	OutputLimit = orchestration.ReadOutputLimit
)

// SessionResponse is one compact API resource or error. Stale ends the
// session after publication so that a client can reopen the current binary.
type SessionResponse struct {
	Body   []byte
	Status int
	Stale  bool
}

// ServeSession publishes responses in request order. deliverPending runs
// after a response is published, including the final stale response.
func ServeSession(input, output *os.File, receive func([]byte) (SessionResponse, error), deliverPending func()) (int, error) {
	if err := framedstdio.RequireRedirected(input, output); err != nil {
		return 1, err
	}
	reader := framedstdio.NewReader(input, InputLimit)
	for {
		line, err := reader.ReadFrame()
		if errors.Is(err, io.EOF) {
			return 0, nil
		}
		if err != nil {
			return 1, err
		}
		response, err := receive(line[:len(line)-1])
		if err != nil {
			return 1, err
		}
		if err := framedstdio.Publish(output, response.Body, OutputLimit); err != nil {
			return 1, err
		}
		if deliverPending != nil {
			deliverPending()
		}
		if response.Stale {
			return 1, nil
		}
	}
}
