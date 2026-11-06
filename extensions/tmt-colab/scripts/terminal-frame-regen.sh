#!/bin/sh
# Regenerate the pinned web renderer from the workspace's Rust toolchain and bindgen.
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd -P)
out=${1:-"$root/extensions/tmt-colab/typescript/app/terminal-frame-assets"}
mkdir -p "$out"
out=$(CDPATH= cd -- "$out" && pwd -P)
tmp=$(mktemp -d "${TMPDIR:-/tmp}/colab-terminal-regen.XXXXXX")
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
test "$(wasm-bindgen --version)" = 'wasm-bindgen 0.2.128'
cd "$root/rust"
cargo_path=${CARGO_HOME:-"$HOME/.cargo"}
RUSTFLAGS="--remap-path-prefix=$cargo_path=/cargo --remap-path-prefix=$PWD=/workspace" \
  cargo rustc --locked --release -p tmt-tui-wasm --target wasm32-unknown-unknown --crate-type cdylib,rlib
wasm_target=${CARGO_TARGET_DIR:-"$PWD/target"}
wasm-bindgen --target web --out-dir "$tmp" "$wasm_target/wasm32-unknown-unknown/release/tmt_tui_wasm.wasm"
cp "$tmp/tmt_tui_wasm_bg.wasm" "$out/tmt_tui_wasm_bg.wasm"
cp "$tmp/tmt_tui_wasm.js" "$out/tmt_tui_wasm.js"
