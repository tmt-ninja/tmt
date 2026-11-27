# Pi channel v1

The opt-in channel is for a TMT-managed, interactive Pi 1.6.1 foreground with the per-launch TMT extension. Ordinary Pi launches use the existing guarded paste path. An exact resume establishes a fresh enrollment for the remembered Pi session. The common launch policy, binding claim, pane guard, inspect and recovery rules apply.

## Submission and public outcome

Core owns the request, its urgency and its single delivery attempt. Once the existing delivery guards admit a request, the extension uses its current session context to choose the submission mode. Idle starts a user turn. While running, normal uses `followUp` and urgent uses `steer`. All three use `pi.sendUserMessage` with prompt expansion disabled. Mode selection and invocation belong to the same extension generation. A blocked UI, abort, compaction or session switch fences submission until fresh session readiness.

The payload is the complete original TMT request frame. Its existing reply block carries the request ID and attempt-bound receipt. Transport adds no visible text. The extension installs one live expectation for that attempt before passing the payload to Pi. Only a user-role `message_start` carrying the exact full payload, in the same enrolled session and generation before the deadline, confirms delivery. The expected payload is consumed once. The comparison binds a single text payload including its line endings and reply block.

While Pi holds a busy submission, Core exposes `delivery=queued` and `messageState=sent/waiting_for_delivery`. A matching start settles delivery. The receipt deadline is durable on the attempt, so sender loss also becomes unconfirmed at expiry. See the [shared message state definition](request-response-v1.md#message-state). Placement in Pi's queue and return from the submission call do not confirm delivery. A possible submission with no matching start by its deadline settles as uncertain, including a lost acknowledgment, changed payload or extension shutdown. A definite pre-submission refusal settles as unavailable. An enrolled attempt never falls through to paste or replay. A delayed event after the deadline cannot revive the expectation. The separate receipt-bound TMT reply remains the durable final. The 30-second receipt window starts with the claim. Core applies its normal Digest and attention guards first. Send-now promotes an eligible held request to urgent. Unframed passthrough, advisory wakes, reply notices and grouped Digest checklists have no per-request start receipt on this channel. They cannot trigger Pi input or a paste fallback. Retained items remain available through the inbox and results.

A byte-identical copy independently submitted in the same trusted session while the expectation is live is indistinguishable through Pi's public API. The evidence establishes occurrence of the exact message in the session. It cannot identify which identical call originated that occurrence.

## Ownership

Bind channel evidence to the committed binding and pane, launch owner and foreground process incarnations, provider session, and a fresh enrollment generation. Exchange bounded frames through a private local endpoint with a bounded deadline. A stale endpoint, wrong session or unverifiable enrollment blocks delivery. Remove only an enrollment owned by the retiring launch. Preserve uncertain evidence for the shared recovery path.

Pi's extension, configuration and session files under the user's provider home are outside channel installation. The extension is materialized for the managed launch. Provider output and request text are untrusted input and cannot confer delivery authority.
