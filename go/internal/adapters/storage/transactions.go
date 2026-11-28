package storage

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/tmt-ninja/tmt/go/internal/core"
	"github.com/tmt-ninja/tmt/go/internal/ports"
)

var _ ports.Store = (*Storage)(nil)

type records struct {
	ctx      context.Context
	tx       *sql.Tx
	readOnly bool
}

func (r records) Identities() ports.IdentityRepo { return identityRows{r} }
func (r records) Bindings() ports.BindingRepo    { return bindingRows{r} }
func (r records) Requests() ports.RequestRepo    { return requestRows{r} }
func (r records) Responses() ports.ResponseRepo  { return responseRows{r} }
func (r records) Profiles() ports.ProfileRepo    { return profileRows{r} }
func (r records) Rooms() ports.RoomRepo          { return roomRows{r} }

func (s *Storage) Read(ctx context.Context, fn func(ports.StoreTx) error) error {
	return s.transact(ctx, true, func(r records) error { return fn(r) })
}

func (s *Storage) Write(ctx context.Context, fn func(ports.StoreTx) error) error {
	return s.transact(ctx, false, func(r records) error { return fn(r) })
}

func (s *Storage) transact(ctx context.Context, readOnly bool, fn func(records) error) error {
	// modernc uses plain BEGIN for ReadOnly even with _txlock=immediate.
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: readOnly})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := fn(records{ctx: ctx, tx: tx, readOnly: readOnly}); err != nil {
		return err
	}
	return tx.Commit()
}

func (r records) exec(query string, args ...any) (sql.Result, error) {
	if r.readOnly {
		return nil, errors.New("storage mutation requires a write transaction")
	}
	return r.tx.ExecContext(r.ctx, query, args...)
}

func (r records) one(query string, args ...any) *sql.Row {
	return r.tx.QueryRowContext(r.ctx, query, args...)
}

func (r records) query(query string, args ...any) (*sql.Rows, error) {
	return r.tx.QueryContext(r.ctx, query, args...)
}

type scanner interface{ Scan(...any) error }

func optional[T any](value *T, err error) (*T, error) {
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return value, err
}

func safeTime(ms uint64) bool {
	return ms > 0 && core.ValidJSSafeInteger(ms)
}

func storedTimestamp(ms uint64) (string, error) {
	if !safeTime(ms) {
		return "", errors.New("storage timestamp must be a positive safe integer")
	}
	return time.UnixMilli(int64(ms)).UTC().Format("2006-01-02T15:04:05.000Z"), nil
}

func scanRows[T any](r records, query string, decode func(scanner) (T, error), args ...any) ([]T, error) {
	rows, err := r.query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]T, 0)
	for rows.Next() {
		data, err := decode(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, data)
	}
	return result, rows.Err()
}
