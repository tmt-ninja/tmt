# Design-system ownership

Space-defined systems are `tmt:design-system` page trees: configuration and
components are page content, and published bundles are release attachments.
`design/systems/compiler.mjs` owns compilation and validation. The app's
`design-system.ts` resolves a page's draft-following or release-locked pin;
mockup stages render in a sized scope. `design-system-pages.ts` and
`design-system-ui.tsx` own creating and presenting those page trees.

`cli_design.rs` implements read-only `tmt colab design` queries. The built-in GUI
bundle ships with the executable and app. Design draws it from the shipped bundle
and docs navigation through `design-built-in.ts`; opening Design does not create
or update a mirrored page tree. The first Comment or Chat creates a discussion
page for that docs key, and later visits reuse it. Design continues to draw the
shipped source rather than the discussion page's stored copy. A space's own
matching system takes precedence in CLI queries.

The page runtime exposes declared browser-ui parts from layered, content-hashed
chunks; the parent sends a page only the chunks its verified components declare
(`runtime-chunks.ts`, `page-runtime.ts`). Page-level modals fit the visible band
the parent sends the frame (`renderer.ts`, `page-frame.css`); a mockup stage keeps
its own box. Live page lists stay in trusted parent chrome. Work-bundle data requires proven owner-only authorship,
and unproven baselines fail closed. The Colab contract owns admission; the
runtime and parent-view code implement it without giving author frames independent
data access or routing authority.

Shared browser components and token generation have one owner in
[the presentation leaf](../../../../design/browser-ui/README.md), reached through
[tmt-design](../../tmt-design/SKILL.md). Colab consumes that output; it does not
copy its implementation. The Colab contract owns pin and bundle behavior.
