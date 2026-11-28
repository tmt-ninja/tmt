# Go replacement backlog (#6938)

tmt-go replaces native tmt after merge (owner decision, 2026-11-28), so every
gap below must reach zero before that merge. This file is the single list: each
owner keeps only its own section current, and every `NOT PORTED` comment in the
code names an item here. Development stays isolated (private roots and tmux
sockets); the native-root switch is one lead-owned change in `internal/home`.

## Lead (home, archtest, CI, leaves)

- [ ] Trial switch: native root at the exact native schema only (refuse to
  migrate), `sqlite .backup` before the first write, the same busy timeout and
  IMMEDIATE writes as native, `@tmt.` option namespace, restore step on the
  Ben page; binary renamed `tmt` only at merge.
- [ ] tmt-tui `components/terminal.rs` (vt100 emulator; 18 Rust tests).
- [ ] Unicode: ICU stream-safe CGJ and final-sigma lookahead; three Unicode 16
  emoji widths (uniseg 1, Rust 2).

## go-1 (core, storage)

- [ ] GO1-01: ICU NFKC without stream-safe combining grapheme joiner insertion.
- [ ] GO1-02: ICU final-sigma context beyond 30 case-ignorable runes.
- [ ] GO1-03: Registered external host target grammars.
- [ ] GO1-04: Remote request routes and response reads.
- [ ] GO1-05: Native Digest, flow and capture retention with incremental page reclaim.
- [ ] GO1-06: Atomic SQLite symlink refusal when opening the hook queue.
- [ ] GO1-07: SQLite no-checkpoint-on-close connection option.
- [x] GO1-08: Digest holds and provider activity in the request delivery view.
- [ ] GO1-09: Read footprint page counts and discovery ownership when a WAL exists without an index.
- [ ] GO1-10: Enumerate the full native Colab backup set in footprint.
- [ ] GO1-11: Reply callbacks, provider capture and flow accounting.
- [ ] GO1-12: Partial usage totals for unmeasured wake turns.
- [ ] GO1-13: End Digest continuations on a verified prompt or binding detach.
  - Native `storage/consumption_history/passthrough_tests.rs::a_stop_blocked_continuation_stays_open_until_its_own_stop_or_a_prompt`
    maps to Go `TestCurrentCaptureAdvancesOnlyMatchingTurnActivity`: blocked Stop
    leaves delivered open, own Stop closes it, verified prompt closes an uncertain
    continuation, and definitely-unsent never opens. The verified prompt callback
    composition is tracked in GO2-04 and CLI-29.
  - Native `storage/bindings/session.rs::a_stop_continuation_ends_with_the_provider_run_that_started_it`
    maps to Go `TestDigestIdleBindingRequiresExactIdleAndNoOpenContinuation` for
    verified runtime exit and `TestDigestContinuationEndsWithBindingReplacementOrDetach`
    for active binding replacement and detach. Late session disclosure and same-process
    session clear still need the lifecycle callback path.
- [ ] GO1-14: Exact resume for Claude and Codex, including the read-only preset projection.
- [ ] GO1-15: Resume forget, move, new, retry, driver switching and stale/pending settlement.
- [ ] GO1-16: Gemini exact resume.
- [ ] GO1-17: Resume with saved wrapper, model, effort and channel settings, plus the associated preset model refresh in --show.
- [x] GO1-18: Exact send-now release, guarded claim and settlement.
- [ ] GO1-19: Reply and timeout notice production.
- [x] GO1-20: Selected Digest checklist snapshot and summary-only counts after settlement.
- [x] GO1-21: Observe future schema versions through an existing API session.
- [ ] GO1-22: Decode authoritative Digest idle activity for Agy and Pi.
- [ ] GO1-23: Preserve the retained thread-root frame when a request is sent now.
  - Native `storage/room/tests.rs::a_roster_post_reaches_only_the_addressed_members`
    maps to Go `TestSendNowProjectsExactRetainedThreadRoot` for the stored root
    ID and retained prompt. The same test pins the root ID when the prompt or
    root retention expires, or the root row is absent. Shared frame rendering
    and the Digest consumer remain in progress.

