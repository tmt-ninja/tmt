//! A page of blocks as HTML, for export: the document's live blocks in order, one deterministic
//! rendering that the TypeScript exporter (`blocks-html.ts`) reproduces byte for byte (both run
//! `contracts/vectors/blocks-html-v1.json`). Deleted blocks and what is under them are left out;
//! siblings come in `(pos, id)` order; adjacent list and to-do items form one nested list.
//! Everything authored is escaped; a mockup's markup is written as stored, because a batch only
//! stores markup that passed the page check. Pure: no Yjs, storage or authority.
use serde_json::{Map, Value};

const MARKS: [&str; 6] = ["link", "bold", "italic", "code", "agent", "block"];

pub fn escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

fn str_of<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value.get(key).and_then(Value::as_str)
}

/// The text of a `{s, marks}` value with its inline marks as tags; line feeds become `<br>`.
fn rich(value: &Value) -> String {
    let text: Vec<char> = str_of(value, "s").unwrap_or_default().chars().collect();
    let marks: &[Value] = value
        .get("marks")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice);
    let mut cuts: Vec<usize> = vec![0, text.len()];
    for mark in marks {
        for key in ["from", "to"] {
            if let Some(at) = mark[key].as_u64() {
                cuts.push((at as usize).min(text.len()));
            }
        }
    }
    cuts.sort_unstable();
    cuts.dedup();
    let mut out = String::new();
    for window in cuts.windows(2) {
        let (from, to) = (window[0], window[1]);
        let covering = |name: &str| {
            marks.iter().find(|mark| {
                mark["mark"] == name
                    && mark["from"].as_u64().is_some_and(|f| f as usize <= from)
                    && mark["to"].as_u64().is_some_and(|t| t as usize >= to)
            })
        };
        let mut open = String::new();
        let mut close = String::new();
        for name in MARKS {
            let Some(mark) = covering(name) else { continue };
            let value = escape(str_of(mark, "value").unwrap_or_default());
            let (start, end) = match name {
                "link" => (format!("<a href=\"{value}\">"), "</a>"),
                "bold" => ("<strong>".to_owned(), "</strong>"),
                "italic" => ("<em>".to_owned(), "</em>"),
                "code" => ("<code>".to_owned(), "</code>"),
                "agent" => (format!("<span data-agent=\"{value}\">"), "</span>"),
                _ => (format!("<span data-block=\"{value}\">"), "</span>"),
            };
            open.push_str(&start);
            close.insert_str(0, end);
        }
        let piece: String = text[from..to].iter().collect();
        out.push_str(&open);
        out.push_str(&escape(&piece).replace('\n', "<br>"));
        out.push_str(&close);
    }
    out
}

fn plain(value: &Value) -> String {
    escape(str_of(value, "s").unwrap_or_default()).replace('\n', "<br>")
}

fn live_children<'a>(all: &'a Map<String, Value>, parent: &str) -> Vec<(&'a str, &'a Value)> {
    let mut items: Vec<_> = all
        .iter()
        .filter(|(_, b)| b["parent"] == parent && b.get("deleted").is_none())
        .map(|(id, b)| (id.as_str(), b))
        .collect();
    items.sort_by(|(ia, a), (ib, b)| (str_of(a, "pos"), ia).cmp(&(str_of(b, "pos"), ib)));
    items
}

fn is_item(block: &Value) -> bool {
    matches!(block["type"].as_str(), Some("list" | "todo"))
}

fn item(block: &Value) -> String {
    let props = &block["props"];
    if block["type"] != "todo" {
        return rich(&block["text"]);
    }
    let mark = if props["checked"] == true {
        "☑"
    } else {
        "☐"
    };
    let mut note: Vec<String> = Vec::new();
    if let Some(who) = str_of(props, "assignee") {
        note.push(escape(who));
    }
    if let Some(due) = str_of(props, "due") {
        note.push(format!("due {}", escape(due)));
    }
    let note = if note.is_empty() {
        String::new()
    } else {
        format!(" ({})", note.join(", "))
    };
    format!("{mark} {}{note}", rich(&block["text"]))
}

