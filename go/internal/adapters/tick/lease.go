package tick

import (
	"crypto/rand"
	json "encoding/json/v2"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const (
	holderLimit = 8192
	leaseMillis = 30_000
	dirName     = "tick"
	lockName    = "clock.lock"
	recordName  = "clock.json"
)

var (
	ErrInvalid   = errors.New("Invalid clock input or retained lease; inspect its status before starting another clock.")
	ErrLeaseLost = errors.New("The clock no longer owns its recorded lease.")
)

type Holder struct {
	SchemaVersion uint8   `json:"schemaVersion"`
	Token         string  `json:"token"`
	PID           uint32  `json:"pid"`
	StartedAtMs   uint64  `json:"startedAtMs"`
	HeartbeatAtMs uint64  `json:"heartbeatAtMs"`
	ExpiresAtMs   uint64  `json:"expiresAtMs"`
	Mode          string  `json:"mode"`
	Build         string  `json:"build"`
	Pane          *string `json:"pane"`
}

type ClockStatus struct {
	SchemaVersion uint8   `json:"schemaVersion"`
	State         string  `json:"state"`
	Holder        *Holder `json:"holder"`
}

type BusyError struct{ Status ClockStatus }

func (e *BusyError) Error() string {
	if e.Status.Holder == nil {
		return "Another clock holds the lease; its holder is unconfirmed."
	}
	return fmt.Sprintf("Another clock holds the lease (process %d).", e.Status.Holder.PID)
}

type directory struct {
	root *os.Root
	file *os.File
}

func openDirectory(root home.Root, create bool) (*directory, error) {
	if !filepath.IsAbs(root.Dir) {
		return nil, ErrInvalid
	}
	if create {
		if err := os.MkdirAll(root.Dir, 0700); err != nil {
			return nil, err
		}
	}
	base, err := os.OpenRoot(root.Dir)
	if err != nil {
		return nil, err
	}
	defer base.Close()
	if create {
		if err := base.Mkdir(dirName, 0700); err != nil && !errors.Is(err, fs.ErrExist) {
			return nil, err
		}
	}
	info, err := base.Lstat(dirName)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() || !private(info) {
		return nil, ErrInvalid
	}
	dir, err := base.OpenRoot(dirName)
	if err != nil {
		return nil, err
	}
	file, err := dir.Open(".")
	if err != nil {
		dir.Close()
		return nil, err
	}
	opened, err := file.Stat()
	if err != nil || !os.SameFile(info, opened) {
		file.Close()
		dir.Close()
		return nil, errors.Join(ErrInvalid, err)
	}
	return &directory{root: dir, file: file}, nil
}

func private(info fs.FileInfo) bool {
	return sys.FileOwnedByEffectiveUser(info) && info.Mode().Perm()&0077 == 0
}

func (d *directory) close() error {
	return errors.Join(d.file.Close(), d.root.Close())
}

func (d *directory) open(name string, flags int) (*os.File, error) {
	file, err := sys.OpenEntryNoFollow(d.file, name, flags, 0600)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || !private(info) {
		file.Close()
		return nil, errors.Join(ErrInvalid, err)
	}
	return file, nil
}

func (d *directory) readHolder() (*Holder, error) {
	file, err := d.open(recordName, os.O_RDONLY)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	body, err := io.ReadAll(io.LimitReader(file, holderLimit+1))
	if err != nil {
		return nil, err
	}
	var record struct {
		Holder
		Build *string `json:"build"`
	}
	if len(body) > holderLimit || json.Unmarshal(body, &record, json.RejectUnknownMembers(true)) != nil || record.Build == nil {
		return nil, ErrInvalid
	}
	record.Holder.Build = *record.Build
	if !record.Holder.valid() {
		return nil, ErrInvalid
	}
	return &record.Holder, nil
}

func (h Holder) valid() bool {
	return h.SchemaVersion == 1 && core.ValidUUID(h.Token) && h.PID != 0 && h.StartedAtMs != 0 &&
		core.ValidJSSafeInteger(h.StartedAtMs) && h.HeartbeatAtMs != 0 && h.ExpiresAtMs > h.HeartbeatAtMs &&
		core.ValidJSSafeInteger(h.ExpiresAtMs) && (h.Mode == "once" || h.Mode == "run") &&
		safeText(h.Build, 64) && (h.Pane == nil || (*h.Pane != "" && safeText(*h.Pane, 128)))
}

func safeText(value string, maxBytes int) bool {
	return len(value) <= maxBytes && utf8.ValidString(value) && !strings.ContainsFunc(value, unicode.IsControl)
}

// Status reads advisory holder evidence and checks the stable kernel lock
// without creating a clock directory or opening the application store.
func Status(root home.Root, now uint64) (ClockStatus, error) {
	dir, err := openDirectory(root, false)
	if errors.Is(err, fs.ErrNotExist) {
		return ClockStatus{SchemaVersion: 1, State: "stopped"}, nil
	}
	if err != nil {
		return ClockStatus{}, err
	}
	defer dir.close()
	return dir.status(now)
}

func (d *directory) status(now uint64) (ClockStatus, error) {
	holder, err := d.readHolder()
	if err != nil {
		return ClockStatus{}, err
	}
	status := ClockStatus{SchemaVersion: 1, State: "stopped", Holder: holder}
	lock, err := d.open(lockName, os.O_RDONLY)
	if errors.Is(err, fs.ErrNotExist) && holder == nil {
		return status, nil
	}
	if err != nil {
		return ClockStatus{}, err
	}
	defer lock.Close()
	free, err := sys.TryLockShared(lock)
	if err != nil {
		return ClockStatus{}, err
	}
	switch {
	case !free && holder != nil && holder.HeartbeatAtMs <= now && now < holder.ExpiresAtMs:
		status.State = "running"
	case !free:
		status.State = "unconfirmed"
	case holder != nil:
		status.State = "stale"
	}
	return status, nil
}

// Lease owns the exclusive kernel lock. Advisory expiry never preempts it.
type Lease struct {
	dir    *directory
	lock   *os.File
	holder Holder
}

func Acquire(root home.Root, mode, build string, pane *string, now uint64) (*Lease, error) {
	var recordedPane *string
	if pane != nil {
		value := *pane
		recordedPane = &value
	}
	holder := Holder{
		SchemaVersion: 1, Token: leaseToken(), PID: uint32(os.Getpid()), StartedAtMs: now, HeartbeatAtMs: now,
		ExpiresAtMs: now + leaseMillis, Mode: mode, Build: build, Pane: recordedPane,
	}
	if !holder.valid() {
		return nil, ErrInvalid
	}
	dir, err := openDirectory(root, true)
	if err != nil {
		return nil, err
	}
	lease, err := dir.acquire(holder, now)
	if err != nil {
		return nil, errors.Join(err, dir.close())
	}
	return lease, nil
}

func (d *directory) acquire(holder Holder, now uint64) (*Lease, error) {
	if _, err := d.root.Lstat(recordName); err == nil {
		if _, err := d.root.Lstat(lockName); errors.Is(err, fs.ErrNotExist) {
			return nil, ErrInvalid
		} else if err != nil {
			return nil, err
		}
	} else if !errors.Is(err, fs.ErrNotExist) {
		return nil, err
	}
	lock, err := d.open(lockName, os.O_CREATE|os.O_RDWR)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			_ = lock.Close()
		}
	}()
	locked, err := sys.TryLockExclusive(lock)
	if err != nil {
		return nil, err
	}
	if !locked {
		status, err := d.status(now)
		if err != nil {
			return nil, err
		}
		return nil, &BusyError{Status: status}
	}
	if _, err := d.readHolder(); err != nil {
		return nil, err
	}
	if err := d.writeHolder(holder); err != nil {
		return nil, err
	}
	ok = true
	return &Lease{dir: d, lock: lock, holder: holder}, nil
}

