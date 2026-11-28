//! Sections are progress (#6619): a page's headings, each with what follows it up to the next
//! heading of the same or a higher level, summarised from the blocks the owner fold already holds.
//! A section counts as progress when it holds a to-do, a pull request link or a waiting question,
//! unless its heading says otherwise (`progress`: `done` or `off`). Its status uses the page
//! status's vocabulary and order (`work_index::computed_state`); display only, never authority.
use crate::work_facts::{PullLink, block_links, pulls, text_urls};
use crate::work_index::{OwnerActivity, PullRequestFact, computed_state};
use serde_json::{Map, Value};
use std::collections::BTreeSet;

/// At most this many sections are summarised; a page with more says so.
pub const SECTIONS: usize = 64;
/// A section title is cut at this many bytes on a character boundary.
pub const SECTION_TITLE: usize = 256;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Section {
    /// The heading block's ID.
    pub id: String,
    pub title: String,
    pub level: u8,
    /// Checked and all to-dos in the section, its sub-sections included.
    pub done: usize,
    pub total: usize,
    /// Questions in the section still waiting for an answer.
    pub open_questions: usize,
    /// A callout in the section with `tone: blocked`.
    pub blocked: bool,
    /// The distinct pull requests the section links to.
    pub pulls: Vec<PullLink>,
    /// The heading's manual setting: `done` or `off`.
    pub manual: Option<&'static str>,
}

/// The page's sections in document order, at most [`SECTIONS`], and whether more were left out.
pub fn sections(blocks: Option<&Value>) -> (Vec<Section>, bool) {
    let Some(all) = blocks.and_then(Value::as_object) else {
        return (Vec::new(), false);
    };
    let mut order = Vec::new();
    walk(all, "root", &mut order);
    let mut found: Vec<Section> = Vec::new();
    // The sections a block falls in: every heading still open above it.
    let mut open: Vec<usize> = Vec::new();
    for (id, block) in order {
        if block["type"] == "heading" {
            let level = u8::try_from(block["props"]["level"].as_u64().unwrap_or(2)).unwrap_or(2);
            // A heading closes every open section of its level or deeper.
            while open.last().is_some_and(|&at| found[at].level >= level) {
                open.pop();
            }
            found.push(Section {
                id: id.to_owned(),
                title: cut(block
                    .pointer("/text/s")
                    .and_then(Value::as_str)
                    .unwrap_or_default()),
                level,
                done: 0,
                total: 0,
                open_questions: 0,
                blocked: false,
                pulls: Vec::new(),
                manual: match block["props"]["progress"].as_str() {
                    Some("done") => Some("done"),
                    Some("off") => Some("off"),
                    _ => None,
                },
            });
            open.push(found.len() - 1);
            continue;
        }
        let links = block_links(block);
        for &at in &open {
            let section = &mut found[at];
            match block["type"].as_str() {
                Some("todo") => {
                    section.total += 1;
                    if block["props"]["checked"] == true {
                        section.done += 1;
                    }
                }
                Some("question") if block["props"]["state"] == "waiting" => {
                    section.open_questions += 1;
                }
                Some("callout") if block["props"]["tone"] == "blocked" => section.blocked = true,
                _ => {}
            }
            for link in &links {
                if !section.pulls.contains(link) {
                    section.pulls.push(link.clone());
                }
            }
        }
    }
    counted_sections(found)
}

