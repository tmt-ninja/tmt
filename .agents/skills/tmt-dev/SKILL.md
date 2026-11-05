---
name: tmt-dev
description: Implement, review, or maintain TMT repository changes with the project's issue, architecture, verification, and review gates.
---

# TMT development

Developer workflow, not end-user CLI guidance. [AGENTS](../../../AGENTS.md) owns
required reading, conventions, delivery/review, safety and evidence rules.
[ARCHITECTURE](../../../ARCHITECTURE.md) owns cross-cutting seams; area skills own
their architecture. Follow those owners rather than repeating policy here.

## Procedure routing

Read the relevant reference sections before running checks:

- [Coding and verification patterns](references/coding-conventions.md): language
  conventions, command/effect patterns, transaction rules and detailed test techniques.
- [Development procedures](references/development.md): setup, disk/worktrees,
  native builds, tooling checks, Project tracking and CI-wake command usage.
- [Focused checks](references/focused-checks.md): driver/runtime, request-ID,
  caller lifecycle, output style and executable-fixture publication checks.
- [tmt-layout](../tmt-layout/SKILL.md): additions, moves and the tracked-file guard.
- [tmt-e2e](../tmt-e2e/SKILL.md): native fixtures, Docker/tmux scenarios, isolation
  and cleanup; its evidence is separate from tooling tests.
- [tmt-release](../tmt-release/SKILL.md): archive, installer, upgrade, publication,
  release-line and CI selection work. A raw-binary smoke is not archive evidence.

## Implementation checks

Identify affected inputs/outputs, transitions, ownership and failure paths before
choosing checks. Reuse existing ports/helpers; map observable assertions across
replacements, not just test totals. When a workflow spans PRs, inspect its integrated
ownership, transitions, retries and partial-failure cleanup.

For Rust executable fixtures, follow the [publication controls](references/focused-checks.md#executable-fixtures-and-snapshots)
and native architecture guard; never substitute stale binaries or lockfiles.
For installed-agent guidance, use [installed guidance verification](../tmt-core-runtime/references/install-architecture.md#installed-guidance-verification):
matching bytes alone do not prove invocation behavior. Process/archive producers
must supply CLI and independently owned companions; the [fixture contract](../tmt-release/references/installation-fixtures.md#process-fixture-builds)
defines the inputs.

## Architecture maintenance

Apply the [maintenance contract](../../../ARCHITECTURE.md#maintenance-contract)
and report the actual boundary impact. Area skills link to contracts, which stay
the definition owners. Do not copy global working rules into references.
