#!/usr/bin/env python3
"""Hand-authored cases for the closed `blocks` value of a structured page (#6004).

An independent model of the contract rules in colab-v1.md ("Structured pages"), not either
implementation: the native validator (`blocks::schema`) and the browser fold validator
(`blocks.ts`) both run the file this writes, `blocks-v1.json`. Run without `--write` to check that
the committed file is what this script produces; `--write` regenerates it.
"""
import json
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE / "blocks-v1.json"
PAGES = HERE / "blocks-page-v1.json"
ATTACHMENTS = HERE / "block-attachments-v1.json"


def bid(n):
    return f"10000000-0000-4000-8000-{n:012}"


def rich(s, marks=None):
    return {"s": s, "marks": marks or []}


def block(kind, parent="root", pos="V", props=None, text=None, **extra):
    value = {"type": kind, "parent": parent, "pos": pos, "props": props or {}}
    if text is not None:
        value["text"] = text
    value.update(extra)
    return value


def para(text="hello", **kw):
    return block("paragraph", text=rich(text), **kw)


valid = []
invalid = []


def ok(name, blocks):
    valid.append({"name": name, "blocks": blocks})


def bad(name, blocks):
    invalid.append({"name": name, "blocks": blocks})


# ---- valid -------------------------------------------------------------------------------------
ok("an empty page", {})
ok("every type with its smallest value", {
    bid(1): block("paragraph", text=rich("")),
    bid(2): block("heading", pos="W", text=rich("Title")),
    bid(3): block("list", pos="X", text=rich("item")),
    bid(4): block("todo", pos="Y", text=rich("do it")),
    bid(5): block("table", pos="Z"),
    bid(6): block("card", pos="a"),
    bid(7): block("question", pos="b", text=rich("Which?")),
    bid(8): block("callout", pos="c", text=rich("Note")),
    bid(9): block("code", pos="d", text=rich("let x = 1;")),
    bid(10): block("image", pos="e"),
    bid(11): block("mockup", pos="f", props={"markup": "<tmt-ui-button>Go</tmt-ui-button>"}),
    bid(12): block("work-bundle", pos="g", props={"page": bid(500)}),
    bid(13): block("page-view", pos="h"),
})
ok("props at their edges", {
    bid(1): block("heading", props={"level": 3}, text=rich("h")),
    bid(2): block("list", pos="W", props={"style": "number", "indent": 2}, text=rich("x")),
    bid(3): block("todo", pos="X", props={"checked": True, "assignee": "a" * 128, "due": "2026-12-31", "indent": 0}, text=rich("t")),
    bid(4): block("card", pos="Y", props={"variant": "section", "title": "t" * 256, "meta": "m" * 128, "collapsible": True, "collapsed": False}),
    bid(5): block("question", pos="Z", props={"kind": "multiple", "agent": "gui-4", "choices": ["a"] * 20, "other": True, "otherMax": 2000, "state": "answered", "answer": "yes"}, text=rich("?")),
    bid(6): block("callout", pos="a", props={"tone": "blocked", "label": "L", "heading": "H"}, text=rich("c")),
    bid(7): block("code", pos="b", props={"language": "rust", "filename": "lib.rs"}, text=rich("fn main() {}")),
    bid(8): block("work-bundle", pos="c", props={"page": bid(500), "number": 4294967295, "work": "w", "editable": True, "tickets": [{"label": "#1", "href": "https://github.com/tmt-ninja/tmt/issues/1"}] * 20}),
})
ok("a card holds blocks and a table holds rows", {
    bid(1): block("card", props={"title": "Notes"}),
    bid(2): para("inside", parent=bid(1)),
    bid(3): block("table", pos="W", props={"columns": [{"id": "a", "name": "A", "width": "narrow", "hideNarrow": True}, {"id": "b", "name": "B"}], "header": True, "density": "compact"}),
    bid(4): block("row", parent=bid(3), pos="V", cells={"a": rich("one"), "b": rich("two", [{"from": 0, "to": 3, "mark": "bold"}])}),
    bid(5): block("row", parent=bid(3), pos="W", cells={}),
})
ok("a tombstone keeps its place", {
    bid(1): para("gone", deleted=1700000000000),
    bid(2): block("card", pos="W", deleted=9007199254740991),
    bid(3): para("child of a deleted card", parent=bid(2)),
})
ok("marks in scalar values, sorted and merged", {
    bid(1): block("paragraph", text=rich("a🐈b link", [
        {"from": 0, "to": 3, "mark": "bold"},
        {"from": 1, "to": 2, "mark": "italic"},
        {"from": 1, "to": 3, "mark": "code"},
        {"from": 4, "to": 6, "mark": "agent", "value": "gui-4"},
        {"from": 4, "to": 8, "mark": "link", "value": "https://example.com/a"},
        {"from": 6, "to": 8, "mark": "block", "value": bid(9)},
    ])),
})
ok("two links side by side with different values stay separate", {
    bid(1): block("paragraph", text=rich("abcd", [
        {"from": 0, "to": 2, "mark": "link", "value": "https://a.example/"},
        {"from": 2, "to": 4, "mark": "link", "value": "https://b.example/"},
    ])),
})
ok("text with line feeds and tabs", {
    bid(1): block("code", text=rich("a\n\tb")),
})
ok("image, mockup and page-view props", {
    bid(1): block("image", props={"images": [{"src": "colab-attachment:abcdef01", "alt": "a", "caption": "c", "tag": "t", "filename": "f.png", "status": "loading"}], "files": [{"name": "n.pdf", "size": "1 KB", "type": "pdf", "href": "colab-attachment:abcdef01"}], "layout": "grid", "size": "l", "variant": "file"}),
    bid(2): block("mockup", pos="W", props={"system": "tmt-gui", "lock": "follow", "preset": "custom", "width": 4000, "height": 0, "toolbarLabels": "a,b", "markup": "<p>x</p>\n"}),
    bid(3): block("page-view", pos="X", props={"label": "Pages", "rows": [{"id": "p1", "name": "One", "stage": "done", "subpages": {"done": 1, "total": 2}}], "filters": [{"field": "project", "value": "p"}], "columns": ["name"], "sort": "title", "limit": 200, "groupBy": "none", "state": "empty", "density": "comfortable", "selected": "p1", "selectable": True}),
})

