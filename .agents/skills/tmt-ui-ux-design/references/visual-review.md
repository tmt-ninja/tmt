# Visual review

Any change that alters what a browser surface looks like (Colab, Remote, the GUI shell, the
design-system docs, the handbook site) gets a visual review before it is accepted. Green CI and
a test that measures geometry do not show that a screen looks right. Only comparing images of
the result with a reference does that. The primary reviewer does this personally and does not
accept the implementer's "matches" claim in its place.

## 1. Name the reference before writing code

Every visual change names its reference in the issue and in the PR body:

- an approved high-fidelity Colab mockup built from design-system tags
  ([mockup procedure](../SKILL.md)),
- the design-system docs page for the component (local docs at `http://127.0.0.1:5100`), or
- the shipped screen it must keep matching.

If none exists, make a mockup first and get the owner's OK on it before building. A change with
no reference is not reviewable and is not accepted.

## 2. Capture side by side

- Capture the reference and the implementation in the same state, with the same data, at 1440
  and 390 px wide, in light and dark. Use headless browsers only.
- Include the filled and edge states: long titles, chips, many rows, empty, loading, error,
  hover and focus, open menus and dialogs, and narrow layouts where text could wrap or truncate.
- Put each pair next to each other in one image (reference left, change right), plus an overlay
  or difference image where the layout should be identical. List the capture paths in the PR.

## 3. Check alignment

Open every pair and look. For each one, check:

- edges and baselines line up across a row, and columns share one gutter;
- spacing uses the token scale, and the same relation (label to field, row to row) uses the same gap;
- controls in one row share a height and their text a size;
- type uses the ramp: size, weight and line height match the reference;
- colour, border, radius and shadow come from tokens, and the same role looks the same everywhere;
- icons share one size and stroke and sit centred on the text;
- nothing overlaps, clips, wraps unexpectedly or touches a line it should clear;
- the result holds at 390 px and in dark.

Any difference from the reference is either fixed or written in the PR as an intended change
that the owner has approved.

## 4. Check that it looks good

Matching a reference is not enough when the reference does not cover a state. Judge each
capture as a designer would:

- a clear hierarchy: the eye lands first on what matters;
- a steady rhythm of spacing, with no cramped clusters beside empty gaps;
- elements align to a shared grid; nothing floats loose or sits a pixel off;
- no doubled borders or outlines, no stray focus rings, no line running through content;
- text never cut mid-word without an ellipsis, and truncation keeps the meaningful part;
- both themes look designed, not just inverted.

If something looks off, it is a finding, even when no rule names it.

## 5. Record the verdict

Post the visual verdict on the PR, naming the head: the reference, the capture set, each
finding and what happened to it, and the result. Visual findings block merging the same way
correctness findings do. They are fixed in the same PR, not deferred to a follow-up, unless the
owner agrees to defer one. A later head that touches the same surface needs fresh captures.
