package mcp

import (
	"errors"
	"io"
	"os"

	"github.com/tmt-ninja/tmt/go/internal/adapters/api"
	"github.com/tmt-ninja/tmt/go/internal/adapters/framedstdio"
)

// Local MCP v1 transport ceilings. InputLimit excludes LF. OutputLimit
// includes LF, the structured resource and its escaped JSON text copy.
const (
	InputLimit  = api.InputLimit + 65_536
	OutputLimit = 3*api.OutputLimit + 65_536
)

// ServeTransport reads complete LF-terminated messages and publishes one
// response for each request. A nil response indicates a notification.
func ServeTransport(input, output *os.File, receive func([]byte) ([]byte, error)) error {
	if err := framedstdio.RequireRedirected(input, output); err != nil {
		return err
	}
	reader := framedstdio.NewReader(input, InputLimit)
	for {
		frame, err := reader.ReadFrame()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		response, err := receive(frame)
		if err != nil {
			return err
		}
		if response == nil {
			continue
		}
		if err := framedstdio.Publish(output, response, OutputLimit-1); err != nil {
			return err
		}
	}
}