# ---- invalid -----------------------------------------------------------------------------------
bad("the value is not an object", [])
bad("a key that is not a generated id", {"not-an-id": para()})
bad("a block that is not an object", {bid(1): "paragraph"})
bad("a field outside the closed set", {bid(1): para(extra=1)})
bad("a missing field", {bid(1): {"type": "paragraph", "parent": "root", "pos": "V", "text": rich("")}})
bad("an unknown type", {bid(1): block("banner")})
bad("a row at the top level", {bid(1): block("row", cells={})})
bad("a block that is its own parent", {bid(1): para(parent=bid(1))})
bad("a parent that is not on the page", {bid(1): para(parent=bid(2))})
bad("a paragraph inside a paragraph", {bid(1): para(), bid(2): para(parent=bid(1), pos="W")})
bad("a card inside a card", {bid(1): block("card"), bid(2): block("card", parent=bid(1), pos="W")})
bad("a row inside a card", {bid(1): block("card"), bid(2): block("row", parent=bid(1), cells={})})
for index, pos in enumerate(["", "a0", "a-b", "a b", "é", "1" * 65]):
    bad(f"a position that is not a sort key ({index})", {bid(1): para(pos=pos)})
bad("a position that is not a string", {bid(1): para(pos=5)})
bad("props that are not an object", {bid(1): {**para(""), "props": []}})
bad("a prop outside the type's schema", {bid(1): para(props={"colour": "red"})})
bad("a prop of another type's schema", {bid(1): para(props={"level": 2})})
bad("an enum prop outside its values", {bid(1): block("callout", props={"tone": "info"}, text=rich(""))})
bad("an integer prop out of range", {bid(1): block("heading", props={"level": 4}, text=rich(""))})
bad("an integer prop that is a float", {bid(1): block("heading", props={"level": 2.5}, text=rich(""))})
bad("an indent of three", {bid(1): block("list", props={"indent": 3}, text=rich(""))})
bad("a boolean prop that is a string", {bid(1): block("todo", props={"checked": "yes"}, text=rich(""))})
bad("a date that is not a date", {bid(1): block("todo", props={"due": "2026-13-01"}, text=rich(""))})
bad("a text prop over its limit", {bid(1): block("card", props={"title": "t" * 257})})
bad("a text prop with a control character", {bid(1): block("card", props={"title": "a\nb"})})
bad("a mockup without markup", {bid(1): block("mockup")})
bad("a work card without a page", {bid(1): block("work-bundle")})
bad("a work card page that is not an id", {bid(1): block("work-bundle", props={"page": "nope"})})
bad("a ticket outside github", {bid(1): block("work-bundle", props={"page": bid(5), "tickets": [{"label": "x", "href": "https://example.com/1"}]})})
bad("too many tickets", {bid(1): block("work-bundle", props={"page": bid(5), "tickets": [{"label": "x", "href": "https://github.com/a/b"}] * 21})})
bad("too many choices", {bid(1): block("question", props={"choices": ["a"] * 21}, text=rich(""))})
bad("an empty choice", {bid(1): block("question", props={"choices": [""]}, text=rich(""))})
bad("duplicate column ids", {bid(1): block("table", props={"columns": [{"id": "a", "name": "A"}, {"id": "a", "name": "B"}]})})
bad("a column id outside its grammar", {bid(1): block("table", props={"columns": [{"id": "a b", "name": "A"}]})})
bad("a column without a name", {bid(1): block("table", props={"columns": [{"id": "a", "name": ""}]})})
bad("a column width outside its values", {bid(1): block("table", props={"columns": [{"id": "a", "name": "A", "width": "wide"}]})})
bad("too many columns", {bid(1): block("table", props={"columns": [{"id": f"c{i}", "name": "n"} for i in range(33)]})})
bad("an image without a source", {bid(1): block("image", props={"images": [{"alt": "a"}]})})
bad("a page-view filter on an unknown field", {bid(1): block("page-view", props={"filters": [{"field": "colour", "value": "x"}]})})
bad("a page-view limit of zero", {bid(1): block("page-view", props={"limit": 0})})
bad("props over the type's size", {bid(1): block("page-view", props={"rows": [{"id": f"p{i}", "name": "n" * 200} for i in range(200)]})})
bad("a text block without text", {bid(1): {"type": "paragraph", "parent": "root", "pos": "V", "props": {}}})
bad("text on a block that has none", {bid(1): block("table", text=rich(""))})
bad("text that is a bare string", {bid(1): block("paragraph", text="hello")})
bad("text with an extra key", {bid(1): block("paragraph", text={"s": "a", "marks": [], "x": 1})})
bad("text over 64 KiB", {bid(1): block("paragraph", text=rich("a" * (64 * 1024 + 1)))})
bad("text with a control character", {bid(1): block("paragraph", text=rich("bell\x07"))})
bad("marks on a code block", {bid(1): block("code", text=rich("abc", [{"from": 0, "to": 1, "mark": "bold"}]))})
bad("marks on a question", {bid(1): block("question", text=rich("abc", [{"from": 0, "to": 1, "mark": "bold"}]))})
bad("a mark with an empty range", {bid(1): block("paragraph", text=rich("abc", [{"from": 1, "to": 1, "mark": "bold"}]))})
bad("a mark past the end", {bid(1): block("paragraph", text=rich("abc", [{"from": 0, "to": 4, "mark": "bold"}]))})
bad("a mark counted in UTF-16 units", {bid(1): block("paragraph", text=rich("🐈", [{"from": 0, "to": 2, "mark": "bold"}]))})
bad("an unknown mark", {bid(1): block("paragraph", text=rich("abc", [{"from": 0, "to": 1, "mark": "underline"}]))})
bad("a flag mark with a value", {bid(1): block("paragraph", text=rich("abc", [{"from": 0, "to": 1, "mark": "bold", "value": "x"}]))})
bad("a link without a value", {bid(1): block("paragraph", text=rich("abc", [{"from": 0, "to": 1, "mark": "link"}]))})
bad("a link that is a script", {bid(1): block("paragraph", text=rich("abc", [{"from": 0, "to": 1, "mark": "link", "value": "javascript:alert(1)"}]))})
bad("a link with a space", {bid(1): block("paragraph", text=rich("abc", [{"from": 0, "to": 1, "mark": "link", "value": "https://a b/"}]))})
bad("an agent mark with a space", {bid(1): block("paragraph", text=rich("abc", [{"from": 0, "to": 1, "mark": "agent", "value": "a b"}]))})
bad("a block mark that is not an id", {bid(1): block("paragraph", text=rich("abc", [{"from": 0, "to": 1, "mark": "block", "value": "x"}]))})
bad("overlapping runs of one mark", {bid(1): block("paragraph", text=rich("abc", [{"from": 0, "to": 2, "mark": "bold"}, {"from": 1, "to": 3, "mark": "bold"}]))})
bad("adjacent runs of one mark and value that are not merged", {bid(1): block("paragraph", text=rich("abc", [{"from": 0, "to": 1, "mark": "bold"}, {"from": 1, "to": 2, "mark": "bold"}]))})
bad("marks out of order", {bid(1): block("paragraph", text=rich("abc", [{"from": 1, "to": 2, "mark": "bold"}, {"from": 0, "to": 1, "mark": "italic"}]))})
bad("marks tied on range out of mark order", {bid(1): block("paragraph", text=rich("abc", [{"from": 0, "to": 1, "mark": "italic"}, {"from": 0, "to": 1, "mark": "bold"}]))})
bad("a row with props", {bid(1): block("table"), bid(2): block("row", parent=bid(1), props={"a": 1}, cells={})})
bad("a row with text", {bid(1): block("table"), bid(2): block("row", parent=bid(1), cells={}, text=rich(""))})
bad("a row without cells", {bid(1): block("table"), bid(2): block("row", parent=bid(1))})
bad("cells on a paragraph", {bid(1): para(cells={})})
bad("a cell that is a bare string", {bid(1): block("table"), bid(2): block("row", parent=bid(1), cells={"a": "x"})})
bad("a cell column id outside its grammar", {bid(1): block("table"), bid(2): block("row", parent=bid(1), cells={"a b": rich("x")})})
bad("a cell over 4 KiB", {bid(1): block("table"), bid(2): block("row", parent=bid(1), cells={"a": rich("a" * 4097)})})
bad("a row with too many cells", {bid(1): block("table"), bid(2): block("row", parent=bid(1), cells={f"c{i}": rich("") for i in range(65)})})
bad("a deleted time that is negative", {bid(1): para(deleted=-1)})
bad("a deleted time that is a float", {bid(1): para(deleted=1.5)})
bad("a deleted time that is a string", {bid(1): para(deleted="now")})
bad("a deleted time past the exact range", {bid(1): para(deleted=9007199254740992)})
bad("a deleted flag that is a boolean", {bid(1): para(deleted=True)})
bad("more blocks than a page holds", {bid(i): para("", pos="V") for i in range(1, 2050)})
bad("a table with too many rows", {bid(1): block("table"), **{bid(i + 2): block("row", parent=bid(1), cells={}) for i in range(513)}})

