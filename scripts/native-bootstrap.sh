#!/bin/sh
# Generated from verified cargo-dist artifacts; do not maintain release facts here.
# HTTPS and embedded digests trust the official origin, not an independent signature.
set -eu

main() {
  version='@@VERSION@@'
  channel='@@CHANNEL@@'
  prefix=${HOME:?HOME is required}/.local
  pin=no
  skill=yes
  setup=yes
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --prefix)
        [ "$#" -ge 2 ] || fail '--prefix requires an absolute directory.'
        prefix=$2
        shift 2 ;;
      --pin) pin=yes; shift ;;
      --no-skill) skill=no; shift ;;
      --no-setup) setup=no; shift ;;
      --help)
        printf '%s\n' 'Usage: sh install.sh [--prefix /absolute/directory] [--pin] [--no-setup] [--no-skill]'
        return 0 ;;
      *) fail "Unknown installer option: $1" ;;
    esac
  done
  case "$prefix" in /*) ;; *) fail '--prefix must be absolute.' ;; esac
  [ "$prefix" != / ] || fail 'Refusing the filesystem root as an installation prefix.'
  for utility in curl uname mktemp rm wc tar chmod; do
    command -v "$utility" >/dev/null 2>&1 || fail "Required utility is missing: $utility"
  done
  if command -v sha256sum >/dev/null 2>&1; then
    hash_tool=sha256sum
  elif command -v shasum >/dev/null 2>&1; then
    hash_tool=shasum
  else
    fail 'SHA-256 verification requires sha256sum or shasum.'
  fi
  host="$(uname -s):$(uname -m)"
  case "$host" in
@@TARGET_CASES@@
    *) fail "This installer has no verified artifact for $host." ;;
  esac

  printf 'Install tmt %s (%s)\n' "$version" "$platform"

  umask 077
  # Only successful mktemp creation grants deletion ownership. The trap is
  # installed immediately; no existing install or abandoned stage is removed.
  stage=$(mktemp -d "${TMPDIR:-/tmp}/tmt-bootstrap.XXXXXXXX")
  trap 'cleanup' 0
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  base="https://github.com/tmt-ninja/tmt/releases/download/v$version"
  download "$base/dist-manifest.json" "$stage/dist-manifest.json" @@MANIFEST_SIZE@@
  verify "$stage/dist-manifest.json" @@MANIFEST_SIZE@@ '@@MANIFEST_HASH@@'
  download "$base/$archive" "$stage/$archive" "$archive_size"
  verify "$stage/$archive" "$archive_size" "$archive_hash"
  step done 'Downloaded and verified archive'

  # Do not extract archive paths into the filesystem. The generator has checked
  # the complete archive inventory; its digest binds this one selected stream.
  tar -xzOf "$stage/$archive" "${archive%.tar.gz}/tmt" > "$stage/tmt"
  chmod 700 "$stage/tmt"
  set -- __native-install --archive "$stage/$archive" \
    --manifest "$stage/dist-manifest.json" --prefix "$prefix" --channel "$channel"
  if [ "$pin" = yes ]; then set -- "$@" --pin; fi
  if (unset GH_TOKEN GITHUB_TOKEN; exec "$stage/tmt" "$@") > "$stage/install.log"; then
    :
  else
    status=$?
    show_diagnostic "$stage/install.log"
    step failed 'Native installation did not finish cleanly; inspect the error above before retrying.' >&2
    step warning 'If the prefix contains an npm/pnpm/brew/manual command, choose another prefix or remove it with its original manager. This installer never overwrites that command.' >&2
    return "$status"
  fi

  render_native_status "$stage/install.log"
  path_pending=no
  setup_pending=no
  skill_pending=no
  selected=$(command -v tmt || :)
  selected_alias=$(command -v tmux-team || :)
  if [ -z "$selected" ] && [ -z "$selected_alias" ]; then
    path_pending=yes
    step warning "$prefix/bin is not in PATH yet. Add it to PATH, then run hash -r or open a new shell."
  elif [ "$selected" != "$prefix/bin/tmt" ] || [ "$selected_alias" != "$prefix/bin/tmux-team" ]; then
    path_pending=yes
    step warning "PATH may still select another installation (tmt: ${selected:-not found}; tmux-team: ${selected_alias:-not found})."
    printf '  %s\n' \
      "Put $prefix/bin first in PATH, then run hash -r or open a new shell." \
      'If replacing an npm/pnpm installation, remove it with npm uninstall -g tmux-team or pnpm remove -g tmux-team using its original manager.' \
      'For Homebrew/manual installs, use their original uninstall procedure. No old installation or shell profile was changed.'
  fi
  # On a terminal, continue into guided setup: it reads its one approval from
  # the terminal because a piped installer's stdin is the script itself.
  # Elsewhere (CI, no terminal, --no-setup), install skills as before.
  if [ "$setup" = yes ] && [ "$skill" = yes ] && [ -z "${CI:-}" ] && interactive; then
    if (unset GH_TOKEN GITHUB_TOKEN; PATH="$prefix/bin:$PATH" exec "$prefix/bin/tmt" setup) </dev/tty; then
      step done 'Setup finished'
    else
      setup_pending=yes
      step warning 'Setup did not finish; tmt is installed. Run tmt setup again when ready.' >&2
    fi
  elif [ "$skill" = yes ]; then
    if (unset GH_TOKEN GITHUB_TOKEN; exec "$prefix/bin/tmt" install) > "$stage/skills.log"; then
      step done 'Installed agent skills'
      show_skill_report "$stage/skills.log"
    else
      show_diagnostic "$stage/skills.log"
      skill_pending=yes
      step warning 'The native binary is installed, but skill setup failed. Inspect conflicts before explicitly running the new tmt install --force; it backs up conflicting links/content.' >&2
      printf '  %s\n' 'No data was migrated or deleted. Retry with the absolute new tmt path.' >&2
      next_steps
      return 1
    fi
    [ "$setup" != yes ] || setup_pending=yes
    printf '%s\n' 'Reload your agent, or read tmt learn --skill in an existing conversation.' \
      'Run tmt setup to connect your agents.'
  fi
  printf '%s\n' 'Use the new tmt upgrade for subsequent native updates. Application data was not migrated or deleted.'
  next_steps
}

# The shell mirrors the CLI's semantic marks; user text is always a printf value.
# Check the destination stream, independently of stdin and the other output stream.
step() {
  case "$1" in
    done) mark='✓'; color=32 ;;
    warning) mark='!'; color=33 ;;
    failed) mark='✗'; color=31 ;;
  esac
  if [ -t 1 ] && [ "${NO_COLOR+x}" != x ] && [ -z "${CI:-}" ]; then
    printf '\033[%sm%s\033[0m %s\n' "$color" "$mark" "$2"
  else
    printf '%s %s\n' "$mark" "$2"
  fi
}

fail() { step failed "$*" >&2; exit 1; }

# Recognize only the captured child's text; never execute or evaluate it.
# Preserve unknown/multiline reports rather than inventing an install outcome.
render_native_status() {
  native_line=
  native_next=
  native_extra=no
  {
    IFS= read -r native_line || :
    if IFS= read -r native_next || [ -n "$native_next" ]; then native_extra=yes; fi
  } < "$1"
  native_status=$native_line
  case "$native_status" in '✓ '*) native_status=${native_status#'✓ '} ;; esac
  if [ "$native_extra" = no ]; then
    case "$native_status" in
      'Installed tmt '?*' at '?*) step done "$native_status"; return ;;
      'Current tmt '?*' at '?*)
        native_current=${native_status#'Current tmt '}
        native_version=${native_current%%' at '*}
        native_path=${native_current#*' at '}
        step done "tmt $native_version is already current at $native_path"
        return ;;
    esac
  fi
  native_detail=
  while IFS= read -r native_detail; do
    printf '%s\n' "$native_detail"
  done < "$1"
  [ -z "$native_detail" ] || printf '%s' "$native_detail"
}

# Failed stdout remains visible alongside the child's untouched stderr.
show_diagnostic() {
  while IFS= read -r diagnostic || [ -n "$diagnostic" ]; do
    printf '%s\n' "$diagnostic" >&2
  done < "$1"
}

# Keep every skill detail, including successful backups, warnings and picker hints.
show_skill_report() {
  while IFS= read -r skill_detail || [ -n "$skill_detail" ]; do
    case "$skill_detail" in
      'Warning:'*|'Recoverable backup:'*) step warning "$skill_detail" ;;
      *) printf '  %s\n' "$skill_detail" ;;
    esac
  done < "$1"
}

# POSIX shell single-quote encoding, including prefixes with apostrophes.
quote_command() {
  quote_rest=$1
  printf "'"
  while :; do
    case "$quote_rest" in
      *"'"*)
        printf '%s%s' "${quote_rest%%\'*}" "'\\''"
        quote_rest=${quote_rest#*\'} ;;
      *) printf "%s'" "$quote_rest"; return ;;
    esac
  done
}

next_command() {
  [ "$next_count" -lt 3 ] || return 0
  if [ "$1" = optional ] && [ -t 1 ] && [ "${NO_COLOR+x}" != x ] && [ -z "${CI:-}" ]; then
    printf '  \033[2m%s\033[0m\n' "$2"
  else
    printf '  %s\n' "$2"
  fi
  next_count=$((next_count + 1))
}

next_steps() {
  next_count=0
  if [ "$path_pending" = yes ]; then
    next_tmt=$(quote_command "$prefix/bin/tmt")
  else
    next_tmt=tmt
  fi
  printf 'Next:\n'
  if [ "$path_pending" = yes ]; then
    next_bin=$(quote_command "$prefix/bin")
    next_command required "export PATH=$next_bin:\"\$PATH\""
    next_command required 'hash -r'
  fi
  if [ "$skill_pending" = yes ]; then
    next_command required "$next_tmt install"
  elif [ "$setup_pending" = yes ]; then
    next_command required "$next_tmt setup"
  elif [ "$setup" = no ] && [ "$skill" = yes ]; then
    next_command optional "$next_tmt setup"
  fi
  if [ "$skill" = yes ] && [ "$skill_pending" = no ]; then
    next_command optional "$next_tmt learn --skill"
  fi
  next_command optional "$next_tmt upgrade"
}

# A person is at a terminal: both the output and /dev/tty are usable.
interactive() {
  [ -t 1 ] && { : </dev/tty; } 2>/dev/null
}

download() {
  download_url=$1
  download_output=$2
  download_limit=$3
  # Disable user curl configuration; never accept an inherited insecure flag.
  set -- --disable --fail --show-error --location --proto '=https' \
    --proto-redir '=https' --max-redirs 3 --connect-timeout 10 --max-time 60 \
    --max-filesize "$download_limit"
  if [ "$download_url" = "$base/$archive" ] && [ -t 2 ] && [ -z "${CI:-}" ]; then
    if [ -n "${archive_display_size:-}" ]; then
      printf 'Downloading tmt %s (%s, %s)\n' "$version" "$platform" "$archive_display_size" >&2
    else
      printf 'Downloading tmt %s (%s)\n' "$version" "$platform" >&2
    fi
    set -- "$@" --progress-bar
  else
    set -- "$@" --silent
  fi
  if curl "$@" --output "$download_output" "$download_url"; then
    :
  else
    download_status=$?
    step failed 'Download failed.' >&2
    return "$download_status"
  fi
}

verify() {
  actual_size=$(wc -c < "$1")
  [ "$actual_size" -eq "$2" ] || fail 'Downloaded asset size mismatch.'
  if [ "$hash_tool" = sha256sum ]; then
    actual_hash=$(sha256sum "$1")
  else
    actual_hash=$(shasum -a 256 "$1")
  fi
  actual_hash=${actual_hash%% *}
  [ "$actual_hash" = "$3" ] || fail 'Downloaded asset SHA-256 mismatch.'
}

cleanup() {
  status=$?
  trap - 0
  if ! rm -rf -- "$stage"; then
    step warning 'Could not remove the private bootstrap staging directory.' >&2
    [ "$status" -ne 0 ] || status=1
  fi
  exit "$status"
}

# Parse the complete final compound command before invoking main. A download
# truncated after the word 'main' must not run with missing caller arguments.
{
  main "$@"
}
