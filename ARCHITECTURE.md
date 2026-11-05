# Architecture

The CLI runtime is the Rust workspace in `rust/`. The `typescript` pnpm workspace owns Vitest, fixture
and release-verification tooling; the repository root has no Node package.
Contributors run Cargo and pnpm scripts directly. The pnpm workspace is not a second CLI runtime, npm product or source-install fallback. A native source checkout selects
`rust/target/debug/tmt` (or an explicitly supplied native executable); a missing
native build is an error. No test, script, or installer may silently execute an
installed host `tmt` or a retired TypeScript product implementation. Node may
run explicit developer fixtures and verifiers, never serve as a product fallback.

Published releases are immutable. Source changes do not publish replacements
or migrate application data.
TMT remains an invocation-owned local CLI, without a remote MCP server, identity
memory or a separate inbox service. The one MCP server it ships is the hidden
`__channel-server`, a stdio server that an opted-in Claude launch starts as its own
child; it listens on no network port.

`better-sqlite3` is a private tooling oracle, never a Rust dependency or native state owner.

## Repository layout

Infra reviews the [layout map/allowlist](.github/repository-layout.json).
[Component ownership](.github/components.json) is separate.

Rust owns the shipped runtime; `typescript/` owns developer tooling/tests and
fixtures. `extensions/` and `drivers/` own their products; `contracts/` owns normative
interfaces. Root files are entry points/configuration; `.github/` owns automation
and maps, `scripts/` shared development helpers, `skills/` bundled guidance and
`.agents/` contributor skills. Provider workspace metadata belongs in its declared
root. `site/` owns publishing sources and `design/` shared visual sources, not Core
behavior. The layout allowlist admits homes, not dependency or release authority.

### Area architecture locations

| Area                                 | Owning skill or guide                                        |
| ------------------------------------ | ------------------------------------------------------------ |
| Core, identity, storage, drivers     | [tmt-core-runtime](.agents/skills/tmt-core-runtime/SKILL.md) |
| Native installation, release, CI     | [tmt-release](.agents/skills/tmt-release/SKILL.md)           |
| Test boundaries and fixtures         | [tmt-e2e](.agents/skills/tmt-e2e/SKILL.md)                   |
| Developer tooling and verification   | [tmt-dev](.agents/skills/tmt-dev/SKILL.md)                   |
| Remote transport and object backends | [tmt-remote](.agents/skills/tmt-remote/SKILL.md)             |
| Colab app, content and decoder       | [tmt-colab](.agents/skills/tmt-colab/SKILL.md)               |
| Ops board and workers                | [tmt-ops-dev](.agents/skills/tmt-ops-dev/SKILL.md)           |
| Terminal presentation                | [tmt-tui](.agents/skills/tmt-tui/SKILL.md)                   |
| Browser UI and design sources        | [tmt-design](.agents/skills/tmt-design/SKILL.md)             |
| Blog and handbook prose              | [site/README.md](site/README.md)                             |

New homes or exceptions need infra review and coordinated map/allowlist changes; ignored outputs
are outside the tracked-file map. The [layout skill](.agents/skills/tmt-layout/SKILL.md)
owns moves and the tracked-file guard.

`design/tokens/tokens.json` owns shared tokens; `@tmt/browser-ui` is the shared
component library. Products consume generated output, never copied implementations.
GUI owns the [leaf boundaries and regeneration](design/browser-ui/README.md).
[Release procedures](.agents/skills/tmt-release/SKILL.md) include the archive’s
product-neutral `rust/archive/NATIVE-INSTALL.md`; [dev-only embed](site/README.md) stays site-owned.

## Public blog boundary

