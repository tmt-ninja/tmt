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
  - Native `storage/requests/service_tests/attention.rs::metadata_expiry_hides_show_and_ack_at_deadline_equality`
    and `final_state_distinguishes_expired_body_from_unavailable_body_at_retention_boundary`
    map their list/show and expired-final assertions to
    `TestExchangeReadHidesExpiredContentAndMetadataWithoutCleanup` in both
    directions. The Go test checks prompt,
    final and metadata deadlines separately and verifies the read leaves the
    stored bodies and cursor intact. The unchanged
    `exchange.test.ts::rejects an unverified implicit caller before request housekeeping`
    also requires a physical scrub on admitted outgoing X and remains pending.
- [ ] GO1-06: Atomic SQLite symlink refusal when opening the hook queue or existing capture store.
- [ ] GO1-07: SQLite no-checkpoint-on-close connection option.
- [x] GO1-08: Digest holds and provider activity in the request delivery view.
- [x] GO1-09: Read footprint page counts and discovery ownership from an unindexed WAL.
  - Native `storage/compaction.rs::page_observation_is_read_only` maps to
    `TestInspectFootprintObservesCommittedWALPages` for a successful observation
    during a writer with unchanged source bytes. This test and
    `TestReadDiscoveryPreservesOwnershipAndFiltersHostSocket` add committed
    WAL-only visibility with no SHM creation. `TestInspectionRefusesUnindexedWALDrift`
    pins refusal on file drift.
- [ ] GO1-10: Enumerate the full native Colab backup set in footprint.
- [ ] GO1-11: Reply callbacks, provider capture and flow accounting.
  - Native `storage/capture_batches/tests.rs::rejected_turn_ends_distinguish_missing_starts_from_duplicates_interrupts_and_clock_rollback`
    and the continuation assertions in `binding/session/activity.rs` map to
    `TestPrepareHookCaptureFencesExactLaunchAndCommitsFinal` for duplicate,
    missing, interrupted and strictly later continuation outcomes.
    The same Go fixture pins prepare under a Core writer and exact receipt replay.
    `TestOpenExistingCaptureRequiresCurrentRegularDatabase` pins a silent missing
    database and unchanged incompatible files. `BenchmarkPrepareAndCommitHookCapture`
    uses a populated private fixture with 513 identities and 1,024 historical
    batches for comparison against native prepare and ingest. Stop composition
    and the remaining capture/accounting producers are in progress.
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
    for active binding replacement and detach.
  - Native `binding/session/activity.rs::synchronous_events_do_not_inherit_other_sessions_or_processes`
    maps to `TestClaudePromptAdmitsOrdinaryStopAndKeepsNewerActivity`: a second
    uncorrelated Claude prompt starts a fresh Working turn even when Stop was
    missed, an older prompt changes nothing, and ordinary Stop needs the
    recorded start.
  - Native `binding/session.rs::the_same_process_continues_a_binding_awaiting_its_next_session`
    pins same-incarnation adoption and refusal for an occupied session or
    replaced process. Go `TestLateClaudeStartupAdoptsOnlyExactAdmittedSession`
    checks those invariants for a sessionless admitted launch, plus the
    persisted lease, preference and saved-session fences. Same-process
    clear and session switching remain open.
- [ ] GO1-14: Exact resume for Claude and Codex, including the read-only preset projection.
- [ ] GO1-15: Resume forget, move, new, retry, driver switching and stale/pending settlement.
  - Go `TestForgetResumeLaunchAndSessionKeepIndependentEvidence` maps the
    durable forget and forget-again assertions in
    `run-harness.e2e.test.ts::resumes only the exact remembered session, never starts fresh and marks only trustworthy failures stale`.
    It maps the current-driver preset clear from
    `runtime/launch_preset.rs::retained_presets_match_only_their_driver_and_clear_without_reappearing`
    and the session-preserving clear from the TypeScript recorded-wrapper fixture.
    CLI command coverage remains open.
