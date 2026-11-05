# Design-system ownership

Space-defined systems are `tmt:design-system` page trees: configuration and
components are page content, and published bundles are release attachments.
`design/systems/compiler.mjs` owns compilation and validation. The app's
`design-system.ts` resolves a page's draft-following or release-locked pin;
mockup stages render in a sized scope. `design-system-pages.ts` and
`design-system-ui.tsx` own creating and presenting those page trees.

`cli_design.rs` implements read-only `tmt colab design` queries. The built-in GUI
bundle is compiled into the executable and the app from
`design/systems/tmt-gui/generated/bundle.json`. The Design library currently uses
`design-mirror.ts` to create or update its generated page mirror on an owner
visit. Runtime pins also resolve the built-in bundle without a page behind its
`tmt-gui` ID. A space's own matching system takes precedence in CLI queries.

Shared browser components and token generation have one owner in
[the presentation leaf](../../../../design/browser-ui/README.md), reached through
[tmt-design](../../tmt-design/SKILL.md). Colab consumes that output; it does not
copy its implementation. The Colab contract owns pin and bundle behavior.