func (l *Lease) Verify() error {
	if l.lock == nil {
		return ErrLeaseLost
	}
	current, err := l.dir.readHolder()
	if err != nil {
		return err
	}
	if current == nil || current.Token != l.holder.Token {
		return ErrLeaseLost
	}
	return nil
}

func (l *Lease) Renew(now uint64) error {
	if err := l.Verify(); err != nil {
		return err
	}
	holder := l.holder
	holder.HeartbeatAtMs, holder.ExpiresAtMs = now, now+leaseMillis
	if !holder.valid() {
		return ErrInvalid
	}
	if err := l.dir.writeHolder(holder); err != nil {
		return err
	}
	l.holder = holder
	return nil
}

func (l *Lease) Close() error {
	if l.lock == nil {
		return nil
	}
	err := l.Verify()
	if err == nil {
		err = l.dir.root.Remove(recordName)
		if err == nil {
			err = l.dir.file.Sync()
		}
	}
	err = errors.Join(err, l.lock.Close(), l.dir.close())
	l.lock = nil
	return err
}

func (d *directory) writeHolder(holder Holder) error {
	content, err := json.Marshal(holder)
	if err != nil {
		return err
	}
	stage := ".clock-" + rand.Text()
	file, err := d.open(stage, os.O_CREATE|os.O_EXCL|os.O_WRONLY)
	if err != nil {
		return err
	}
	defer d.root.Remove(stage)
	_, writeErr := file.Write(content)
	if err := errors.Join(writeErr, file.Sync(), file.Close()); err != nil {
		return err
	}
	if err := d.root.Rename(stage, recordName); err != nil {
		return err
	}
	return d.file.Sync()
}

func leaseToken() string {
	var raw [16]byte
	rand.Read(raw[:])
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", raw[:4], raw[4:6], raw[6:8], raw[8:10], raw[10:])
}
