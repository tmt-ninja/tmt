package storage

import "embed"

// Schema holds the migration files, byte-identical copies of
// rust/crates/tmt-adapters/src/storage/schema (checked by go/scripts/check-schema-copy.sh).
// The Rust files stay the single owner; refresh the copies, never edit them here.
//
//go:embed schema/*.sql
var Schema embed.FS
