package storage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/tmt-ninja/tmt/go/internal/core"
)

func backfillRetention(ctx context.Context, tx *sql.Tx) error {
	// These constants are frozen migration policy, independent of settings.
	const retentionMs = 7 * 86_400_000
	const settlementMs = 86_400_000
	const maximum = core.MaxJSSafeInteger
	var invalid bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(
		SELECT 1 FROM request_attempts
		WHERE typeof(prepared_at_ms) <> 'integer' OR prepared_at_ms NOT BETWEEN 1 AND ?1
		   OR typeof(expires_at_ms) <> 'integer' OR expires_at_ms NOT BETWEEN 1 AND ?1
		   OR (settled_at_ms IS NOT NULL AND (typeof(settled_at_ms) <> 'integer' OR settled_at_ms NOT BETWEEN 1 AND ?1))
		UNION ALL
		SELECT 1 FROM request_responses
		WHERE typeof(submitted_at_ms) <> 'integer' OR submitted_at_ms NOT BETWEEN 1 AND ?1
	)`, maximum).Scan(&invalid); err != nil {
		return err
	}
	if invalid {
		return errors.New("historical timestamp is outside the supported range")
	}
	if _, err := tx.ExecContext(ctx, `UPDATE request_attempts SET retention_expires_at_ms = MIN(?1,
		MAX(prepared_at_ms + ?2, expires_at_ms + ?3, COALESCE(settled_at_ms + ?3, 0)))`,
		maximum, retentionMs, settlementMs); err != nil {
		return fmt.Errorf("backfill attempt horizon: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE request_responses SET response_expires_at_ms = MIN(?, submitted_at_ms + ?)`,
		maximum, retentionMs); err != nil {
		return fmt.Errorf("backfill response horizon: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE request_attempts
		SET retention_expires_at_ms = MAX(retention_expires_at_ms, COALESCE(
			(SELECT response_expires_at_ms FROM request_responses
			 WHERE request_responses.request_id = request_attempts.request_id
			   AND request_responses.attempt_id = request_attempts.attempt_id), retention_expires_at_ms))`); err != nil {
		return fmt.Errorf("extend matching response horizons: %w", err)
	}
	indexes, err := Schema.ReadFile("schema/006_indexes.sql")
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, string(indexes)); err != nil {
		return fmt.Errorf("index retention horizons: %w", err)
	}
	return nil
}

func validateIdentitySource(ctx context.Context, tx *sql.Tx) error {
	body, err := migrationSQL(1)
	if err != nil {
		return err
	}
	expected, _, _ := strings.Cut(body, ";")
	if err := requireTable(ctx, tx, "identities", expected); err != nil {
		return err
	}
	var custom bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM sqlite_schema
		WHERE tbl_name = 'identities' AND type IN ('index', 'trigger') AND sql IS NOT NULL)`).Scan(&custom); err != nil {
		return err
	}
	if custom {
		return errors.New("identity migration cannot replace custom indexes or triggers")
	}
	return nil
}