- [x] GO1-24: Read existing discovery ownership without provisioning.
  - Native `storage/bindings/service_tests/discovery.rs::read_only_discovery_preserves_rows_and_distinguishes_known_stale_hook_only_and_duplicates`
    maps to Go `TestReadDiscoveryPreservesOwnershipAndFiltersHostSocket` for unchanged
    ownership, host isolation, and both records for a duplicate pane, and to
    `TestReadDiscoveryLeavesMissingHomeAbsent` for a missing database. Candidate
    classification is tracked in CLI-04.

## go-2 (sys, process, tmux, host, drivers, channel)

- [ ] GO2-01: Native process-table reads before the bounded ps fallback.
- [ ] GO2-02: Launch into a missing session only with private-server ownership.
- [ ] GO2-03: Launch-only Gemini skill discovery from native's shared skill root. Native Gemini registers no runtime or launch hooks.
- [ ] GO2-04: Claude Digest continuation output and Stop completion. Verified prompt routing uses the existing writer. Native `runtime/prompt_tests.rs::prompt_hooks_decode_only_submissions_and_encode_their_own_event` (Claude decode cases) → `TestClaudePromptDecodesOnlySubmissions`; the prompt/blocked-Stop boundary in `a_stop_blocked_continuation_stays_open_until_its_own_stop_or_a_prompt` → `TestClaudeDigestPromptUsesExactAdmissionAndLeavesStopSeparate` plus the GO1-13 storage tests.
- [ ] GO2-05: Claude managed skill injection.
- [ ] GO2-06: Claude channel enrollment composition for a verified binding and launch owner.
- [ ] GO2-07: Codex managed write grant and settings-derived scope.
- [ ] GO2-08: Codex invocation-only managed skills.
- [ ] GO2-09: Enable Codex invocation hooks through the verified lifecycle and Digest callbacks.
- [ ] GO2-10: Compose qualified Codex channel startup and emit the native preflight advisory.
- [ ] GO2-11: Enforce the native 256 KiB Codex WebSocket inbound frame cap in addition to the 1 MiB message cap.
- [x] GO2-12: Exact invoking tmux client focus and directional pane swap. Ambiguous client claims refuse rather than using activity as an identity proof. Key-job session parity: Rust `tmux/focus.rs::a_key_binding_job_without_a_pane_uses_the_session_in_tmux` → `TestKeyBindingJobUsesTheSessionInTmux`; the pane-less `focus --client` view in `typescript/test/e2e/focus.e2e.test.ts` → the private-client assertion in `TestPrivateFocusAndSwapExactInvokingClient` (CLI scenario owned by go-3). Swap result parity: Rust `swap_uses_exact_ids_and_detaches_without_selecting_or_killing` and `swap_already_beside_and_refusals_have_no_mutating_call`, plus the displaced-pane and already-beside cases in `focus.e2e.test.ts` → the private swap assertions in `TestPrivateFocusAndSwapExactInvokingClient`.
- [x] GO2-13: Bounded discovery and exact marked-pane snapshots.
- [x] GO2-14: Built-in terminal attach over an admitted PTY connection.
- [ ] GO2-15: Go-owned built-in PTY supervisor and launch lifecycle.

## go-3 (cli, output)