doc = {
    "format": "tmt-colab-blocks",
    "version": 1,
    "description": "Hand-authored cases for the closed `blocks` value of a structured page (#6004), written by blocks-reference.py. `valid` values are accepted and `invalid` ones refused, each for the one rule its name states. Shared by the native validator and the browser fold validator; limits are the colab-v1 \"Structured pages\" limits.",
    "valid": valid,
    "invalid": invalid,
}
text = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"

# The page around the blocks: which metadata a page of blocks may carry (the decoder's projection
# rules). Each case is a content document with `html` (empty unless the case gives one: a converted
# page keeps its old source there, frozen), no `blocks` root yet and `title` plus the `meta` below;
# `valid` says whether the decoder and the fold accept it.
CONVERTED_AT = 1_794_000_000_000  # ms
blocks_meta = lambda **extra: {"pageType": "blocks", **extra}
pages = []
LEGACY = "<h1>Old page</h1>\n<p>Kept exactly as it was.</p>\n"
def page(name, meta, ok, html=None, blocks_root=None):
    case = {"name": name}
    if html is not None:
        case["html"] = html
    if blocks_root is not None:
        case["blocksRoot"] = blocks_root
    pages.append({**case, "meta": meta, "valid": ok})
page("an ordinary page", {}, True)
page("a new page of blocks, with no legacy source and no conversion time", blocks_meta(), True)
page("a page of blocks with work", blocks_meta(work={"version": 2, "order": []}), True)
page("a page of blocks with attachments", blocks_meta(attachments=[]), True)
page("a page of blocks made from a template", blocks_meta(fromTemplate={"name": "report"}), True)
page("a page of blocks with a state", blocks_meta(pageState="done"), True)
page("a page of blocks converted in place from an empty page: convertedAt, no legacy source", blocks_meta(convertedAt=CONVERTED_AT), True)
page("a page of blocks converted at time zero", blocks_meta(convertedAt=0), True)
page("a page of blocks holding the legacy source of a converted page", blocks_meta(), True, html=LEGACY)
page(
    "a page of blocks with a legacy source, work, a state, attachments and fromTemplate",
    blocks_meta(work={"version": 2, "order": []}, pageState="done", attachments=[], fromTemplate={"name": "report"}),
    True,
    html=LEGACY,
)
page("a page of blocks converted in place: convertedAt beside its legacy source", blocks_meta(convertedAt=CONVERTED_AT), True, html=LEGACY)
page(
    "a converted page of blocks with work, attachments, fromTemplate, a state, convertedAt and its legacy source",
    blocks_meta(
        work={"version": 2, "order": []},
        attachments=[],
        fromTemplate={"name": "report"},
        pageState="done",
        convertedAt=CONVERTED_AT,
    ),
    True,
    html=LEGACY,
)
# A revert drops pageType and the blocks, but a Yjs root type cannot be dropped, only emptied: the
# runners build a `blocks` root holding one entry, then delete the entry (`emptied`) or keep it (`live`).
page("a page reverted to HTML: pageType gone, its legacy source live again, the blocks root emptied", {}, True, html=LEGACY, blocks_root="emptied")
page("a page reverted to HTML with its other metadata kept", {"pageState": "done", "work": {"version": 2, "order": []}}, True, html=LEGACY, blocks_root="emptied")
page("an ordinary page whose blocks root still holds a block", {}, False, html=LEGACY, blocks_root="live")
page("a dashboard", {"pageType": "shell", "shell": {"version": 1, "items": {}, "order": []}}, True)
page("a dashboard whose blocks root is emptied", {"pageType": "shell", "shell": {"version": 1, "items": {}, "order": []}}, False, blocks_root="emptied")
page("a page of blocks with a legacy source and a layout", blocks_meta(layout="column"), False, html=LEGACY)
page("a page of blocks with a legacy source that is a template", blocks_meta(template={"name": "weekly", "description": ""}), False, html=LEGACY)
page("a page of blocks that is a template", blocks_meta(template={"name": "weekly", "description": ""}), False)
page("a page of blocks with a layout", blocks_meta(layout="column"), False)
page("a page of blocks with a canvas layout and its reason", blocks_meta(layout="canvas", layoutReason="a frame"), False)
page("a page of blocks with work that is not a work value", blocks_meta(work={"version": 2, "order": "x"}), False)
page("a page of blocks with attachments that are not descriptors", blocks_meta(attachments=[{"nope": 1}]), False)
page("a page of blocks with a fromTemplate that is not a mark", blocks_meta(fromTemplate="report"), False)
page("a page of blocks with a state that is not one", blocks_meta(pageState="soon"), False)
page("convertedAt that is a string", blocks_meta(convertedAt="2026-11-07"), False)
page("convertedAt that is a negative time", blocks_meta(convertedAt=-1), False)
page("convertedAt that is a fraction of a millisecond", blocks_meta(convertedAt=1.5), False)
page("convertedAt beyond what a browser number holds exactly", blocks_meta(convertedAt=2**53), False)
page("convertedAt with a legacy source on an ordinary page", {"convertedAt": CONVERTED_AT}, False, html=LEGACY)
page("convertedAt on an ordinary page", {"convertedAt": CONVERTED_AT}, False)
page("the retired convertedFrom on a page of blocks", blocks_meta(convertedFrom=bid(7)), False)
page_doc = {
    "format": "tmt-colab-blocks-page",
    "version": 1,
    "description": "Which metadata a page of blocks may carry (#6004), written by blocks-reference.py. Each case is a content document with an html text (empty unless the case gives `html`), no blocks root yet, a title and the meta given; valid ones are accepted and the others refused by the isolated decoder and the browser fold alike. A page of blocks keeps work, attachments, fromTemplate, a state and convertedAt (the time in ms it was converted in place), and never a template or a layout; convertedAt belongs to a page of blocks alone. Its html is empty on a new page, or the frozen legacy source of a page converted in place: it is never rendered and never writable. A case with `blocksRoot` also gives the document a `blocks` root with one entry, deleted again when it is `emptied`: a reverted page has no pageType but keeps that emptied root, which only a page without pageType may do, and not while it holds a block.",
    "cases": pages,
}
page_text = json.dumps(page_doc, ensure_ascii=False, indent=2) + "\n"