func validateBindingSource(ctx context.Context, tx *sql.Tx, body string) error {
	_, table, found := strings.Cut(body, "CREATE TABLE bindings_039")
	if !found {
		return errors.New("host migration has no replacement bindings definition")
	}
	table, _, _ = strings.Cut(table, ";")
	expected := "CREATE TABLE bindings" + strings.Replace(table,
		"CHECK (transport IN ('tmux', 'herdr'))", "CHECK (transport = 'tmux')", 1)
	if err := requireTable(ctx, tx, "bindings", expected); err != nil {
		return err
	}
	var custom bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE sql IS NOT NULL
		AND name NOT IN ('bindings', 'bindings_endpoint') AND sql LIKE '%bindings%')`).Scan(&custom); err != nil {
		return err
	}
	if custom {
		return errors.New("host migration cannot rebuild bindings with dependent schema objects")
	}
	return nil
}

func requireTable(ctx context.Context, tx *sql.Tx, table, expected string) error {
	var actual string
	if err := tx.QueryRowContext(ctx, "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?", table).Scan(&actual); err != nil {
		return fmt.Errorf("inspect historical %s schema: %w", table, err)
	}
	if !slices.Equal(strings.Fields(actual), strings.Fields(expected)) {
		return fmt.Errorf("migration requires the historical %s table definition", table)
	}
	return nil
}

var hostTables = [...]struct {
	table, oldRule, newRule string
}{
	{
		"bindings", "CHECK (transport IN ('tmux', 'herdr'))",
		`CHECK (length(transport) BETWEEN 1 AND 32 AND transport GLOB '[a-z]*'
    AND transport NOT GLOB '*[^a-z0-9-]*')`,
	},
	{
		"request_attempts", "CHECK (host IS NULL OR (route_kind = 'pane' AND host IN ('tmux', 'herdr')))",
		`CHECK (host IS NULL OR (route_kind = 'pane' AND length(host) BETWEEN 1 AND 32
    AND host GLOB '[a-z]*' AND host NOT GLOB '*[^a-z0-9-]*'))`,
	},
	{
		"request_responses", "CHECK (host IS NULL OR host IN ('tmux', 'herdr'))",
		`CHECK (host IS NULL OR (length(host) BETWEEN 1 AND 32
    AND host GLOB '[a-z]*' AND host NOT GLOB '*[^a-z0-9-]*'))`,
	},
	{
		"host_servers", "CHECK (host IN ('herdr'))",
		`CHECK (host <> 'tmux' AND length(host) BETWEEN 1 AND 32
    AND host GLOB '[a-z]*' AND host NOT GLOB '*[^a-z0-9-]*')`,
	},
}

type schemaObject struct {
	kind, name, table, definition string
}

// Schema 41 refuses unknown dependencies before it replaces the four tables.
func validateHostSource(ctx context.Context, tx *sql.Tx) error {
	actual, err := hostSchemaObjects(ctx, tx)
	if err != nil {
		return err
	}
	fresh, err := sql.Open("sqlite", "file::memory:?_txlock=immediate&_pragma=foreign_keys(ON)")
	if err != nil {
		return err
	}
	defer fresh.Close()
	conn, err := fresh.Conn(ctx)
	if err != nil {
		return err
	}
	defer conn.Close()
	if err := migrateThrough(ctx, conn, 40); err != nil {
		return fmt.Errorf("build schema-40 reference: %w", err)
	}
	reference, err := conn.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer reference.Rollback()
	expected, err := hostSchemaObjects(ctx, reference)
	if err != nil {
		return err
	}
	if !slices.Equal(actual, expected) {
		return errors.New("host-name migration requires the schema-40 definitions of bindings, request_attempts, request_responses and host_servers")
	}
	return nil
}

func hostSchemaObjects(ctx context.Context, tx *sql.Tx) ([]schemaObject, error) {
	rows, err := tx.QueryContext(ctx, `SELECT type, name, tbl_name, COALESCE(sql, '') FROM sqlite_schema
		WHERE tbl_name IN (?1, ?2, ?3, ?4)
		   OR (sql IS NOT NULL AND (instr(sql, ?1) OR instr(sql, ?2) OR instr(sql, ?3) OR instr(sql, ?4)))
		ORDER BY type, name`, hostTables[0].table, hostTables[1].table, hostTables[2].table, hostTables[3].table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var objects []schemaObject
	for rows.Next() {
		var o schemaObject
		if err := rows.Scan(&o.kind, &o.name, &o.table, &o.definition); err != nil {
			return nil, err
		}
		o.definition = strings.Join(strings.Fields(strings.ReplaceAll(o.definition, `"`, "")), " ")
		objects = append(objects, o)
	}
	return objects, rows.Err()
}

func rebuildHostTables(ctx context.Context, tx *sql.Tx) error {
	for _, item := range hostTables {
		var definition string
		if err := tx.QueryRowContext(ctx, "SELECT sql FROM sqlite_schema WHERE type = 'table' AND tbl_name = ?", item.table).Scan(&definition); err != nil {
			return err
		}
		start := strings.IndexByte(definition, '(')
		if start < 0 || strings.Count(definition, item.oldRule) != 1 {
			return fmt.Errorf("host-name migration requires exactly one schema-40 host rule on %s", item.table)
		}
		dependents, err := hostDependents(ctx, tx, item.table)
		if err != nil {
			return err
		}
		staged := item.table + "_041"
		body := strings.Replace(definition[start:], item.oldRule, item.newRule, 1)
		// Identifiers here are constants from hostTables, never stored or user text.
		statement := fmt.Sprintf("CREATE TABLE %s %s; INSERT INTO %s SELECT * FROM %s; DROP TABLE %s; ALTER TABLE %s RENAME TO %s;",
			staged, body, staged, item.table, item.table, staged, item.table)
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("rebuild host table %s: %w", item.table, err)
		}
		for _, dependent := range dependents {
			if _, err := tx.ExecContext(ctx, dependent); err != nil {
				return fmt.Errorf("restore %s index or trigger: %w", item.table, err)
			}
		}
	}
	return nil
}

func hostDependents(ctx context.Context, tx *sql.Tx, table string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT sql FROM sqlite_schema
		WHERE type IN ('index', 'trigger') AND tbl_name = ? AND sql IS NOT NULL ORDER BY type, name`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var dependents []string
	for rows.Next() {
		var statement string
		if err := rows.Scan(&statement); err != nil {
			return nil, err
		}
		dependents = append(dependents, statement)
	}
	return dependents, rows.Err()
}
