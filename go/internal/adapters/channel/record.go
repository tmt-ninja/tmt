//go:build darwin || linux

package channel

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"time"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const (
	recordLimit = 4096
	lockName    = ".lock"
	lockWait    = 2 * time.Second
	lockPoll    = 10 * time.Millisecond
)

var errNoChannelDirectory = errors.New("channel directory has not been created")

type processRecord struct {
	PID   uint64 `json:"pid"`
	Start string `json:"start"`
}

type paneRecord struct {
	Host            string `json:"host"`
	ServerID        string `json:"serverId"`
	SocketPath      string `json:"socketPath"`
	ServerPID       uint64 `json:"serverPid"`
	ServerStartTime string `json:"serverStartTime"`
	PaneID          string `json:"paneId"`
	PanePID         uint64 `json:"panePid"`
}

type claudeRecord struct {
	Version     uint8          `json:"version"`
	BindingID   string         `json:"bindingId"`
	IdentityID  string         `json:"identityId,omitempty"`
	Generation  string         `json:"generation"`
	LaunchOwner processRecord  `json:"launchOwner"`
	Pane        *paneRecord    `json:"pane,omitempty"`
	Foreground  *processRecord `json:"foreground,omitempty"`
	Claude      *processRecord `json:"claude"`
}

type channelDir struct {
	root *os.Root
	file *os.File
}

func openChannelDir(root home.Root, create bool) (*channelDir, error) {
	if !filepath.IsAbs(root.Dir) {
		return nil, ErrEnrollment
	}
	base, err := os.OpenRoot(root.Dir)
	if err != nil {
		return nil, err
	}
	defer base.Close()
	if create {
		if err := base.Mkdir(channelDirectory, 0700); err != nil && !errors.Is(err, fs.ErrExist) {
			return nil, err
		}
	}
	info, err := base.Lstat(channelDirectory)
	if !create && errors.Is(err, fs.ErrNotExist) {
		return nil, errNoChannelDirectory
	}
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || info.Mode().Perm() != 0700 || !sys.FileOwnedByEffectiveUser(info) {
		return nil, errors.New("channel directory must be an owner-only directory")
	}
	dir, err := base.OpenRoot(channelDirectory)
	if err != nil {
		return nil, err
	}
	fd, err := dir.Open(".")
	if err != nil {
		dir.Close()
		return nil, err
	}
	opened, err := fd.Stat()
	if err != nil || !os.SameFile(info, opened) || opened.Mode().Perm() != 0700 || !sys.FileOwnedByEffectiveUser(opened) {
		fd.Close()
		dir.Close()
		return nil, errors.New("channel directory changed while opening it")
	}
	return &channelDir{root: dir, file: fd}, nil
}

func (dir *channelDir) close() {
	dir.file.Close()
	dir.root.Close()
}

func (dir *channelDir) lock(ctx context.Context) (*os.File, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	file, err := sys.OpenEntryNoFollow(dir.file, lockName, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err := privateRegular(file); err != nil {
		file.Close()
		return nil, err
	}
	wait, cancel := context.WithTimeout(ctx, lockWait)
	defer cancel()
	tick := time.NewTicker(lockPoll)
	defer tick.Stop()
	for wait.Err() == nil {
		ok, err := sys.TryLockExclusive(file)
		if err != nil {
			file.Close()
			return nil, err
		}
		if ok && wait.Err() == nil {
			return file, nil
		}
		select {
		case <-wait.Done():
		case <-tick.C:
		}
	}
	file.Close()
	return nil, wait.Err()
}

func privateRegular(file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || !sys.FileOwnedByEffectiveUser(info) {
		return errors.New("channel entry must be a private regular file")
	}
	return nil
}

func (dir *channelDir) readClaude(bindingID string) (*claudeRecord, error) {
	file, err := sys.OpenEntryNoFollow(dir.file, bindingID+".json", os.O_RDONLY, 0)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if err := privateRegular(file); err != nil {
		return nil, err
	}
	data, err := io.ReadAll(io.LimitReader(file, recordLimit+1))
	if err != nil {
		return nil, err
	}
	if len(data) > recordLimit || !utf8.Valid(data) {
		return nil, errors.New("invalid channel enrollment record")
	}
	return decodeClaudeRecord(data, bindingID)
}

func decodeClaudeRecord(data []byte, bindingID string) (*claudeRecord, error) {
	object, err := strictObject(data, "version", "bindingId", "identityId", "generation", "launchOwner", "pane", "foreground", "claude")
	if err != nil {
		return nil, err
	}
	for _, key := range []string{"launchOwner", "foreground", "claude"} {
		if raw := object[key]; raw != nil && !bytes.Equal(raw, []byte("null")) {
			if _, err := strictObject(raw, "pid", "start"); err != nil {
				return nil, err
			}
		}
	}
	if pane := object["pane"]; pane != nil && !bytes.Equal(pane, []byte("null")) {
		if _, err := strictObject(pane, "host", "serverId", "socketPath", "serverPid", "serverStartTime", "paneId", "panePid"); err != nil {
			return nil, err
		}
	}
	var record claudeRecord
	if err := json.Unmarshal(data, &record); err != nil || !record.valid(bindingID) {
		return nil, errors.New("invalid channel enrollment record")
	}
	return &record, nil
}

// strictObject rejects duplicate keys and trailing JSON. Supplying names also
// rejects fields outside the named schema.
func strictObject(data []byte, names ...string) (map[string]json.RawMessage, error) {
	invalid := errors.New("invalid channel JSON object")
	d := json.NewDecoder(bytes.NewReader(data))
	if token, err := d.Token(); err != nil || token != json.Delim('{') {
		return nil, invalid
	}
	values := make(map[string]json.RawMessage, len(names))
	for d.More() {
		token, err := d.Token()
		key, ok := token.(string)
		if err != nil || !ok || (len(names) != 0 && !slices.Contains(names, key)) || values[key] != nil {
			return nil, invalid
		}
		var raw json.RawMessage
		if err := d.Decode(&raw); err != nil {
			return nil, invalid
		}
		values[key] = raw
	}
	if token, err := d.Token(); err != nil || token != json.Delim('}') {
		return nil, invalid
	}
	if _, err := d.Token(); err != io.EOF {
		return nil, invalid
	}
	return values, nil
}

func (dir *channelDir) writeClaude(record claudeRecord) error {
	raw, err := json.Marshal(record)
	if err != nil {
		return err
	}
	if len(raw) > recordLimit {
		return errors.New("channel enrollment record exceeds its bound")
	}
	var nonce [16]byte
	rand.Read(nonce[:])
	pending := fmt.Sprintf(".record-%x", nonce)
	file, err := sys.OpenEntryNoFollow(dir.file, pending, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer dir.root.Remove(pending)
	_, writeErr := file.Write(raw)
	var syncErr error
	if writeErr == nil {
		syncErr = file.Sync()
	}
	if err := errors.Join(writeErr, syncErr, file.Close()); err != nil {
		return err
	}
	if err := dir.root.Rename(pending, record.BindingID+".json"); err != nil {
		return err
	}
	return dir.file.Sync()
}
