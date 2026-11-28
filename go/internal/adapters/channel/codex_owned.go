//go:build darwin || linux

package channel

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"net/netip"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/adapters/runtime"
	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const (
	codexDirectory      = "codex"
	codexCapabilityFile = "capability"
	codexServerLog      = "server.log"
	codexStartupLimit   = 64 * 1024
	codexCleanupBudget  = 2 * time.Second
	codexStartupBudget  = 15 * time.Second
)

var (
	errCodexStartup = errors.New("owned Codex app-server did not start")
	errCodexCleanup = errors.New("owned Codex app-server cleanup is unconfirmed")
)

// ownedCodexServer has exactly one process owner and reaper. There is no
// process discovery or adoption. The supervisor will own it for the lifetime
// of the launcher control stream.
type ownedCodexServer struct {
	child    *os.Process
	endpoint codexEndpoint
	process  processRecord
	files    *codexGenerationFiles
	stopped  bool
	stopErr  error
}

func startOwnedCodex(ctx context.Context, root home.Root, generation string, plan CodexPlan, observer runtime.Observer) (*ownedCodexServer, error) {
	ctx, cancel := context.WithTimeout(ctx, codexStartupBudget)
	defer cancel()
	if !validLaunchPath(plan.selected.Path) || !validLaunchPath(plan.cwd) || ctx.Err() != nil {
		return nil, errCodexStartup
	}
	files, err := createCodexGeneration(root, generation)
	if err != nil {
		return nil, errors.Join(errCodexStartup, err)
	}
	server := &ownedCodexServer{files: files}
	if err := server.start(ctx, plan, observer); err != nil {
		return nil, errors.Join(err, server.stop())
	}
	return server, nil
}

func (s *ownedCodexServer) start(ctx context.Context, plan CodexPlan, observer runtime.Observer) error {
	var nonce [32]byte
	rand.Read(nonce[:])
	token := hex.EncodeToString(nonce[:])
	file, err := s.files.create(codexCapabilityFile)
	if err != nil {
		return errors.Join(errCodexStartup, err)
	}
	_, writeErr := io.WriteString(file, token)
	if err := errors.Join(writeErr, file.Sync(), file.Close()); err != nil {
		return errors.Join(errCodexStartup, err)
	}
	log, err := s.files.create(codexServerLog)
	if err != nil {
		return errors.Join(errCodexStartup, err)
	}
	defer log.Close()
	spec := plan.serverCommand(filepath.Join(s.files.path, codexCapabilityFile))
	cmd := exec.Command(spec.Path, spec.Args...)
	cmd.Dir, cmd.Env, cmd.Stderr = spec.Dir, spec.Env, log
	sys.OwnProcessGroup(cmd)
	if ctx.Err() != nil || checkPrivatePath(s.files.dir, s.files.path) != nil {
		return errCodexStartup
	}
	if err := cmd.Start(); err != nil {
		return errors.Join(errCodexStartup, err)
	}
	s.child = cmd.Process
	address, err := waitCodexAddress(ctx, log)
	if err != nil {
		return errors.Join(errCodexStartup, err)
	}
	observed, err := observer.Observe(ctx, s.child.Pid)
	if err != nil || ctx.Err() != nil || observed.State != runtime.Alive || observed.Incarnation.PID != s.child.Pid ||
		!observed.Incarnation.Valid() {
		return errCodexStartup
	}
	s.process = processRecord{PID: uint64(s.child.Pid), Start: observed.Incarnation.Start}
	s.endpoint, err = newCodexEndpoint(address, token)
	return err
}

func (s *ownedCodexServer) stop() error {
	if s.stopped {
		return s.stopErr
	}
	s.stopped = true
	defer s.files.close()
	if s.child != nil {
		pid := s.child.Pid
		signalErr := sys.KillChildGroup(pid)
		ctx, cancel := context.WithTimeout(context.Background(), codexCleanupBudget)
		_, waitErr := sys.WaitChild(ctx, s.child)
		cancel()
		if errors.Is(waitErr, context.DeadlineExceeded) {
			// The sole reaper may collect later. These files remain for
			// explicit recovery, even if the child exits after our budget.
			go func() { _, _ = s.child.Wait() }()
		} else if waitErr != nil {
			_ = s.child.Release()
		}
		if waitErr == nil && errors.Is(signalErr, os.ErrPermission) && sys.ChildGroupGone(pid) {
			signalErr = nil
		}
		if err := errors.Join(signalErr, waitErr); err != nil {
			s.stopErr = errors.Join(errCodexCleanup, err)
			return s.stopErr
		}
	}
	if err := s.files.remove(); err != nil {
		s.stopErr = errors.Join(errCodexCleanup, err)
	}
	return s.stopErr
}

