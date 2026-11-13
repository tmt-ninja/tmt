---
name: tmt-design-system
description: Use a TMT design system in a Colab page or UI mockup - find it, pin it so the page follows its draft (or lock one release), and write only its component tags.
---

# Design systems in Colab pages

A design system is a tree of Colab pages in the Design tab, with components that have their own
tags (`<prefix>-button`, ...). A page pins the system and follows its live draft: an edit in the
Design tab shows on the page. A published version is a release, a fixed bundle a page can lock to
instead. Make and edit the page itself with the tmt-colab skill.

## When to use one

Use a design system when the person names one, asks for a mockup of a product UI that has one, or
the page should look like a product screen. Plain notes, plans and reviews need none: Colab's
own page style already applies.

## Find the release

```sh
tmt colab design ls --json                       # systems, prefixes, released versions
tmt colab design show <system>[@version] --json  # pin, lock, components (default: latest)
```

`<system>` is the `system` from `ls`, the tag prefix or the name. `tmt-gui` is the built-in
tmt GUI system (tags `tmt-ui-*`): every install can pin it, and its `show` needs nothing running.
It is the default for TMT product mockups. For a structured page, its block tags are `tmt-ui-block-document` holding
`tmt-ui-block`s, each with one of `tmt-ui-heading-block`, `tmt-ui-text-block`, `tmt-ui-list-item`,
`tmt-ui-todo`, `tmt-ui-table-block`, `tmt-ui-card-block`, `tmt-ui-callout` or `tmt-ui-code-block`,
plus `tmt-ui-block-mention`, `tmt-ui-block-menu`, `tmt-ui-block-toast`, `tmt-ui-question-block`,
`tmt-ui-image-block`, `tmt-ui-mockup-block`, `tmt-ui-work-bundle` and `tmt-ui-page-view`. A
work bundle reads only its admitted referenced page, and a page view shows the owner's admitted
page list. A space's own systems need a running
`tmt colab serve` for `show`. `show` prints `meta` (the pin line to copy), `lockMeta` (the line
that locks this release), `principles`, and every component's `tag`, `props` (enum values or type,
default), `slots` and `examples`. Read it once per page; there is no per-system skill.

A system whose `latest` is `none` has no release yet, so `show` cannot list its components. Tell
the person that publishing is their step in the Design tab.

## Write the page

1. Put the `meta` line from `show` first in the page, exactly as printed:
   `<meta name="tmt-ds" content="<system>">`. One system per page. Use `lockMeta` instead only when
   the person asks for a page that must not change, for example a signed-off mockup.
2. Put components directly in page flow. For a device-sized mockup stage, wrap them in an
   explicitly sized scope such as `<div data-tmt-ds-scope style="width:390px;height:844px">`.
   Each stage owns its overlays, focus and responsive size; controls outside it stay usable.
   Start overlays closed.
3. Build with the system's tags only. Start from its `examples`, keep their markup shape, and
   set only the listed props with listed values. Put content in the default slot, or in a named
   slot with `slot="<name>"`.
4. Follow the release's `principles`, for example one primary action per surface.
5. Plain HTML can sit around the components for layout and text. Do not restyle a component's
   inside with your own CSS; choose its props instead.
6. On a page in another language, give the words a component would otherwise show in English.
   Each takes one comma list with an exact count; any other count keeps the English words:

   | Tag | Prop | Words, in order |
   | --- | --- | --- |
   | `tmt-ui-block-menu` | `hint-labels` | choose, insert, close |
   | `tmt-ui-mockup-block` | `toolbar-labels` | Custom, Light, Dark, Viewer |

   A block menu's `items` name rows as `<id>:<label>` (the catalog row, with no English
   description) or `<id>:<label>:<description>`, and `group:<id>:<heading>` renames a group
   heading.

The page shows design-system problems inside its frame: a tag from another prefix, an unknown
component, an invalid prop value, a draft that does not compile, or a
pin that cannot be read. A page that follows the draft is checked against the draft, so a renamed
component or prop shows up there. Fix every one before handing the page over. The page checks custom prefixes after resolving the system.

## Versions

- A page that follows the draft sees every edit in the Design tab, published or not. The built-in
  `tmt-gui` draft is the release this TMT ships.
- A lock never moves by itself. A locked page stays on its release until someone changes the pin;
  it shows a notice when TMT no longer carries that release.
- To move a locked page, run `show` for the version (or use `meta` to follow the draft), replace
  the line, and check that every tag and prop still exists there. Do not do it without the
  person's ask.
- Never edit a system's own pages to make your page work. Comments and fixes on a system go
  through its Design pages (tmt-colab skill, editing: "A design-system example"). The built-in
  tmt GUI has no pages to edit: Design draws it from the build, and a fix is a code change to
  `design/browser-ui` through a PR. A comment on a built-in page lands on a `<title> · tmt GUI`
  page that holds only its discussion; editing that page changes nothing Design shows.

## Limits

- One system per page. A lock is read-only: the bundle is verified by its hash, and a changed
  bundle does not render.
- A standalone export (`page.standalone.html`) carries the page's pinned bundle and draws its
  components offline. From the CLI, a page that follows a space system's draft gets no copy
  (`design-draft-unavailable`); export it from the browser, or lock a release. Parts that read
  other pages (page views, work bundles) stay empty there.
- Interactive behaviour is what the component offers. For your own scripts use the page runtime
  (tmt-colab skill, runtime).

### Built-in menu and page-search examples

For `tmt-ui-menu`, a `-` between items starts a separated group, for example
`items="Manage page,-,Archive…,About this page"`. A dangling separator remains
plain text. Set `trigger="icon"` for the ellipsis action. `tmt-ui-command` accepts plain items and `page:<title>:<context>`
items; the latter render a page icon, title and quiet context line. A `create:<label>`
item stays above page results. Its optional
`query` sets the initial search text. For example:

```html
<tmt-ui-command label="Search pages" query="retro"
  items="page:Weekly retro:Product / Planning,page:Weekly retro:Operations / Planning"></tmt-ui-command>
```

Malformed page entries remain plain text. These examples describe the visual
components; a product host owns page eligibility, selection and changes.
