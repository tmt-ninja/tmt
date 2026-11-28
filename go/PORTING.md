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
