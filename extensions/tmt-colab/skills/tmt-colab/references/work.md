# Page work

A page can have a two-line summary and ordered sub-pages. Give each part its own page when it
needs its own discussion or owner. To track work within one page, use [heading sections](blocks.md#section-progress).
The page's manual state (`tmt colab page state PAGE todo|in-progress|done --json`) is separate
from its computed status and progress. The app supplies the page top bar and status details. Use `subpage ls PAGE` for freshly folded sub-page work.

Use `tmt colab ls --json --work` for owner Work home summaries, including counted sections and
project orders. A running serve reads its owner list; an offline read folds the local store.
Plain `ls --json` skips these extras. `sectionsOmitted` flags an incomplete section listing.
The top-level `projectOrders` maps project names to revisions and ranked items. For a name in
`projectOrdersOmitted`, use `tmt colab work order show PROJECT --json` for its complete order.

A request from a Colab comment on a block page can end with a to-do it became: `To-do: TEXT` and
`Check it when done: tmt colab block props PAGE BLOCK --set checked=true`. Run that command when the
work is done; the to-do is added only once the request is sent, and a reply never checks it.

```sh
tmt colab subpage create PAGE --title 'Write the guide' --json   # makes a page and attaches it; prints childPage
tmt colab subpage attach PAGE CHILD --json                       # an existing page; --before SUBPAGE to place it
tmt colab subpage move PAGE CHILD --before SUBPAGE --json        # without --before it goes last
tmt colab subpage detach PAGE CHILD --json                       # the page itself stays
tmt colab subpage ls PAGE --json
tmt colab summary set PAGE --line1 'Release plan' --line2 'Read before the release' --json
```

The owner's list counts direct children by computed status, falling back to manual state when status is unavailable.
Archiving a sub-page keeps its link: `subpage ls` still lists it with `"archived": true` (state
column `archived`), so you can see and detach it, but it leaves the progress, the list row's count
and the browser's work panel until it is unarchived. The
summary's first line is at most 24 characters and says where the page stands; the second is at most
60 and says what comes next.

Every change applies to the page's current revision, or to `--expected-revision` when you pass one;
`COLAB_STALE_BASE` means the page changed, so read it again. An invalid value refuses the whole
change.

## Link rules

A page has one parent, a link never closes a loop, and sub-pages nest at any depth. An attach that
breaks a rule is `COLAB_LINK_REFUSED` with a `reason`: `second-parent` (another page lists it; the
message names that page), `cycle` (the page itself or a page above it), `unavailable` (not a page
of this space) or `invalid-hierarchy` (existing links already conflict). Two writers can still race
into a page with two parents or a loop; `tmt colab show PAGE --json` flags them in `page.warnings`.
Repair them with `subpage detach`, which is always admitted.

Pages from before sub-pages held tasks. The serve rewrites them once as sub-pages (the pages those
tasks followed) and keeps each page's old tasks in `migrations/5825/<pageId>.json` in the space's
directory; a page it could not rewrite yet shows `work-not-migrated` in `show` and `ls` and is
tried again at the next serve. Until it is rewritten, every `subpage` and `summary` change to that page
is refused as `COLAB_WORK_NOT_MIGRATED`: run `tmt colab serve` first. Do not recreate old tasks
yourself: tell the person where the copy is.

`subpage create` makes an empty structured page first, then attaches it. Use `--html` for an HTML
page with the title as its heading. If the
attach fails it prints the page it made and the `subpage attach` command that finishes; it never
searches for a page to adopt, so running it again makes another page.