- [ ] GO1-16: Match native Gemini resume refusal and unregistered-session cleanup.
  - Native `drivers/gemini.rs` registers no runtime.
    `runtime/session_presence/tests.rs::first_party_drivers_look_only_in_their_own_private_tree`
    expects unknown Gemini session presence. The storage refusal in
    `TestVerifyResumeRefusesSavedEvidenceBeforeMutation` covers the
    `RESUME_UNSUPPORTED` branch in `run_command/resume.rs`.
    Unregistered-session cleanup and CLI parity remain open.
- [ ] GO1-17: Resume with saved wrapper, model, effort and channel settings.
  - Go `TestResumePresetProjectionAndFence` maps the exact-session preset
    selection in native `runtime/launch_preset.rs` and the associated model
    refresh in `resume_command.rs` `--show`. Wrapper replay and channel
    support remain open.
  - Go `TestResumeStateModelReadsNativeVersions` maps the launch-model
    and unreadable-document assertions in `runtime/driver_state.rs`.
- [x] GO1-18: Exact send-now release, guarded claim and settlement.
- [ ] GO1-19: Reply and timeout notice production.
- [x] GO1-20: Selected Digest checklist snapshot and summary-only counts after settlement.
- [x] GO1-21: Observe future schema versions through an existing API session.
- [ ] GO1-22: Decode authoritative Digest idle activity for Agy and Pi.
- [x] GO1-23: Preserve the retained thread-root frame when a request is sent now.
  - Native `storage/room/tests.rs::a_roster_post_reaches_only_the_addressed_members`
    maps to Go `TestSendNowProjectsExactRetainedThreadRoot` for the stored root
    ID and retained prompt. The same test pins the root ID when the prompt or
    root retention expires, or the root row is absent.
  - Native `storage/digest_hook.rs` uses the same request frame for live and
    held deliveries. Go `TestDigestClaimSealsExactPrefixAndSettlesOnce` pins the
    same root projection in both the claimable preview and exact claimed read.
    It also checks ID-only fallback at expiry and content-free history.
  - Go `TestThreadReplyLineMatchesNativeAssertion` ports the bounded and
    ID-only previews from native `request_frame.rs` and checks that the child
    frame after the prefix is byte-for-byte unchanged.

- [x] GO1-24: Read existing discovery ownership without provisioning.
  - Native `storage/bindings/service_tests/discovery.rs::read_only_discovery_preserves_rows_and_distinguishes_known_stale_hook_only_and_duplicates`
    maps to Go `TestReadDiscoveryPreservesOwnershipAndFiltersHostSocket` for unchanged
    ownership, host isolation, and both records for a duplicate pane, and to
    `TestReadDiscoveryLeavesMissingHomeAbsent` for a missing database. Candidate
    classification is tracked in CLI-04.

- [x] GO1-25: Read plans and their revision without expanding members.
  - Main native `orchestration/read.rs` Plans read permits 257 active identities
    and returns `ORCH_LIMIT` at 129 plans. Go
    `TestOrchPolicySnapshotUsesNativeMemberCapAndFilterOrder` covers both
    boundaries, plan order, targets and member overrides.

- [x] GO1-26: Resolve Digest receiving through the shared orchestration evaluator.
  - Native `orchestration/calendar.rs::gap_clamps_and_fold_encloses_both_occurrences`
    maps to `TestGapClampsAndFoldEnclosesBothOccurrences` in Go's shared calendar.
    `TestDigestCalendarPinsDSTBoundaries` retains the storage boundary assertion,
    and `TestDigestReceivingUsesSharedPlanAndFencesCalendar` verifies projected
    receiving, exact source and slot, the master switch and stale-calendar refusal.

- [x] GO1-27: Read Jobs by exact display number and project last-run request evidence.
  - Native `storage/orchestration/jobs.rs::resolve_orchestration_job` and
    `jobs/tests/public_read.rs::public_jobs_page_is_complete_scoped_and_bounded_while_show_keeps_exact_text`
    map to `TestReadJobsFiltersPagesAndProjectsPolicyAndRuns` for exact text,
    valid and removed job numbers, bounded selectors, and unchanged paging.
  - Native `jobs/tests/public_read.rs::last_run_uses_canonical_final_state_without_read_mutations_or_response_bodies`
    and `request/service/history.rs` map to `TestReadJobRunProjectsExactRequestEvidence`
    for canonical final metadata, unchanged cursor, no final text, and exact
    parent, room and recipient acknowledgement evidence.

