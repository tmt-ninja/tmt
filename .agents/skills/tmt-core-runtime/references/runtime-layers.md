# Runtime layers and shared crates

[ARCHITECTURE.md](../../../../ARCHITECTURE.md#runtime-layers) names the layers and their
one dependency direction. This reference owns what each layer and shared crate may hold.
The [architecture guard](../../../../rust/crates/tmt-cli/tests/architecture.rs) enforces
the module and dependency rules; [development procedures](../../tmt-dev/references/development.md#architecture-guard)
own its checks. It supplements behavior review.

## Layers

| Layer             | Owner                           | Responsibility                                                                                                                                                                                                  |
| ----------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pure domain       | `rust/crates/tmt-core/src/`     | Identity, names, bindings, profiles, settings, retention, request state and native-install version policy. No filesystem, process, SQLite, tmux, network or CLI framework.                                      |
| Concrete adapters | `rust/crates/tmt-adapters/src/` | Config files, SQLite, bounded files and processes, signals, tmux evidence/transport, response input, HTTP acquisition, native release publication and managed skill files.                                      |
| Application/CLI   | `rust/crates/tmt-cli/src/`      | Core grammar, typed invocations, preflight and use-case composition, completion and the executable entry point. It chooses adapters; it does not duplicate their storage, file, installation or process policy. |

[Orchestration](../../../../contracts/orchestration-v1.md) follows the same split: Core
`effective()` resolves policy; the adapters own the calendar, SQLite and the `tick` clock;
the CLI and API expose it; Digest does the receiving. Sending rules and talk limits refuse
or hold in request preparation, and canonical jobs share its acceptance.

## Shared crates

- `tmt-command-output` owns shared command output, errors and formatting.
- `tmt-cli-style` owns human text: [CLI style](../../../../design/cli-style.md), `grid`,
  help, `Interaction` and `progress`. It has no TMT dependencies.
The default `table` feature of `tmt-cli-style` enables terminal tables and width
probing; its architecture guard still enforces the presentation-leaf boundary.

- `tmt-tui` is an internal, unpublished, application-neutral presentation leaf for TMT
  terminal UIs, taking its tokens from `tmt-cli-style` roles. The
  [dependency guard](../../../../rust/crates/tmt-cli/tests/architecture/policy.rs) owns its
  allowlist; Core, adapters, CLI and extension behavior stay out of it. Ops is its one
  reviewed consumer, and a new consumer or dependency goes to tmt-lead. The
  [`tmt-tui` skill](../../tmt-tui/SKILL.md) owns the leaf itself.
- `tmt-invoke` owns executable discovery, bounded capture and ordered newline exchanges
  over one owned child, child-only environment overlays and browser launch. Callers own
  protocols, admission and presentation; it has no TMT dependencies.
- `tmt-sys` is the single audited `unsafe` boundary: only `tmt-adapters` depends on it,
  and every other crate forbids unsafe code.

## Feature graph

Workspace quality checks cover the unified feature graph. Native process fixtures build
products separately to keep ordinary CLI feature isolation;
[development procedures](../../tmt-dev/references/development.md#rust-checks) own their
selection.
