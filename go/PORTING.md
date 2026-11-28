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
- [ ] GO1-08: Digest holds and provider activity in the request delivery view.
- [ ] GO1-09: Read footprint page counts when a WAL exists without an index.
- [ ] GO1-10: Enumerate the full native Colab backup set in footprint.
- [ ] GO1-11: Reply callbacks, provider capture and flow accounting.
- [ ] GO1-12: Partial usage totals for unmeasured wake turns.
- [ ] GO1-13: End the binding’s Digest continuation.
- [ ] GO1-14: Exact resume for Claude and Codex, including the read-only preset projection.
- [ ] GO1-15: Resume forget, move, new, retry, driver switching and stale/pending settlement.
- [ ] GO1-16: Gemini exact resume.
- [ ] GO1-17: Resume launches that honor saved wrapper, model, effort and channel settings.
- [ ] GO1-18: Exact send-now release, guarded claim and settlement.
- [ ] GO1-19: Reply and timeout notice production.
- [ ] GO1-20: Selected Digest checklist snapshot and summary-only counts after settlement.
- [ ] GO1-21: Observe future schema versions through an existing API session.

## go-2 (sys, process, tmux, host, drivers, channel)

## go-3 (cli, output)

- [ ] `CLI-01` Implement `resume` and `run --resume` with a verified remembered session, plus preset inspection, forget, retry, move, fresh start and driver switching.
- [ ] `CLI-02` Implement `send-now` with authorization, a claim on the original queued attempt and verified delivery settlement.
- [ ] `CLI-03` Implement `focus`, `focus --client` and `focus --into` with verified client and pane evidence.
- [ ] `CLI-04` Implement `discover` with bounded candidate evidence, classification and discovery digests.
- [ ] `CLI-05` Implement discovery-guarded `add --expect` and `--identity` against fresh evidence.
- [ ] `CLI-06` Implement `marked` with a frozen mark and an exact binding check.
- [ ] `CLI-07` Implement interactive `attach` and `--detach-others` through the verified built-in terminal stream.
- [ ] `CLI-08` Implement caller discovery from tmux process ancestry when environment claims are unavailable.
- [ ] `CLI-09` Reconcile orphaned and legacy pane metadata during binding.
- [ ] `CLI-10` Project remembered sessions and provider activity in `ls` and reconcile binding presence.
- [ ] `CLI-11` Implement `ls --room` membership filtering.
- [ ] `CLI-12` Implement `ls --detected` with host and socket selection.
- [ ] `CLI-13` Implement bounded `whoami --context` output.
- [ ] `CLI-14` Implement direct-pane `talk` with verified driver routing.
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

## go-4 (install, extensions, api, mcp, digest, tick)

- [ ] Finish local API v1 operation admission, response parity, lazy schema fencing,
  lifecycle delivery, and CLI composition. Qualify MCP identity pinning and all
  eight tool calls against real Go request services.
- [ ] Finish Digest checklist read, claim, delivery and settle, receiving sync,
  consumption limits and changes, and the shared wake clock. Port the finite and
  foreground tick clock, job and capture composition, and consented timer commands.
- [ ] Prove resolved child execution and callbacks against a real Rust companion
  using the Go home. Port lifecycle-hook enable, disable and delivery with
  executable verification and bounded context contributions.
- [ ] Complete orchestration reads and CLI commands, including the Why journal,
  then workspace capture and restore; port the external-command dispatch markers
  currently marked unported in the dispatch adapter.
- [ ] Port Go guide reference topics in native order. Complete setup, owned skill
  registry and provider integration that are currently unported in the managed
  skills adapter. Keep Go launch guidance on its isolated binary and home.
- [ ] Finish installation and upgrade parity and the consented Go uninstall.
  Its experiment scope is the Go executable and Go home.
