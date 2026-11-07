# Structured pages (blocks)

A structured page is made of blocks, not HTML: paragraphs, headings, lists, todos, tables, cards,
questions, callouts, code, images, mockups, work bundles and page views. People edit it in the
browser; you edit it with `tmt colab block`. `page create` creates one by default;
`page write` and `page patch` refuse it (`COLAB_STRUCTURED_PAGE`), and `block` refuses an ordinary
page (`COLAB_NOT_STRUCTURED`). A page converted from HTML keeps its old HTML as a frozen legacy
source: it is never shown, you cannot write it, and block edits leave it as it was. Read it with
`page read PAGE --legacy`, or export the page for `legacy.html`. `page convert PAGE --revert`
restores the HTML and removes every block added since conversion; it names the count and requires
`--yes` when the count is nonzero. `page convert PAGE --yes` confirms conversion in place.
Pass `--expected-revision REV` from a page read when the confirmation is based on an earlier read;
the operation refuses if the page has changed since that revision.

```sh
tmt colab page create --title 'Release notes' --json                   # prints pageId
tmt colab block ls PAGE --json                                         # the tree; --all adds deleted blocks
tmt colab block get PAGE BLOCK --json                                  # one block, with its text as base
tmt colab block insert PAGE --type heading --props '{"level":2}' --text 'Plan' --json   # prints blockIds
tmt colab block insert PAGE --type paragraph --text 'First' --after BLOCK --json        # --first, or --parent CARD
tmt colab block props PAGE BLOCK --set level=3 --unset tone --json
tmt colab block move PAGE BLOCK --parent CARD --after SIBLING --json
tmt colab block delete PAGE BLOCK --json                               # and: block restore PAGE BLOCK
tmt colab block batch PAGE --file ops.json --json                      # many ops, all or nothing
```

Every command is a granular edit that merges with what others change at the same time, so none needs
a revision and none can answer `COLAB_STALE_BASE`. Block IDs are generated; `--id` picks one.
Nothing goes in a block's text as HTML: marks are separate (`block text ... --mark bold --from 0 --to 5`;
`--value` for `link`, `agent` and `block`, `--clear` to remove).

## Change text

- A small change: `block text PAGE BLOCK --find 'old' --replace 'new'`. `old` must occur exactly once
  (`COLAB_BLOCK_TEXT_NOT_FOUND`, `COLAB_BLOCK_TEXT_AMBIGUOUS`); add context to make it unique.
- A rewrite: `block get ... --write-text now.txt`, edit a copy, then
  `block text ... --file new.txt --base-file now.txt`. The system diffs `now.txt` against `new.txt` and
  applies only your hunks to the text the page holds now, so what people typed meanwhile stays. When
  your hunk overlaps their edit, theirs stays and the receipt lists yours under `droppedHunks`
  (`{id, from, to, text}` in characters of the text you read): run `block get` again and reapply it.
- A table cell: add `--cell COLUMN` to `block text`, or use `block table`.

## Tables

`block insert --type table --props '{"columns":[{"id":"name","name":"Name"}]}'`, then
`block table PAGE TABLE add-row --cell name=Ada`, `set-cell --row ROW --column name --text 'x'`,
`remove-row --row ROW`, and `add-column`, `rename-column`, `move-column`, `remove-column` by
`--column ID` (ids stay put when a column is renamed or moved).

## Ops file

`block batch` takes a JSON array of ops, at most 256 and 1 MiB:
`{"op":"insert","id","type","parent?","after?","props?","text?"}`, `move`, `props` (`set`, `unset`),
`text` (`replace`, `set` with `base`, or `format`), `delete`, `restore` and `table`. One bad op refuses
the whole batch. `after` absent places the block last, `null` first; it must be a child of `parent`
(`COLAB_BLOCK_BAD_AFTER`). A block inside a card has `parent` set to the card's ID; a card holds no
card. The contract, `Structured pages` in `colab-v1.md`, has every type's props and the limits.

## Questions and mockups

A `question` block registers itself in the page's questions with the batch that adds it, as a
`<tmt-question>` does (the entry stays if you delete or edit the block); the page's creator receives
the answers. A `mockup` block's `markup` must pass `tmt colab page check`: a finding refuses the batch
as `COLAB_BLOCK_MARKUP`, so save the markup to a file and check it first.

## Limits and deleting

A page holds 2048 blocks, deleted ones included; text is at most 64 KiB per block. `delete` hides a
block and what is under it; `restore` brings it back for seven days. After that, or when the page
fills, compaction removes it for good and any op naming it answers `COLAB_BLOCK_NOT_FOUND`.
`COLAB_CAPACITY` names a limit you passed; `COLAB_INPUT_INVALID` a value the type's schema refuses.
