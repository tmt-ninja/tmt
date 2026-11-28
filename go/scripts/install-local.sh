#!/bin/sh
# Build a local tmt-go beside the native tmt.
set -eu

go_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
bin_dir=${HOME:?HOME must be set}/.local/bin
target=$bin_dir/tmt-go

mkdir -p "$bin_dir"
if [ -L "$target" ] || { [ -e "$target" ] && [ ! -f "$target" ]; }; then
    printf 'Cannot replace %s: expected a regular file\n' "$target" >&2
    exit 1
fi

stage=$(mktemp -d "$bin_dir/.tmt-go.XXXXXXXX")
trap 'rm -f "$stage/tmt-go"; rmdir "$stage"' EXIT
trap 'exit 1' HUP INT TERM

(
    cd "$go_dir"
    GOOS=$(go env GOHOSTOS)
    GOARCH=$(go env GOHOSTARCH)
    GOWORK=off CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" \
        go build -trimpath -o "$stage/tmt-go" ./cmd/tmt-go
)

# Keep the staged binary on the destination filesystem for atomic replacement.
case $(uname -s) in
    Darwin) mv -fh "$stage/tmt-go" "$target" ;;
    Linux) mv -fT "$stage/tmt-go" "$target" ;;
    *) printf 'Unsupported host OS\n' >&2; exit 1 ;;
esac
printf 'Installed %s\n' "$target"
