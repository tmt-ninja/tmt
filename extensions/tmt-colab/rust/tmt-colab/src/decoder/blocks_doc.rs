//! The Yjs side of a structured page's `blocks` root (#6004), reached only from the decoder child:
//! reading it into the projection `blocks::schema` validates, replaying the validator's steps on it,
//! and creating the empty root. A block is a nested `Y.Map` (`type`, `parent`, `pos`, `props` as a
//! `Y.Map`, `text` as a `Y.Text`, a row's `cells` as a `Y.Map` of `Y.Text`, `deleted`); marks are
//! `Y.Text` attributes. The child compares what it reads back with what the validator expected, so
//! a difference between the two models is a refusal, never a silent divergence.
use super::DecodeFault;
use crate::blocks::{
    ops::Step,
    schema::ROW,
    text::{MARKS, RichText},
};
use serde_json::{Map as JsonMap, Value};
use std::{collections::HashMap, sync::Arc};
use yrs::{
    Any, GetString, In, Map, MapPrelim, MapRef, Out, ReadTxn, Text, TextPrelim, TextRef,
    TransactionMut, types::Attrs,
};

fn any(value: &Value) -> Result<Any, DecodeFault> {
    Any::from_json(&value.to_string()).map_err(|_| DecodeFault::Rejected)
}
fn json(value: &Any) -> Result<Value, DecodeFault> {
    serde_json::to_value(value).map_err(|_| DecodeFault::Rejected)
}
fn string_of(out: Out) -> Result<String, DecodeFault> {
    match out {
        Out::Any(Any::String(s)) => Ok(s.to_string()),
        _ => Err(DecodeFault::Rejected),
    }
}

/// One `Y.Text` as `{"s","marks"}`. Only plain string runs are text; an embed or a mark outside
/// the closed set is a rejection.
fn read_text<T: ReadTxn>(txn: &T, text: &TextRef, rich: bool) -> Result<Value, DecodeFault> {
    let mut runs: Vec<crate::blocks::text::Run> = Vec::new();
    for chunk in text.diff(txn, yrs::types::text::YChange::identity) {
        let Out::Any(Any::String(piece)) = chunk.insert else {
            return Err(DecodeFault::Rejected);
        };
        let mut marks = Vec::new();
        for (name, value) in chunk.attributes.iter().flat_map(|a| a.iter()) {
            marks.push(match (name.as_ref(), value) {
                ("bold" | "italic" | "code", Any::Bool(true)) => (name.to_string(), None),
                ("link" | "agent" | "block", Any::String(v)) => {
                    (name.to_string(), Some(v.to_string()))
                }
                _ => return Err(DecodeFault::Rejected),
            });
        }
        runs.push((piece.to_string(), marks));
    }
    let text = RichText::from_runs(&runs).map_err(|_| DecodeFault::Rejected)?;
    let value = text.to_value();
    if !rich && !value["marks"].as_array().is_some_and(Vec::is_empty) {
        return Err(DecodeFault::Rejected);
    }
    Ok(value)
}

/// The `blocks` root as the projection `blocks::schema::validate` takes.
pub(super) fn project<T: ReadTxn>(txn: &T, blocks: &MapRef) -> Result<Value, DecodeFault> {
    let mut out = JsonMap::new();
    for (id, entry) in blocks.iter(txn) {
        let Out::YMap(block) = entry else {
            return Err(DecodeFault::Rejected);
        };
        let block_type = string_of(block.get(txn, "type").ok_or(DecodeFault::Rejected)?)?;
        let mut value = JsonMap::new();
        for (key, field) in block.iter(txn) {
            let projected = match (key, field) {
                ("type" | "parent" | "pos", Out::Any(Any::String(s))) => {
                    Value::String(s.to_string())
                }
                ("deleted", Out::Any(any)) => json(&any)?,
                ("props", Out::YMap(props)) => {
                    let mut map = JsonMap::new();
                    for (name, prop) in props.iter(txn) {
                        let Out::Any(prop) = prop else {
                            return Err(DecodeFault::Rejected);
                        };
                        map.insert(name.into(), json(&prop)?);
                    }
                    Value::Object(map)
                }
                ("text", Out::YText(text)) => {
                    read_text(txn, &text, crate::blocks::schema::rich(&block_type))?
                }
                ("cells", Out::YMap(cells)) if block_type == ROW => {
                    let mut map = JsonMap::new();
                    for (column, cell) in cells.iter(txn) {
                        let Out::YText(cell) = cell else {
                            return Err(DecodeFault::Rejected);
                        };
                        map.insert(column.into(), read_text(txn, &cell, true)?);
                    }
                    Value::Object(map)
                }
                _ => return Err(DecodeFault::Rejected),
            };
            value.insert(key.into(), projected);
        }
        out.insert(id.into(), Value::Object(value));
    }
    Ok(Value::Object(out))
}