- [x] GO1-28: Create, read, replace and retire Room rosters in the caller's transaction.
  - Native `storage/room/tests.rs::explicit_rosters_round_trip_offline_members_and_enforce_cas`
    and `effective_membership_fences_retirement_even_when_definition_revision_did_not_change`
    map to `TestRoomOfflineRosterRoundTripsWithCASAndEffectiveMembership`.
  - Native `membership_edits_are_idempotent_and_independent_across_rooms` and
    `late_membership_failure_rolls_back_the_existing_roster_and_revision` map to
    `TestRoomMembershipEditsAreIdempotentAndRollBackOnLateFailure`.
    Native `simultaneous_joins_preserve_both_members_and_existing_roster` maps to
    `TestConcurrentRoomJoinsPreserveExistingRoster`.
  - Native `room_retirement_preserves_rosters_and_history_but_fences_new_work_and_recreation`
    roster assertions, `failed_retirement_does_not_change_revision_or_membership`
    and `final_room_revision_can_retire_once_and_replay_without_overflow` map to
    `TestRoomRetirementPreservesHistoricalRosterAndReplaysAtMaxRevision`.
    CLI selectors and durable dispatch composition are separate.

- [x] GO1-30: Keep fresh-open migrations convergent under contention.
  - Native `storage/tests.rs::concurrent_openers_commit_each_migration_only_once`
    and `cold_open_race_initializes_wal_for_every_caller` map to
    `TestConcurrentFreshOpen`. Migration 41 builds its private reference before
    taking the live writer, then validates the actual schema under that writer.
    `migrations/writer_wait_tests.rs::a_writer_that_adds_no_version_still_ends_the_wait_in_busy_after_the_stall_bound`
    maps to `TestOpenStalledMigrationReturnsTypedBusy` at the production bound.

## go-2 (sys, process, tmux, host, drivers, channel)

- [x] GO2-01: Native selected-process start reads on Darwin and Linux before the bounded ps fallback. Rust `process/process_info.rs::stopped_and_exited_owned_children_keep_batch_parity` → `TestNativeProcessStartsForLiveStoppedAndGone` and `TestNativeStartTokenMatchesTheBoundedPSFallback`; Linux stat parsing → `TestNativeLinuxStatKeepsTheStartFieldAfterComplexCommand`. Under concurrent test suites, repeated batched ps reads exhausted the swap budget, including the fresh post-swap check. Native reads preserve the persisted token and remove those subprocesses. Each focus ancestry proof also checks both required links from one snapshot (`TestProcessTreeProvesBothSegmentsFromOneSnapshot`), with fresh rechecks and deadlines intact.
- [ ] GO2-02: Launch into a missing session only with private-server ownership.
- [ ] GO2-03: Launch-only Gemini skill discovery from native's shared skill root. Native Gemini registers no runtime or launch hooks.
- [x] GO2-04: Claude Digest continuation output and Stop completion. Verified prompt routing uses the existing writer. Native `runtime/prompt_tests.rs::prompt_hooks_decode_only_submissions_and_encode_their_own_event` (Claude decode cases) → `TestClaudePromptDecodesOnlySubmissions`; the prompt/blocked-Stop boundary in `a_stop_blocked_continuation_stays_open_until_its_own_stop_or_a_prompt` → `TestClaudeDigestPromptUsesExactAdmissionAndLeavesStopSeparate` plus the GO1-13 storage tests. Codec and handoff parity: native `drivers/claude/digest/tests.rs::only_unrecursive_documented_main_stop_claims_and_output_uses_block_reason` and `responses.rs::byte_cap_preserves_scalars_and_line_endings_without_a_marker` → `TestClaudeStopOnlyOffersDigestForDocumentedUnrecursiveMainStop` and `TestClaudeStopBoundsProviderFinalAtScalarBoundary`; `process/handoff.rs` exact/partial/expired output and flag restoration → `TestWriteHandoffPublishesExactBytes`, `TestWriteHandoffDistinguishesBlockedPartialAndExpired` and `TestNonblockingHandoffRestoresOriginalStatusFlags`.
  - Native `digest_hook_command.rs` worker reserve, pinned handoff and exact outcome mapping → `TestClaudeDigestWorkerUsesReservedBudgetAndExactScope`, `TestClaudeDigestWorkerDoesNotRunAfterReserve` and `TestClaudeDigestOnlyCompletePublicationIsDelivered`. Existing-schema capture and verified Stop → `TestClaudeContinuedStopCommitsOnlyThePreparedExactCapture` and GO1-13 storage checks. Native `drivers/claude/digest/tests.rs` settings composition, setup-owned observers, explicit settings and ignored user sources → `TestDigestLaunchAddsOneActivityObserverAndOneScopedStop`, `TestDigestLaunchPreservesSetupObserversAndExplicitSettings`, `TestDigestLaunchRefusesAmbiguousSettingsWithoutReadsOrWrites` and `TestSetupStopObserverRequiresExactSelectedFlavor`. The managed-launch regression `TestPrivateClaudeStopPublishesAndClosesExactContinuation` exercises the native scoped Stop hook from `typescript/test/e2e/run-harness.e2e.test.ts` and the retained-answer boundary from `external_host.rs::a_stop_that_ends_a_digest_continuation_is_admitted_and_keeps_its_response`. It holds SessionStart until foreground admission, delivers one checklist, confirms it on its own Stop and verifies runtime exit.