/// Adjacent items as nested `ul`/`ol`: each level takes its first item's kind.
fn list_run(out: &mut String, run: &[(&str, &Value)]) {
    let mut open: Vec<&str> = Vec::new();
    for (_, block) in run {
        let depth = block["props"]["indent"].as_u64().unwrap_or(0).min(2) as usize;
        let tag = if block["type"] == "list" && block["props"]["style"] == "number" {
            "ol"
        } else {
            "ul"
        };
        while open.len() > depth + 1 {
            out.push_str(&format!("</li></{}>", open.pop().unwrap_or("ul")));
        }
        if open.len() == depth + 1 {
            if open[depth] == tag {
                out.push_str("</li>");
            } else {
                out.push_str(&format!("</li></{}><{tag}>", open[depth]));
                open[depth] = tag;
            }
        }
        while open.len() < depth + 1 {
            out.push_str(&format!("<{tag}>"));
            open.push(tag);
        }
        out.push_str("<li>");
        out.push_str(&item(block));
    }
    while let Some(tag) = open.pop() {
        out.push_str(&format!("</li></{tag}>"));
    }
    out.push('\n');
}

fn table(out: &mut String, all: &Map<String, Value>, id: &str, block: &Value) {
    let props = &block["props"];
    let columns: &[Value] = props
        .get("columns")
        .and_then(Value::as_array)
        .map_or(&[], Vec::as_slice);
    out.push_str("<table>");
    if let Some(label) = str_of(props, "label") {
        out.push_str(&format!("<caption>{}</caption>", escape(label)));
    }
    if props["header"] != false && !columns.is_empty() {
        out.push_str("<thead><tr>");
        for column in columns {
            let name = escape(str_of(column, "name").unwrap_or_default());
            out.push_str(&format!("<th>{name}</th>"));
        }
        out.push_str("</tr></thead>");
    }
    out.push_str("<tbody>");
    for (_, row) in live_children(all, id) {
        out.push_str("<tr>");
        for column in columns {
            let cell = str_of(column, "id")
                .and_then(|column| row["cells"].get(column))
                .map(rich)
                .unwrap_or_default();
            out.push_str(&format!("<td>{cell}</td>"));
        }
        out.push_str("</tr>");
    }
    out.push_str("</tbody></table>\n");
}