`site/src/blog/` builds `site/src/posts/`; the shared Pages workflow uploads only
the verified blog artifact. [site/README.md](site/README.md#blog) owns content,
approval and publishing procedures; Marketing maintains them.

## TypeScript workspace boundary

The `typescript` pnpm workspace owns private developer tooling, fixtures and
browser packages, not a second shipped CLI. Packages resolve declared dependencies
rather than root-hoisted tooling. Runtime contracts and canonical skills retain
their product owners; site tooling keeps its separate lockfile.

### CI selection and worker model

[The component map](.github/components.json) is the single owner of path ownership
and consumer selection. CI selection, binary consumption, version inheritance and
release activation are distinct contracts; registration grants no publication
authority. The [release skill's CI reference](.agents/skills/tmt-release/references/ci-selection.md)
owns map fields, selection, workers, caches, toolchains and advisory lanes.

Selected missing, failed, cancelled or unexpectedly skipped work and empty discovery
cannot satisfy required gates. Publication reuses the native aggregate's scope-skip
proof with check-suite provenance, never recomputed selection or bare skips.

## Runtime layers

Core is three layers with one dependency direction: `tmt-core` (pure domain) →
`tmt-adapters` (effects) → `tmt-cli` (application). Shared crates sit beside them;
`tmt-sys` is the single audited `unsafe` boundary. Extensions reach Core only through the
public contracts below. The [architecture guard](rust/crates/tmt-cli/tests/architecture.rs)
enforces the dependency rules; [runtime layers](.agents/skills/tmt-core-runtime/references/runtime-layers.md)
owns each layer's and crate's responsibilities.

## Public command boundary

Core's grammar owns the command names and reserves them before external dispatch.
Extensions reach Core through four public interfaces, each owned by its contract:
external `tmt-<name>` commands, the local [extension API](contracts/extension-api.md),
local [MCP](contracts/mcp-v1.md) and [lifecycle hooks](contracts/extension-api.md#lifecycle-hooks).
The [extension surface reference](.agents/skills/tmt-core-runtime/references/extension-surface.md)
owns their module rules and the Core command surface.

Files under `contracts/` are Core contracts owned by tmt-lead, except the channel
contracts #606 assigns to a squad (`remote-channel-v1.md`: tmt-remote);
`extensions/<ext>/contracts/` belongs to the squad that owns `<ext>`.
A contract is the single definition owner: guides and skills link to it and never
restate it. The directory listing is the contract index.

## Domain and state ownership

Core's SQLite store owns identities, bindings, requests and finals, jobs and
orchestration; one adapter holds the connection and every write goes through a Core
service. An extension owns only its `<dataRoot>/<extension>` area and its disposable
caches, reaches Core state through the public interfaces above, and never writes Core
storage. User-owned configuration is changed only by the person or by a consented,
compare-and-swap Core command, never by an agent directly. Delivery is uncertain once
input may have reached a terminal, and uncertainty never authorizes replay.

Digest owns its holds, history, price file and valuation. It reaches Core through
`tmt tick`, Digest hooks and Core's usage rollup; Core owns delivery acceptance
and identity state.

The tmt-core-runtime references own each area's module rules:
[identities, names and bindings](.agents/skills/tmt-core-runtime/references/identity-bindings.md#ownership-overview),
[storage, requests and configuration](.agents/skills/tmt-core-runtime/references/requests-storage.md#ownership-overview),
[hosts, drivers and channels](.agents/skills/tmt-core-runtime/references/hosts-drivers.md#ownership-overview)
and [managed skills and native installation](.agents/skills/tmt-core-runtime/references/install-architecture.md#ownership-overview).
Test evidence boundaries are in the [E2E reference](.agents/skills/tmt-e2e/references/test-boundaries.md#evidence-boundaries).

## Ops extension

Ops reaches Core through public JSON, the extension API, `tmt tick` and public
host templates, never private Core, host or provider state. There are no Core/Ops
Cargo or source dependencies. Core owns identity handoff, verified stop/remove,
rooms and orchestration authority; Digest owns its delivery, locks and deadlines.
Ops owns its extension data and disposable caches, not Core storage or the user's
configuration. New public APIs need Core review.

Board paint and input perform no I/O; workers own acquisition and effects.
Design-system components are pure role grids in `tmt-tui-components`; renderers sit only at the edges.
`tmt-tui` is an application-neutral presentation leaf: it acquires no terminal,
clock, persistence or provider data and has no reverse product dependency.
Applications own their data, effects and terminal lifecycle.

The [Ops skill](.agents/skills/tmt-ops-dev/SKILL.md) owns workspace, discovery,
checklist and worker mechanics; [tmt-tui](.agents/skills/tmt-tui/SKILL.md) owns the
drawing pipeline and parity checks. The [embedded Ops skill](extensions/tmt-ops/skills/tmt-ops/SKILL.md)
owns user-facing commands and JSON; row-shape changes update it and its native
regression together.

## Release boundary

Release tooling shares native runtime/linkage proof across cargo-dist archives,
installers, upgrades and public smoke. Generated extension minima cover product
registration and declaration support; cut metadata freezes the published CLI.
Raw binaries prove neither archives nor public installs. [Handoffs](contracts/native-install-handoff-v1.md)
and [records](contracts/release-index-v1.md) bind release bytes to identity.
Archive, installer, verifier, publication, compiled schema and PR producer/cleanup sources belong to [tmt-release](.agents/skills/tmt-release/SKILL.md).

### Main release cuts

A release is a product-prefixed tag on a main commit. `release.yml` admits main
pushes by cadence, with hourly backup and manual dispatch. Each allocated tag owns an
independent pipeline; allocation, failed-draft replacement and predecessor history are in
the [main-cut reference](.agents/skills/tmt-release/references/main-cuts.md#cut-allocation).

Build-time version injection belongs to the [main-cut reference](.agents/skills/tmt-release/references/main-cuts.md#cut-and-source-tooling).

Notes, migration comparison and breaking authorization share the newest published
ancestor. Drafts never advance published evidence. Tags become immutable after all gates
pass; only the CLI converges latest to its highest publication.

The [release skill](.agents/skills/tmt-release/SKILL.md#main-cut-authorization) owns publication authorization and product activation; the [main-cut reference](.agents/skills/tmt-release/references/main-cuts.md#publication-gates-and-recovery) owns gates and recovery.

[Release reconciliation](.agents/skills/tmt-release/SKILL.md#project-release-reconciliation) separates delivery from publication; [development procedures](.agents/skills/tmt-dev/references/development.md#project-tracking) define issue lifecycle.

## Maintenance contract

Update this map in the same change when responsibility, dependency direction,
command/error contracts, storage schema or lifecycle, trust boundaries,
resource ownership, shared test infrastructure or release evidence changes.
Keep a significant decision's alternatives, failure behavior and verification
plan in its issue and reflect the delivered boundary here. A green formatter or
checkmark is not architecture evidence.

This file keeps owner maps, dependency direction and cross-cutting invariants, within
the line and byte budgets `typescript/test/tooling/guide-budget.test.ts` enforces. Module-level
rules belong in the owning area skill (`.agents/skills/tmt-core-runtime` for core); a
line that only explains one module's code goes there, not here.

Every change reports its architecture impact and names the affected Rust owner,
adapter, CLI composition and tests. New policy belongs in the existing owner;
do not add a parallel TypeScript implementation, provider inventory, config path
registry, release catalog, process runner, archive parser or memory/MCP layer.

## Remote extension

`extensions/tmt-remote` owns the Remote door, its browser SDK and `<dataRoot>/remote/`.
Behavior: [channel contract](contracts/remote-channel-v1.md) and
[message v1](contracts/remote-message-v1.md); structure:
[tmt-remote architecture](.agents/skills/tmt-remote/references/architecture.md).

- **Core.** Core distrusts Remote. Remote calls only public Core JSON through the absolute
  `TMT_EXECUTABLE`/`tmt-invoke`. `talk --remote` reaches the serving owner, which dispatches
  to Core under the same ID; finals are receipt-bound Core `reply`s.
- **Extensions.** Only Remote's public CLI, browser SDK and `tmt-extension-objects`; no
  private Remote state.
- **Colab.** Owner-installed at `/r/<prefix>/x/colab/`; see [Colab](#colab-extension).
- **State leaf.** `rust/crates/tmt-extension-state` is a library leaf consumed by Remote,
  Colab, Ops, adapters' config/hook consent and Digest history. It has no TMT or crypto
  dependency; Core and Colab's model cannot consume it.

## Colab extension

Colab is an app on Remote, mounted through its owner-only socket. Remote owns the
door, Host/Origin checks, pairing and grants; Colab owns content admission and
sealing. Colab reaches Core and Remote only through their public interfaces, with
no private Core or Remote crate or state dependency. The native architecture guard
enforces these dependency and decoder boundaries.

Trusted parent chrome admits discussion and sends. Author HTML runs in an opaque
sandbox frame; its messages are cosmetic claims, never authority. Parent scripts
and styles are self-hosted. The frame's policy denies network access, but author
self-navigation can still leak a request. Only the isolated native decoder child
parses Yjs. No browser route serves plaintext except owner-only local page titles;
the browser Worker provides resource containment, not a security sandbox.

The [Colab contract](extensions/tmt-colab/contracts/colab-v1.md) owns behavior and
hosted packaging. The [Colab skill](.agents/skills/tmt-colab/SKILL.md) routes module,
content, attachment, design-system and verification details. Shared visual sources
remain owned by [tmt-design](.agents/skills/tmt-design/SKILL.md).