# Attachments on a page of blocks (#6190): which references a batch may add and which descriptors it
# may remove. A case gives the blocks before and after the batch, the descriptors the page holds
# (`current`, by attachment ID) and the change (`set`, `remove`); descriptors are sealed against the
# page's `source` (the html root: empty, or the frozen legacy source) unless `setSource` says other.
def aid(n):
    return f"{n:08x}-0000-4000-8000-000000000000"
TWIN = "00000001-0000-4000-8000-0000000000ff"
LEGACY_SOURCE = "<p>The old page.</p>"
def image(src, **extra):
    return block("image", props={"images": [{"src": src}]}, **extra)
def ref(n):
    return "colab-attachment:" + aid(n)
cases = []
def case(name, before, nxt, expect, current=(), source="", set=(), remove=(), set_source=None):
    entry = {"name": name, "source": source, "before": before, "next": nxt, "current": list(current)}
    if set:
        entry["set"] = list(set)
    if set_source is not None:
        entry["setSource"] = set_source
    if remove:
        entry["remove"] = list(remove)
    entry["expect"] = expect
    cases.append(entry)
A, B = bid(1), bid(2)
refused = {"refused": "attachment"}
invalid_change = {"refused": "invalid"}
unchanged = {"list": None}
case("a reference to a descriptor the page does not hold is refused", {}, {A: image(ref(1))}, refused)
case("the batch that adds the descriptor may add the image that shows it", {}, {A: image(ref(1))}, {"list": [aid(1)]}, set=[aid(1)])
case("a descriptor the page already holds serves a later batch with no change", {}, {A: image(ref(1))}, unchanged, current=[aid(1)])
case("the short form names the one descriptor with that prefix", {}, {A: image("colab-attachment:00000001")}, unchanged, current=[aid(1)])
case("a short form two descriptors share names neither", {}, {A: image("colab-attachment:00000001")}, refused, current=[aid(1), TWIN])
case("the full ID names one of two descriptors that share a prefix", {}, {A: image(ref(1))}, unchanged, current=[aid(1), TWIN])
case("a short form no descriptor has is refused", {}, {A: image("colab-attachment:00000003")}, refused, current=[aid(1)])
for bad_token in ("", "zz", "0000001", "00000001A", "00000001-0000-4000-8000-000000000009"):
    case(f"a malformed or unknown token {bad_token!r} is refused", {}, {A: image("colab-attachment:" + bad_token)}, refused, current=[aid(1)])