/// An HTML page's sections (#6619): each `h2` and `h3` the outline lists, keyed `h1`, `h2`, ... by
/// its order. Saved task checkboxes contribute to the section's to-do counts alongside its
/// waiting questions and pull request facts.
pub fn html_sections(source: &str, open: &BTreeSet<&str>) -> (Vec<Section>, bool) {
    use crate::page_check::Part;
    let Some(parts) = crate::page_check::parts(source) else {
        return (Vec::new(), false);
    };
    let mut found: Vec<Section> = Vec::new();
    let mut inside: Vec<usize> = Vec::new();
    for part in parts {
        let mut candidates = Vec::new();
        match part {
            Part::Heading(level, title) => {
                while inside.last().is_some_and(|&at| found[at].level >= level) {
                    inside.pop();
                }
                found.push(Section {
                    id: format!("h{}", found.len() + 1),
                    title: cut(&title),
                    level,
                    done: 0,
                    total: 0,
                    open_questions: 0,
                    blocked: false,
                    pulls: Vec::new(),
                    manual: None,
                });
                inside.push(found.len() - 1);
                continue;
            }
            Part::Question(id) => {
                if open.contains(id.as_str()) {
                    for &at in &inside {
                        found[at].open_questions += 1;
                    }
                }
                continue;
            }
            Part::TaskCheckbox { checked } => {
                for &at in &inside {
                    found[at].total += 1;
                    found[at].done += usize::from(checked);
                }
                continue;
            }
            Part::Link(href) => candidates.push(href),
            Part::Text(text) => text_urls(&text, &mut candidates),
        }
        if candidates.is_empty() || inside.is_empty() {
            continue;
        }
        for link in pulls(candidates).unwrap_or_default() {
            for &at in &inside {
                if !found[at].pulls.contains(&link) {
                    found[at].pulls.push(link.clone());
                }
            }
        }
    }
    counted_sections(found)
}

fn counted_sections(mut sections: Vec<Section>) -> (Vec<Section>, bool) {
    sections.retain(Section::counted);
    let omitted = sections.len() > SECTIONS;
    sections.truncate(SECTIONS);
    (sections, omitted)
}

impl Section {
    /// Whether the section counts toward the page's progress.
    pub fn counted(&self) -> bool {
        match self.manual {
            Some("off") => false,
            Some(_) => true,
            None => self.total > 0 || !self.pulls.is_empty() || self.open_questions > 0,
        }
    }

    /// The section's status with these pull request facts, one per link in [`Section::pulls`]
    /// order; `None` when they are not known. `none` for a section that does not count.
    pub fn state(&self, prs: Option<&[PullRequestFact]>, now_ms: u64) -> &'static str {
        if !self.counted() {
            return "none";
        }
        // A manual done wins; the count still shows the real numbers.
        if self.manual == Some("done") {
            return "done";
        }
        let prs = if self.pulls.is_empty() {
            Some(&[][..])
        } else {
            prs
        };
        let todos = Some((self.done, self.total));
        // A section has no owner of its own: the page rules without an owner's activity.
        match computed_state(
            todos,
            self.blocked,
            self.open_questions > 0,
            prs,
            OwnerActivity::Other,
            now_ms,
        ) {
            state @ ("done" | "blocked" | "needs-you" | "waiting-ci" | "waiting-release") => state,
            "unknown" => "unchecked",
            _ if self.total > 0 && self.done == self.total => "done",
            _ if self.done > 0 => "working",
            _ => "not-started",
        }
    }

    /// The status the fold alone decides: decided only when every possible fact for its pull
    /// requests gives the same answer, else `unchecked`, as the page list does.
    pub fn folded_state(&self, now_ms: u64) -> &'static str {
        if self.pulls.is_empty() {
            return self.state(Some(&[]), now_ms);
        }
        let mut answer = None;
        for fact in [
            PullRequestFact::Open,
            PullRequestFact::Merged {
                released: Some(true),
            },
            PullRequestFact::Merged {
                released: Some(false),
            },
            PullRequestFact::Closed,
            PullRequestFact::Unknown,
        ] {
            let state = self.state(Some(&vec![fact; self.pulls.len()]), now_ms);
            if answer.is_some_and(|known| known != state) {
                return "unchecked";
            }
            answer = Some(state);
        }
        answer.unwrap_or("unchecked")
    }
}

/// Count the same bounded, fold-decided sections on the selected page and in Work.
pub fn progress(sections: &[Section], now_ms: u64) -> Option<crate::page_state::Progress> {
    let mut progress = crate::page_state::Progress::default();
    for section in sections.iter().filter(|section| section.counted()) {
        match section.folded_state(now_ms) {
            "done" => progress.done += 1,
            "not-started" => progress.todo += 1,
            "unchecked" => progress.unknown += 1,
            _ => progress.in_progress += 1,
        }
        progress.total += 1;
    }
    (progress.total != 0).then_some(progress)
}

