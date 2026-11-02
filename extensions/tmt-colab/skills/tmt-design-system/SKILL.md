---
name: tmt-design-system
description: Use a published TMT design system in a Colab page or UI mockup - find it, pin one release, and write only that release's component tags.
---

# Design systems in Colab pages

A design system is a tree of Colab pages in the Design tab. Each published version is a release:
a fixed bundle of components with their own tags (`<prefix>-button`, ...). A page uses a system
by pinning one release. Make and edit the page itself with the tmt-colab skill.

## When to use one

Use a design system when the person names one, asks for a mockup of a product UI that has one, or
the page should look like a product screen. Plain notes, plans and reviews need none: Colab's
own page style already applies.

## Find the release

```sh
tmt colab design ls --json                       # systems, prefixes, released versions
tmt colab design show <system>[@version] --json  # one release (default: latest)
```

`<system>` is the root page ID, the tag prefix or the name. `show` needs a running
`tmt colab serve`. It prints `meta` (the pin line to copy), `principles`, and every component's
`tag`, `props` (enum values or type, default), `slots` and `examples`. Read it once per page;
there is no per-system skill.

A system whose `latest` is `none` has no release yet. You cannot pin it. Tell the person that
publishing is their step in the Design tab.

## Write the page

1. Put the `meta` line from `show` first in the page, exactly as printed:
   `<meta name="tmt-ds" content="<system>@<version>#sha256-...">`. One pin per page.
2. Build with that release's tags only. Start from its `examples`, keep their markup shape, and
   set only the listed props with listed values. Put content in the default slot, or in a named
   slot with `slot="<name>"`.
3. Follow the release's `principles`, for example one primary action per surface.
4. Plain HTML can sit around the components for layout and text. Do not restyle a component's
   inside with your own CSS; choose its props instead.

The page shows design-system problems inside its frame: a tag from another prefix, an unknown
component, an invalid prop value, or a pin that cannot be read. Fix every one before you hand the
page over. `tmt colab page check` covers the HTML rules, not these.

## Versions

- A pin never moves by itself. A page stays on its release until someone changes the pin.
- Edits in the Design tab change the system's draft. Pages see them only after a new version is
  published and the page's pin is upgraded to it.
- To upgrade a page, run `show` for the new version, replace the `meta` line, and check that every
  tag and prop still exists there. Do not upgrade without the person's ask.
- Never edit a system's own pages to make your page work. Comments and fixes on a system go
  through its Design pages (tmt-colab skill, editing: "A design-system example").

## Limits

- One release per page, read-only: the bundle is verified by its hash, and a changed bundle does
  not render.
- Components render only inside Colab; a downloaded standalone page does not carry the release.
- Interactive behaviour is what the component offers. For your own scripts use the page runtime
  (tmt-colab skill, runtime).