fn prelim(block: &Value) -> Result<MapPrelim, DecodeFault> {
    let mut map: HashMap<Arc<str>, In> = HashMap::new();
    for key in ["type", "parent", "pos"] {
        let value = block[key].as_str().ok_or(DecodeFault::Rejected)?;
        map.insert(key.into(), In::Any(Any::String(value.into())));
    }
    let props: HashMap<Arc<str>, In> = block["props"]
        .as_object()
        .ok_or(DecodeFault::Rejected)?
        .iter()
        .map(|(k, v)| Ok((Arc::from(k.as_str()), In::Any(any(v)?))))
        .collect::<Result<_, DecodeFault>>()?;
    map.insert("props".into(), In::Map(MapPrelim::from_iter(props)));
    if let Some(text) = block.get("text") {
        // A new block's text is plain: marks come only from later `format` steps.
        let s = text["s"].as_str().ok_or(DecodeFault::Rejected)?;
        map.insert("text".into(), TextPrelim::new(s).into());
    }
    if let Some(cells) = block.get("cells") {
        let cells: HashMap<Arc<str>, In> = cells
            .as_object()
            .ok_or(DecodeFault::Rejected)?
            .iter()
            .map(|(k, v)| {
                let s = v["s"].as_str().ok_or(DecodeFault::Rejected)?;
                Ok((Arc::from(k.as_str()), TextPrelim::new(s).into()))
            })
            .collect::<Result<_, DecodeFault>>()?;
        map.insert("cells".into(), In::Map(MapPrelim::from_iter(cells)));
    }
    Ok(MapPrelim::from_iter(map))
}

fn block_map(txn: &TransactionMut, blocks: &MapRef, id: &str) -> Result<MapRef, DecodeFault> {
    match blocks.get(txn, id) {
        Some(Out::YMap(block)) => Ok(block),
        _ => Err(DecodeFault::Rejected),
    }
}
fn sub_map(txn: &TransactionMut, block: &MapRef, key: &str) -> Result<MapRef, DecodeFault> {
    match block.get(txn, key) {
        Some(Out::YMap(map)) => Ok(map),
        _ => Err(DecodeFault::Rejected),
    }
}
fn text_ref(
    txn: &TransactionMut,
    blocks: &MapRef,
    id: &str,
    column: Option<&str>,
) -> Result<TextRef, DecodeFault> {
    let block = block_map(txn, blocks, id)?;
    let found = match column {
        Some(column) => sub_map(txn, &block, "cells")?.get(txn, column),
        None => block.get(txn, "text"),
    };
    match found {
        Some(Out::YText(text)) => Ok(text),
        _ => Err(DecodeFault::Rejected),
    }
}
/// The byte offset of a scalar-value index (the document counts bytes).
fn bytes_at(text: &str, index: usize) -> Result<u32, DecodeFault> {
    let at = text
        .char_indices()
        .nth(index)
        .map_or(text.len(), |(at, _)| at);
    if index > text.chars().count() {
        return Err(DecodeFault::Rejected);
    }
    u32::try_from(at).map_err(|_| DecodeFault::Rejected)
}
fn marks_cleared() -> Attrs {
    MARKS.iter().map(|m| (Arc::from(*m), Any::Null)).collect()
}

/// The steps that build the given blocks from nothing: each block, its marks, its tombstone.
pub(super) fn rebuild(blocks: &Value) -> Vec<Step> {
    let mut steps = Vec::new();
    let Some(all) = blocks.as_object() else {
        return steps;
    };
    let marks_of = |id: &str, column: Option<&str>, text: &Value, steps: &mut Vec<Step>| {
        for mark in text["marks"].as_array().into_iter().flatten() {
            let (Some(from), Some(to), Some(name)) = (
                mark["from"].as_u64(),
                mark["to"].as_u64(),
                mark["mark"].as_str(),
            ) else {
                continue;
            };
            steps.push(Step::Format {
                id: id.into(),
                column: column.map(str::to_owned),
                from: from as usize,
                to: to as usize,
                mark: name.into(),
                value: Some(mark["value"].as_str().unwrap_or("true").to_owned()),
            });
        }
    };
    for (id, block) in all {
        steps.push(Step::Put {
            id: id.clone(),
            block: block.clone(),
        });
    }
    for (id, block) in all {
        if let Some(text) = block.get("text") {
            marks_of(id, None, text, &mut steps);
        }
        for (column, cell) in block
            .get("cells")
            .and_then(Value::as_object)
            .into_iter()
            .flatten()
        {
            marks_of(id, Some(column), cell, &mut steps);
        }
        if let Some(at) = block.get("deleted").and_then(Value::as_u64) {
            steps.push(Step::Delete { id: id.clone(), at });
        }
    }
    steps
}