/// The counted sections as the owner list and the page's status read carry them: `{id, title,
/// level, done, total, state, manual?}`, with `state` from `state_of`.
pub fn summary(sections: &[Section], state_of: impl Fn(&Section) -> &'static str) -> Value {
    Value::Array(
        sections
            .iter()
            .filter(|section| section.counted())
            .map(|section| {
                let mut row = serde_json::json!({
                    "id": section.id, "title": section.title, "level": section.level,
                    "done": section.done, "total": section.total, "state": state_of(section),
                });
                if let Some(manual) = section.manual {
                    row["manual"] = serde_json::json!(manual);
                }
                row
            })
            .collect(),
    )
}

/// Live blocks in document order: each block, then its children, by `pos`.
fn walk<'a>(all: &'a Map<String, Value>, parent: &str, out: &mut Vec<(&'a str, &'a Value)>) {
    let mut items: Vec<_> = all
        .iter()
        .filter(|(_, block)| block["parent"] == parent && block.get("deleted").is_none())
        .map(|(id, block)| (id.as_str(), block))
        .collect();
    items.sort_by(|(ia, a), (ib, b)| (a["pos"].as_str(), ia).cmp(&(b["pos"].as_str(), ib)));
    for (id, block) in items {
        out.push((id, block));
        walk(all, id, out);
    }
}

