package storage

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"encoding/json/v2"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/home"
	"github.com/tmt-ninja/tmt/go/internal/ports"
	"github.com/tmt-ninja/tmt/go/internal/sys"
)

const hookEntryLimit = 131072

type HookQueue struct {
	db       *sql.DB
	mainPath string
	path     string
}

var _ ports.HookQueue = (*HookQueue)(nil)

// OpenHookQueue admits an existing initialized queue. Core owns provisioning.
func OpenHookQueue(ctx context.Context, root home.Root, wait time.Duration) (*HookQueue, error) {
	if !filepath.IsAbs(root.Dir) || filepath.Clean(root.Database) != filepath.Join(root.Dir, home.DatabaseName) {
		return nil, errors.New("invalid tmt-go database path")
	}
	path, err := hookQueuePath(root.Database)
	if err != nil {
		return nil, err
	}
	for _, suffix := range []string{"", "-wal", "-shm", "-journal"} {
		ok, err := admitPrivateHookFile(path + suffix)
		if err != nil {
			return nil, err
		}
		if !ok && suffix == "" {
			return nil, os.ErrNotExist
		}
	}
	db, err := openHookSQLite(path, wait)
	if err != nil {
		return nil, err
	}
	conn, err := db.Conn(ctx)
	if err == nil {
		err = errors.Join(validateHookSchema(ctx, conn), conn.Close())
	}
	if err != nil {
		return nil, errors.Join(err, db.Close())
	}
	return &HookQueue{db: db, path: path, mainPath: filepath.Join(filepath.Dir(path), home.DatabaseName)}, nil
}

func (q *HookQueue) Close() error { return q.db.Close() }

func (q *HookQueue) write(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := q.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func (q *HookQueue) Enqueue(ctx context.Context, event core.HookCaptureEvent) (core.HookPublication, error) {
	if !event.Valid() {
		return core.HookPublication{Status: core.HookPublicationUnpublished}, errors.New("invalid hook capture event")
	}
	if err := q.append(ctx, event); err != nil {
		return q.observePublication(ctx, event.ID, err)
	}
	return core.HookPublication{Status: core.HookPublicationQueued}, nil
}

func (q *HookQueue) append(ctx context.Context, event core.HookCaptureEvent) error {
	now := time.Now().UnixMilli()
	return q.write(ctx, func(tx *sql.Tx) error {
		var provisional *string
		if c := event.Capture; c != nil && c.Provisional {
			key, err := provisionalTurnKey(c)
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, "INSERT INTO provisional_batches(turn_key,batch_id,created_ms) VALUES(?,?,?) ON CONFLICT(turn_key) DO NOTHING", key, c.Batch, now); err != nil {
				return err
			}
			var batch string
			if err := tx.QueryRowContext(ctx, "SELECT batch_id FROM provisional_batches WHERE turn_key=?", key).Scan(&batch); err != nil {
				return err
			}
			if !core.ValidUUID(batch) {
				return errors.New("invalid stored provisional batch")
			}
			copy := *c
			copy.Batch = &batch
			event.Capture = &copy
			provisional = &batch
		}
		payload, err := json.Marshal(event)
		if err != nil || len(payload) > hookEntryLimit {
			return errors.New("invalid or oversized hook capture event")
		}
		_, err = tx.ExecContext(ctx, "INSERT INTO hook_writes(event_id,identity_id,provisional_batch,kind,payload,enqueued_ms) VALUES(?,?,?,'capture',?,?)", event.ID, event.Identity(), provisional, string(payload), now)
		return err
	})
}

func provisionalTurnKey(c *core.HookPendingCapture) (string, error) {
	payload, err := json.Marshal([]any{c.Identity, c.Binding, c.Provider, c.Session, c.PID, c.Start, c.Turn})
	if err != nil {
		return "", err
	}
	frame := []byte("tmt-hook-provisional-batch-v1")
	frame = binary.BigEndian.AppendUint64(frame, uint64(len(payload)))
	digest := sha256.Sum256(append(frame, payload...))
	return hex.EncodeToString(digest[:]), nil
}

func (q *HookQueue) observePublication(ctx context.Context, id core.HookEventID, appendErr error) (core.HookPublication, error) {
	var present bool
	err := q.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM hook_writes WHERE event_id=?)", id).Scan(&present)
	if err == nil && present {
		return core.HookPublication{Status: core.HookPublicationQueued}, nil
	}
	if err == nil {
		var receipt *core.HookCaptureReceipt
		receipt, err = q.readPublicationReceipt(ctx, id)
		if err == nil && receipt != nil {
			return core.HookPublication{Status: core.HookPublicationRecorded, Receipt: receipt}, nil
		}
	}
	if err != nil {
		return core.HookPublication{Status: core.HookPublicationUnknown}, errors.Join(appendErr, err)
	}
	return core.HookPublication{Status: core.HookPublicationUnpublished}, appendErr
}

func (q *HookQueue) readPublicationReceipt(ctx context.Context, id core.HookEventID) (*core.HookCaptureReceipt, error) {
	present, err := admitPrivateHookFile(q.mainPath)
	if err != nil {
		return nil, err
	}
	if !present {
		return nil, os.ErrNotExist
	}
	dsn := url.URL{Scheme: "file", Path: q.mainPath, RawQuery: "mode=ro"}
	db, err := sql.Open("sqlite", dsn.String())
	if err != nil {
		return nil, err
	}
	defer db.Close()
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	version, err := validateHistory(ctx, tx)
	if err != nil {
		return nil, err
	}
	if version != SchemaVersion {
		return nil, errors.New("capture receipt requires current Core schema")
	}
	return readHookReceipt(records{ctx: ctx, tx: tx, readOnly: true}, id)
}