fn block(out: &mut String, all: &Map<String, Value>, id: &str, block: &Value) {
    let props = &block["props"];
    let kind = block["type"].as_str().unwrap_or_default();
    match kind {
        "paragraph" => out.push_str(&format!("<p>{}</p>\n", rich(&block["text"]))),
        "heading" => {
            let level = if props["level"] == 3 { 3 } else { 2 };
            out.push_str(&format!("<h{level}>{}</h{level}>\n", rich(&block["text"])));
        }
        "table" => table(out, all, id, block),
        "card" => {
            let title = str_of(props, "title").map(escape);
            let meta = str_of(props, "meta").map(escape);
            let collapsible = props["collapsible"] == true;
            if collapsible {
                let open = if props["collapsed"] == true {
                    ""
                } else {
                    " open"
                };
                out.push_str(&format!("<details{open}>"));
                out.push_str(&format!(
                    "<summary>{}</summary>",
                    title.as_deref().unwrap_or_default()
                ));
            } else {
                out.push_str("<section>");
                if let Some(title) = &title {
                    out.push_str(&format!("<h3>{title}</h3>"));
                }
            }
            if let Some(meta) = &meta {
                out.push_str(&format!("<p><small>{meta}</small></p>"));
            }
            out.push('\n');
            children(out, all, id);
            out.push_str(if collapsible {
                "</details>\n"
            } else {
                "</section>\n"
            });
        }
        "question" => {
            let choices: &[Value] = props
                .get("choices")
                .and_then(Value::as_array)
                .map_or(&[], Vec::as_slice);
            let kind = str_of(props, "kind").unwrap_or(if choices.is_empty() {
                "short"
            } else {
                "single"
            });
            out.push_str(&format!(
                "<tmt-question data-id=\"{}\" data-kind=\"{}\"",
                escape(id),
                escape(kind)
            ));
            if let Some(agent) = str_of(props, "agent") {
                out.push_str(&format!(" data-agent=\"{}\"", escape(agent)));
            }
            out.push_str(&format!("><p data-question>{}</p>", plain(&block["text"])));
            for choice in choices {
                out.push_str(&format!(
                    "<span data-choice>{}</span>",
                    escape(choice.as_str().unwrap_or_default())
                ));
            }
            out.push_str("</tmt-question>\n");
        }
        "callout" => {
            out.push_str("<aside");
            if let Some(tone) = str_of(props, "tone") {
                out.push_str(&format!(" data-tone=\"{}\"", escape(tone)));
            }
            out.push('>');
            let label = str_of(props, "label").map(|l| format!("<strong>{}</strong>", escape(l)));
            let heading = str_of(props, "heading").map(escape);
            if label.is_some() || heading.is_some() {
                let parts: Vec<String> = [label, heading].into_iter().flatten().collect();
                out.push_str(&format!("<p>{}</p>", parts.join(" ")));
            }
            out.push_str(&format!("<p>{}</p></aside>\n", rich(&block["text"])));
        }
        "code" => {
            out.push_str("<pre");
            if let Some(name) = str_of(props, "filename") {
                out.push_str(&format!(" data-filename=\"{}\"", escape(name)));
            }
            out.push_str("><code");
            if let Some(language) = str_of(props, "language") {
                out.push_str(&format!(" class=\"language-{}\"", escape(language)));
            }
            let body = escape(str_of(&block["text"], "s").unwrap_or_default());
            out.push_str(&format!(">{body}</code></pre>\n"));
        }
        "image" => {
            if props["variant"] == "file" {
                out.push_str("<ul>");
                for file in props
                    .get("files")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    let name = escape(str_of(file, "name").unwrap_or_default());
                    let label = match str_of(file, "href") {
                        Some(href) => format!("<a href=\"{}\">{name}</a>", escape(href)),
                        None => name,
                    };
                    out.push_str(&format!("<li>{label}</li>"));
                }
                out.push_str("</ul>\n");
            } else {
                for image in props
                    .get("images")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                {
                    out.push_str(&format!(
                        "<figure><img src=\"{}\"",
                        escape(str_of(image, "src").unwrap_or_default())
                    ));
                    if let Some(alt) = str_of(image, "alt") {
                        out.push_str(&format!(" alt=\"{}\"", escape(alt)));
                    }
                    out.push('>');
                    if let Some(caption) = str_of(image, "caption") {
                        out.push_str(&format!("<figcaption>{}</figcaption>", escape(caption)));
                    }
                    out.push_str("</figure>\n");
                }
            }
        }
        "mockup" => out.push_str(&format!(
            "<div data-mockup>{}</div>\n",
            str_of(props, "markup").unwrap_or_default()
        )),
        "work-bundle" => {
            out.push_str(&format!(
                "<div data-work-bundle=\"{}\"",
                escape(str_of(props, "page").unwrap_or_default())
            ));
            if let Some(number) = props["number"].as_u64() {
                out.push_str(&format!(" data-number=\"{number}\""));
            }
            out.push('>');
            if let Some(work) = str_of(props, "work") {
                out.push_str(&format!("<p>{}</p>", escape(work)));
            }
            let tickets: &[Value] = props
                .get("tickets")
                .and_then(Value::as_array)
                .map_or(&[], Vec::as_slice);
            if !tickets.is_empty() {
                out.push_str("<ul>");
                for ticket in tickets {
                    out.push_str(&format!(
                        "<li><a href=\"{}\">{}</a></li>",
                        escape(str_of(ticket, "href").unwrap_or_default()),
                        escape(str_of(ticket, "label").unwrap_or_default())
                    ));
                }
                out.push_str("</ul>");
            }
            out.push_str("</div>\n");
        }
        "page-view" => {
            out.push_str("<section data-page-view>");
            if let Some(label) = str_of(props, "label") {
                out.push_str(&format!("<h3>{}</h3>", escape(label)));
            }
            let rows: &[Value] = props
                .get("rows")
                .and_then(Value::as_array)
                .map_or(&[], Vec::as_slice);
            if !rows.is_empty() {
                out.push_str("<ul>");
                for row in rows {
                    out.push_str(&format!(
                        "<li>{}</li>",
                        escape(str_of(row, "name").unwrap_or_default())
                    ));
                }
                out.push_str("</ul>");
            }
            out.push_str("</section>\n");
        }
        _ => {}
    }
}