func waitCodexAddress(ctx context.Context, log *os.File) (netip.AddrPort, error) {
	ticker := time.NewTicker(20 * time.Millisecond)
	defer ticker.Stop()
	buf := make([]byte, codexStartupLimit+1)
	for ctx.Err() == nil {
		n, err := log.ReadAt(buf, 0)
		if err != nil && !errors.Is(err, io.EOF) {
			return netip.AddrPort{}, err
		}
		if n > codexStartupLimit {
			return netip.AddrPort{}, errors.New("Codex startup output exceeded its bound")
		}
		if address, ok := announcedCodexAddress(buf[:n]); ok && ctx.Err() == nil {
			return address, nil
		}
		select {
		case <-ctx.Done():
		case <-ticker.C:
		}
	}
	return netip.AddrPort{}, ctx.Err()
}

func announcedCodexAddress(log []byte) (netip.AddrPort, bool) {
	if !utf8.Valid(log) {
		return netip.AddrPort{}, false
	}
	end := strings.LastIndexByte(string(log), '\n')
	if end < 0 {
		return netip.AddrPort{}, false
	}
	for line := range strings.SplitSeq(string(log[:end]), "\n") {
		value, ok := strings.CutPrefix(strings.TrimSpace(line), "listening on: ws://")
		if !ok {
			continue
		}
		address, err := netip.ParseAddrPort(value)
		if err != nil {
			return netip.AddrPort{}, false
		}
		if address.Addr() == netip.AddrFrom4([4]byte{127, 0, 0, 1}) && address.Port() != 0 {
			return address, true
		}
	}
	return netip.AddrPort{}, false
}

type codexGenerationFiles struct {
	parent *channelDir
	dir    *channelDir
	name   string
	path   string
	files  map[string]fs.FileInfo
}

func openCodexDir(root home.Root, create bool) (*channelDir, error) {
	channels, err := openChannelDir(root, create)
	if err != nil {
		return nil, err
	}
	defer channels.close()
	return openPrivateChannelChild(channels.root, codexDirectory, create)
}

func createCodexGeneration(root home.Root, generation string) (*codexGenerationFiles, error) {
	if !core.ValidUUID(generation) {
		return nil, errCodexStartup
	}
	parent, err := openCodexDir(root, true)
	if err != nil {
		return nil, err
	}
	if err := parent.root.Mkdir(generation, 0700); err != nil {
		parent.close()
		return nil, err
	}
	dir, err := openPrivateChannelChild(parent.root, generation, false)
	if err != nil {
		parent.close()
		return nil, errors.Join(errCodexCleanup, err)
	}
	return &codexGenerationFiles{
		parent: parent, dir: dir, name: generation, path: filepath.Join(ClaudeDirectory(root), codexDirectory, generation),
		files: make(map[string]fs.FileInfo),
	}, nil
}

func (f *codexGenerationFiles) create(name string) (*os.File, error) {
	file, err := sys.OpenEntryNoFollow(f.dir.file, name, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := privateRegular(file); err != nil {
		file.Close()
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	f.files[name] = info
	return file, nil
}

func (f *codexGenerationFiles) remove() error {
	if err := checkPrivatePath(f.dir, f.path); err != nil {
		return err
	}
	for name, expected := range f.files {
		current, err := f.dir.root.Lstat(name)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil || !current.Mode().IsRegular() || !os.SameFile(expected, current) {
			return errors.New("Codex generation file changed before cleanup")
		}
		if err := f.dir.root.Remove(name); err != nil {
			return err
		}
	}
	entry, err := f.parent.root.Lstat(f.name)
	if err != nil {
		return err
	}
	opened, err := f.dir.file.Stat()
	if err != nil || !os.SameFile(entry, opened) {
		return errors.New("Codex generation directory changed before cleanup")
	}
	return f.parent.root.Remove(f.name)
}

func (f *codexGenerationFiles) close() {
	f.dir.close()
	f.parent.close()
}