func (q *HookQueue) Next(ctx context.Context) (*core.HookQueueEntry, error) {
	return q.next(ctx, false, nil)
}

func (q *HookQueue) NextUncommitted(ctx context.Context, id *core.IdentityID) (*core.HookQueueEntry, error) {
	return q.next(ctx, true, id)
}

func (q *HookQueue) next(ctx context.Context, uncommitted bool, owner *core.IdentityID) (*core.HookQueueEntry, error) {
	for {
		var entry core.HookQueueEntry
		var id core.HookEventID
		var identity *core.IdentityID
		var payload []byte
		filter := "WHERE (?1=0 OR committed=0)"
		args := []any{uncommitted}
		if owner != nil {
			filter += " AND identity_id=?2"
			args = append(args, *owner)
		}
		err := q.db.QueryRowContext(ctx, "SELECT sequence,event_id,identity_id,committed,payload FROM hook_writes "+filter+" ORDER BY sequence LIMIT 1", args...).Scan(&entry.Sequence, &id, &identity, &entry.Committed, &payload)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if len(payload) <= hookEntryLimit && json.Unmarshal(payload, &entry.Event, json.RejectUnknownMembers(true)) == nil && entry.Event.Valid() &&
			entry.Event.ID == id && sameHookOwner(identity, entry.Event.Identity()) {
			return &entry, nil
		}
		if err := q.quarantine(ctx, entry.Sequence); err != nil {
			return nil, err
		}
	}
}

func sameHookOwner(a, b *core.IdentityID) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func (q *HookQueue) quarantine(ctx context.Context, sequence uint64) error {
	return q.write(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, "INSERT OR IGNORE INTO invalid_hook_writes(event_id,quarantined_ms) SELECT event_id,?1 FROM hook_writes WHERE sequence=?2", time.Now().UnixMilli(), sequence); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, "DELETE FROM hook_writes WHERE sequence=?", sequence)
		return err
	})
}

func (q *HookQueue) MarkCommitted(ctx context.Context, id core.HookEventID) error {
	_, err := q.db.ExecContext(ctx, "UPDATE hook_writes SET committed=1 WHERE event_id=?", id)
	return err
}

func (q *HookQueue) Acknowledge(ctx context.Context, id core.HookEventID) error {
	_, err := q.db.ExecContext(ctx, "DELETE FROM hook_writes WHERE event_id=?", id)
	return err
}

type hookQueueClaim struct {
	mu    sync.Mutex
	queue *HookQueue
	file  *os.File
}

func (c *hookQueueClaim) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.closeLocked()
}

func (c *hookQueueClaim) closeLocked() error {
	if c.file == nil {
		return nil
	}
	err := c.file.Close()
	c.file = nil
	return err
}

func (q *HookQueue) TryClaim(ctx context.Context) (ports.HookQueueClaim, bool, error) {
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	path := filepath.Join(filepath.Dir(q.path), "hook-writes.lock")
	file, err := openHookLock(path)
	if err != nil {
		return nil, false, err
	}
	acquired, err := sys.TryLockExclusive(file)
	if !acquired {
		return nil, false, errors.Join(err, file.Close())
	}
	return &hookQueueClaim{queue: q, file: file}, true, nil
}

func openHookLock(path string) (*os.File, error) {
	exists, err := admitPrivateHookFile(path)
	if err != nil {
		return nil, err
	}
	root, err := os.OpenRoot(filepath.Dir(path))
	if err != nil {
		return nil, err
	}
	defer root.Close()
	name := filepath.Base(path)
	var file *os.File
	if !exists {
		file, err = root.OpenFile(name, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0o600)
		if err != nil && !errors.Is(err, os.ErrExist) {
			return nil, err
		}
	}
	if file == nil {
		file, err = root.OpenFile(name, os.O_RDWR, 0)
		if err != nil {
			return nil, err
		}
	}
	actual, err := file.Stat()
	if err == nil {
		var selected os.FileInfo
		selected, err = os.Lstat(path)
		if err == nil && (!os.SameFile(actual, selected) || !actual.Mode().IsRegular() || actual.Mode().Perm() != 0o600 || !sys.FileOwnedByEffectiveUser(actual)) {
			err = fmt.Errorf("invalid hook drainer lock")
		}
	}
	if err != nil {
		return nil, errors.Join(err, file.Close())
	}
	return file, nil
}

func (q *HookQueue) FinishIfEmpty(ctx context.Context, claim ports.HookQueueClaim) (bool, error) {
	c, ok := claim.(*hookQueueClaim)
	if !ok || c == nil || c.queue != q {
		return false, errors.New("hook queue requires its own drainer claim")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.file == nil {
		return false, errors.New("hook queue claim has been released")
	}
	var empty bool
	err := q.write(ctx, func(tx *sql.Tx) error {
		if err := tx.QueryRowContext(ctx, "SELECT NOT EXISTS(SELECT 1 FROM hook_writes)").Scan(&empty); err != nil {
			return err
		}
		if empty {
			return c.closeLocked()
		}
		return nil
	})
	return empty, err
}