- [x] GO2-05: Claude leaves user-installed plugins in place. Native `drivers/claude/digest/tests.rs::launches_add_no_plugin_dir_and_keep_the_users_own` → `TestClaudeLaunchesAddNoPluginDirAndKeepTheUsersOwn` (fresh, explicit plugin, resumed with explicit plugin, Stop settings and unchanged fixture files).
- [ ] GO2-06: Claude channel enrollment composition for a verified binding and launch owner.
- [x] GO2-07: Codex managed state-root grant follows explicit launch options and bounded settings/profile evidence from the child environment. Native `drivers/codex/launch_permissions.rs` explicit, ambiguous and prompt cases → `TestCodexManagedGrantTracksExplicitModesAndPromptBoundaries`; private config and replayed profile cases → `TestCodexManagedGrantReadsPrivateSettingsAndSelectedProfile`; managed fresh, exact resume, remote and wrapper cases → `TestCodexManagedFreshResumeAndUnmanagedInvocations`.
- [ ] GO2-08: Codex invocation-only managed skills.
- [ ] GO2-09: Enable Codex invocation hooks through the verified lifecycle and Digest callbacks.
- [ ] GO2-10: Compose qualified Codex channel startup and emit the native preflight advisory.
- [ ] GO2-11: Enforce the native 256 KiB Codex WebSocket inbound frame cap in addition to the 1 MiB message cap.
- [x] GO2-12: Exact invoking tmux client focus and directional pane swap. Ambiguous client claims refuse rather than using activity as an identity proof. Key-job session parity: Rust `tmux/focus.rs::a_key_binding_job_without_a_pane_uses_the_session_in_tmux` → `TestKeyBindingJobUsesTheSessionInTmux`; the pane-less `focus --client` view in `typescript/test/e2e/focus.e2e.test.ts` → the private-client assertion in `TestPrivateFocusAndSwapExactInvokingClient` (CLI scenario owned by go-3). Swap result parity: Rust `swap_uses_exact_ids_and_detaches_without_selecting_or_killing` and `swap_already_beside_and_refusals_have_no_mutating_call`, plus the displaced-pane and already-beside cases in `focus.e2e.test.ts` → the private swap assertions in `TestPrivateFocusAndSwapExactInvokingClient`.
- [x] GO2-13: Bounded discovery and exact marked-pane snapshots.
- [x] GO2-14: Built-in terminal attach over an admitted PTY connection.
- [ ] GO2-15: Go-owned built-in PTY supervisor and launch lifecycle.