fn cut(text: &str) -> String {
    let mut end = text.len().min(SECTION_TITLE);
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text[..end].to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn page(blocks: &[(&str, &str, &str, Value, &str)]) -> Value {
        let mut all = Map::new();
        for (id, parent, pos, block, text) in blocks {
            let mut block = block.clone();
            block["parent"] = json!(parent);
            block["pos"] = json!(pos);
            block["text"] = json!({"s": text, "marks": []});
            all.insert((*id).to_owned(), block);
        }
        Value::Object(all)
    }
    fn heading(level: u8) -> Value {
        json!({"type": "heading", "props": {"level": level}})
    }
    fn todo(checked: bool) -> Value {
        json!({"type": "todo", "props": {"checked": checked}})
    }

    #[test]
    fn sections_nest_by_level_and_a_parent_sums_its_children() {
        let blocks = page(&[
            (
                "intro",
                "root",
                "a",
                json!({"type": "paragraph", "props": {}}),
                "Notes",
            ),
            ("plan", "root", "b", heading(2), "Plan"),
            ("t1", "root", "c", todo(true), "one"),
            ("build", "root", "d", heading(3), "Build"),
            ("t2", "root", "e", todo(false), "two"),
            (
                "card",
                "root",
                "f",
                json!({"type": "card", "props": {}}),
                "",
            ),
            ("t3", "card", "a", todo(true), "three, inside a card"),
            ("ship", "root", "g", heading(2), "Ship"),
            (
                "pr",
                "root",
                "h",
                json!({"type": "paragraph", "props": {}}),
                "https://github.com/tmt-ninja/tmt/pull/1",
            ),
            ("about", "root", "i", heading(2), "About"),
            (
                "text",
                "root",
                "j",
                json!({"type": "paragraph", "props": {}}),
                "Plain text.",
            ),
        ]);
        let (found, omitted) = sections(Some(&blocks));
        assert!(!omitted);
        let view: Vec<_> = found
            .iter()
            .map(|s| {
                (
                    s.title.as_str(),
                    s.level,
                    s.done,
                    s.total,
                    s.pulls.len(),
                    s.counted(),
                )
            })
            .collect();
        assert_eq!(
            view,
            [
                ("Plan", 2, 2, 3, 0, true),
                ("Build", 3, 1, 2, 0, true),
                ("Ship", 2, 0, 0, 1, true),
            ]
        );
        assert_eq!(found[0].state(None, 0), "working");
        assert_eq!(found[1].state(None, 0), "working");
        // A section waiting on a PR is decided only once its facts are known.
        assert_eq!(found[2].folded_state(0), "unchecked");
        assert_eq!(
            found[2].state(Some(&[PullRequestFact::Open]), 0),
            "waiting-ci"
        );
        assert_eq!(
            found[2].state(
                Some(&[PullRequestFact::Merged {
                    released: Some(true)
                }]),
                0
            ),
            "done"
        );
    }

    #[test]
    fn precedence_and_the_manual_settings() {
        let blocks = page(&[
            ("a", "root", "a", heading(2), "Blocked"),
            ("a1", "root", "b", todo(false), ""),
            (
                "a2",
                "root",
                "c",
                json!({"type": "callout", "props": {"tone": "blocked"}}),
                "stuck",
            ),
            (
                "a3",
                "root",
                "d",
                json!({"type": "question", "props": {"state": "waiting"}}),
                "?",
            ),
            ("b", "root", "e", heading(2), "Asks"),
            (
                "b1",
                "root",
                "f",
                json!({"type": "question", "props": {"state": "waiting"}}),
                "?",
            ),
            (
                "c",
                "root",
                "g",
                json!({"type": "heading", "props": {"level": 2, "progress": "done"}}),
                "Done by hand",
            ),
            ("c1", "root", "h", todo(false), ""),
            ("c2", "root", "i", todo(true), ""),
            (
                "d",
                "root",
                "j",
                json!({"type": "heading", "props": {"level": 2, "progress": "off"}}),
                "Example",
            ),
            ("d1", "root", "k", todo(false), ""),
            ("e", "root", "l", heading(2), "Not started"),
            ("e1", "root", "m", todo(false), ""),
            ("f", "root", "n", heading(2), "All checked"),
            ("f1", "root", "o", todo(true), ""),
        ]);
        let (found, _) = sections(Some(&blocks));
        let states: Vec<_> = found
            .iter()
            .map(|s| (s.title.as_str(), s.folded_state(0)))
            .collect();
        assert_eq!(
            states,
            [
                ("Blocked", "blocked"),
                ("Asks", "needs-you"),
                ("Done by hand", "done"),
                ("Not started", "not-started"),
                ("All checked", "done"),
            ]
        );
        // The manual done keeps the real count visible.
        assert_eq!((found[2].done, found[2].total), (1, 2));
    }

    #[test]
    fn an_html_page_has_sections_from_its_outline_headings() {
        let source = r#"<h1>Plan</h1><h2>Build <em>it</em></h2>
<p>See https://github.com/o/r/pull/7 now.</p>
<h3>Ask</h3><div><tmt-question data-id="q1"><h2>Not a section</h2></tmt-question></div>
<div hidden><h2>Hidden</h2></div>
<h2>Ship</h2><p><a href="https://github.com/o/r/pull/8">#8</a></p><tmt-question data-id="q2"></tmt-question>"#;
        let (found, omitted) = html_sections(source, &BTreeSet::from(["q1"]));
        assert!(!omitted);
        let rows: Vec<_> = found
            .iter()
            .map(|s| {
                (
                    s.id.as_str(),
                    s.title.as_str(),
                    s.level,
                    s.open_questions,
                    s.pulls.len(),
                )
            })
            .collect();
        assert_eq!(
            rows,
            [
                ("h1", "Build it", 2, 1, 1),
                ("h2", "Ask", 3, 1, 0),
                ("h3", "Ship", 2, 0, 1)
            ]
        );
        assert!(found.iter().all(Section::counted));
        assert_eq!(found[1].state(Some(&[]), 0), "needs-you");
    }

    #[test]
    fn html_task_checkboxes_count_from_saved_source_under_each_open_heading() {
        let source = r#"
<input type="checkbox" checked>
<h2>Build</h2><label><input TYPE="CHECKBOX" checked="false"> Plan</label>
<h3>Details</h3><ul><li><input type=checkbox> Review</li></ul>
<input type=checkbox checked disabled>
<div hidden><input type=checkbox checked></div>
<input hidden type=checkbox checked>
<form id=survey><input type=checkbox checked></form>
<input type=checkbox checked form=survey>
<fieldset><input type=checkbox checked></fieldset>
<tmt-questions><input type=checkbox checked></tmt-questions>
<tmt-question><input type=checkbox checked></tmt-question>
<template><input type=checkbox checked></template>
<svg><input type=checkbox checked /></svg>
<script>const example = '<input type=checkbox checked>';</script>
<p>[x] Example</p><input type=radio checked>
<h2>Ship</h2><input type=checkbox checked>
<h2>Notes</h2><p>[x] Sample text</p>"#;
        let (found, omitted) = html_sections(source, &BTreeSet::new());
        assert!(!omitted);
        let facts: Vec<_> = found
            .iter()
            .map(|section| {
                (
                    section.id.as_str(),
                    section.done,
                    section.total,
                    section.folded_state(0),
                )
            })
            .collect();
        assert_eq!(
            facts,
            [
                ("h1", 1, 2, "working"),
                ("h2", 0, 1, "not-started"),
                ("h3", 1, 1, "done"),
            ]
        );
        assert!(
            html_sections("<h2>Notes</h2><p>[x] Sample text</p>", &BTreeSet::new())
                .0
                .is_empty()
        );
    }

    #[test]
    fn only_counted_headings_consume_projection_slots() {
        let mut blocks = serde_json::Map::new();
        for i in 0..SECTIONS + 2 {
            blocks.insert(format!("h{i}"), json!({"type":"heading","parent":"root","pos":format!("{i:03}"), "props":{"level":2,"progress":if i==0 {"off"} else {"done"}}}));
        }
        let (rows, omitted) = sections(Some(&Value::Object(blocks.clone())));
        assert!(omitted);
        assert_eq!(rows.len(), SECTIONS);
        assert_eq!(rows.last().unwrap().id, format!("h{SECTIONS}"));
        blocks.remove(&format!("h{}", SECTIONS + 1));
        assert!(!sections(Some(&Value::Object(blocks))).1);
    }

    #[test]
    fn a_page_past_the_bound_says_so_and_parents_keep_counting() {
        let mut items = vec![("top", "root", "a".to_owned(), heading(2), "Top".to_owned())];
        for n in 0..SECTIONS + 2 {
            items.push((
                Box::leak(format!("h{n}").into_boxed_str()),
                "root",
                format!("b{n:04}"),
                heading(3),
                format!("Part {n}"),
            ));
            items.push((
                Box::leak(format!("t{n}").into_boxed_str()),
                "root",
                format!("b{n:04}x"),
                todo(true),
                String::new(),
            ));
        }
        let rows: Vec<_> = items
            .iter()
            .map(|(id, parent, pos, block, text)| {
                (*id, *parent, pos.as_str(), block.clone(), text.as_str())
            })
            .collect();
        let (found, omitted) = sections(Some(&page(&rows)));
        assert!(omitted);
        assert_eq!(found.len(), SECTIONS);
        assert_eq!(found[0].total, SECTIONS + 2);
    }

    /// The shared vectors (`contracts/vectors/sections-v1.json`) the open page's `liveSections`
    /// runs too (#6687): the serve's sections and their fold-only state, case by case.
    #[test]
    fn the_shared_vectors_agree() {
        let file: Value =
            serde_json::from_str(include_str!("../../../contracts/vectors/sections-v1.json"))
                .unwrap();
        for case in file["cases"].as_array().unwrap() {
            let (found, omitted) = sections(Some(&case["blocks"]));
            let got: Vec<Value> = found
                .iter()
                .map(|section| {
                    let mut row = json!({
                        "id": section.id, "title": section.title, "level": section.level,
                        "done": section.done, "total": section.total,
                        "state": section.folded_state(0),
                    });
                    if let Some(manual) = section.manual {
                        row["manual"] = json!(manual);
                    }
                    row
                })
                .collect();
            assert_eq!(Value::Array(got), case["sections"], "{}", case["name"]);
            assert_eq!(json!(omitted), case["omitted"], "{}", case["name"]);
        }
    }
}
