// Package core is the pure domain layer, the Go port of rust/crates/tmt-core.
// It imports the standard library only and performs no filesystem, process,
// SQLite, tmux or network work; the architecture test enforces this.
//
// Owner: go-1. Exported types used by internal/ports change only through the lead.
package core

// IdentityID is an identity UUID in canonical lower-case text form.
type IdentityID string

// BindingID is a binding UUID.
type BindingID string

// RequestID is an exchange request id such as "req_<uuid>".
type RequestID string

// Name is a validated identity name; construct it with the names rules (go-1).
type Name string

// Receipt is the opaque reply receipt bound to one request ("v2_...").
type Receipt string
