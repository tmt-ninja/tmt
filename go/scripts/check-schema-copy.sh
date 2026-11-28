#!/bin/sh
# Fails when the embedded migration copies differ from the Rust schema owner.
set -eu
root=$(git rev-parse --show-toplevel)
diff -r "$root/rust/crates/tmt-adapters/src/storage/schema" "$root/go/internal/adapters/storage/schema"
echo "schema copies match"
