# tmt-go (experiment #6938)

Go port of the native `tmt` executable (`rust/crates`), built on the long-lived
branch `poc/go`. It is never merged into `main` without a separate owner decision.
The plan, ownership and open questions are on #6938.

## Isolation

- The binary is `tmt-go`. Its data root is `TMT_GO_HOME`, else `~/.local/share/tmt-go`;
  it ignores `TMT_HOME`. `internal/home` refuses any root overlapping the native
  root (`TMT_HOME`, `$XDG_CONFIG_HOME/tmt`, `~/.config/tmt`) or holding `tmt.db`.
- No package writes provider directories or provider settings. Hooks, channel
  config and skills are injected per launch under the tmt-go root.
- Tests use fake providers (`test/fixtures`) and reach tmux only through
  `test/tmuxtest` (private socket, TMUX unset, host default refused).

## Layers and owners

| Path | Owner |
| --- | --- |
| `go.mod`, `cmd/tmt-go`, `internal/ports`, `internal/home`, `internal/archtest`, `test/tmuxtest`, `test/parity`, `.github/workflows/go.yml` | tmt-go-lead |
| `internal/core`, `internal/adapters/storage` | go-1 |
| `internal/sys`, `internal/invoke`, `internal/clistyle`, `internal/adapters/{process,tmux,host,pty,delivery,runtime,interrupt,verifiedstop,drivers,channel}`, `test/fixtures` | go-2 |
| `internal/cli`, `internal/output` | go-3 |
| `internal/adapters/{install,skills,release,config,api,mcp,framedstdio,exthooks,extcmd,tick,digest}`, `test/e2e` | go-4 |
| `internal/jobcalendar`, `internal/hostgrammar`, `internal/driverprotocol`, `internal/ptyprotocol`, `internal/tuicomponents`, `internal/tui` | core-agy (lent, Gemini) |

`internal/archtest` enforces: core imports only the standard library and `golang.org/x/text`, with no I/O;
ports imports only core; adapters never import cli; only `internal/sys` uses
`unsafe`, `syscall` or `x/sys`; only adapters import `internal/sys`; production code
never imports `go/test`; modules outside the standard library are on an approved list.

## Install for daily use

`go/scripts/install-local.sh` (go-4) builds `tmt-go` and places it at `~/.local/bin/tmt-go`,
beside the native `tmt`, never replacing or aliasing it.

## Branch flow

Each seat works in its own worktree on a local branch tracking `poc/go`, commits
only in the paths it owns, then `git pull --rebase origin poc/go` and pushes.
Nobody force-pushes `poc/go`. A change to `internal/ports`, exported `internal/core`
types used by ports, `go.mod` dependencies or `archtest` goes through the lead.
Before every push: `gofmt -l .` empty, `go vet ./...`, `env -u TMUX -u TMUX_PANE go test ./...`.

## Schema

`internal/adapters/storage/schema/*.sql` are byte copies of
`rust/crates/tmt-adapters/src/storage/schema`; `scripts/check-schema-copy.sh` fails on drift.