- [ ] `CLI-01` Complete resume with provider session presence checks, preset replay, Gemini, forget, retry, move, fresh start and driver switching.
- [ ] `CLI-02` Extend send-now to verified provider-channel delivery and built-in and external hosts.
- [ ] `CLI-03` Focus built-in and external hosts. Go tmux focus is covered by the focus parser cases from Rust parser/tests/identity.rs and the private Go equivalents of typescript/test/e2e/focus.e2e.test.ts: cross-session focus and back, unique/ambiguous key jobs, four-direction swap and already-beside, zoom and absent/stale/foreign refusals.
- [ ] `CLI-04` Port admitted external host discovery and additional native built-in driver aliases. The tmux inventory tests reuse the read-only scan and fresh binding assertions from `discovery.e2e.test.ts` and the native SHA-256 contract vectors from `contracts/discovery-v1.json`.
- [ ] `CLI-05` Implement discovery-guarded `add --expect` and `--identity` against fresh evidence.
- [ ] `CLI-06` Port the native optional pane badge. Tmux marked binding uses a frozen target; private fixtures reuse the missing mark, invalid name, no fallback, repeat/promotion/conflict, mark move and vanished pane assertions from `marked-binding.e2e.test.ts`.
- [ ] `CLI-07` Implement interactive `attach` and `--detach-others` through the verified built-in terminal stream.
- [ ] `CLI-08` Implement caller discovery from tmux process ancestry when environment claims are unavailable.
- [ ] `CLI-09` Reconcile orphaned and legacy pane metadata during binding.
- [ ] `CLI-10` Project remembered sessions and provider activity in `ls` and reconcile binding presence.
- [ ] `CLI-11` Implement `ls --room` membership filtering.
- [ ] `CLI-12` Implement `ls --detected` with host and socket selection.
- [ ] `CLI-13` Implement bounded `whoami --context` output.
- [ ] `CLI-14` High priority after focus: implement direct-pane `talk` with verified driver routing. Reuse the native durable-talk, smoke request, and response-integrity assertions.
- [ ] `CLI-15` Implement `talk --remote` through Remote delivery.
- [ ] `CLI-16` Implement `talk --room` and its membership rules.
- [ ] `CLI-17` Implement `talk --passthrough` through guarded raw paste.
- [ ] `CLI-18` Implement `talk --expect-name` with exact identity pinning.
- [ ] `CLI-19` Send best-effort reply notifications after durable acceptance.
- [ ] `CLI-20` Deliver the retained Digest checklist from ordinary idle `check`.
- [ ] `CLI-21` Implement `x flow` with content-free exchange counts.
- [ ] `CLI-22` Implement bounded `x listen` with incoming attention and room filtering.
- [ ] `CLI-23` Compose launch enrollment and guarded channel routing, including `run --channel` and remembered channel choice.
- [ ] `CLI-24` Implement `channel inspect` and `channel recover`.
- [ ] `CLI-25` Launch through built-in and approved external hosts.
- [ ] `CLI-26` Support bare provider launches, automatic names and remembered or configured launch selection.
- [ ] `CLI-27` Launch arbitrary foreground programs and remaining managed drivers.
- [ ] `CLI-28` Map foreground termination to the native signal-specific exit status.
- [ ] `CLI-29` Complete lifecycle callback activity, provider context and Digest continuation.
- [ ] `CLI-30` Compose `api` over its stdio server and typed operations.
- [ ] `CLI-31` Compose `mcp` with a pinned saved identity and canonical exchange and dispatch owners.
- [ ] `CLI-32` Compose `room` administration, membership and delivery commands.
- [ ] `CLI-33` Compose `orch` jobs, plans, previews, lead and route mutations, retained talks and focus with go-4.
- [ ] `CLI-34` Compose `workspace` save, inspect, listing, restore and removal with go-4.
- [ ] `CLI-35` Compose `tick` runs, status and timer controls.
- [ ] `CLI-36` Compose `setup` with go-4.
- [ ] `CLI-37` Compose `install` with managed skill ownership, approved provider integrations and the Herdr back key.
- [ ] `CLI-38` Compose `upgrade` and its update alias with version selection, preview and consent.
- [ ] `CLI-39` Compose `uninstall` with go-4.
- [ ] `CLI-40` Implement official extension receipt inventory and release checking for `extension ls --prefix` and `--check`.
- [ ] `CLI-41` Compose consented `extension install`, `upgrade`, `rm` and hook management.
- [ ] `CLI-42` Compose driver approval, removal and registry verification for `driver ls` and host routing.
- [ ] `CLI-43` Compose external command dispatch, help-tail rewriting and dynamic completion.
- [ ] `CLI-44` Complete native launch templates for supported hosts.
- [ ] `CLI-45` Match native `learn` quick start, guide bytes and reference topics once go-4 lands the assets.
- [ ] `CLI-46` Complete `storage` with native maintenance guidance after retained-cleanup approval.
- [ ] `CLI-47` Compose internal worker commands for the channel server, PTY server, reply notices and request observation.
- [ ] `CLI-48` Compose internal managed-installation setup, refresh, upgrade and database maintenance commands.
- [ ] `CLI-49` Compose internal allowance, consumption, flush and Digest callbacks.