- [x] GO2-16: Codex npm launcher evidence. Native `drivers/codex/launch_process.rs` exact package/script and direct executable cases → `TestNpmSelectedPackageAndRunningScriptMustAgree` and `TestNpmDirectLaunchRemainsDistinctFromUnprovedShim`. Native `runtime/evidence.rs` immediate-child and pinned-incarnation cases → `TestSelectedLauncherMustHaveOneExactImmediateForegroundProvider` and `TestNpmForegroundRechecksExactLauncherAndUniqueImmediateChild`. CLI launch and exit composition is tracked in CLI-01.

## go-3 (cli, output)

- [ ] `CLI-01` Complete resume with direct provider session presence checks, Codex npm launcher ownership, Gemini, retry, move, fresh start and driver switching. Saved presets with an exec-in-place launcher replay the pinned command and settings. Generic wrapper descendants receive no runtime admission.
- [ ] `CLI-02` Extend send-now to verified provider-channel delivery and built-in and external hosts.
- [ ] `CLI-03` Focus built-in and external hosts. Go tmux focus is covered by the focus parser cases from Rust parser/tests/identity.rs and the private Go equivalents of typescript/test/e2e/focus.e2e.test.ts: cross-session focus and back, unique/ambiguous key jobs, four-direction swap and already-beside, zoom and absent/stale/foreign refusals.
- [ ] `CLI-04` Port admitted external host discovery and additional native built-in driver aliases. The tmux inventory tests reuse the read-only scan and fresh binding assertions from `discovery.e2e.test.ts` and the native SHA-256 contract vectors from `contracts/discovery-v1.json`.
- [ ] `CLI-05` Implement discovery-guarded `add --expect` and `--identity` against fresh evidence.
- [ ] `CLI-06` Port the native optional pane badge. Tmux marked binding uses a frozen target; private fixtures reuse the missing mark, invalid name, no fallback, repeat/promotion/conflict, mark move and vanished pane assertions from `marked-binding.e2e.test.ts`.
- [ ] `CLI-07` Implement interactive `attach` and `--detach-others` through the verified built-in terminal stream.
- [ ] `CLI-08` Implement caller discovery from tmux process ancestry when environment claims are unavailable.
- [ ] `CLI-09` Reconcile orphaned and legacy pane metadata during binding.
- [ ] `CLI-10` Project remembered sessions and provider activity in `ls` and reconcile binding presence.
- [x] `CLI-11` Scope `ls --room` to the active roster, including offline members.
- [ ] `CLI-12` Implement `ls --detected` with host and socket selection.
- [ ] `CLI-13` Implement bounded `whoami --context` output.
- [ ] `CLI-14` Port direct-pane talk on non-tmux hosts. Verified bound tmux panes keep the Inbox route. Unbound tmux panes retain the request against the exact endpoint and require a fresh paste fence. Private Go tests map durable receipt, detach/result, and byte preservation from `durable-talk.e2e.test.ts`, `smoke.e2e.test.ts` and `response-integrity.e2e.test.ts`.
- [ ] `CLI-15` Implement `talk --remote` through Remote delivery.
- [ ] `CLI-16` Implement `talk --room` and its membership rules.
- [ ] `CLI-17` Implement `talk --passthrough` through guarded raw paste.
- [ ] `CLI-18` Apply the validated `talk --expect-name` UUID/name pin on the Remote route (CLI-15).
- [ ] `CLI-19` Send best-effort reply notifications after durable acceptance.
- [ ] `CLI-20` Deliver the retained Digest checklist from ordinary idle `check`.
- [ ] `CLI-21` Implement `x flow` with content-free exchange counts.
- [ ] `CLI-22` Implement bounded `x listen` with incoming attention and room filtering. The native timeout and debounce options validate before execution.
- [ ] `CLI-23` Compose launch enrollment and guarded channel routing, including `run --channel` and remembered channel choice.
- [ ] `CLI-24` Implement `channel inspect` and `channel recover`.
- [ ] `CLI-25` Launch through built-in and approved external hosts.
- [x] Shared retained thread previews in live request frames. The output fixture ports `request_frame.rs::the_thread_line_is_one_display_normalized_bounded_line` and verifies the frame preserves the exact child bytes after the one-line prefix.
- [ ] `CLI-26` Support bare provider launches, automatic names and remembered or configured launch selection.
- [ ] `CLI-27` Launch arbitrary foreground programs and remaining managed drivers.
- [ ] `CLI-28` Map foreground termination to the native signal-specific exit status.
- [ ] `CLI-29` Complete lifecycle callback activity, provider context and Digest continuation.
- [ ] `CLI-30` Compose `api` over its stdio server and typed operations.
- [ ] `CLI-31` Compose `mcp` with a pinned saved identity and canonical exchange and dispatch owners.
- [ ] `CLI-32` Compose durable `room send` and `room broadcast`. Room creation, listing, historical show, retirement and membership are ported.
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

