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

The `typescript` pnpm workspace owns private Node tooling/tests and one lockfile,
with parent-relative packages for the parked browser-addon shell, Remote client SDK,
and Colab browser/client packages. Packages resolve declared dependencies, never
root-hoisted tooling; browser specs reach the tooling SQLite oracle through
`typescript/test/support`. Rust, root launchers, core contracts and canonical
skills stay outside this boundary; extension contracts stay with their product.

Vite+ supplies one Vitest runner, aliased Vite core and bundled Oxfmt/Oxlint.
Packages retain their separate configs, plugins, formatter selections and warning
policies. `typescript/scripts/format-workspace.mjs` owns root code/docs selections;
`lint-config.mjs` owns shared lint rules. Compiler commands retain their owners;
site and release tooling stay outside this lockfile.

### CI selection and worker model

`.github/actions/setup-firebase-tools` owns the isolated npm lockfile and shared
installation for hosted Firebase emulator tools, outside the pnpm workspace. The
[CI reference](.agents/skills/tmt-release/references/ci-selection.md) owns its consumers.

[`.github/components.json`](.github/components.json) is the one component map:
`owns`/`excludes` define path roots, `selectedBy` overrides ownership for scattered
files, and ordered rules select CI consumers independently. `release:false`
excludes a component from automatic cuts/publication. Only non-released components
may declare `releaseStatus:never` (never shipped) or `releaseStatus:parked`
(explicitly deferred); absence means awaiting activation. `releaseConsumers` names
packaged consumers of private components. Registration alone never authorizes activation.

`typescript/scripts/ci-scope.mjs` owns map validation, path ownership, conservative
CI selection and final gate validation. Its `releasedComponentsForPath` is the
shared release-attribution owner: released roots plus each binary's transitive
Cargo normal/build workspace dependencies; dev edges do not count. Explicit
private non-Rust consumers are additive. `cargo-workspace.mjs` supplies resolved
Cargo metadata; version inheritance/editing has its own private release-tool owner.
CI scope, ownership, binary consumption and version inheritance are separate contracts.

