# Digest usage report contract v1

`tmt digest usage report [--since 24h|7d|30d] (--json | --csv usage|credits|exchange)`
joins Core's public consumption, limit and exchange documents into one read for
people and spreadsheets. `--since` defaults to `24h`; exactly one output is chosen.
`tmt digest usage report --from <RFC3339> --json` reads from an absolute start instead
and adds [spend per provider](#spend-from-a-start).
It is read-only: Digest keeps no usage store, collector or scheduler for it, and it
never changes settings or delivers messages. Token figures come from Core; input
cost estimates use Digest's existing price-table owner and add no usage evidence.

## Reads

Digest calls Core only through public commands, under a 60-second command deadline
with Core's usual 15 seconds and 1 MiB per call:

1. `tmt identity ls --json`: the roster. This is the only required read.
2. `tmt x flow --since W --bucket W --json`: one row per sender, recipient and kind
   for the window ([flow contract](../../../contracts/request-response-v1.md#content-free-exchange-flow)).
3. `references.resolve` for flow participants that are not on the roster (names,
   retired).
4. `consumption.history` for the roster plus retired flow participants, ordered by
   name then UUID, in batches of 16, as two reads of `windowsMs:[W]` with
   `includeRetired:true`: `maxBuckets:1` for totals with attribution and
   `maxBuckets` 24 (`24h`, hourly) or 7 / 30 (`7d` / `30d`, daily) for the series.
   Windows above an hour read Core's [32-day rollup](../../../contracts/extension-api.md#five-minute-rollup),
   so `window.toMs` is the last completed five-minute boundary and up to five minutes
   of the newest activity are not in it. Totals are Core's, never a sum of buckets.
5. `storage.root` locates Digest's optional validated price cache. This read never
   fetches, refreshes or writes it; an absent/unusable cache or root read uses the
   embedded table. Status remains the owner of price-file refreshes.

## Document

`--json` prints one document, `{"version":1, ...}`:

- `observedAtMs` (Digest's clock), `since`, and `window` (`{fromMs,toMs}` Core
  reported; null when no identity could be read).
- `usage.seats[]` (identities with rollup evidence): `id`, `name` (null when Core
  could not resolve it), `retired`, `totals` `{input,output,cached}`, `byModel`
  (Core's attribution as `{modelId,input,output,cached,cacheWrite,cost,costUnavailable}`,
  or null when Core attributed none of the total; the rows may sum to less than `totals`;
  `cacheWrite` is null when Core reported no count; `cost` and `costUnavailable` are the
  seat's own share as `usage.models[]` defines them), `cost` and `costUnavailable` (the
  seat's total: the sum of its rows' costs, `lowerBound` when any row is a floor; null
  with every reason when a row with tokens is unpriced, and with `unattributed` when the
  seat has tokens no model row covers; `{usdMicros: 0, lowerBound: false}` for a seat with
  no tokens; a row with no tokens never blocks it), `unattributed`
  (`{input,output,cached}`, present only when `byModel` is not null and the rows sum to
  less than `totals`: what no model row covers), `lines` (the lines its tokens belong to,
  as `usage.lines[]` counts them: its models' families, plus `unattributed` for tokens no
  model row covers; empty for a seat with no tokens), `series[]` (`{fromMs,toMs,input,output,cached,coveredMs,complete}`)
  and `coverage` `{coveredMs,windowMs,startsAtMs,complete,gap}`. A `series[]` point also
  carries `serviceTier` (the provider's tier id, such as `default` or `priority`) when
  Core reports the tier of the seat's newest token-moving read in that bucket; absent is
  unknown, never `default`. `startsAtMs` is where
  the seat's evidence begins inside the window: Core's `availableFromMs` for it (the
  start of its first rollup bucket with a successful read), but never before the
  window's own start. Earlier time was not recorded, and Core does not backfill it.
  Cached input is part of input; total is input plus output. An incomplete bucket is a
  lower bound, not an error. Core lists every bucket of the window, and `coveredMs` is the
  bucket's coverage as Core reports it. **A point is no data only when its tokens are 0
  and its `coveredMs` is 0** (the host was asleep, say); any other point, a zero with
  coverage included, is a reading. A point without `coveredMs` comes from an older Digest
  and reads as a reading. `coverage.incompleteReason` is present when the seat's
  newest reading in Core's closed history was incomplete and its driver named why
  (`latest.consumption.incompleteReason`; [values](../../../contracts/extension-api.md#consumption-history)).
  It describes that reading, not every incomplete bucket in the window.
- `usage.unavailable[]`: `{id,name,retired,reason,cause?}` for an identity with no
  evidence: `no_evidence` (found, no successful read in the rollup), `not_found`, or
  `read_failed` (its batch failed or contradicted itself; a warning says why).
  Unavailable is never reported as a seat with zero. A `no_evidence` row carries
  Core's `cause` when Core gave one (`no_binding`, `no_agent`, `no_sampler`, `idle`,
  `not_sampled`; [meaning](../../../contracts/extension-api.md#consumption-history)):
  why nothing is being sampled right now. A value this build does not know is passed
  through, and a reader must tolerate one. The other reasons carry no cause.
- `usage.otherSessions`: `{name:"other sessions",reason:"no_source"}`, always present.
  Core counts a Codex seat's started sessions (subagents and auto-review) with the seat at
  the root of their parent chain
  ([the rule](../../../contracts/extension-api.md#consumption-history)), so every figure above
  is the seat's. A session that no seat started is not read, so its usage is
  unavailable, never a zero and never folded into a seat; the report's totals are the sum of
  its seat rows.
- `usage.lines[]`: totals grouped by model family, from the model id: `claude`
  (`claude-*`), `gpt` (`gpt-*`), `other`, and `unattributed` for totals Core could
  not attribute. `seats` counts identities contributing; `partialSeats` those whose
  coverage is not complete. The family is a presentation label, not a provider claim.
  Each line also has `cost` and `costUnavailable`: the sum of its models' costs (below),
  null with every reason when any model in it is unpriced, and `lowerBound` when any of
  them is a floor; the `unattributed` line is always null with `unattributed`.
- `usage.models[]`: one row per model id across seats, ascending: `modelId`, `line`,
  `totals` `{input,output,cached,cacheWrite}` (`cacheWrite` null when any seat's row lacked
  Core's count), contributing `seats` (sorted UUIDs), `partialSeats`, `cost` (null or
  `{usdMicros, lowerBound}`) and sorted `costUnavailable` reason ids. Rates are per model,
  so this is the priced unit: each seat's share is [quoted](digest-v1.md#quotes) on its own
  over all four classes at the rates in effect on the report's UTC day (a window's rollup
  bucket has no finer time), and the shares are summed. `lowerBound` is true when any
  share's cache writes went unreported where the provider bills them. Reasons: `no_price`,
  `class_price_missing`, `unsafe_cost`; any makes `cost` null.
- `usage.providers[]`: recorded driver shares, ascending by `driver`, from Core's
  optional `byDriver` in the totals read. Each row contains `driver`, `totals`
  `{input,output,cached}`, contributing `seats` (sorted UUIDs), `partialSeats`,
  `inputCost` (null or `{usdMicros}`), and sorted `costUnavailable` reason ids.
  Drivers with no recorded input/output share have no row. Unknown driver ids
  remain distinct; neither current seat state, model families nor allowance windows
  establish a driver. `usage.providerUnattributed` contains the token remainder
  Core could not attribute to a driver, including retained older records. Missing
  or failed usage reads remain in `usage.unavailable`, never zero provider rows.
- `pricing`: the one validated cached-or-built-in pricing snapshot used by the
  model and provider estimates, with the same version, origin, basis and model-rate fields
  as [Digest status pricing](digest-v1.md#pricing-file). A model or line `cost` is a
  **Cost estimate (list price)**; label a `lowerBound` one as a floor. A provider's
  `inputCost` is labelled exactly **Input cost estimate (list price)** and shows the table
  version. It values recorded input as uncached input at each model's `input` rate,
  including cached input once; output is not priced, because a driver share has no class
  split by model. They are not bills or money saved. Prices are applied to
  model-attributed input, never to an inferred latest model. A seat's aggregate
  can be priced for a driver only when one driver covers all its token totals:
  independent driver/model splits do not establish a joint attribution.
  Incomplete recording stays a lower bound, indicated by `partialSeats`.
  An unmatchable driver/model split gives `driver_model_attribution_unknown`;
  missing model input gives `model_attribution_unknown`; an unpriced model gives
  `no_price`; unsafe valuation arithmetic gives `unsafe_cost`. Any such share
  makes that provider's complete `inputCost` null, with the reasons preserved.
  Supported quotes round per model to the nearest micro-dollar, half upward,
  through the canonical pricing owner. Its explicit unbilled-model rule still
  applies. Cost never determines provider membership or token ordering.
- `limits[]`: account windows, deduplicated by `(provider, account key, windowMinutes, resetsAtMs)`
  across seats and buckets; the newest observation wins and windows are never summed.
  The report first reads Core's account-level `consumption.limits`
  ([account limits](../../../contracts/extension-api.md#account-limits)). An entry with
  `rateLimits` replaces every seat-derived window of its `(provider, account key)` whole,
  never merged per window; `seats` still names the seats that reported that account. A
  malformed entry is dropped alone. An older Core (`API_INPUT_INVALID`) or a failed read
  keeps the per-seat derivation below unchanged; a failed read also adds a `limits` warning.
  The report also reads `latest.consumption.rateLimits` from Core's closed-history
  seed: a Claude cache's original fetch may predate the displayed buckets while its
  windows remain current. It preserves that `observedAtMs`, which can be much older
  than the report; it never refreshes the cache or re-dates the evidence.
  The closed seed wins a fetch-time tie, so a rollup cannot restore a cache
  window that the reader already removed at reset.
  Each has `provider` (the driver of the source line, as Core reports it in
  `rateLimits.provider`; never inferred, so an observation without a driver id, as from a
  Core that predates the field, is dropped), `account` (`{key,label}` as Core reports it in
  `rateLimits.account`; absent when Core names none, which reads as the provider's one
  implicit account. A present but malformed one drops the observation, so it never folds
  into another account's windows), `usedPercent`, `observedAtMs`, `seats` (UUIDs), `stale` (`resetsAtMs` is not
  after `observedAtMs` of the report), `elapsedPercent` (share of the window length
  elapsed at the report's `observedAtMs`, clamped to 0–100, two decimals) and
  `paceDeltaPoints` (`usedPercent - elapsedPercent`; negative is under an even pace).
  A stale window has null `elapsedPercent` and `paceDeltaPoints`.
- `limitsUnavailable[]`: `{line,reason}` for each line whose seats reported no
  limits, with `reason: "not_observed"`. A missing/unusable Claude cache is
  unavailable, never zero; older Core/Digest versions may report `no_source`.
  An account Core knows without a current window adds `{provider,account,reason}` with
  Core's `reason` (`none_observed` or `expired`), and its seat-derived windows are dropped.
- Model share: a seat's share of a model over the window is that `byModel` row's tokens
  over the seat's `totals`, with `unattributed` as its own remainder; a seat with null
  `byModel` has no model share. The report adds no separate field for it.
- `credits`: the Codex credit balance over the window, `{points:[...]}`, or null when no
  seat's series carries a balance (Claude has none). It reads the credits and tier that
  Core's rollup keeps per bucket, at the series resolution (hourly for `24h`, daily for
  `7d` and `30d`). A point is `{fromMs,toMs,balance,observedAtMs,hasCredits,unlimited,
serviceTiers}` for a series bucket in which some seat observed a balance: the
  observation with the newest `observedAtMs` among the seats, so seats on one account give
  one series and a balance is never summed. `balance` is the provider's decimal text in its
  credit unit. `serviceTiers` is the sorted set of tier ids seats reported for that bucket
  (empty when none: unknown, never `default`). A bucket nobody observed has no point and
  nothing is carried into it. Core carries no account id with credits, so seats on two
  accounts would interleave in one series; `observedAtMs` shows it.
- `exchange`: `sinceMs`, `observedAtMs`, `pairs[]` (`sender`, `recipient`, `kind`,
  `count`, `bytes`), and `bySender[]` / `byRecipient[]` (`participant`, `count`,
  `bytes`; most messages first, then UUID). A participant is `{id,name,retired}`;
  a null `id` is an unknown sender or recipient. Counts and bytes are content-free
  metadata. Null when the flow could not be read.
- `warnings[]`: `{section,code,message}` for each degraded read.
- `spend`: only in a `--from` report; see [Spend from a start](#spend-from-a-start).

Only the roster is fatal. A failed flow leaves `exchange` null; unresolved names are
null; a failed or inconsistent history batch makes its identities `read_failed`.
Retired identities have no listing, so one appears only as a flow participant.
Failure exits 1 and prints `{"version":1,"error":{code,message}}` on stdout with `--json`, or a one-line error on stderr with `--csv`.

## Spend from a start

`--from` takes an RFC 3339 instant with a `Z` or `±HH:MM` offset (fractions below a
millisecond are dropped). It must lie within the last 32 days, the length Core's
[rollup](../../../contracts/extension-api.md#five-minute-rollup) keeps; an older, future
or unparseable start fails with `DIGEST_INPUT_INVALID` before any read. It conflicts with
`--since` and `--csv`. The document is the one above with these differences:

- Every `consumption.history` read passes one `throughMs`: Digest's clock rounded down to
  five seconds ([pinned cut](../../../contracts/extension-api.md#consumption-history)), so
  every window ends at the same instant. The cut expires after 60 seconds, as Core's pin
  does; a batch read after that fails like any other. `storage.root` is read first,
  because the price rows decide which windows are read.
- `since` is null. `window` and the sections above cover the window from the start rounded
  up to five minutes to the cut's last closed five-minute boundary (at least one slot, so
  a start inside the newest five minutes still has a window; `window` reports the bounds
  Core read). The series is daily.
- `exchange` is null with a `DIGEST_WINDOW_UNSUPPORTED` warning: Core's flow takes only its
  own windows.
- With no flow to find members retired since the start, Digest reads Core's
  [`consumption.retired`](../../../contracts/extension-api.md#retired-consumption) once,
  from the earliest spend start, and reads those identities with the roster (names from
  `references.resolve`; an unresolved one keeps a null name). A failed read, an older
  Core without the operation, or a truncated list adds a `retired` warning and the
  `retired_unread` reason to every spend value.
- `spend`, below. No read touches authentication, key or account state, so spend is never
  split by billing scope; it is a token-based list-price estimate, not a bill.

`spend` is `{requestedFromMs, fromMs, toMs, providers[]}`. `fromMs` is the start rounded up
to five minutes (never before the request, and at most `toMs`) and `toMs` the cut's last
closed five-minute boundary. `providers[]` has one row per billing vendor, ascending:
`anthropic` (model ids starting `claude-`), `google` (`gemini-`) and `openai` (`gpt-`, and
the unbilled `codex-auto-review`). The vendor comes from the model id, because a key is
billed by its vendor whichever driver spent it; Digest owns the prefix map beside its price
table. Every vendor has a row, so a vendor nothing was recorded for is a measured zero
with its reasons. A row is `{provider, fromMs, toMs, models, total, pace}`: `models` are
the sorted model ids that contributed, `total` covers `fromMs` to `toMs`, and `pace` holds
one value for each of the 3, 6 and 24 hours before `toMs`, each with `windowMs`, `fromMs`
and `toMs`. A value is `{usdMicros, complete, lowerBound, reasons}`.

**Reads.** Digest collects every start it needs, all ending at `toMs`: `fromMs`, the three
pace starts, and each UTC midnight on which a price row takes effect between the earliest
of them and `toMs`. A start at least 65 minutes before `toMs` is read as its own rollup
window (`maxBuckets: 1`, at most three windows per request). A nearer start is summed from
the five-minute buckets of one 65-minute rollup window (`maxBuckets: 13`), so every value
reads the same tier and ends at the same instant. Batches are the report's 16 seats.

**Pricing.** A segment is the time between two consecutive starts: per seat and model, the
longer window's row minus the shorter one's. Each segment lies inside one rate period, so
each model share is [quoted](digest-v1.md#quotes) once over all four classes at the row in
effect at the segment's start, and a value is the sum of its segments' quotes. A dated rate
is never applied across its start.

**Reasons.** Sorted ids; `complete` is true only when there are none, and `lowerBound` is
true when there are some and `usdMicros` is a number:

- `no_price`, `class_price_missing`, `unsafe_cost`: a share of that vendor could not be
  priced; `usdMicros` is null.
- `cache_write_unreported`: a share's cache writes went unreported where the provider bills
  them, so the quote is a floor.
- `attribution_split_dropped`: a shorter window holds more of a model than a longer one
  (Core drops a split beyond four models); that segment of the model is not counted.
- The rest reach every vendor, because the missing tokens could be anyone's:
  `coverage_partial` (a seat's window is not fully covered, or has no evidence),
  `before_retention` (Core keeps nothing for a seat before a later instant), `unattributed`
  (tokens no model row covers), `unmapped_model` (a model id no vendor prefix names),
  `retired_unread` (Core could not list every member retired since the start) and
  `usage_unreadable` (a batch read failed; its warning is under `spend`).

A consumer does its own budget arithmetic over these values and adds no price matcher. An
incomplete value is not an exact balance.

## CSV

`--csv` prints one RFC 4180 table with a header and LF row ends. Its rows are the
JSON rows, so the two never disagree.

- `usage`: `id,name,retired,line,model,input,output,cached,coveredMs,windowMs,startsAtMs,complete,unavailable,cause`.
  One row per model of each seat (`line` from the model id), one `unattributed` row with
  an empty `model` for what no model row covers (the whole total when `byModel` is null),
  then one row per unavailable identity with
  only `id,name,retired,unavailable,cause`, then the `other sessions` row with
  only `name` and `unavailable` (`no_source`).
- `credits`: `fromMs,toMs,balance,observedAtMs,hasCredits,unlimited,serviceTiers`, one row
  per point (`serviceTiers` joined by spaces); only the header when `credits` is null.
- `exchange`: `senderId,sender,recipientId,recipient,kind,count,bytes`, one row per
  pair; an unknown participant has empty cells. It fails with `EXCHANGE_UNAVAILABLE`
  when the flow could not be read.

A text cell starting with `=`, `+`, `-`, `@`, tab or carriage return gets a leading
`'`, so a spreadsheet never reads a name as a formula. CSV carries no `limits`, no
series (so no per-bucket `coveredMs`); use `--json` for them.

## Vector

The frozen [usage report vector](vectors/usage-report-v1.json) pins the join: Core's
documents in, this document and the three tables out, with arithmetic written by hand.
Its `spend from a period start` case pins the spend reads (`requests`, in order) and the
`spend` section for Core's `answers` to them, priced by hand.