- [x] `CLI-50` Fix intermittent parallel private-tmux deadlines via GO2-01 (8d7b740d72). `TestPrivateDiscoveryAndMarkedPaneWithoutMetadata` expired its 1 s process read in the old pane's exact Discover after re-marking. `TestDiscoverAndMarkedOnPrivateTmux` returned an empty, truncated initial inventory under load. `TestPrivateFocusAndSwapExactInvokingClient` reached the 12 s fixture limit in its last focus action. A separate adapter trace pinned the 4 s swap deadline in a post-swap batched `ps` read with 368 ms left, following reads up to 944 ms. `TestFocusSwapGeometryMatchesNative` reported generic reconciliation in left and right without identifying a stage. Native start observations and one ancestry snapshot per proof replace the repeated subprocess work. All original deadlines and exact pre/post checks remain, and all four fixtures passed uncached with package parallelism in both flavors.

### Native test mappings from merged main

- `typescript/test/native/room.test.ts` membership, listing, ambiguity and malformed command cases run unchanged in the parity manifest. The retired UUID, idempotent retirement and still-retained membership assertions → `TestRoomRetainsRetiredUUIDWithoutResolvingItsName`. Rust `parser/tests/room.rs` dispatch argv and malformed commands → `TestRoomGrammarMatchesNative`. The Rust renderer oracle `room_command.rs::rooms_list_in_state_sections_by_name_with_short_ids` → `TestRoomListMatchesNativeStateSections`.

- `typescript/test/native/binding.test.ts` lifetime filtering, outside-tmux `ls --here` refusal and Unicode list alignment run unchanged in the parity manifest. `TestListHerePinsCallerSessionAndServerBeforeOpeningStorage` verifies the exact caller session and refuses a conflicting server claim before opening storage.

- `rust/crates/tmt-cli/src/parser/tests/messaging.rs` listener timing bounds → `TestExchangeListenValidatesNativeTimingOptions`. The manifest runs five unchanged native `exchange.test.ts` and `inbox.test.ts` cases for retired or foreign selectors, explicit offline identity, legacy flag refusal, recipient pull and acknowledgement boundaries.

- `rust/crates/tmt-cli/src/parser/tests/messaging.rs` Remote UUID pin and passthrough-option constraints → `TestTalkAdmissionMatchesNativeRemoteAndPassthroughOptions`. The manifest runs two unchanged `test/native/talk.test.ts` preflight cases for timing/config and missing recipients against both executables.
- `typescript/test/e2e/check-routing.e2e.test.ts` capture-only UUID pin, remapped name and retired UUID refusals → `TestCheckPinsCaptureToActiveUUIDBeforeHostAccess`; explicit line-count and capture-only pane routing → `TestCheckCapturesExplicitPrivatePaneWithPositionalLinePrecedence` and `TestCheckExplicitLinesStillValidatesConfigBeforeStorage`. The manifest runs three unchanged `test/native/check.test.ts` cases covering missing/inactive names, invalid config and read-only lookup misses.

- `rust/crates/tmt-cli/src/parser/tests/setup.rs` hidden Digest callback, legacy baked argv, discover-launch and bounded worker budget assertions → `TestDigestHookGrammarMatchesNative`, `TestDigestHookGrammarRejectsInvalidSourcesAndBudgets` and `TestHiddenNamesAreReservedButAbsentFromHelp`.