case("a file's href is a reference too", {}, {A: block("image", props={"files": [{"name": "a", "href": ref(1)}]})}, refused)
case("a file's href that names a held descriptor is admitted", {}, {A: block("image", props={"files": [{"name": "a", "href": ref(1)}]})}, unchanged, current=[aid(1)])
case("an https source is not judged", {}, {A: image("https://example.com/a.png")}, unchanged)
case("a data source is not judged", {}, {A: image("data:image/png;base64,AAAA")}, unchanged)
case("a reference already dangling in the base is not judged again", {A: image(ref(7))}, {A: image(ref(7)), B: image("https://example.com/b.png")}, unchanged)
case("bringing back a deleted block with a dangling reference is judged", {A: image(ref(7), deleted=5)}, {A: image(ref(7))}, refused)
case("a deleted block's reference is not live", {}, {A: image(ref(7), deleted=5)}, unchanged)
case("a descriptor a live block shows cannot be removed", {A: image(ref(1))}, {A: image(ref(1))}, refused, current=[aid(1), aid(2)], remove=[aid(1)])
case("nor by its short form", {A: image("colab-attachment:00000001")}, {A: image("colab-attachment:00000001")}, refused, current=[aid(1), aid(2)], remove=[aid(1)])
case("a descriptor no block shows is removed", {A: image(ref(1))}, {A: image(ref(1))}, {"list": [aid(1)]}, current=[aid(1), aid(2)], remove=[aid(2)])
case("deleting the block and removing its descriptor in one batch", {A: image(ref(1))}, {A: image(ref(1), deleted=9)}, {"list": [aid(2)]}, current=[aid(1), aid(2)], remove=[aid(1)])
case("removing a descriptor whose block was deleted earlier", {A: image(ref(1), deleted=9)}, {A: image(ref(1), deleted=9)}, {"list": [aid(2)]}, current=[aid(1), aid(2)], remove=[aid(1)])
case("swapping a re-sealed descriptor in when the block points at it", {A: image(ref(1))}, {A: image(ref(3))}, {"list": [aid(3)]}, current=[aid(1)], set=[aid(3)], remove=[aid(1)])
case("swapping it without pointing the block at it is refused", {A: image(ref(1))}, {A: image(ref(1))}, refused, current=[aid(1)], set=[aid(3)], remove=[aid(1)])
case("a descriptor sealed against another source is refused", {}, {}, invalid_change, set=[aid(1)], set_source="<p>another page</p>")
case("on a converted page the descriptors are bound to its frozen legacy source", {}, {A: image(ref(1))}, {"list": [aid(1)]}, source=LEGACY_SOURCE, set=[aid(1)])
case("removing what the page does not hold is refused", {}, {}, invalid_change, remove=[aid(9)])
case("a change that adds and removes the same ID is refused", {}, {}, invalid_change, current=[aid(1)], set=[aid(1)], remove=[aid(1)])
case("an empty change is no change", {}, {}, unchanged, current=[aid(1)])
# Which descriptors the 30-day sweep keeps on a page of blocks: those a block still references,
# live or deleted and not yet purged. A purged block is simply absent from `blocks`.
kept = []
def keeps(name, blocks, current, expect):
    kept.append({"name": name, "blocks": blocks, "current": list(current), "expect": list(expect)})
