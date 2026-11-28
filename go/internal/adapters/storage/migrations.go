package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

const migrationWriterSlice = 100 * time.Millisecond

const createMigrationHistory = `CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`

func migrateThrough(ctx context.Context, conn *sql.Conn, last int) error {
	current, err := recordedThrough(ctx, conn)
	if err != nil || current >= last {
		return err
	}
	if err := migrationWrite(ctx, conn, last, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, createMigrationHistory); err != nil {
			return err
		}
		return validateHistoryTable(ctx, tx)
	}); err != nil {
		return fmt.Errorf("initialize migration history: %w", err)
	}
	current, err = recordedThrough(ctx, conn)
	if err != nil {
		return err
	}
	for version := current + 1; version <= last; version++ {
		if err := applyMigration(ctx, conn, version); err != nil {
			return fmt.Errorf("migration %d: %w", version, err)
		}
	}
	return nil
}

func applyMigration(ctx context.Context, conn *sql.Conn, version int) (err error) {
	var hostReference []schemaObject
	if version == 41 {
		current, err := recordedThrough(ctx, conn)
		if err != nil || current >= version {
			return err
		}
		hostReference, err = hostSourceReference(ctx)
		if err != nil {
			return fmt.Errorf("build schema-40 reference: %w", err)
		}
	}
	switch version {
	case 9, 41, 65, 66:
		// Rebuilds must suspend cascading deletions outside the transaction.
		defer func() {
			err = errors.Join(err, setForeignKeys(context.WithoutCancel(ctx), conn, true))
		}()
		if err := setForeignKeys(ctx, conn, false); err != nil {
			return err
		}
	}
	return migrationWrite(ctx, conn, version, func(tx *sql.Tx) error {
		current, err := validateHistory(ctx, tx)
		if err != nil || current >= version {
			return err
		}
		if current != version-1 {
			return fmt.Errorf("migration %d requires recorded version %d", version, version-1)
		}
		body, err := migrationSQL(version)
		if err != nil {
			return err
		}
		switch version {
		case 9:
			if err := validateIdentitySource(ctx, tx); err != nil {
				return err
			}
			if err := checkForeignKeys(ctx, tx); err != nil {
				return err
			}
		case 39:
			if err := validateBindingSource(ctx, tx, body); err != nil {
				return err
			}
		case 41:
			if err := validateHostSource(ctx, tx, hostReference); err != nil {
				return err
			}
			if err := checkForeignKeys(ctx, tx); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, body); err != nil {
			return fmt.Errorf("apply migration SQL: %w", err)
		}
		switch version {
		case 6:
			if err := backfillRetention(ctx, tx); err != nil {
				return err
			}
		case 41:
			if err := rebuildHostTables(ctx, tx); err != nil {
				return err
			}
		case 84:
			if err := provisionMigrationHookQueue(ctx, tx); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO _migrations (version, name, applied_at)
			VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`, version, migrationNames[version-1]); err != nil {
			return fmt.Errorf("record migration: %w", err)
		}
		switch version {
		case 9, 39, 41, 65, 66:
			return checkForeignKeys(ctx, tx)
		default:
			return nil
		}
	})
}

func migrationSQL(version int) (string, error) {
	name := fmt.Sprintf("schema/%03d.sql", version)
	if version == 6 {
		name = "schema/006_columns.sql"
	}
	body, err := Schema.ReadFile(name)
	return string(body), err
}

func migrationWrite(ctx context.Context, conn *sql.Conn, needed int, write func(*sql.Tx) error) error {
	tx, err := migrationWriter(ctx, conn, needed)
	if tx == nil || err != nil {
		return err
	}
	defer tx.Rollback()
	if err := write(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// A healthy competing opener can progress through an arbitrarily slow chain.
// Recheck the WAL snapshot between short waits and bound only a stalled writer.
func migrationWriter(ctx context.Context, conn *sql.Conn, needed int) (tx *sql.Tx, err error) {
	seen, err := recordedThrough(ctx, conn)
	if err != nil || seen >= needed {
		return nil, err
	}
	defer func() {
		if restoreErr := setBusyTimeout(context.WithoutCancel(ctx), conn, busyTimeout); restoreErr != nil {
			if tx != nil {
				_ = tx.Rollback()
				tx = nil
			}
			err = errors.Join(err, restoreErr)
		}
	}()
	advanced := time.Now()
	for {
		if err := setBusyTimeout(ctx, conn, migrationWriterSlice); err != nil {
			return nil, err
		}
		tx, err := conn.BeginTx(ctx, nil)
		if !isBusy(err) {
			return tx, err
		}
		recorded, readErr := recordedThrough(ctx, conn)
		if readErr != nil || recorded >= needed {
			return nil, readErr
		}
		if recorded > seen {
			seen, advanced = recorded, time.Now()
		} else if time.Since(advanced) >= busyTimeout {
			return nil, err
		}
	}
}

func recordedThrough(ctx context.Context, conn *sql.Conn) (int, error) {
	tx, err := conn.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return 0, fmt.Errorf("read migration snapshot: %w", err)
	}
	defer tx.Rollback()
	var exists bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM sqlite_schema
		WHERE type = 'table' AND name = '_migrations')`).Scan(&exists); err != nil || !exists {
		return 0, err
	}
	if err := validateHistoryTable(ctx, tx); err != nil {
		return 0, err
	}
	return validateHistory(ctx, tx)
}

func validateHistoryTable(ctx context.Context, tx *sql.Tx) error {
	type column struct {
		name, kind   string
		notNull, key int
	}
	expected := [...]column{{"version", "INTEGER", 0, 1}, {"name", "TEXT", 1, 0}, {"applied_at", "TEXT", 1, 0}}
	columns, err := tx.QueryContext(ctx, "PRAGMA table_info(_migrations)")
	if err != nil {
		return err
	}
	defer columns.Close()
	count := 0
	for columns.Next() {
		var actual column
		var id int
		var defaultValue sql.NullString
		if err := columns.Scan(&id, &actual.name, &actual.kind, &actual.notNull, &defaultValue, &actual.key); err != nil {
			return err
		}
		actual.kind = strings.ToUpper(actual.kind)
		if count >= len(expected) || actual != expected[count] {
			return errors.New("the _migrations table does not match the supported schema")
		}
		count++
	}
	if err := columns.Err(); err != nil {
		return err
	}
	if count != len(expected) {
		return errors.New("the _migrations table does not match the supported schema")
	}
	return nil
}

func validateHistory(ctx context.Context, tx *sql.Tx) (int, error) {
	rows, err := tx.QueryContext(ctx, "SELECT version, name FROM _migrations ORDER BY version")
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	count := 0
	for rows.Next() {
		var version int
		var name string
		if err := rows.Scan(&version, &name); err != nil {
			return 0, fmt.Errorf("invalid migration history: %w", err)
		}
		if version != count+1 {
			return 0, fmt.Errorf("migration history is not contiguous at version %d", version)
		}
		if version > SchemaVersion {
			return 0, fmt.Errorf("database schema version %d is newer than supported version %d", version, SchemaVersion)
		}
		if expected := migrationNames[count]; name != expected {
			return 0, fmt.Errorf("migration %d has changed from %q to %q", version, name, expected)
		}
		count++
	}
	return count, rows.Err()
}

func setForeignKeys(ctx context.Context, conn *sql.Conn, enable bool) error {
	expected := 0
	if enable {
		expected = 1
	}
	if _, err := conn.ExecContext(ctx, fmt.Sprintf("PRAGMA foreign_keys = %d", expected)); err != nil {
		return err
	}
	var actual int
	if err := conn.QueryRowContext(ctx, "PRAGMA foreign_keys").Scan(&actual); err != nil {
		return err
	}
	if actual != expected {
		return errors.New("migration foreign-key policy did not take effect")
	}
	return nil
}

func checkForeignKeys(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, "PRAGMA foreign_key_check")
	if err != nil {
		return err
	}
	defer rows.Close()
	if rows.Next() {
		return errors.New("migration requires consistent foreign keys")
	}
	return rows.Err()
}