- `rust/crates/tmt-cli/src/resume_command.rs::named_preset_inspection_and_clear_bypass_failed_caller_selection` and the forget assertions in `typescript/test/e2e/run-harness.e2e.test.ts` → `TestResumeNamedPresetAndForgetWithoutAHost`. The native storage-denial case `preserves human launch-state refusal and resumes normal forgotten-session lookup` → `TestResumeForgetStorageDenialLeavesDatabaseBytes`. The private tmux fixture also pins implicit preset clearing and native's nameless `--forget` dispatch.
- `rust/crates/tmt-adapters/src/runtime/launch_preset.rs` model, explicit environment and same-basename fallback assertions, plus the exec-wrapper assertions in `typescript/test/e2e/run-harness.e2e.test.ts` → `TestResumePreparationReplaysSavedSettingsWithoutChangingParent` and `TestResumeForegroundUsesSavedCodexSession/saved_exec_wrapper`. The private fixture verifies replayed argv, the exact admitted provider session, receipt-bound delivery and ended runtime state.
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
unmodified TypeScript harness. Dispatch-only CI run `46152837311` passed
3 native and 9 E2E cases each against Go and Rust. The unchanged Digest discovery
case in `typescript/test/native/digest-delivery.test.ts` passed separately against
both runtimes after receiving sync was added.

- [ ] Finish local API v1 operation admission, response parity, lazy schema fencing,
  lifecycle delivery, and CLI composition. Qualify MCP identity pinning and all
  eight tool calls against real Go request services.
- [ ] Complete Digest consumption limits and changes, and live claim/flush/wake parity and pass the configured paste-enter delay through CLI
  composition. The shared thread-root frame is measured before sealing, with
  the native whole-first-item Stop bound. The retained and ID-only lines and
  one-receipt assertion map to `storage/digest_hook.rs` in the Rust adapter.
  Receiving publication and unchanged-cursor CAS map to
  `storage/orchestration/receiving.rs`.
  Port the finite and foreground tick, job and capture composition, and consented
  timer commands over the clock lease and minute window.
- [ ] Port lifecycle-hook enable, disable and delivery with executable verification
  and bounded context contributions.
- [ ] Complete orchestration job mutations and execution, talks and routes.
  API and CLI job reads share the cursor, schedule and recorded run projection.
  Exact definition bytes, CLI/API list equality and unchanged cursors map to
  `job_help_preview_exact_message_and_cli_api_reads_are_causal` in
  `rust/crates/tmt-cli/tests/orchestration/jobs.rs`. The TypeScript Ops
  scenarios that read jobs also require job writes and companion integration.
  Plan list/show share the API projection and port exact selector and
  UUID-shaped name assertions from `plan_filters_keep_competing_effects_and_uuid_selection_never_falls_back_to_names`
  in `rust/crates/tmt-cli/tests/orchestration.rs`. Overview uses one effective
  resolver and preserves member selection and plan sources. Gap, fold, and
  half-hour range assertions map to the native `orchestration/calendar.rs`
  tests. Digest storage uses the same resolver. Preview and its unchanged
  cursor and malformed candidate cases map to
  `preview_is_in_memory_and_bad_candidate_or_future_schema_preserves_state`
  in the native CLI tests.
  Why shares its JSON projection between the API and CLI. Its paging,
  uncertainty and unchanged change-cursor assertions map to `why_reads_actual_transactional_events_and_preserves_uncertainty`
  in `rust/crates/tmt-cli/tests/orchestration.rs`. Why advertises Digest claims
  and settlements. Hold and sending producers and other orchestration CLI
  entry points remain pending. Then port workspace capture and restore and the remaining
  external-command dispatch markers.
- [ ] Port Go guide reference topics in native order. Complete setup, owned skill
  registry and provider integration that are currently unported in the managed
  skills adapter. Keep Go launch guidance on its isolated binary and home.
- [ ] Finish installation and upgrade parity and the consented Go uninstall.
  Its experiment scope is the Go executable and Go home.