### Native test mappings from merged main

- `rust/crates/tmt-adapters/src/request_frame.rs` frame guidance, byte stability and sender escaping → `go/internal/output/output_test.go` coverage in `TestRequestFrameOneClosingGuidance` and `TestRequestFrameNativeSenderEscaping`.
- `rust/crates/tmt-cli/src/exchange_command/presentation.rs` incoming reply command in JSON and human presentation → `TestExchangeListAndShowProtectContentBoundaries` in `go/internal/cli/exchange_test.go`.
- `typescript/test/e2e/talk-completion.e2e.test.ts` receipt line and request correlation → `TestLiveTalkGetsDurableReplyFromPrivateFakeProvider` in `go/internal/cli/talk_private_test.go`, with the exact line pinned by the output frame tests.

## go-4 (install, extensions, api, mcp, digest, tick)

API help is compared byte-for-byte (after the executable-name substitution) by
`go/test/parity` → `TestHelpMatchesNative/{80,120}/api`, against the native
binary built from the same branch. Existing TypeScript assertions reused unchanged
in the initial dual-runtime native slice (3 passed on each runtime):

- `typescript/test/native/api.test.ts` checks incomplete session frames and
  incomplete/oversized one-shot input before opening storage.
- `typescript/test/native/extension-command.test.ts` checks exact external argv,
  stdin, stdout, stderr, exit status, and the callback executable.

The same three TypeScript assertions also passed with `nativecompat` and the
unmodified TypeScript harness. The dispatch-only CI job is available. Its first
E2E measurement is pending.

- [ ] Finish local API v1 operation admission, response parity, lazy schema fencing,
  lifecycle delivery, and CLI composition. Qualify MCP identity pinning and all
  eight tool calls against real Go request services.
- [ ] Complete Digest receiving sync, consumption limits and changes, and live
  claim/flush/wake parity. Port thread-root framing and pass the configured
  paste-enter delay through CLI composition.
  Port the finite and foreground tick, job and capture composition, and consented
  timer commands over the clock lease and minute window.
- [ ] Port lifecycle-hook enable, disable and delivery with executable verification
  and bounded context contributions.
- [ ] Complete orchestration overview, plans, preview, jobs, talks and routes.
  Why shares its JSON projection between the API and CLI. Its paging,
  uncertainty and unchanged change-cursor
  assertions map to `why_reads_actual_transactional_events_and_preserves_uncertainty`
  in `rust/crates/tmt-cli/tests/orchestration.rs`. Why advertises Digest claims
  and settlements. Hold and sending producers and other orchestration CLI
  entry points remain pending. Then port workspace capture and restore and the remaining
  external-command dispatch markers.
- [ ] Port Go guide reference topics in native order. Complete setup, owned skill
  registry and provider integration that are currently unported in the managed
  skills adapter. Keep Go launch guidance on its isolated binary and home.
- [ ] Finish installation and upgrade parity and the consented Go uninstall.
  Its experiment scope is the Go executable and Go home.