/// Replay the validator's steps in one transaction.
pub(super) fn apply(
    txn: &mut TransactionMut,
    blocks: &MapRef,
    steps: &[Step],
) -> Result<(), DecodeFault> {
    for step in steps {
        match step {
            Step::Put { id, block } => {
                blocks.insert(txn, id.as_str(), prelim(block)?);
            }
            Step::Move { id, parent, pos } => {
                let block = block_map(txn, blocks, id)?;
                block.insert(txn, "parent", parent.as_str());
                block.insert(txn, "pos", pos.as_str());
            }
            Step::Prop { id, key, value } => {
                let props = sub_map(txn, &block_map(txn, blocks, id)?, "props")?;
                match value {
                    Some(value) => {
                        props.insert(txn, key.as_str(), any(value)?);
                    }
                    None => {
                        props.remove(txn, key);
                    }
                }
            }
            Step::Cell { id, column } => {
                let cells = sub_map(txn, &block_map(txn, blocks, id)?, "cells")?;
                cells.insert(txn, column.as_str(), TextPrelim::new(""));
            }
            Step::Splice {
                id,
                column,
                from,
                to,
                text,
            } => {
                let target = text_ref(txn, blocks, id, column.as_deref())?;
                let current = target.get_string(txn);
                let (start, end) = (bytes_at(&current, *from)?, bytes_at(&current, *to)?);
                if end > start {
                    target.remove_range(txn, start, end - start);
                }
                // The new text carries no mark, whatever surrounds it.
                target.insert_with_attributes(txn, start, text, marks_cleared());
            }
            Step::Format {
                id,
                column,
                from,
                to,
                mark,
                value,
            } => {
                let target = text_ref(txn, blocks, id, column.as_deref())?;
                let current = target.get_string(txn);
                let (start, end) = (bytes_at(&current, *from)?, bytes_at(&current, *to)?);
                let set = match (mark.as_str(), value) {
                    ("bold" | "italic" | "code", Some(_)) => Any::Bool(true),
                    (_, Some(v)) => Any::String(v.as_str().into()),
                    (_, None) => Any::Null,
                };
                let mut attrs = Attrs::new();
                attrs.insert(Arc::from(mark.as_str()), set);
                target.format(txn, start, end - start, attrs);
            }
            Step::Delete { id, at } => {
                block_map(txn, blocks, id)?.insert(txn, "deleted", any(&Value::from(*at))?);
            }
            Step::Restore { id } => {
                block_map(txn, blocks, id)?.remove(txn, "deleted");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        blocks::{ops, schema},
        decoder::{Namespace, child},
    };
    use serde_json::json;
    use yrs::{StateVector, Transact, Update, updates::decoder::Decode};

    fn bid(n: u32) -> String {
        format!("10000000-0000-4000-8000-{n:012}")
    }
    fn page() -> yrs::Doc {
        let doc = yrs::Doc::new();
        doc.get_or_insert_text("html");
        let meta = doc.get_or_insert_map("meta");
        let mut tx = doc.transact_mut();
        meta.insert(&mut tx, "title", "T");
        meta.insert(&mut tx, "pageType", "blocks");
        drop(tx);
        doc
    }
    fn blocks_of(doc: &yrs::Doc) -> Value {
        child::project(doc, Namespace::Content).unwrap()["blocks"].clone()
    }
    /// Validate the batch against what the document projects, replay it, and demand the document
    /// then projects exactly what the validator expected. Returns the update it produced.
    fn run(doc: &yrs::Doc, ops: Value) -> Vec<u8> {
        let before = blocks_of(doc);
        let applied = ops::apply(
            &before,
            &json!({"ops": ops}),
            &json!({"timeMs": 1_700_000_000_000_u64}),
        )
        .unwrap();
        let blocks = doc.get_or_insert_map("blocks");
        let mut tx = doc.transact_mut();
        apply(&mut tx, &blocks, &applied.steps).unwrap();
        let update = tx.encode_update_v1();
        drop(tx);
        let after = child::project(doc, Namespace::Content).unwrap();
        assert_eq!(after["blocks"], applied.next);
        schema::validate(&after["blocks"]).unwrap();
        update
    }

    #[test]
    fn an_empty_page_of_blocks_projects_an_empty_value() {
        let doc = page();
        assert_eq!(
            child::project(&doc, Namespace::Content).unwrap()["blocks"],
            json!({})
        );
    }

    #[test]
    fn every_step_replays_to_what_the_validator_expected() {
        let doc = page();
        run(
            &doc,
            json!([
                {"op": "insert", "id": bid(1), "type": "heading", "props": {"level": 3}, "text": "Plan 🐈"},
                {"op": "insert", "id": bid(2), "type": "paragraph", "text": "hello world"},
                {"op": "insert", "id": bid(3), "type": "card", "props": {"title": "Notes"}},
                {"op": "insert", "id": bid(4), "type": "todo", "parent": bid(3), "text": "ship"},
                {"op": "insert", "id": bid(5), "type": "table", "props": {"columns": [{"id": "a", "name": "A"}]}},
            ]),
        );
        run(
            &doc,
            json!([
                {"op": "text", "id": bid(2), "format": {"from": 0, "to": 5, "mark": "bold", "value": true}},
                {"op": "text", "id": bid(2), "format": {"from": 6, "to": 11, "mark": "link", "value": "https://example.com/x"}},
                {"op": "props", "id": bid(4), "set": {"checked": true, "due": "2026-12-01"}},
                {"op": "move", "id": bid(2), "parent": bid(3), "after": null},
            ]),
        );
        // Typing inside a marked run, astral text before it, and a whole-text set.
        run(
            &doc,
            json!([
                {"op": "text", "id": bid(2), "replace": {"find": "ell", "with": "ELL🐈"}},
                {"op": "text", "id": bid(1), "replace": {"find": "Plan", "with": "Roadmap"}},
                {"op": "text", "id": bid(4), "base": "ship", "set": "ship it"},
            ]),
        );
        run(
            &doc,
            json!([
                {"op": "table", "id": bid(5), "action": "add-row", "row": bid(6), "cells": {"a": "one"}},
                {"op": "table", "id": bid(5), "action": "set-cell", "row": bid(6), "column": "a", "text": "one 🐈"},
                {"op": "table", "id": bid(5), "action": "add-column", "column": {"id": "b", "name": "B"}},
                {"op": "table", "id": bid(5), "action": "add-row", "row": bid(7)},
                {"op": "table", "id": bid(5), "action": "set-cell", "row": bid(7), "column": "b", "text": "late"},
                {"op": "props", "id": bid(5), "unset": ["columns"]},
            ]),
        );
        run(
            &doc,
            json!([
                {"op": "delete", "id": bid(3)},
                {"op": "table", "id": bid(5), "action": "remove-row", "row": bid(6)},
            ]),
        );
        run(&doc, json!([{"op": "restore", "id": bid(3)}]));
        let value = blocks_of(&doc);
        assert!(value[bid(3)].get("deleted").is_none());
        assert_eq!(value[bid(7)]["cells"]["b"]["s"], "late");
    }

    #[test]
    fn two_writers_converge_and_each_update_replays_alone() {
        let one = page();
        run(
            &one,
            json!([
                {"op": "insert", "id": bid(1), "type": "paragraph", "text": "The quick brown fox jumps"},
                {"op": "insert", "id": bid(2), "type": "paragraph", "text": "second"},
            ]),
        );
        // The page as both writers hold it before they diverge: its metadata and two blocks.
        let base = one
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        let two = yrs::Doc::new();
        two.get_or_insert_text("html");
        two.get_or_insert_map("meta");
        two.transact_mut()
            .apply_update(Update::decode_v1(&base).unwrap())
            .unwrap();
        // Concurrently: one edits a word and moves a block, the other edits another word, inserts and deletes.
        let from_one = run(
            &one,
            json!([
                {"op": "text", "id": bid(1), "replace": {"find": "brown", "with": "red"}},
                {"op": "move", "id": bid(2), "after": null},
            ]),
        );
        let from_two = run(
            &two,
            json!([
                {"op": "text", "id": bid(1), "replace": {"find": "jumps", "with": "leaps"}},
                {"op": "insert", "id": bid(3), "type": "heading", "text": "New"},
                {"op": "delete", "id": bid(2)},
            ]),
        );
        one.transact_mut()
            .apply_update(Update::decode_v1(&from_two).unwrap())
            .unwrap();
        two.transact_mut()
            .apply_update(Update::decode_v1(&from_one).unwrap())
            .unwrap();
        let (a, b) = (blocks_of(&one), blocks_of(&two));
        assert_eq!(a, b);
        assert_eq!(a[bid(1)]["text"]["s"], "The quick red fox leaps");
        assert!(a[bid(2)].get("deleted").is_some());
        schema::validate(&a).unwrap();
        // A fresh reader that gets only the updates in order projects the same page.
        let reader = yrs::Doc::new();
        reader.get_or_insert_text("html");
        reader.get_or_insert_map("meta");
        for bytes in [&base, &from_one, &from_two] {
            reader
                .transact_mut()
                .apply_update(Update::decode_v1(bytes).unwrap())
                .unwrap();
        }
        assert_eq!(
            child::project(&reader, Namespace::Content).unwrap()["blocks"],
            a
        );
    }

    #[test]
    fn rebuilding_a_projection_gives_the_same_projection() {
        let doc = page();
        run(
            &doc,
            json!([
                {"op": "insert", "id": bid(1), "type": "paragraph", "text": "hello 🐈 world"},
                {"op": "insert", "id": bid(2), "type": "table", "props": {"columns": [{"id": "a", "name": "A"}]}},
                {"op": "table", "id": bid(2), "action": "add-row", "row": bid(3), "cells": {"a": "cell text"}},
                {"op": "text", "id": bid(1), "format": {"from": 0, "to": 5, "mark": "bold", "value": true}},
                {"op": "text", "id": bid(1), "format": {"from": 6, "to": 7, "mark": "link", "value": "https://example.com/z"}},
                {"op": "table", "id": bid(2), "action": "set-cell", "row": bid(3), "column": "a", "text": "cell text!"},
                {"op": "text", "id": bid(3), "cell": "a", "format": {"from": 0, "to": 4, "mark": "italic", "value": true}},
                {"op": "insert", "id": bid(4), "type": "code", "text": "let x = 1;"},
                {"op": "delete", "id": bid(4)},
            ]),
        );
        let original = blocks_of(&doc);
        let fresh = page();
        let map = fresh.get_or_insert_map("blocks");
        let mut tx = fresh.transact_mut();
        apply(&mut tx, &map, &rebuild(&original)).unwrap();
        drop(tx);
        assert_eq!(blocks_of(&fresh), original);
    }

    #[test]
    fn a_hand_built_wrong_shape_is_rejected() {
        let wrong: [fn(&yrs::Doc, &MapRef); 5] = [
            |doc, blocks| {
                let mut tx = doc.transact_mut();
                blocks.insert(&mut tx, "x", "not a map");
            },
            |doc, blocks| {
                let mut tx = doc.transact_mut();
                blocks.insert(
                    &mut tx,
                    "x",
                    MapPrelim::from_iter([("type", In::Any(Any::from("paragraph")))]),
                );
                blocks.insert(&mut tx, "y", TextPrelim::new("t"));
            },
            |doc, blocks| {
                let mut tx = doc.transact_mut();
                let block = blocks.insert(
                    &mut tx,
                    "x",
                    MapPrelim::from_iter([("type", In::Any(Any::from("paragraph")))]),
                );
                block.insert(&mut tx, "props", 5);
            },
            |doc, blocks| {
                let mut tx = doc.transact_mut();
                let block = blocks.insert(
                    &mut tx,
                    "x",
                    MapPrelim::from_iter([("type", In::Any(Any::from("paragraph")))]),
                );
                block.insert(&mut tx, "text", TextPrelim::new("t"));
                let text = match block.get(&tx, "text") {
                    Some(Out::YText(text)) => text,
                    _ => unreachable!(),
                };
                let mut attrs = Attrs::new();
                attrs.insert(Arc::from("underline"), Any::Bool(true));
                text.format(&mut tx, 0, 1, attrs);
            },
            |doc, blocks| {
                let mut tx = doc.transact_mut();
                let block = blocks.insert(
                    &mut tx,
                    "x",
                    MapPrelim::from_iter([("type", In::Any(Any::from("row")))]),
                );
                block.insert(
                    &mut tx,
                    "cells",
                    MapPrelim::from_iter([("a", In::Any(Any::from("plain")))]),
                );
            },
        ];
        for build in wrong {
            let doc = page();
            let blocks = doc.get_or_insert_map("blocks");
            build(&doc, &blocks);
            let txn = doc.transact();
            assert!(
                project(&txn, &blocks).is_err()
                    || schema::validate(&project(&txn, &blocks).unwrap()).is_err()
            );
        }
        // A `blocks` root on an ordinary page is not a page.
        let ordinary = yrs::Doc::new();
        ordinary.get_or_insert_text("html");
        ordinary.get_or_insert_map("meta");
        ordinary.get_or_insert_map("blocks");
        assert!(child::project(&ordinary, Namespace::Content).is_err());
    }
}
