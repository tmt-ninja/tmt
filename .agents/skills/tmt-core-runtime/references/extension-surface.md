# Extension surface: command dispatch, API, MCP and hooks

Code-side rules for what core exposes to extensions. Wire shapes and limits are in
[extension-api](../../../../contracts/extension-api.md) (including "Lifecycle hooks") and
[mcp-v1](../../../../contracts/mcp-v1.md); the seam summary is in
[ARCHITECTURE.md](../../../../ARCHITECTURE.md#public-command-boundary).

## Ownership overview

The grammar (`rust/crates/tmt-cli/src/grammar.rs` and its `grammar/` modules) owns
core command registration, option placement and rejection, and the help projection;
each owner's parser turns its grammar into typed invocations and publishes through
`tmt-command-output`. Hidden commands parse for internal workflows but never appear
in help or completion. [Argument parsing](../../../../AGENTS.md#commands-effects-and-contracts) stays with typed parsers.
Human/JSON share typed result/status contracts; [list](../../../../contracts/identity-status-v1.md#list-runtime-driver) owns runtime-driver proof.
Command dispatch, help and completion rules are in
[Command dispatch and help](#command-dispatch-and-help).

### External command contract (v1)

An unknown root command named `[a-z0-9][a-z0-9-]*` resolves `tmt-<name>` on PATH;
core wins every collision. On Unix the adapter `exec`s, so the extension inherits
stdio, TTY and signals and its exit status is the command's. `core_executable` hands
companions the managed stable launcher via `TMT_EXECUTABLE`, else the invoking executable.
Only the tail is forwarded; missing official names reuse native installation.

### Local extension API (v1)

`tmt api` is the public, same-user process port for machine-shaped gaps in the
ordinary CLI: one versioned JSON request on stdin, one JSON resource or error on
stdout. Explicit `--session` uses ordered JSON lines and a lazy resource connection;
workspace capture retains its bounded read-only snapshot.
Request admission stays fresh and a schema change ends it with a reopen code.
`tmt-adapters::api` owns composition/storage; shared `framed_stdio` bounds API/MCP
frames. The CLI owns publication, request boundaries and cleanup, with no listener
or daemon. Protocol major 1 accepts additive operations and fields; incompatible
changes need a new major.
Human-shaped operations remain their
ordinary JSON commands, not duplicate API implementations. The
[extension API contract](../../../../contracts/extension-api.md) owns the protocol and operation contracts.

### Local MCP (v1)

`tmt mcp --identity <saved-name-or-uuid>` is an agent-launched stdio interface over
the existing exchange. The [MCP contract](../../../../contracts/mcp-v1.md) owns its wire,
schemas and bounds; `tmt-adapters::mcp` owns admission and framing and
`tmt-cli::mcp_command` composes the existing command owners in process. It adds no
exchange state, persistence or retry semantics and is separate from the private
Claude channel server.

### Extension hooks (v1)

`tmt-adapters::extension_hooks` delivers consented, best-effort lifecycle
observations and context lines to verified `tmt-<name>` executables
([wire contract](../../../../contracts/extension-api.md#lifecycle-hooks)). PATH discovery alone
never runs a hook; ownership and a stat fingerprint are re-checked before each
delivery. Capture is per connection and transactional, delivery is bounded and
never changes a command's result, and a nested `tmt` captures nothing. Extension
summaries are untrusted informational data. With no consent file a command spawns
nothing.

## Core command surface

The [grammar](../../../../rust/crates/tmt-cli/src/grammar.rs) owns primary names, aliases and
the public help surface; core reserves its names before external dispatch.
Core owns [workspace geometry/codecs](../../../../contracts/workspace-v1.md#restore-authority) and generations; adapters, atomic publication/fenced
creation; CLI, consent/output. The built-in host's store records running members, which restore restarts one at a time through ordinary resume ([built-in snapshots](../../../../contracts/workspace-v1.md#built-in-host-snapshots)). Restore pins bytes; full restore uses ordinary
resume/external dispatch in created panes. Layout-only grants no launch authority.
One typed result serves human and JSON output; `identity show`
without a name uses the shared verified-caller selector and never falls back to
a working directory, active pane or sole identity.
`check --capture-only` shares UUID binding selection and `identity_context`'s
expected-name guard with pinned identity reads, before host capture; ordinary
check keeps name/pane routing and its existing Digest opportunity.

## Command dispatch and help

- `tmt-cli/src/grammar.rs` owns the ordered core registrations, shared spec/option helpers
  and help projection; private `grammar/` modules own builders by group and do not import each
  other. Each visible core command registers from a `CommandSpec` through
  `tmt_cli_style::apply`; hidden commands have no help page. Every public core option has a
  nonblank single-line description, checked recursively. Core help never enters runtime
  dispatch or skill-drift inspection. Unknown help topics name the nearest resolved public
  parent's help command; error code, presentation mode and JSON fields stay unchanged.
- Unknown-argument diagnostics reuse that scan's nearest canonical public path for a
  human-only help hint through the existing suggestion renderer. Hidden commands,
  values, `--` data and launch tails never select the hint topic; JSON keeps the
  original parser message and fields. Clap's typed subcommand suggestions omit hidden
  registrations and their aliases; when all candidates are hidden, human errors use
  the same public-scope hint without changing the offending token or JSON fields.
- The help scan shares option-value boundaries with error-mode recovery so `-h` bypasses
  required operands without reading payload data as flags. Help with `--json` reaches
  `finish_parse` and returns `JSON_UNSUPPORTED` before operand validation. `OutputMode` holds only JSON;
  unsupported `--verbose`/`--debug` fail with `USAGE_ERROR` before effects.
- Core names and aliases are reserved before external PATH dispatch; the recursive listing
  guard in `tmt-cli-style::audit` covers core and Ops.
- `skill_reminder` prints at most one best-effort stderr line after a successful result and
  never changes JSON or raw stdout; `TMT_HINTS=off` disables transition hints, not error
  recovery or drift reports.
- `output::table` is the one plain human-table renderer (escaping, Unicode width, no
  truncation or color); JSON and exact message bodies bypass it.

## External commands (v1)

- PATH enumeration happens only for root help, root completion and unknown-command
  suggestions; exact dispatch probes one filename. `tmt help <extension>` runs
  `tmt-<extension> --help`; `tmt help <extension> <tail...>` forwards `<tail...> --help`.
  Tail flags, including `--json`, belong to the extension; Core names and aliases stay reserved.
- A missing official command uses the existing installable product registry. Its CLI offer
  requires stdin/stdout terminals, no JSON and conservative caller-context admission;
  agent markers, registered runtime ancestry and unavailable evidence suppress the offer.
  Help remains read-only. Other callers receive `EXTENSION_NOT_INSTALLED` (exit 3), with
  an exact consented install command. Accepted installation prints the shell-quoted
  original invocation and never dispatches it. Installed extension tails stay opaque.
  Root help's missing-official rows and bare-root Start here use the shared receipt-based
  inventory projection, not PATH presence as readiness. PATH still owns external resolution;
  explicit/nested help keeps its existing grammar. Completion lists installed commands only.
- Installed-extension prefix refusals recover presentation mode only from the stored
  Core prefix using the diagnostic scanner, and never inspect or execute the extension tail.
- Direct extension dispatch, completion and Remote message delivery share the child-only
  `TMT_EXECUTABLE` environment builder, using `core_executable::selected` for the callback.
  Bounded calls keep the process owner's spawn classification and cleanup; they never
  mutate the parent environment or insert an environment-launcher child.
- Completion v1 (`__complete`) runs through the bounded process owner with a one-second
  deadline and 64 KiB bound; shells quote candidates and never evaluate them. It is optional and falls back to file
  completion on any failure.

## Local API and MCP

- `tmt-adapters::api` owns envelope admission and composition; the facade `api.rs` keeps the
  dispatcher, bounds, per-request settings/admission and lazy `Session` storage lifetime;
  private `api/` modules own operation families. Explicit `tmt api --session` reuses one
  resource connection and drains lifecycle observations per request, with no transaction across frames.
  The sole exception, `workspace.capture`, retains its bounded zero-busy-timeout read-only
  identity snapshot and its no-create/current-schema admission.
  Each request checks the current application schema; `API_SESSION_STALE` rejects the request
  and ends the session so consumers reopen the current executable. Capabilities and
  unsupported-version discovery never open storage; after a connection opens, discovery
  also passes that schema fence. Explicit identity selects write attribution, not privilege.
- Client byte framing and child cleanup belong to neutral `tmt-invoke::LineChannel`;
  it adds no idle timer, protocol envelope or replay. Ops owns its per-UI queue,
  capability negotiation, interaction priority and later-request reopen policy in
  `core::api_session`. Other extensions can reuse the neutral leaf without depending on Ops.
- `framed_stdio` owns invocation-descriptor newline acquisition/publication for API and MCP:
  bounded frames, idle blocking, partial-frame/write deadlines, no worker or fd-flag mutation.
  The ports own their envelopes, error recovery and clean EOF. API closes its connection on
  every exit; notebook admission reuses it through the existing notebook owner.
- `identity.rename` admits an exact UUID/name CAS through the binding owner, without host
  observation; CLI name-based rename shares its transaction-local policy.
- `rooms.roster` reads membership, metadata and status from one deferred SQLite snapshot and
  excludes presence (host observation, `ls --room --json`). `identity_projection` gives CLI
  and API identical identity bytes. `identityHooks.*` are scoped to the named consumer;
  another consumer's hook is `HOOK_NOT_FOUND`.
- `extensions.uses` (`api/extensions.rs`) resolves the default install prefix and reads only receipts through
  `native_install::uses`; it never installs, runs an extension or opens storage. The declaration is the optional
  release file `TMT-USES.json`, validated at acquisition and inspected like the other release files.
- History reads never acknowledge or renew retention; dispatch operation IDs recover
  immutable acceptance and replay never wakes again.
- `tmt-cli::mcp_command` pins one saved identity UUID and data root and composes the existing
  command owners in process with the same JSON encoders. API dispatch distinguishes local name
  lookup from an exact saved UUID so retirement cannot retarget a pinned writer.

## Extension hooks

- `tmt extension hooks enable <name>` records path, SHA-256, stat fingerprint and capabilities
  in `<global>/extension-hooks.json` (0600, atomic replace); ownership and fingerprint are
  re-checked before every delivery and a change skips the extension until re-enabled.
- Enable probes before locking, with a one-second deadline. A probe that misses it gives
  `EXTENSION_HOOKS_UNAVAILABLE` with the retry command and records nothing: the first start
  of a newly written executable can be slow on macOS, so a miss is never
  `EXTENSION_INCOMPATIBLE`; another probe failure or an unsupported answer is.
  Enable/disable decode and change the current document in
  `tmt_extension_state::Document::update`, using the caller's global directory as state root.
  Its stable directory-identity lock waits up to five seconds for admission; callbacks are
  never replayed. Existing destinations must be owned regular 0600 files for mutation;
  a mode refusal names the path, `chmod 600` fix and exact retry command. Invalid schemas
  retain `EXTENSION_HOOKS_INVALID`; lock/storage failures and uncertain publication retain
  `EXTENSION_HOOKS_UNAVAILABLE` with the shared cause and retry. Never infer rollback from
  an uncertain publication. Missing-file disable creates nothing; existing-file no-ops
  check under the lock without replacing bytes. The shared leaf owns staging and recovery.
- Lifecycle observers keep their once-per-process consent snapshot; context contributions
  read fresh consent. Neither reader takes the writer lock, and disabling does not cancel
  an observer already captured by the current process.
- Capture installs temporary triggers in `Storage::open` only for the `tmt` CLI with an
  enabled `lifecycle_observations_v1` observer; the temporary table follows the transaction,
  so a rollback leaves no evidence. API sessions drain/deliver at each request boundary;
  other invocations do so after the command, under one aggregate
  deadline, its output is discarded and no failure changes the result. `TMT_HOOK_DELIVERY=1`
  stops nested capture.
- Context contributions (`context_v1`, via `context_command::verified_document`) are asked
  only for a verified bound identity, are untrusted and are dropped before role or notes when
  the 4 KiB context bound bites. Provider `UserPromptSubmit` hooks reuse the same budget and
  need a running, verified binding that matches the caller.
- Without a consent file a command reads it at most once, on first storage open, and spawns
  nothing.