fn children(out: &mut String, all: &Map<String, Value>, parent: &str) {
    let items = live_children(all, parent);
    let mut at = 0;
    while at < items.len() {
        if is_item(items[at].1) {
            let end = items[at..]
                .iter()
                .position(|(_, b)| !is_item(b))
                .map_or(items.len(), |n| at + n);
            list_run(out, &items[at..end]);
            at = end;
        } else {
            block(out, all, items[at].0, items[at].1);
            at += 1;
        }
    }
}

/// The page's live blocks as HTML, each block-level fragment on its own line.
pub fn render(blocks: &Value) -> String {
    let mut out = String::new();
    if let Some(all) = blocks.as_object() {
        children(&mut out, all, "root");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blocks::schema;
    use serde_json::json;
    use std::path::PathBuf;

    fn id(n: u32) -> String {
        format!("40000000-0000-4000-8000-{n:012}")
    }
    fn rich(s: &str, marks: Value) -> Value {
        json!({"s": s, "marks": marks})
    }
    fn block(kind: &str, parent: &str, pos: &str, props: Value, text: Option<Value>) -> Value {
        let mut value = json!({"type": kind, "parent": parent, "pos": pos, "props": props});
        if let Some(text) = text {
            value["text"] = text;
        }
        value
    }
    fn doc(blocks: Vec<(u32, Value)>) -> Value {
        Value::Object(blocks.into_iter().map(|(n, b)| (id(n), b)).collect())
    }

    /// Named documents the TypeScript renderer runs too.
    fn cases() -> Vec<(&'static str, Value)> {
        let root = "root";
        let p = |pos: &str, text: Value| block("paragraph", root, pos, json!({}), Some(text));
        let item = |parent: &str, pos: &str, kind: &str, props: Value, text: &str| {
            block(kind, parent, pos, props, Some(rich(text, json!([]))))
        };
        let mut tombstone = p("V", rich("gone", json!([])));
        tombstone["deleted"] = json!(1_700_000_000_000u64);
        vec![
            ("an empty page", doc(vec![])),
            (
                "marks, escaping, line feeds and astral characters",
                doc(vec![
                    (
                        1,
                        p(
                            "V",
                            rich(
                                "a <b> & \"q\" it's 🐈 end\nnext",
                                json!([
                                    {"from": 0, "to": 5, "mark": "bold"},
                                    {"from": 2, "to": 8, "mark": "italic"},
                                    {"from": 10, "to": 12, "mark": "code"},
                                    {"from": 13, "to": 16, "mark": "link", "value": "https://example.com/?a=1&b=2"},
                                    {"from": 17, "to": 20, "mark": "agent", "value": "Ada"},
                                    {"from": 21, "to": 25, "mark": "block", "value": id(9)},
                                ]),
                            ),
                        ),
                    ),
                    (
                        2,
                        block(
                            "heading",
                            root,
                            "W",
                            json!({"level": 3}),
                            Some(rich("Third", json!([]))),
                        ),
                    ),
                    (
                        3,
                        block(
                            "heading",
                            root,
                            "X",
                            json!({}),
                            Some(rich("Second", json!([]))),
                        ),
                    ),
                ]),
            ),
            (
                "siblings in pos then id order, deleted blocks left out",
                doc(vec![
                    (3, p("b", rich("third", json!([])))),
                    (2, p("a", rich("second", json!([])))),
                    (1, p("a", rich("first", json!([])))),
                    (4, tombstone),
                ]),
            ),
            (
                "nested lists and to-dos",
                doc(vec![
                    (
                        1,
                        item(root, "V", "list", json!({"style": "bullet"}), "one"),
                    ),
                    (
                        2,
                        item(
                            root,
                            "W",
                            "list",
                            json!({"style": "bullet", "indent": 1}),
                            "one.a",
                        ),
                    ),
                    (
                        3,
                        item(
                            root,
                            "X",
                            "list",
                            json!({"style": "number", "indent": 2}),
                            "one.a.i",
                        ),
                    ),
                    (
                        4,
                        item(root, "Y", "list", json!({"style": "bullet"}), "two"),
                    ),
                    (
                        5,
                        item(
                            root,
                            "Z",
                            "todo",
                            json!({"checked": true, "assignee": "Ada", "due": "2026-11-09"}),
                            "ship",
                        ),
                    ),
                    (6, item(root, "a", "todo", json!({}), "write <docs>")),
                    (7, p("b", rich("after", json!([])))),
                    (
                        8,
                        item(root, "c", "list", json!({"style": "number"}), "again"),
                    ),
                ]),
            ),
            (
                "a table with a caption, a missing cell and a deleted row",
                {
                    let mut gone = json!({"type": "row", "parent": id(1), "pos": "X", "props": {},
                        "cells": {"a": rich("deleted", json!([]))}});
                    gone["deleted"] = json!(1_700_000_000_000u64);
                    doc(vec![
                        (
                            1,
                            block(
                                "table",
                                root,
                                "V",
                                json!({"label": "Items & costs",
                            "columns": [{"id": "a", "name": "Item"}, {"id": "b", "name": "Cost"}]}),
                                None,
                            ),
                        ),
                        (
                            2,
                            json!({"type": "row", "parent": id(1), "pos": "V", "props": {},
                            "cells": {"a": rich("bolt", json!([{"from": 0, "to": 4, "mark": "bold"}])),
                                      "b": rich("1", json!([]))}}),
                        ),
                        (
                            3,
                            json!({"type": "row", "parent": id(1), "pos": "W", "props": {},
                            "cells": {"a": rich("nut", json!([]))}}),
                        ),
                        (4, gone),
                        (
                            5,
                            block(
                                "table",
                                root,
                                "W",
                                json!({"header": false,
                            "columns": [{"id": "a", "name": "Only"}]}),
                                None,
                            ),
                        ),
                    ])
                },
            ),
            (
                "cards, a collapsed one, and a deleted one with a live child",
                {
                    let mut card = block("card", root, "X", json!({"title": "Gone"}), None);
                    card["deleted"] = json!(1_700_000_000_000u64);
                    doc(vec![
                        (
                            1,
                            block(
                                "card",
                                root,
                                "V",
                                json!({"title": "Plan", "meta": "owner: Ada"}),
                                None,
                            ),
                        ),
                        (2, item(&id(1), "V", "todo", json!({}), "inside")),
                        (
                            3,
                            block(
                                "card",
                                root,
                                "W",
                                json!({"title": "More", "collapsible": true, "collapsed": true}),
                                None,
                            ),
                        ),
                        (
                            4,
                            item(&id(3), "V", "list", json!({"style": "bullet"}), "hidden"),
                        ),
                        (5, card),
                        (
                            6,
                            item(&id(5), "V", "list", json!({"style": "bullet"}), "orphan"),
                        ),
                    ])
                },
            ),
            (
                "question, callout, code and image blocks",
                doc(vec![
                    (
                        1,
                        block(
                            "question",
                            root,
                            "V",
                            json!({"kind": "multiple", "agent": "Ada", "choices": ["Yes", "No"]}),
                            Some(rich("Ship <it>?", json!([]))),
                        ),
                    ),
                    (
                        2,
                        block(
                            "question",
                            root,
                            "W",
                            json!({}),
                            Some(rich("Why?", json!([]))),
                        ),
                    ),
                    (
                        3,
                        block(
                            "callout",
                            root,
                            "X",
                            json!({"tone": "review", "label": "Review", "heading": "Needs a look"}),
                            Some(rich(
                                "Details",
                                json!([{"from": 0, "to": 7, "mark": "italic"}]),
                            )),
                        ),
                    ),
                    (
                        4,
                        block(
                            "code",
                            root,
                            "Y",
                            json!({"language": "rust", "filename": "main.rs"}),
                            Some(rich("fn main() {\n    println!(\"<hi>\");\n}", json!([]))),
                        ),
                    ),
                    (
                        5,
                        block(
                            "image",
                            root,
                            "Z",
                            json!({"images": [{"src": "colab-attachment:0123abcd", "alt": "A \"cat\"", "caption": "Cat"}, {"src": "https://example.com/b.png"}]}),
                            None,
                        ),
                    ),
                    (
                        6,
                        block(
                            "image",
                            root,
                            "a",
                            json!({"variant": "file", "files": [{"name": "a.pdf", "href": "https://example.com/a.pdf"}, {"name": "b.txt"}]}),
                            None,
                        ),
                    ),
                ]),
            ),
            (
                "mockup, work bundle and page view",
                doc(vec![
                    (
                        1,
                        block(
                            "mockup",
                            root,
                            "V",
                            json!({"markup": "<tmt-card title=\"A\"><p>Hi</p></tmt-card>"}),
                            None,
                        ),
                    ),
                    (
                        2,
                        block(
                            "work-bundle",
                            root,
                            "W",
                            json!({"page": id(7), "number": 6004, "work": "Blocks & CLI",
                        "tickets": [{"label": "#6004", "href": "https://github.com/tmt-ninja/tmt/issues/6004"}]}),
                            None,
                        ),
                    ),
                    (
                        3,
                        block(
                            "page-view",
                            root,
                            "X",
                            json!({"label": "Open pages", "rows": [{"id": id(8), "name": "Plan"}, {"id": id(9), "name": "Notes & ideas"}]}),
                            None,
                        ),
                    ),
                ]),
            ),
        ]
    }

    fn generate() -> String {
        let cases: Vec<String> = cases()
            .into_iter()
            .map(|(name, blocks)| {
                schema::validate(&blocks).unwrap_or_else(|_| panic!("invalid case: {name}"));
                serde_json::to_string(
                    &json!({"name": name, "blocks": blocks, "html": render(&blocks)}),
                )
                .unwrap()
            })
            .collect();
        format!(
            "{{\n  \"format\": \"tmt-colab-blocks-html\",\n  \"version\": 1,\n  \"description\": \"A page of blocks and the HTML export renders for it. The native renderer (blocks::html) produced the html, which was read through case by case; the TypeScript renderer must match it byte for byte. Regenerate with TMT_BLESS_VECTORS=1 cargo test -p tmt-colab blocks::html.\",\n  \"cases\": [\n    {}\n  ]\n}}\n",
            cases.join(",\n    ")
        )
    }

    #[test]
    fn the_html_vectors_are_current() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../contracts/vectors/blocks-html-v1.json");
        let fresh = generate();
        if std::env::var_os("TMT_BLESS_VECTORS").is_some() {
            std::fs::write(&path, &fresh).unwrap();
            return;
        }
        let stored = std::fs::read_to_string(&path).expect("blocks-html-v1.json");
        assert!(
            stored == fresh,
            "blocks-html-v1.json is stale; run TMT_BLESS_VECTORS=1 cargo test -p tmt-colab blocks::html"
        );
    }

    #[test]
    fn every_rendering_passes_the_page_check() {
        for (name, blocks) in cases() {
            let html = render(&blocks);
            let report = crate::page_check::check(&html).unwrap();
            // The registry is not read offline; an unregistered question is the only finding allowed.
            assert!(
                report.findings.iter().all(|f| f.element == "tmt-question"),
                "{name}: {:?}",
                report.findings
            );
        }
    }
}
