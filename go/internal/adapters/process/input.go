//go:build darwin || linux

package process

import (
	"errors"
	"io"
	"math"
	"os"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/sys"
)

var (
	ErrInputTimeout = errors.New("timed out while reading response input")
	ErrInputStream  = errors.New("could not read redirected response input")
	ErrInputFile    = errors.New("could not read response input file")
)

// ReadInputFile follows explicit symlinks and reads at most maximum+1 bytes
// from the opened regular file. The caller validates size and encoding.
func ReadInputFile(path string, maximum int) ([]byte, error) {
	if maximum < 0 || maximum == math.MaxInt {
		return nil, ErrInputFile
	}
	file, err := sys.OpenInput(path)
	if err != nil {
		return nil, errors.Join(ErrInputFile, err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return nil, errors.Join(ErrInputFile, err)
	}
	if !info.Mode().IsRegular() {
		return nil, errors.Join(ErrInputFile, errors.New("input must be a regular file"))
	}
	data, err := io.ReadAll(io.LimitReader(file, int64(maximum)+1))
	if err != nil {
		return nil, errors.Join(ErrInputFile, err)
	}
	return data, nil
}

// ReadInputStdin requires EOF within five seconds of starting acquisition,
// regardless of intervening reads. It returns
// maximum+1 bytes as soon as the body exceeds the caller's size limit. It
// borrows the descriptor and leaves it open and its flags unchanged.
func ReadInputStdin(file *os.File, maximum int) ([]byte, error) {
	return ReadInputStdinFor(file, maximum, 5*time.Second)
}

// ReadInputStdinFor uses the same EOF and byte bounds with the caller's
// remaining acquisition budget.
func ReadInputStdinFor(file *os.File, maximum int, timeout time.Duration) ([]byte, error) {
	return readInputStdin(file, maximum, timeout, time.Now)
}

func readInputStdin(file *os.File, maximum int, timeout time.Duration, now func() time.Time) ([]byte, error) {
	deadline := now().Add(timeout)
	if maximum < 0 || maximum == math.MaxInt || timeout <= 0 {
		return nil, ErrInputStream
	}
	terminal, err := sys.StdioTerminal(file)
	if err != nil {
		return nil, errors.Join(ErrInputStream, err)
	}
	if terminal {
		return nil, errors.Join(ErrInputStream, errors.New("response input cannot be a terminal"))
	}
	var data []byte
	var buf [8192]byte
	for len(data) <= maximum {
		remaining := deadline.Sub(now())
		if remaining <= 0 {
			return nil, ErrInputTimeout
		}
		ready, err := sys.StdioReady(file, false, remaining)
		if errors.Is(err, sys.ErrStdioInterrupted) {
			continue
		}
		if err != nil {
			return nil, errors.Join(ErrInputStream, err)
		}
		if deadline.Sub(now()) <= 0 {
			return nil, ErrInputTimeout
		}
		if !ready {
			continue
		}
		n, retry, err := sys.StdioRead(file, buf[:min(len(buf), maximum+1-len(data))])
		if err != nil {
			return nil, errors.Join(ErrInputStream, err)
		}
		if deadline.Sub(now()) <= 0 {
			return nil, ErrInputTimeout
		}
		if retry {
			continue
		}
		if n == 0 {
			break
		}
		data = append(data, buf[:n]...)
	}
	return data, nil
}