Project-only never-shipped path declarations and their CI-only admission guard are defined in the
[release-tracking reference](.agents/skills/tmt-release/references/native-release.md#project-release-tracking).

Selected missing, failed, cancelled or unexpectedly skipped work and empty discovery
cannot satisfy required gates; selection, worker, cache and advisory-browser details live in the
[CI reference](.agents/skills/tmt-release/references/ci-selection.md) and PR-title gates in the
[release reference](.agents/skills/tmt-release/references/native-release.md#conventional-pr-titles).
Publication reuses the native aggregate's scope-skip proof with check-suite provenance, not
recomputed selection or bare skips.

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

## Domain and state ownership

## Managed skills and native installation

Managed agent guidance is a filesystem concern separate from application state.
`tmt_core::skill_catalog` is the one list of bundled skill names and reference topics; the
bundle is embedded and materialized by digest under `skill_installation` (references are
embedded only, served by `tmt learn`, never installed), and the
architecture test rejects duplicate multi-name lists in production Rust. Core install exposes
only `tmt` and `tmt-inbox`.
Skill installation never opens configuration, SQLite or tmux. Retired bundles, catalog
publication, removal and refresh/uninstall preservation follow the [installer owner](.agents/skills/tmt-core-runtime/references/install-architecture.md#managed-skills).
Extension-owned skills arrive as bytes through `skills.install`/`skills.remove`
(explicit consent) and link into the same roots; core names are reserved, and an API
name or owner alone cannot authorize catalog replacement. Name ownership, force
backups and post-activation skill warnings follow the same installer owner.

Native executable installation is a different owner under `tmt-adapters::native_install`.
Its cosmetic pane-option cutover performs host CAS outside SQLite, between short row checks.
`Product` owns installable products; archive data adds none. Every product uses one acquisition,
receipt and atomic-publication path with independent links, lock and current
release, and the active executable is the authority for a managed update: receipts
anchor to the installation prefix, not to configuration roots. Verification precedes
execution, publication runs the release verifier before the receipt so a rejection
keeps the previous release, and failure or cancellation never leaves a half-published
current release. CLI self-upgrade delegates to the verified candidate under the
[handoff contract](contracts/native-install-handoff-v1.md); PR channel trust,
compiled schema export and admission are owned by the [PR channel contract](contracts/native-pr-channel.md). The candidate then lets that CLI
run the consented extension phase; there is no rollback or second installer.
`install_guidance` projects setup's verified inventory as public
[`guidance.actions`](contracts/extension-api.md#installation-guidance-through-the-ordinary-cli);
PATH only resolves commands.
Receipt-frozen [CLI minima](contracts/extension-api.md#optional-cross-extension-uses) gate activation; listing compares locally.
[Installer architecture](.agents/skills/tmt-core-runtime/references/install-architecture.md) owns retention,
discovery, receipts, skills, repair and handoff; [release procedures](.agents/skills/tmt-release/SKILL.md) own verification and publication.

## Ops extension

`extensions/tmt-ops/rust/tmt-ops` builds optional `tmt-ops`, dispatched as `tmt ops`.
`ui`, `hotkeys`, `skill` and `playbook` are Ops commands; member/state commands
use `squad` (alias `sq`). Releases use `tmt-ops-v<version>`.
[Ops](.agents/skills/tmt-ops-dev/SKILL.md) and [TUI](.agents/skills/tmt-tui/SKILL.md)
own module/drawing boundaries and verification.

- **Seam.** Ops uses public JSON/API, `tmt tick` and
  [`host templates`](contracts/driver-protocol-v1.md#launch-templates) via
  `TMT_EXECUTABLE` (else PATH), bounded by `tmt-invoke`. `board/host_launch`
  prepares/rechecks frozen argv for New member (new UUID before join)
  and Switch tool (same UUID, requested running driver). Core owns
  handoff and the verified stop/remove guard (`tmt-adapters::verified_stop`, shared by
  the CLI and `identity.stop`/`identity.remove`). Ops uses that API for confirmed
  close/delete, never private Core/host/provider state. Digest owns
  locks/deadlines/delivery. No Core/Ops Cargo/source edges. tmt-lead reviews new APIs.
  Leaves: `tmt-tui`, `tmt-cli-style`, `tmt-invoke`, `tmt-extension-state`, `tmt-job-calendar`,
  `tmt-pty-protocol` (a built-in host's terminal-stream frames); dev-only `tmt-test-support`.
  Each UI shares separate lazy API sessions for background and interaction workers,
  with worker-only I/O and no uncertain-request replay; the Digest tick opens one per minute.
  The refresh owner admits bounded retained projections through successful cursors
  and local stamps; independent clocks and action admission stay fresh.
- **Data.** Squads are Core rooms `squad-<name>`; fields are identity metadata
  `squad.<name>.<field>`, with no Ops membership store. Ops owns `<dataRoot>/ops`
  (`storage.root`) and disposable `$XDG_CACHE_HOME/tmt-ops` caches. Retired
  `cache/board` files stay untouched. `ops.toml` is user-owned: agents never write it;
  Ops uses CAS; checklists and legacy jobs live in
  [`ops.db`](.agents/skills/tmt-ops-dev/references/data-and-state.md#ops-state-database).
  Core owns jobs/runs; Ops imports legacy ones once.
  `migration` owns locked byte-preserving cutover; CLI warns once, UI paints notices through App.
  No Ops config/checklist data enters `config.json` or Core storage.
  Confirmed lead changes separately offer the global squad-lead union through Core's
  orchestration preview/consent/CAS; Core owns that list and its permission checks.
- **Workspace.** Agents/Digest share one acquired roster ([workspace](.agents/skills/tmt-ops-dev/references/board.md#workspace-and-retained-identity)); the flat Agents list caches canonical all-agent projections, while tree projections are frame-scoped.
  Paint/input do no Core reads; WP1 owns conversation/editor/drafts. UUID selection, the virtual Common pool, membership pause/Resume and squad rename belong to the [surface](.agents/skills/tmt-ops-dev/references/board-home.md) and [cron](.agents/skills/tmt-ops-dev/references/board-cron.md) references.
  Per-name view state stays in the disposable Ops cache, apart from shared Config preferences. Lifecycles and the HOME usage receipt: [refresh worker](.agents/skills/tmt-ops-dev/references/refresh-and-meter.md#refresh-worker).
  Savings and usage figures are supplier estimates, never provider history; [Ops acquisition](.agents/skills/tmt-ops-dev/references/refresh-and-meter.md) owns their readers, valuation and lifecycles.
  Member references resolve through the acquired global identity inventory and grant no delivery authority or paint/input I/O ([reference ownership](.agents/skills/tmt-ops-dev/references/board-notebooks.md)).
- **Board rendering.** The [Ops board guide](.agents/skills/tmt-ops-dev/references/board-home.md#shared-board-components) owns shared painter responsibilities and their host adapters.
- **Discovery.** The board consumes [Core discovery
  v1](contracts/discovery-v1.md) through finite public `discover` and guarded
  `add` commands on its existing ordered lane. Its private controller owns
  explicit review, bounded scan generations and retained per-item outcomes;
  paint/input perform no discovery I/O. Core retains native/digest/identity
  authority, acquisition limits and binding effects. Successful public refresh
  selects the returned UUID through the workspace projection.
- **Checklist.** `checklist_command` uses the existing caller/room admission and
  versioned room-UUID JSON in `ops.db`, with a mutation log committed in the same transaction. Reads create no files;
  failed prepublication preserves bytes; uncertainty remains Unknown after
  readback. The board consumes the same typed service.
- **Contracts.** The [embedded skill](extensions/tmt-ops/skills/tmt-ops/SKILL.md)
  owns `sq ls`, `config`, `checklist` and `cron` JSON; native `ops.test.ts` verifies
  them. Row JSON changes update that skill and its native regression in the same
  PR. The Ops developer references own worker fences, cache/timing fields,
  Core-owned Digest policy and independent CLI display projections.

## Testing and evidence boundaries

Rust tests stay owner-local. TypeScript suites share `test/support`, which imports
no suite. Native/E2E import neither each other nor tooling. Scenarios own assertions;
support owns fixtures and scripted loopback models, never provider launch.
Frozen inputs and independent SQL/schema oracles cannot derive expectations from
the implementation under test.

State, provider roots, prefixes, sockets and processes remain fixture-owned.
Adapters' default-off `test-isolation` feature admits private discovery paths in consumer test builds.
`typescript/scripts/private-world.mjs` runs suite commands in a private HOME/XDG/TMPDIR world
(under `/tmp` when the temporary directory is too long for sockets) and reports what they leave behind; Ops test builds resolve their cache to a process-private root.
Native fixtures isolate ancestry and tmux discovery; Docker owns isolated tmux
and peers. The E2E run lifecycle owns registered fixture cleanup at suite end
and on catchable main-process signals. Host tmux, provider installs and global environment
mutation are not evidence.

Cleanup confirms owned child/group absence before deleting fixture state;
unknown inspection, leaks and false positives fail. Signals target only verified
owned processes. Runtime tests prove CLI behavior, Docker proves transport and
lifecycle, and release tooling proves actual archives and public installation;
one layer's success cannot substitute for another's evidence.

Helper ownership, fixture publication and lifecycle details live in the
[E2E references](.agents/skills/tmt-e2e/references/test-boundaries.md); shared
commands remain in [DEVELOPMENT](.agents/skills/tmt-dev/references/development.md#native-process-and-shared-tests).

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

[Release reconciliation](.agents/skills/tmt-release/SKILL.md#project-release-reconciliation) separates delivery from publication; [DEVELOPMENT](.agents/skills/tmt-dev/references/development.md#project-tracking) owns issue lifecycle.

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

Colab (`extensions/tmt-colab/`: `tmt-colab`, `tmt-colab-model`, `@tmt/colab-client`,
`@tmt/colab-app`) embeds its app and skill; the opt-in archive installer uses `skills/`.
`tmt colab skill` reads embedded bytes without core or storage.
[colab-v1](extensions/tmt-colab/contracts/colab-v1.md) owns behavior and hosted packaging;
the [development skill](.agents/skills/tmt-colab/SKILL.md) owns modules and checks.
Hosted links reuse Remote's SDK, joined interests and Colab admission/own sealing.

- **Layer.** Colab is an app on Remote with no door of its own. `tmt-colab serve`
  listens only on the owner-only socket `<dataRoot>/colab/door.sock`. Remote mounts it at
  `/r/<prefix>/x/colab/`, owns Host/Origin, cookies, pairing and grants, forwards the
  verified device as `tmt-device-context`, and never forwards the reserved `/.tmt/` subtree
  from a browser. Public short entries bootstrap from validated `tmt-mount` without device context;
  Colab resolves page prefixes from its verified catalog; reader seeds stay in fragments.
  It stores ciphertext, never decodes Yjs ([sync rules](.agents/skills/tmt-colab/references/architecture-sync-decoder.md#stream-sync)).
- **Dependency direction.** `tmt-colab` depends on `tmt-colab-model` (pure codecs and fixed
  crypto), `tmt-extension-state`, `-objects`, `-serve` and `tmt-invoke`/`tmt-cli-style`; the browser
  depends on Remote's served SDK (`/sdk/remote-v1.js`). Never `tmt-core`, `tmt-adapters`,
  `tmt-remote`; core is reached through `$TMT_EXECUTABLE api` and bounded public
  `identity show`/`ls --json` reads (display, routing, advisory edit locks).
  The architecture guard enforces this set, that only `tmt-colab` consumes the model and `html5ever`,
  and that only `decoder/child.rs` imports `yrs`. User-template copies use parser-owned ranges and refuse changed templates before creation.
- **Seams.** With Remote: the mount socket, `tmt-device-context`, the device-events callback
  and the browser SDK; the Ask agent sends through Remote's SDK operations helper as the
  paired owner device, with no native bridge, ledger or migration, and the read-only Agents view
  stays within the [observation boundary](.agents/skills/tmt-colab/references/ask-agent.md).
  After a Remote restart, Colab's public recovery entry reopens the paired device's session once,
  through the same tab claim; all other app assets stay owner-gated. With core: `Product::Colab` registers
  the executable with the installer, and the app is served from `serve --app-dir`, else
  bytes embedded from `TMT_COLAB_APP_DIR`, else the checkout's Vite output.
  Colab owns the mounted browser app, including trusted recovery and archived reads ([browser contract](extensions/tmt-colab/contracts/colab-v1.md#implemented-mounted-browser-assets-1253)).
  Inline question blocks reserve measured in-flow space; thread-reference activation is admitted
  against the parent's authenticated thread projection ([contract](extensions/tmt-colab/contracts/colab-v1.md#own-stream-discussion-records-1427)).
  `tmt colab serve` attaches to a running door, else starts a supervised one it alone stops.
  Colab reaches Remote only through its public CLI: no state files, no crate dependency. Serves follow verified current releases ([cutoff and door ownership](.agents/skills/tmt-colab/references/architecture-state.md)).
- **Message editing.** Rich input and MessageComposer follow the [editing boundary](.agents/skills/tmt-colab/references/architecture-state.md#message-editing-boundary): the editor grants no dispatch authority; Send records one comment and one Ask per distinct visible mention.
- **Design systems.** `tmt:design-system` holds config, components and releases. Design draws the shipped built-in GUI; `design/systems/compiler.mjs` checks bundles. Pages follow drafts or lock releases. Runtime 4 allows declared browser-ui parts; live page lists stay in parent chrome. Work-bundle data needs proven owner-only authorship; unproven baselines fail closed. Mockups use sized scopes; `tmt colab design` reads only.
- **Renderer invariant.** Parent chrome allows only self-hosted scripts and styles (no
  `unsafe-inline`). Author HTML runs only in `renderer.html` inside an opaque
  `sandbox allow-scripts` frame whose own policy permits inline scripts and styles but no
  network. Everything the frame reports is a cosmetic claim; only parent controls admit
  discussion or sends ([highlights](.agents/skills/tmt-colab/references/discussion.md), [slots and theme](.agents/skills/tmt-colab/references/page-chrome.md)).
  This contains author code; page self-navigation can still leak a request.
- **Attachments.** [Grammar](extensions/tmt-colab/contracts/attachment-v1.md) and [staging](extensions/tmt-colab/contracts/colab-v1.md#native-attach-command-2291) use crypto, authenticated cuts, fold metadata and Saves.
  The mount-owned object adapter joins generation-scoped callbacks, original uploads, committed reads and detached history; root-local reads need an established channel.
  Remote owns backend/quota/origin; Colab owns crypto/admission and [removal of unreferenced objects](extensions/tmt-colab/contracts/colab-v1.md#unreferenced-attachments-5284). Remote declares Colab Local; snapshot/retained-reference persistence remains planned in the [storage proposal](extensions/tmt-colab/contracts/storage-v1-proposal.md).
- **Firestore admission.** Hidden `tmt colab deploy-declaration --json`; the [declaration subsection](extensions/tmt-colab/contracts/colab-v1.md#firestore-deployment-declaration) owns admission and codecs. Hosted folds verify log anchors before checkpoint pairs. ([native opening](.agents/skills/tmt-colab/references/architecture-state.md#native-opening-and-admission))
- **Plaintext.** Source, shell, discussion reads and export are root-local: only the isolated decoder
  child decodes Yjs, no browser route serves plaintext (bar owner-only local titles in `/api/pages`; [detail](.agents/skills/tmt-colab/references/architecture-state.md#native-opening-and-admission)), and the Worker is resource
  containment, not a security sandbox. Native code stores content and `kind:"own"` actions signed by the root-local writer under the [publication](extensions/tmt-colab/contracts/colab-v1.md#content-publication-1908-1928-1934) fences; [editor metadata requests](extensions/tmt-colab/contracts/colab-v1.md#editor-metadata-requests-5195-a-5256) pass automatic owner admission and preserve root-local content authority. Per-action [routing](.agents/skills/tmt-colab/references/architecture-sync-decoder.md#page-source-and-export) is in the sync reference.
