# CI selection and workers

The [component-map contract](../../../../ARCHITECTURE.md#ci-selection-and-worker-model)
keeps path ownership, CI selection and release attribution distinct. Read
`typescript/scripts/ci-scope.mjs`, `.github/components.json` and the affected
workflow before changing selection or a gate. Required checks remain `Code quality`,
`Unit tests`, `Docker E2E` and `Native package matrix`; selected missing, failed,
cancelled or unexpectedly skipped jobs fail closed. Never accept empty test discovery.
The publication commit gate accepts scope-skipped `Unit tests` only with the latest
successful `Native package matrix` from the same GitHub Actions suite, completed
no earlier than that skip; the aggregate validates its selection. The other required
contexts must succeed. Held-draft recovery belongs to
[main cuts](main-cuts.md#publication-gates-and-recovery).

Code quality checks local relative-link targets in tracked Markdown outside `site/`,
excluding fences, inline code and HTML comments; it does not fetch URLs or validate anchors.

## Tooling workspace and component map

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

[`.github/components.json`](../../../../.github/components.json) is the one component map:
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

## Diff and scope selection

- PRs use the merge-base diff. Merge groups use the common ancestor of fetched
  `origin/main` and `merge_group.head_sha` through the queue head, covering every
  pending change; the event's `base_sha` is insufficient. Fetch full history:
  missing objects cannot yield a passing empty selection. Include deletions and
  both sides of renames.
- Ordered component-map rules select native work. Shared, unknown or unreadable
  inputs retain full verification; prose without build/runtime consumers selects
  only Code quality. Selection covers every path, recording owner, rule, selection
  and map digest; summaries detail the first 100 paths and group the rest by rule/count.
- Scope is `ops` only when every native-selecting path is Ops-owned: retain its
  Cargo checks, architecture guard, native tests and E2E under existing names;
  skip unchanged CLI builds, packed installs and tooling unit tests. Shared,
  CLI-owned or unknown native inputs require full scope.
- Colab browser source/test/spec trees select Code quality, browser lanes and the gating
  `colab-chrome` job without the full native gate.
  Native chrome CSS, hosted-build inputs, entry/build/config, public assets,
  vectors, native skills and unknown inputs retain full verification. Unconditional
  app quality/build checks the renderer-style generator; browser selectors are independent.
- Colab `contracts/colab-v1.md` prose selects Code quality, whose app unit tests
  check shipped-skill error codes; native jobs do not read it. Contract vectors
  and unknown contract paths retain full scope.
- Workspace Rust checks retain every member, without retired product exclusions
  or producers. Reject empty Remote discovery before execution.

The required `Unit tests` context collects three parallel consumers. Retained
tooling uses four Vitest workers in CI; local runs keep two. The shell project
contains the onboarding contracts and alone installs zsh. Both projects use one
source-file inventory; the collector requires their successful results and a
SHA/run-bound report whose file/test/status identities exactly equal the declarations
captured before each module executes, including expanded parameterized cases and
declared skips. The reporter uses the ordinary test run, without a second collection pass. Skips are
reported separately from passed coverage. Run-scoped artifacts are overwritten by
reruns, so successful unchanged-head consumers can be reused.

Remote and Colab Rules emulators run in the selected Rules consumer, requiring
full scope. The collector requires it only when either Rules flag is true.
`remote_firestore` covers Remote's suite, fixtures, `rules.rs` or
`ci.yml`; `colab_firestore` covers Colab's `firestore/`, `deploy-declaration-*`
vectors, emulator suite or `ci.yml`. The [workflow](../../../../.github/workflows/ci.yml)
owns Java/Node pins. All hosted Firebase CLI consumers use the
[locked installer](../../../../.github/actions/setup-firebase-tools/action.yml): one isolated
`package-lock.json`, `npm ci --ignore-scripts`, and its local `firebase` binary on PATH;
no global or floating install. Installer changes select Remote Rules, native sync and hosted-reader proofs. Remote uses hosted Temurin; Colab's digest-pinned
image uses the same pins, `--rm --init --network none`, a read-only extension mount
and no credentials. Both fail closed within step bounds, without retries or cache.

[Remote squads emulator qualifier](../../../../.github/workflows/remote-squads-emulator.yml)
is advisory and outside required aggregates: PRs and main pushes touching Remote Rust,
the workflow, shared Firebase installer, its script, `rust/Cargo.toml` or `rust/Cargo.lock` run
[the qualifier script](../../../../typescript/scripts/remote-squads-qualifier.mjs). It reads
the Remote squads README command at run time, because Remote's emulator guard keeps the
default-off feature out of `.github/`. It runs against loopback Auth and Firestore emulators
with the same pins and compiles first, so the qualifier step stays bounded at 10 minutes.

## Worker gates

`Native Rust contracts` aggregates fmt/Clippy, workspace test/build, native process
and MSRV. In the full scope, the Clippy worker also lints every tmt-remote target with
the default-off emulator feature through
[the Remote emulator lint script](../../../../typescript/scripts/remote-emulator-lint.mjs),
so a stale caller in a feature-gated test fails a required check. It compiles only,
with no emulator, credential or account, and the guard keeps the flag out of `.github/`.
MSRV reads `rust/Cargo.toml` and checks every retained package target; process
verification discovers every retained suite without a product blacklist.
Full/Ops scopes require every selected worker; `none` skips the aggregate. Invalid
scope, missing/extra results, failure or unexpected skips fail closed; names stay stable.

The [apt action](../../../../.github/actions/apt-install/action.yml) allows three
attempts for each network phase (60 s update, 120 s `--download-only`) with 10 s
termination grace and 5/10 s backoff. It then unpacks and configures from the
downloaded files (`--no-download`) in two 240 s attempts; before the second, it runs
`dpkg --configure -a`, so the retry starts from a repaired dpkg state. After the first
timeout of either network phase, only Azure is removed from the verified runner-image
mirror list for remaining attempts; unexpected layouts are logged and unchanged.
Native-process contracts retain a 20-minute job limit and unchanged test deadlines.

`Native process contracts` gates one `Native process build` and two `Native process
shard` jobs (#3836). The build compiles every process fixture once, including the
synthetic alpha, and uploads the executables as one zstd tar; the shards download it
and never compile. `typescript/scripts/native-shards.mjs` splits the serial suite
with the `e2e-shards.mjs` algorithm and `typescript/scripts/native-shard-weights.json`;
a guard rejects a native test file in no shard or two. Full scope requires all three,
a scoped component that names native tests requires the build and shard 1 with shard 2
skipped, and anything else fails (`ci-scope.mjs gate-process`).

The process build also runs seconds-scale source runtime contracts for changed Remote
and Colab paths (#6052). Remote checks the built debug executable's help with the
archive proof's command expectations; Colab checks source skills with the same
reference collector and name validation as the archive proof. These checks do not
select additional packaging rehearsals or replace matching-host archive verification.

`Docker E2E` gates shards from `typescript/scripts/e2e-shards.mjs` and committed
`test/e2e/shard-weights.json`: full scope requires both (shard 1 also runs the pinned
adapter environment slice), component scope requires shard 1 when its `scopedChecks.e2eFiles`
names files and neither for an explicit empty list (the job skips on an empty file list, which
the harness would read as every file), and no native selection requires neither.
A component scope applies only when every native path it changes matches a map rule; an
unmapped path keeps full scope. Its required `scopedChecks.unitTests` keeps the Linux
runtime builds and Unit tests when true; a missing or non-boolean value rejects the map.
Vitest and the splitter discover identical retained files; the guard rejects zero
or double membership. Pinned Node runs the built-in-only wrapper on the host;
pnpm activation/frozen install belong to the image. Only the hosted `ubuntu-latest`
mirror builder uses `cleanup: false` and job-VM disposal; fallback/persistent
runners retain default cleanup.

`Native package matrix` requires every selected native result. Its event-derived
`macos` flag is false for pull requests and merge groups, where both macOS build/smoke
results must be exactly skipped, so no required check waits on macOS (#2547). Linux
stays required. macOS coverage moved after merge: the admitted main push and weekly
schedule run both macOS runtime builds and packed installs; each main push also triggers
`release-rehearsal.yml` for the products it selects, in its own workflow so main verification
never waits on macOS, whose prepare stages build, verify and upgrade-prove both Darwin targets; `release-version-injection.yml` runs its macOS hosts on main push and
daily (PRs run Linux only); and every release's `native-release-prepare.yml` assembles and
proves all four targets before any publish. A macOS-only break is found after merge and
fixed forward. The [runtime smoke matrix](../../tmt-e2e/references/runtime-smoke-matrix.md)
owns Rosetta wrapping, installed-byte architecture admission and advisory Intel coverage.

`Code quality` verifies the private browser leaf with frozen, lifecycle-script-free
installation and nonempty filtered CSS-equality/type/lint/format/package checks.
Its import guard confines production to the leaf and excludes React from the static
entry. The component rule keeps full native scope; this is not product adoption
or broader advisory browser coverage. E2E/artifacts prepare checked CSS; all three native
stages retain the actual Rust embedded-input guard.

`colab-chrome` runs `e2e/chrome.spec.ts` against the native fallback chrome. `colab_chrome`
selects app-suite inputs, `ci.yml`, or `chrome.rs`, `socket.rs`, `assets.rs` and
`tests/socket.rs`, in PR, merge-group and main-full runs. The job builds the `tmt-colab`
`socket` test fixture, sets `COLAB_CHROME_REQUIRED=1` (a missing fixture fails, never skips)
and applies the complete-listed-case guard (`colab-native-spec-report.mjs`) with one worker
and no retries. `Native package matrix` requires it: selected means success, unselected
means skipped; no required name changes. It restores caches without saving, except
Chromium on main. Chromium-only CI jobs use `install-chromium-deps`, the one pinned
Chromium package list through the bounded apt action; browser downloads stay separate.
The Colab three-engine safety net retains Playwright's own dependency installation.

`browser-ui` runs the design gallery's six computed-style audits and overlay motion checks
in Chromium, with seeded negative controls. It is one matrix job under one gate: three gallery
shards (`test:browser --shard N/3`) and a parallel TUI docs entry (`test:tui-docs`), each within
the 15-minute limit, with fail-fast off.
`browser_ui` selects `design/browser-ui/**`,
`design/tokens/**`, the Ops oracle and CLI theme the TUI docs read at build time, and the
closed CI/tooling/workspace inputs in `ci-scope.mjs`; a tooling
guard follows the gallery's local import graph and refuses inputs outside that selector.
PR and merge-group diffs select it independently of native scope; main-full and weekly/manual
full runs also select it. Unrelated product-only changes and cache seeds do not. It uses the
same pinned Chromium cache and `install-chromium-deps` action as `colab-chrome`;
the shared action owns the pinned package list and bounded apt installation.
The existing `Native package matrix` requires selected success (unselected means skipped),
and complete-main includes it; no required-check name changes. Only synthetic gallery
failure traces are retained, one artifact per matrix entry, for seven days. The leaf remains developer tooling, with no
product or tmux fixture.

## Trusted main verification

Each main push selects full CI only after a bounded read admits its SHA as current
main. An admitted run finishes without cancellation; newer pushes replace one
pending run, while superseded events skip verification/seeding. All workers use
the admitted SHA, including both Rules suites, native sync, notices, the Colab chrome spec, both Docker
shards and all runtime/packed targets. PR/MG selection/required names are unchanged;
main runs code/frontend checks while PR title/Agent steps apply only to PR/MG.

`Complete trusted-main verification` requires the exact worker inventory/flags;
missing, extra, failed, cancelled or skipped work refuses. It grants no publication
or cut admission. Only the main-failure job has issue-write permission: it reports
bounded run/SHA/job evidence on #3054, checking the bot run/attempt marker before
one POST. A complete inventory with no failed rows is reread up to three times
inside the shared API budget; persistent absence still posts the run/SHA and gate
dependency results with a job-rows-not-visible diagnostic under the same marker.
Cancelled jobs without an acquired runner remain reportable. Uncertain
writes never retry; malformed/incomplete inventories and capacity/API failures stay visible.
Seeds cannot supply complete-verification evidence.

The Colab chrome job always records root-disk availability before Playwright. When
less than 20 GiB is available, it removes only unused preinstalled Android, .NET
and Haskell toolchains; at or above that threshold it skips cleanup. The bounded
cleanup has a 60 s limit plus 5 s kill grace inside a 2-minute step. Before/after
mount usage, the available-space threshold, skip/run decision, elapsed seconds and
exit status stay in the step summary. A timeout reports partial cleanup and
continues; other cleanup errors fail the job. Node/Rust/browser caches and workspace
outputs are not cleanup targets. Traces are retained only for failures; video
recording remains disabled. Temporary traces still exist during a test.

## Cache ownership

Docker PR/MG shards restore exact main-owned dependency archives; the purpose-specific
main seed exports Cargo target/debug and registry. The image's Cargo commands keep the
package scope the seed cooks, or archived dependencies rebuild. Misses build cold; real compiler
failures never retry cold. Pinned `Swatinem/rust-cache` has one main-ref writer per
key: workspace for shared dev dependencies, process for its dev/release builds
(`native-process-rust`), MSRV for its toolchain, each runtime target for its cache.
Only admitted main-full or `verify=false` seed events write; PRs, merge groups and
other workers restore only. The process cache is cold until its first main save.
`ci.yml` sets `SEGMENT_DOWNLOAD_TIMEOUT_MINS: '2'`, so a throttled or stalled restore
(Actions cache egress limit) becomes a miss within two minutes, and every
`setup-buildx-action` keeps `cache-binary: false` to avoid a stalled binary-cache
restore (#5708). Docker E2E and its seed retain the pinned primary download; on
failure they first require an available local `docker buildx` and omit the fallback
version input, so fallback reuses that plugin without a GitHub Releases download.
A missing local plugin fails closed before the fallback action (#6129).
Pinned release archives (nextest, wasm-bindgen) come from one
[fetch-pinned-archive](../../../../.github/actions/fetch-pinned-archive/action.yml) action. It
restores an `actions/cache` entry keyed on the archive's sha256 (a stalled restore is a miss
after two minutes), downloads only on a miss with `curl --retry 3 --retry-all-errors` (60 s per
attempt, no new attempt after 150 s), and checks the pinned digest on every path before the
main ref saves the entry or a caller extracts it. Callers keep only the URL and digest (#6212).
Artifact downloads in CI jobs and the release manifest step retry once after 45
seconds within a bounded step; a second failure fails the job (#5743).
CI disables dev debug info/incremental compilation; release profiles follow manifests.
[Native release verification](native-release.md#cli-upgrade-proof) owns release/adapter caches.

CI consumers and `colab-browser.yml` use [install-ci-rust.sh](../../../../scripts/install-ci-rust.sh)
to retain the requested host toolchain before restore, preserving components,
targets and manifest MSRV; runner-image extras are removed only on disposable Actions VMs.
`native-intel.yml` retains Intel `runtime-${TARGET}` setup; the upgrade proof keeps
its `RUSTUP_TOOLCHAIN` and source-scoped `CARGO_TARGET_DIR`. Pairing/project-release,
bundle/prepare metadata and `release.yml` keep their own environment families,
without CI dev-debug settings; release prepare/version injection use separate
product/target keys. [Workflow definitions](../../../../.github/workflows) own these
settings. Keys bind compiler/platform/environment/manifests; exact hits do not prove
complete feature/profile population.

Weekly/manual seeds have no diff and select full scope: the Rust aggregate validates
workers, outer verification gates skip. Main-full keeps the same owners/keys;
feature-branch dispatches restore only.

## Advisory browser selection

[Colab browser verification](../../../../.github/workflows/colab-browser.yml) is
advisory (the gating chrome spec lives in `ci.yml`), outside required aggregates, with no main-push or merge-group trigger.
No lane authorizes publication.
`colab_harness` selects client/model/contract vectors, its workflow, shared Cargo
manifest/lockfile and pnpm lockfile; empty/unknown PR diffs select nothing. PRs run
Chromium; weekly/manual runs require strict Chromium/Firefox and Linux WebKitGTK
refusal, plus separate strict macOS WebKit corpus/interop. macOS never runs on PR/MG.
Rust restores never save; browser keys bind OS/architecture/pinned Playwright, and only
successful main-ref runs save. Reports prove primitives, not product acceptance.

`colab-app` uses `colab_app` for app/colab-client/browser-ui paths, its workflow,
the shared Chromium dependency action and pnpm lockfile, plus weekly/manual events.
`@tmt/colab-app test:browser` runs Chromium with one
worker/no retries/no Rust; native-executable specs skip with a named reason, so
the run proves the browser components only. Bounded logs/failure traces last seven days. Whole-file weights in
`e2e/shard-weights.json` use `typescript/scripts/colab-acceptance-shards.mjs`;
helper/matrix share eleven whole-file shards under the unchanged 720-second modeled
wall guard (`colab-component-shards.test.ts`, run by Code quality on every PR and merge
group, so a spec-only change that skips Unit tests still runs it), assigning each spec exactly once, including
new default-weight files. Keep the 20-minute job/30-second test limits, one worker
and no retries. Component jobs restore the main-owned Chromium cache without saving,
and always install system dependencies. Dot/JSON reporters share the results artifact (`results.json`
per-test durations); refits record source runs/method/variance and verify full
test-ID equality before changing the split.

`colab-hosted` PRs run the bundle spec for `colab_hosted` or `colab_hosted_emulator`. The
same job's final step runs `e2e/served.spec.ts` against the embedded binary and a private
expected-byte copy of `dist` (checkout `dist` is hidden and restored by an exit trap) when
`selectColabHosted` selects the exact serve/door/assets/reader-entry inputs. There
`COLAB_SERVE_REQUIRED=1` fails a missing binary, and the JSON report guard requires every
listed case to pass exactly once with zero skips; component-only runs keep the named
missing-native skip. Record the first three real timings on #3126; stop and report if the
served step exceeds 90 seconds or the job 15 minutes.
`selectHostedReaderEmulator` in `ci-scope.mjs` selects hosted-reader inputs (Objects,
Catchup/reader keys), signed-proof client, native producer/composer and Remote
production Rust/assets/SDK; it excludes client tests, Remote tests/docs and the
test-only Colab pin. The [shared action](../../../../.github/actions/hosted-reader-emulator/action.yml)
owns Java and the populated emulator cache, consumes the same locked Firebase installer, and uses the unchanged owner wrapper,
private state, loopback demo Auth/Firestore and Chromium. The qualifier follows the
ordinary spec because it rebuilds Remote with `test-emulator`. Full label/weekly/manual
acceptance runs it once on shard 1 after ordinary acceptance, even on failure,
unless cancelled; build hashes are recorded first. It adds no permission/aggregate;
on failure, the action retains proof test-results and two demo-emulator logs for
three days. The wrapper copies only those logs before removing its private world.

Real-binary acceptance runs weekly/manually or on `colab-acceptance` PRs. Only adding
that exact label triggers acceptance; removing it never does. Opening a PR never does:
a PR created with the label also gets its `labeled` event, which starts the one wave for
that head. Pushes and reopening a labelled PR start a wave. Label edits skip
selector/interop; job concurrency prevents cancelling in-flight checks. Three shards
use `fail-fast: false`, separate concurrency/artifacts and whole-file duration
weights (`colab-acceptance-shards.mjs`, `acceptance/shard-weights.json`), exactly once
per file. Each tests the default merge ref and records head/merge SHAs in
`tested-head.txt`, builds the app then all three executables once, and runs Ubuntu
x64 Chromium with one worker in 30 minutes. Rust restores never save. Seven-day
evidence retains only source/build hashes/outcomes with bounded assertion
locations/timeouts, never raw errors/private traces/profiles. Unexpected outcomes
print the bounded private-JSON summary; acceptance never cancels active runs.

## Workspace compilation and partitions

Full scope calls `workspace-partitions.yml` under the workspace worker ID; Ops
keeps Cargo/architecture verification. The producer retains independent Cargo/libtest
discovery, separate doctests, dev build and selected native sync. Required `partitions`
(K) admits 2 or 3. Each Ubuntu consumer admits producer source/run/toolchain/archive digest
separately from execution attempt, proves its slice and records actual PASS identities.
The always-run collector rejects missing/skipped/failed/overlapping/foreign results
before native aggregation; counts never replace exact non-ignored case coverage.

Producer/consumers share pinned nextest and record actual Cargo/rustc versions.
Consumers install pinned Rust for tests using Cargo metadata, pass real Cargo in
`CARGO`, extract/run without cache restore or build. Only the admitted main producer
writes caches. Phase evidence covers compile/list/archive/extract/execute; Actions
steps retain setup/transfer/emulator/collection cost. Separate VMs own cleanup;
local heavy proofs require Infra's run grant. All phases drain captured output
before returning or throwing, keeping names/details/summary in job logs and phase artifacts. Identity failures name the partition, binary/case and terminal status; leaked handles remain rejected and are distinguished from missing completion evidence. `nextest list` (inventory, slice checks and downloaded-archive extraction/listing) has a 60 s command bound; compile/archive/execute retain 18 min. A timeout names the phase and bound while preserving its original cause/output and `timeoutMs`/`errorCode` phase evidence. It is not retried.

Only a fully successful producer job and both uploads yield its receipt, binding
original attempt, exact manifest bytes, archive hash/size and immutable inventory/
closure IDs/digests. Schema 2 separates producer from actual execution attempt;
result names contain both. Cargo-built runtime examples are archive inputs and
consumers verify restored executable paths before testing.

`ci.yml` runs K=3 partitions (#3284). Recovery admits K=2 or 3; collection selects each partition's latest actual success
within three attempts of one producer generation. Newer failed/cancelled/incomplete executions refuse,
never falling back. Attempt start time plus exact earlier-success fingerprint
identifies copied retained jobs with new IDs. Ambiguous/unavailable metadata,
changed source/toolchain, expired/missing/duplicate artifacts, digest mismatch or
different producer refuses. Recovery reads GET only, <=20 requests/90 seconds;
single attempts make no recovery calls or added job/step. Only the collector has
`actions: read`, with the reusable caller's matching ceiling.

Downloads use `actions/download-artifact@v8`, `digest-mismatch: error`, through the
[retry action](../../../../.github/actions/download-artifact-retry/action.yml); uploads use
v4. Original artifact IDs and `selection.json` retain job/artifact identities/result
hashes with unchanged aggregate counts and exact-once proof. Failed-jobs recovery
is [qualified for unchanged-source K=2](https://github.com/pj-tmt/tmt/issues/3571#issuecomment-6250385665)
within these bounds; missing/expired/ambiguous evidence or changed producer requires
re-run all jobs. This grants no publication/workflow-dispatch authority.
The four workspace job p90 budgets use the weekly report's 31–35 samples for both
events; other MG limits stay unchanged.
Infra reverts if those runs exceed the pre-rollout 886 s MG median wall or 13.9
workspace runner-minutes, or show an unexplained equivalence failure.
Budget provenance stays in the JSON below.

## Gate-time budgets

`node typescript/scripts/ci-gate-time.mjs` uses read-only REST (~85 requests) for the
last 40 successful `ci.yml` PR/MG runs, ordered by creation then ID. It reports gate
wall (creation to last selected required context), per-job wall/queue, controlling
job and runner-minutes with median/nearest-rank p90. Split `Unit tests` wall spans
the earliest selected consumer start through collector completion; its short
collector wall is never credited as a budget improvement. Queue and runner-minutes
still use physical jobs, without charging that span twice. Skips and negative reused-copy
spans have no sample; the controlling worker is the last non-aggregate before gate
end. Over-budget values and budgeted jobs without samples stay visible; timing
never blocks PRs. [ci-gate-budgets.json](../../../../typescript/scripts/ci-gate-budgets.json)
owns figures/provenance: gate median/p90 and job p90. Exceeding a figure is over
budget; increases need Infra's written note on #3283.

`node typescript/scripts/ci-macos-demand.mjs --output PREFIX` measures one complete
run-created UTC window of at most six hours (default six; `--since`/`--until`).
Only source-traced macOS-capable workflows are hydrated. JSON/Markdown show
workflow/event, job and disjoint PR-association occupancy/queue samples, unavailable
and skipped jobs, exclusions and the shared REST-core ledger before/after.
Each invocation caps all GET attempts at 800, including retries/rate snapshots;
it refuses data reads below 2500 initial core remaining. Persistent 100-row jobs
HTTP 502s discard the partial run and restart at page one with 50 rows, requiring
unchanged count and exactly that many unique IDs. Exact earlier terminal copies,
including failures, count once. Unreadable runs name the run/count;
no partial census, sampling or resume. Collect 72 hours as twelve exact six-hour
windows, at most four windows/hour; sum occupancy/counts and recompute quantiles
from samples, never average percentiles. Seven-day extension needs Infra approval.
Required-check policy and estimated reductions remain separate; CI selection is unchanged.

Monday hygiene compares budgets: two consecutive over-budget weeks require an
issue to the dominating suite's squad for sharding/consumers/trimming. A PR expected
to add more than about 20 s to a required job must say so in its body and update
weights or assignment (`typescript/test/e2e/shard-weights.json`,
`typescript/scripts/native-shard-weights.json` or Colab `acceptance/shard-weights.json`) there.

## Verification

### Release gate parity

Infra's `.github/release-parity.json` inventories executable steps in `native-release.yml`,
`release.yml` and local reusables. Publication-policy/incident entries are narrower;
`coverage: policy` means regression tests, not publication or actual archives.
`releaseOnly` requires a concrete live-state reason no PR can reach and cannot
carry `followUp`; each gap needs a counterpart or that reason, never an open marker.

A `preMerge` counterpart names a `ci.yml` job selected by a ci-scope output for a pull
request or merge group; a `mainPush` counterpart names a job that runs on a main
push (here `release-rehearsal.yml:prepare`), and the guard requires a main push trigger, a path selection and no PR-only `verify`
condition. An entry may list both, or name a `releaseOnly` reason instead. The release
rehearsal is mainPush coverage: it rehearses the products the push's `before..sha` diff
selects. A push superseded while pending, or one whose selection missed an input, is
rehearsed by the nightly all-products `release-rehearsal.yml`, and no release skips the
four-target prepare proofs. Separate
selectors (such as
`release-rehearsal.mjs`) name `selection.source`, which must emit the output.
Always-selected verification uses `selection.kind: "always"` and the actual incident
step; the guard rejects path-dependent conditions or absent steps. The manifest
maps rehearsed prepare/packaging stages to `release-rehearsal` as mainPush; each incident names
the release failure step and counterpart/release-only reason. Extend guard incident
lists/tests when adding an incident.

For workflow changes review coverage and update executable-step inventory/admitted
job SHA-256. `node typescript/scripts/release-parity.mjs inventory` prints definitions
without updating the manifest. Changed commands/conditions/matrices/called workflows
need review even with unchanged names. The guard rejects stale/unmapped workflows,
jobs, steps, publication policies, invalid counterparts/selectors or unsupported
structure. Local reusables are followed; external reusables or alias/flow job/step
mappings need admission tests before use. Fingerprints require review and never
establish semantic equivalence.

Run `node typescript/scripts/release-parity.mjs check` and, from `typescript/`,
`corepack pnpm exec vp test run --config vitest.config.ts
test/tooling/release-parity.test.ts test/tooling/release-workflow.test.ts`.
Code quality runs parity for PR/MG, including prose-only changes; the manifest records existing coverage.
Selection/workflow changes also run:

```sh
corepack pnpm exec vp test run --config vitest.config.ts test/tooling/ci-scope.test.ts test/tooling/release-workflow.test.ts test/tooling/e2e-shards.test.ts test/tooling/native-shards.test.ts
corepack pnpm check:tooling
```

Run `actionlint` on changed workflows and the selected layer's checks. Review positive/
negative selections, cumulative queue diffs, shard membership and exact aggregates;
selection never substitutes for runtime/archive/browser proof.

## Prepared Infra tick summary

`typescript/scripts/infra-tick-summary.mjs` prepares read-only evidence for the
hourly Infra lead tick. Run it manually beside the existing tick before changing
its cron prompt; the lead compares the two reports after the script lands.
The script does not judge reviews, attribute causes, arm PRs or publish releases.
Release evidence reads at most the first two 100-record pages and states that older
releases were not read; it is not the cut allocator's consistent catalogue. A recent-page
refusal marks the release section `INCOMPLETE`, preserves the cursor and still collects
the other sections. Missing smoke-tag evidence remains an explicit anomaly.
Export the same `TMT_CI_WATCH_STATE` directory for watcher and tick: its local heartbeat adds timestamped anomalies for missing/stale (>2 h)/invalid/error evidence or coverage notes younger than 24 h, without API reads or changes to REST `INCOMPLETE` semantics.
A new output directory establishes a zero-call bootstrap boundary, not a health
report. Run the command again for evidence after that boundary:

```sh
node typescript/scripts/infra-tick-summary.mjs --output /tmp/tmt-infra-tick --review-map /tmp/infra-review-map.json
```

Retention lives inside `--output`. After a complete tick has written its cursor, it removes
cached `evidence/<sha256>.json` files that are older than 48 hours, not named in
`cursor.json` and not read by that tick, then the oldest unprotected ones while the rest
exceeds 50 MB. It touches only regular files with that name, never links. An
`INCOMPLETE` or refused tick prunes nothing, and a pruning failure is reported as
skipped without changing the complete tick. Each run first keeps `calls.jsonl` to the
invocations of the previous 24 hours (at most 20,000 lines). `summary.*` reports only
the counts of pruned and kept files.

`--bootstrap` can establish a boundary after historical refusal only without an
existing cursor or `--since`. It omits earlier failure/review history; changed old
runs remain eligible, observed active runs stay tracked, and recurrence begins at
observed post-boundary evidence. Older active runs completed before first observation
are outside coverage. The caller supplies a reviewed path-to-lead map with every
applicable shared path/lead and its #606 source line, for example
`{"rules":[{"prefix":".github/","leads":["tmt-lead","tmt-infra-lead"],"source":"#606 shared paths, lines 17-19"}]}`.
This is an example, not a complete ownership map. Unmapped shared paths/missing
exact-head statements are anomalies. JSON retains
exact comment/head/stated lead; statements (including NO-GO) never imply acceptance.
Guide-index changes are conservatively flagged at file level for lead inspection.

All calls share 80 requests/120 seconds, including failures and the bounded release
view. Budget refusals leave the cursor unchanged and name an exact `--until` prefix
and remaining interval, preferring an already-read run-created boundary (otherwise a
labeled computed midpoint). Retry that prefix with the same command; only after it
completes, retry the original `--until` using the resulting cursor. Never edit the
cursor or skip a refused prefix. Splitting does not guarantee a smaller live PR workload;
if it still refuses, choose a smaller prefix or escalate. No half is reported complete
before its own evidence is read. REST is GET-only, with two fixed read-only GraphQL exceptions:
queue positions and one <=100-PR review batch. Queue errors/failure/>100 entries print
`queue coverage unavailable`, never timestamp-derived positions. Review cost is
logged in `calls.jsonl`; missing/invalid cost, errors or >20 points refuses. The
batch binds listed heads to file counts/paths and comment bodies/URLs, reading
the first 100 files and last 100 comments. Pagination uses full REST/final
exact-head/file-count verification for that PR only.
Truncated/foreign/duplicate evidence or changed heads refuse, never empty healthy sweeps.
Draft visibility needs push permission; changing counts/identities, missing required
metadata or exhaustion refuses. Discovery, queue, releases, PR reviews and complete
terminal-job metadata precede optional logs. Select the first failed non-aggregate
worker per attempt, newest runs first (ties by run ID, jobs by ID), at most three
logs per tick. Each read has a 20 s maximum within a 60 s phase, reduced to retain
10 s and two API calls. Caps include cache reads; hits are not network calls.
Reports begin `logs read: k of n failed workers` (including retained samples),
and name every unread worker/reason. Unread logs are not retried automatically or
asserted healthy. Recurrence uses observed tokens/distinct PR/MG contexts only.
Missing/oversize/timed-out logs remain unavailable, not causes or successes. Full
logs retain their SHA-256/cache and the packed owner's 16 MiB ceiling; other reads
keep its default. Public-install failures join exact tag-bearing job
labels to unique published records; missing/draft/ambiguous joins are unavailable,
and multiple failed hosts count as one release.

Health counts use `per_page=1` for 24-hour/tick windows, including >1,000 totals.
Details enumerate created-window failure/timed-out/action-required/stale slices,
refusing at 1,000 matches before exceeding searchable evidence. Queued/in-progress
searches track older reruns without a created filter. A count/row or membership race
discards the whole live scan and restarts at page one, at most three scans in the shared
budget, waiting 3 s then 9 s between scans only if the wait fits the shared 120 s
deadline. If backoff cannot fit, a dedicated live-listing refusal asks for one retry
and never suggests a time-budget window split. It otherwise refuses with status/count/rows; created-window
queries stay strict and other active states stay within the window. A live-listing
`INCOMPLETE` already includes backoff; retry the lead invocation only once before
escalating a persistent refusal. Unobserved older reruns
starting/finishing between ticks and
workflow `startup_failure` are outside detail coverage, explicitly stated in reports.
Only unseen failed attempts incur job/log reads; observed tokens remain for 24-hour recurrence.
Reviews cover open PRs updated since `since` plus PRs merged in the interval.
Exhaust open PR pages; discover closed candidates through `issues?state=closed&since=`
with a one-second overlap before the rounded-down boundary, filtered locally to inclusive
`since`, then hydrate each PR for its head and merge time. Neither walk stops on an old row.
Two fresh passes must agree on page count and identity membership, allowing reordered
members; duplicates, additions, drops or shrinking pages refuse. This checks observed
membership, not a transactional snapshot. Reserve all hydration calls plus the review
batch before reading any candidate; insufficient budget refuses without a partial set.

Quiet one-page acquisition costs `17 + min(P, 2) + H` calls (`P` release pages, `H` recently
updated closed PR candidates, including unmerged closures), plus tracked/new failure
details, extra list pages, one nonempty review query and per-PR REST fallbacks.
`H` grows with merges/closed-PR updates; split a long window with `--until`.
The timed fixture (P=7, H=0, one review batch, 0.5 s other calls, 1.8 s per
single-page failed attempt) supports 60 uncached failed attempts: 80 calls/118 s;
the 61st refuses. Extra pages, hydration, tracked runs or slow calls lower this
ceiling. Twenty attempts plus the full 60 s log phase cost at most 106 s in
that fixture; 10/30 workers across ten attempts cost at most 88 s. The shared
80/120 limits always apply; mandatory exhaustion refuses with the cursor unchanged.
Bootstrap has no historical detail reads. Explicit `--since` without a cursor opts
into <=24-hour historical collection; terminal job/log cache can survive refusal,
but unbounded/heavily paginated windows may not converge. Bootstrap starts a new
observer, not a repair of an oversized incremental window. Split backlog with
`--since UTC --until UTC`, without resetting the cursor, then collect the remainder.
There is no pending-window checkpoint/automatic retry. Use at most two manual
invocations per window (<=160 calls); after two refusals stop, split or escalate.
A transient `Truncated REST evidence` may allow one retry in the same directory;
`--until` fixes its end and the cursor stays unchanged.

`calls.jsonl` records network endpoint/method/outcome/elapsed time and review query
cost; cache hits are not calls. It stores no credentials, response bodies or raw logs.
Refusals name the acquisition stage and cohort PR count. `summary.md` ranks up to 20 anomaly lines:
failed drafts/publication failures and unavailable queue/public-install evidence, failed runs/repeated tests, guide budgets, stuck queue entries,
then PR statements (one count with three example PRs). `summary.json` retains every anomaly and
evidence/cache path; coverage and host disk/load follow the printed anomalies. `cursor.json`
advances atomically when all required metadata is complete under the stated log
sample, including omitted/unavailable diagnostics. Only failed attempted downloads
add log anomalies; omissions remain in worker records and the tail list.
Required metadata unavailability/refusal returns nonzero with unchanged cursor; the first line
says `INCOMPLETE: <kinds>; cursor not advanced`. Queue failures retain a credential-redacted
reason. Entries enqueued after the fixed report boundary have age zero.
Core's #2268 tick prompt must say: "Logs are sampled; log not read is unknown
diagnostic detail, not a healthy worker." The prompt itself is not changed here.
Only complete reports can explicitly state no anomalies. Known GitHub
credentials are redacted; posted summaries contain no secrets/raw logs.
[guide-budgets.json](../../../../typescript/scripts/guide-budgets.json) owns shared
guide line/byte limits used by the summary and guard. Reports remain input for lead judgement.

## Local CI failure watcher

`typescript/scripts/ci-failure-watch.mjs` is an operator-started observer, not a
required gate. The Infra lead starts its `ci-watch` window after review; it adds
no host service or credentials. Example (the map is reviewed from #606):

```sh
node typescript/scripts/ci-failure-watch.mjs --dry-run --routing-map /tmp/ci-routing.json
export TMT_CI_WATCH_STATE=/tmp/tmt-ci-watch
node typescript/scripts/ci-failure-watch.mjs --routing-map /tmp/ci-routing.json --identity tmt-infra-lead
```

The map has `source:"https://github.com/pj-tmt/tmt/issues/606"` and `rules` containing
one `workflowPrefix` or `jobPrefix`, a `squad` and its `source` line in #606. Longest
workflow prefix wins before job prefix; unmapped says so. These are suggestions:
all messages go only to Infra, who attributes/forwards them. The watcher never
reads logs or claims a failing test name. It watches failed completed main pushes,
merge groups, dispatches and schedules; PR authors retain their CI.

Every 60 s, conditional completed/in-progress/queued reads retain ETags and cached
metadata. A start/restart catches up created-within-24-hour cohorts from its cursor;
tracked active ids/attempts get one direct read after leaving page one. Unobserved
older history is a once-only coverage alert; a full 100-row active page with more
behind it alerts once per overflow and re-arms after a clean pass. Short-page
count mismatches do not prove overflow.
Steady new runs and observed in-flight reruns target about two minutes; this is
not all-history coverage. A pass has 800 GET attempts, a 2,500 REST-core floor,
a 120 s cold-start bound and 20 s per read. Conditional/search/attempt reads count.
Heartbeat progress continues during catch-up; ordinary steady passes retain the
60 s interval. Reads or budgets that cannot prove a complete cohort fail closed.

One alert per failed run/attempt lists every failed job. Its signature is the
workflow plus sorted failed-job set; six-hour dedup re-arms after green on the
same event. Routing uses the earliest-started failed job (API order breaks ties
or missing times). Observed attempts are not replayed; version-1 history is kept.
Each re-arm searches open signature issues again: a matching issue is linked in the
notification; without a match, the notification carries the run URL only. The watcher
never creates issues; the Infra lead files one manually on a second sighting. At most
six `tmt talk` submissions per rolling hour are permitted; bursts fold by suggested
squad within a 24,000-byte notice bound, with excess alerts kept pending and no job names
dropped. A private exclusive lock prevents competing watchers. Persisted delivery intent
stops an uncertain submission from being blindly repeated; inspect TMT and the recorded
intent before operator repair. A budget-deferred known-unsent alert retries next pass.
`--dry-run` prints the last 24 h and proposed messages, makes GETs only, and never
reads/writes live state, sends messages or starts a loop.

`heartbeat.json` reports time, status, cursor, read count and pending alerts; stale
(over two hours), future, malformed or error status is unhealthy. The hourly-tick
integration reads the same state setting. No deployment/window or cron/prompt
change is performed by this script. Detection delay is measured from Actions `updated_at`
to the recorded submission time after merge, not inferred from queue timestamps.

## Old organization links

After the rename to tmt-ninja (#5137), `typescript/test/tooling/previous-repository-links.test.ts`
fails when a tracked file links to the old name `pj-tmt` (a github.com, raw.githubusercontent.com,
ghcr.io or `repos/` URL, or the old GitHub Pages host) more often than
[the ratchet](../../../../typescript/test/fixtures/previous-repository-links.json) allows for that
file. Existing links are listed there and may only shrink: after replacing links with `tmt-ninja`,
run `node scripts/previous-repository-links.mjs --write` from `typescript/` to lower the counts; it
refuses to raise them. The bare `pj-tmt/tmt` constants that deliberately accept the old name (the Rust
`PREVIOUS_REPOSITORY`, the release index writer) are not URL-shaped and need no entry. Redirects keep
old github.com links working, but pages on the old GitHub Pages host do not redirect.