keeps("a descriptor a live block references is kept", {A: image(ref(1))}, [aid(1)], [aid(1)])
keeps("a descriptor only a deleted block references is kept, so an undo or a restore keeps its image", {A: image(ref(1), deleted=5)}, [aid(1)], [aid(1)])
keeps("a purged block references nothing, so its descriptor is no longer kept", {}, [aid(1)], [])
keeps("a descriptor no block references is not kept", {A: image("https://example.com/a.png")}, [aid(1)], [])
keeps("only the referenced one of two descriptors is kept", {A: image(ref(2))}, [aid(1), aid(2)], [aid(2)])
keeps("two blocks that name one descriptor keep it once", {A: image(ref(1)), B: image(ref(1), deleted=5)}, [aid(1)], [aid(1)])
keeps("a file's href keeps its descriptor", {A: block("image", props={"files": [{"name": "a", "href": ref(1)}]})}, [aid(1)], [aid(1)])
keeps("a short reference keeps the one descriptor with that prefix", {A: image("colab-attachment:00000001")}, [aid(1), aid(2)], [aid(1)])
keeps("a short reference two descriptors share keeps both: a sweep only ever widens what is kept", {A: image("colab-attachment:00000001")}, [aid(1), TWIN], [aid(1), TWIN])
keeps("a reference to a descriptor the page does not hold keeps nothing", {A: image(ref(7))}, [aid(1)], [])
keeps("a malformed reference keeps nothing", {A: image("colab-attachment:zz")}, [aid(1)], [])
keeps("a page with no descriptors keeps none", {A: image(ref(1))}, [], [])
descriptor = {
    "version": 1,
    "attachmentId": "<attachmentId>",
    "space": "a" * 32,
    "page": "20000000-0000-4000-8000-000000000091",
    "epoch": "1",
    "namespace": "content",
    "objectId": "a" * 64,
    "authorDevice": "20000000-0000-4000-8000-000000000093",
    "membershipRevision": "1",
    "source": {"kind": "document", "sourceDigest": "<sha256 of the source the descriptor was sealed against>"},
    "envelopeHash": "c" * 64,
    "signature": "<64 bytes of 0x01, base64url without padding>",
    "payloadSha256": "d" * 64,
    "payloadBytes": "10",
    "plaintextBytes": "5",
    "filename": "a.png",
    "mediaType": "image/png",
}
attach_doc = {
    "format": "tmt-colab-block-attachments",
    "version": 1,
    "description": "Which attachment references a batch on a page of blocks may add and which descriptors it may remove (#6190), written by blocks-reference.py and run by the native `blocks::attachments` and the browser's `admitAttachments` alike. A case lists the blocks before and after the batch, the descriptors the page holds (`current`, by attachment ID) and the typed change (`set`, `remove`); a descriptor is `descriptor` with its `attachmentId` set and its `sourceDigest` the sha256 (lowercase hex) of the case's `source` (the page's html root), or of `setSource` for the added ones. `expect` is the list the page holds afterwards (`list`, by ID; null when the change leaves it as it is) or a refusal: `attachment` (a reference no descriptor names, or a removal of one a live block shows) or `invalid` (a change the shared attachment rules refuse). The rules are checked when a batch is admitted, not when a state is folded: two writers can leave a dangling reference on a merged page, which must still fold.",
    "descriptor": descriptor,
    "cases": cases,
    "kept": kept,
    "keptDescription": "Which descriptors the 30-day sweep keeps on a page of blocks (#6190), run by the native `blocks::attachments::referenced`: a descriptor stays while any block that is on the page, live or deleted and not yet purged, references it, and is swept on the same schedule as a file whose reference left an HTML page's source once none does. `current` is the page's descriptor list (by ID); `expect` the IDs kept.",
}
attach_text = json.dumps(attach_doc, ensure_ascii=False, indent=2) + "\n"

outputs = [(OUT, text, f"{len(valid)} valid, {len(invalid)} invalid"), (PAGES, page_text, f"{len(pages)} cases"), (ATTACHMENTS, attach_text, f"{len(cases)} cases")]
for path, body, summary in outputs:
    if "--write" in sys.argv:
        path.write_text(body, encoding="utf-8")
        print(f"wrote {path.name}: {summary}")
    else:
        if path.read_text(encoding="utf-8") != body:
            sys.exit(f"{path.name} differs from this script; run it with --write")
        print(f"{path.name} matches: {summary}")
