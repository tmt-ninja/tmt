// fakeprovider answers one framed request in tests via the supplied CLI binary.
package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/flavor"
)

const composer = "› Ask Codex to do anything"

var replyLine = regexp.MustCompile(`^tmt(?:-go)? reply (req_[0-9a-f-]{36}) --receipt (v2_[A-Za-z0-9_-]+) --message <text>$`)

func main() {
	path := os.Getenv("TMT_EXECUTABLE")
	if err := run(path, os.Stdin, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(executable string, input io.Reader, stdout, stderr io.Writer) error {
	if !filepath.IsAbs(executable) || filepath.Base(executable) != flavor.Binary ||
		!filepath.IsAbs(os.Getenv(flavor.EnvHome)) {
		return errors.New("fake provider requires an explicit " + flavor.Binary + " executable and test home")
	}
	fmt.Fprintln(stdout, composer)
	fmt.Fprintln(stdout, "← for agents · ? for shortcuts")
	request, receipt, body, err := readFrame(input)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, executable, "reply", request, "--receipt", receipt, "--message=ack: "+body)
	command.Stdout, command.Stderr = stdout, stderr
	return command.Run()
}

func readFrame(input io.Reader) (request, receipt, body string, err error) {
	// Fixtures use one small prompt and one reply instruction. Bound total
	// bytes as well as a single line, regardless of input framing.
	reader := bufio.NewScanner(io.LimitReader(input, 64*1024))
	var lines []string
	for reader.Scan() {
		line := reader.Text()
		lines = append(lines, line)
		n := len(lines)
		if n >= 3 && line == "</tmt-reply>" && strings.HasPrefix(lines[n-3], "<tmt-reply from=\"") &&
			strings.HasSuffix(lines[n-3], "\">") {
			if reply := replyLine.FindStringSubmatch(lines[n-2]); reply != nil {
				// Keep only the task text and consume the remaining frame
				// through the blank line produced by submit.
				lines = lines[:n-3]
				for reader.Scan() {
					if reader.Text() == "" {
						return reply[1], reply[2], strings.TrimSuffix(strings.Join(lines, "\n"), "\n"), nil
					}
				}
				break
			}
		}
	}
	if err := reader.Err(); err != nil {
		return "", "", "", err
	}
	return "", "", "", errors.New("fake provider received no complete submitted request")
}
