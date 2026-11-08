//! The block batch: one validator for every caller (the browser's save path and `tmt colab block`).
//! `apply` checks a batch of ops against the current `blocks` value, in order, and returns the
//! next value, the receipt and the normalized steps the decoder replays on the Yjs document as
//! granular edits. One bad op refuses the whole batch. No Yjs, storage or authority here.
use super::{
    merge, pos,
    schema::{self, ROOT, ROW, TYPES},
    text::{RichText, plain_value},
};
use crate::{
    closed::{Invalid, canonical, id, integer, object, require, text},
    limits,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use tmt_colab_model::values;

/// Why a batch was refused. Everything else is `Invalid`: unknown op, bad shape, a value the
/// type's schema refuses.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Refusal {
    Invalid,
    /// An op names a block that is not on the page (never added, or purged by compaction).
    NotFound,
    /// `after` names a block that is not a child of `parent`.
    BadAfter,
    TextNotFound,
    TextAmbiguous,
    Capacity,
    /// A mockup's markup has page-check findings.
    Markup,
    /// An attachment reference no descriptor of the page names, or a descriptor a live block still
    /// shows is removed (#6190).
    Attachment,
}
impl From<Invalid> for Refusal {
    fn from(_: Invalid) -> Self {
        Self::Invalid
    }
}
type Result<T> = std::result::Result<T, Refusal>;

/// One normalized edit, replayed in order by the decoder on the page's Yjs document.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "step", rename_all = "kebab-case", deny_unknown_fields)]
pub enum Step {
    /// A new block: its complete projection (`type`, `parent`, `pos`, `props`, `text` or `cells`).
    Put {
        id: String,
        block: Value,
    },
    Move {
        id: String,
        parent: String,
        pos: String,
    },
    /// Set (`Some`) or remove (`None`) one key of a block's props.
    Prop {
        id: String,
        key: String,
        value: Option<Value>,
    },
    /// An empty cell text in a row, so a later edit has a `Y.Text` to write to.
    Cell {
        id: String,
        column: String,
    },
    /// Replace `[from, to)` of a block's text (or of one cell's) with unmarked text.
    Splice {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        column: Option<String>,
        from: usize,
        to: usize,
        text: String,
    },
    Format {
        id: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        column: Option<String>,
        from: usize,
        to: usize,
        mark: String,
        value: Option<String>,
    },
    Delete {
        id: String,
        at: u64,
    },
    Restore {
        id: String,
    },
}

#[derive(Debug, PartialEq)]
pub struct Applied {
    pub next: Value,
    pub steps: Vec<Step>,
    /// `{"ops":[{"op","id"}…],"droppedHunks":[{"id","from","to","text"}…]}`.
    pub receipt: Value,
}

enum After<'a> {
    Last,
    First,
    Block(&'a str),
}

struct Editing {
    doc: Map<String, Value>,
    steps: Vec<Step>,
    ops: Vec<Value>,
    dropped: Vec<Value>,
    now: u64,
}

/// Exactly the required keys and some of the optional ones. Unlike `closed::keys`, a key may be
/// `null`: `after: null` is "first", and the next check on the value refuses a null anywhere else.
fn keys(value: &Value, required: &[&str], optional: &[&str]) -> Result<()> {
    let map = object(value)?;
    require(required.iter().all(|key| map.contains_key(*key)))?;
    require(
        map.keys()
            .all(|key| required.contains(&key.as_str()) || optional.contains(&key.as_str())),
    )?;
    Ok(())
}
fn after_of(op: &Value) -> Result<After<'_>> {
    Ok(match op.get("after") {
        None => After::Last,
        Some(Value::Null) => After::First,
        Some(value) => After::Block(id(value)?),
    })
}
fn string(value: &Value) -> Result<&str> {
    Ok(text(value)?)
}
fn plain_text(value: &Value, bytes: usize) -> Result<&str> {
    let value = string(value)?;
    require(super::text::valid_text(value, bytes))?;
    Ok(value)
}

impl Editing {
    fn block(&self, key: &str) -> Result<&Value> {
        self.doc.get(key).ok_or(Refusal::NotFound)
    }
    fn block_type(&self, key: &str) -> Result<&str> {
        Ok(self.block(key)?["type"].as_str().unwrap_or_default())
    }
    fn note(&mut self, op: &str, key: &str) {
        self.ops.push(json!({"op": op, "id": key}));
    }

    /// The sort key for a block placed under `parent` after `after`, among the siblings the block
    /// itself does not count in (`except`, for a move).
    fn place(&self, parent: &str, after: &After<'_>, except: Option<&str>) -> Result<String> {
        let mut siblings: Vec<(&str, &str)> = self
            .doc
            .iter()
            .filter(|(key, b)| b["parent"] == parent && Some(key.as_str()) != except)
            .map(|(key, b)| (b["pos"].as_str().unwrap_or_default(), key.as_str()))
            .collect();
        siblings.sort_unstable();
        let (before, next) = match after {
            After::Last => (siblings.last().map(|s| s.0), None),
            After::First => (None, siblings.first().map(|s| s.0)),
            After::Block(key) => {
                let at = siblings
                    .iter()
                    .position(|s| s.1 == *key)
                    .ok_or(Refusal::BadAfter)?;
                (Some(siblings[at].0), siblings.get(at + 1).map(|s| s.0))
            }
        };
        pos::between(before, next).map_err(|_| Refusal::Capacity)
    }

    fn require_parent(&self, parent: &str, child_type: &str) -> Result<()> {
        if parent == ROOT {
            return Ok(());
        }
        require(child_type != "card" && self.block_type(parent)? == "card")?;
        Ok(())
    }

    fn insert(&mut self, op: &Value) -> Result<()> {
        keys(
            op,
            &["op", "id", "type"],
            &["parent", "after", "props", "text"],
        )?;
        let key = id(&op["id"])?;
        let block_type = string(&op["type"])?;
        require(!self.doc.contains_key(key) && TYPES.contains(&block_type))?;
        require(self.doc.len() < limits::BLOCKS).map_err(|_| Refusal::Capacity)?;
        let parent = op.get("parent").map_or(Ok(ROOT), string)?;
        self.require_parent(parent, block_type)?;
        let position = self.place(parent, &after_of(op)?, None)?;
        let props = op.get("props").cloned().unwrap_or_else(|| json!({}));
        object(&props)?;
        let mut block =
            json!({"type": block_type, "parent": parent, "pos": position, "props": props});
        match (schema::has_text(block_type), op.get("text")) {
            (true, given) => {
                let body = given.map_or(Ok(""), |v| plain_text(v, limits::BLOCK_TEXT_BYTES))?;
                block["text"] = plain_value(body);
            }
            (false, None) => {}
            (false, Some(_)) => return Err(Refusal::Invalid),
        }
        self.steps.push(Step::Put {
            id: key.into(),
            block: block.clone(),
        });
        self.doc.insert(key.into(), block);
        self.note("insert", key);
        Ok(())
    }

    fn move_block(&mut self, op: &Value) -> Result<()> {
        keys(op, &["op", "id"], &["parent", "after"])?;
        let key = id(&op["id"])?;
        let block_type = self.block_type(key)?.to_owned();
        require(block_type != ROW)?;
        let parent = match op.get("parent") {
            Some(value) => string(value)?.to_owned(),
            None => self.block(key)?["parent"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
        };
        require(parent != key)?;
        self.require_parent(&parent, &block_type)?;
        let position = self.place(&parent, &after_of(op)?, Some(key))?;
        let block = self.doc.get_mut(key).ok_or(Refusal::NotFound)?;
        block["parent"] = parent.clone().into();
        block["pos"] = position.clone().into();
        self.steps.push(Step::Move {
            id: key.into(),
            parent,
            pos: position,
        });
        self.note("move", key);
        Ok(())
    }

    fn props(&mut self, op: &Value) -> Result<()> {
        keys(op, &["op", "id"], &["set", "unset"])?;
        let key = id(&op["id"])?;
        let block_type = self.block_type(key)?.to_owned();
        require(block_type != ROW)?;
        let set = op
            .get("set")
            .map_or(Ok(Map::new()), |v| object(v).cloned())?;
        let unset: Vec<&str> = match op.get("unset") {
            None => Vec::new(),
            Some(value) => value
                .as_array()
                .ok_or(Invalid)?
                .iter()
                .map(string)
                .collect::<Result<_>>()?,
        };
        require(!(set.is_empty() && unset.is_empty()))?;
        require(unset.iter().all(|k| !set.contains_key(*k)))?;
        let mut props = self.block(key)?["props"]
            .as_object()
            .cloned()
            .unwrap_or_default();
        for name in &unset {
            props.remove(*name);
        }
        props.extend(set.clone());
        schema::validate_props(&block_type, &Value::Object(props.clone()))?;
        self.doc.get_mut(key).ok_or(Refusal::NotFound)?["props"] = Value::Object(props);
        let mut names: Vec<(&str, Option<&Value>)> =
            set.iter().map(|(k, v)| (k.as_str(), Some(v))).collect();
        names.extend(unset.iter().map(|k| (*k, None)));
        names.sort_by_key(|(name, _)| *name);
        for (name, value) in names {
            self.steps.push(Step::Prop {
                id: key.into(),
                key: name.into(),
                value: value.cloned(),
            });
        }
        self.note("props", key);
        Ok(())
    }

    /// The text being edited: a block's own, or one cell of a row (empty when it has none yet).
    fn text_of(&self, key: &str, column: Option<&str>) -> Result<RichText> {
        let block = self.block(key)?;
        let block_type = block["type"].as_str().unwrap_or_default();
        let value = match column {
            Some(column) => {
                require(block_type == ROW)?;
                block["cells"]
                    .get(column)
                    .cloned()
                    .unwrap_or_else(|| plain_value(""))
            }
            None => {
                require(schema::has_text(block_type))?;
                block["text"].clone()
            }
        };
        let (rich, bytes) = match column {
            Some(_) => (true, limits::BLOCK_CELL_BYTES),
            None => (schema::rich(block_type), limits::BLOCK_TEXT_BYTES),
        };
        Ok(RichText::from_value(&value, rich, bytes)?)
    }

    fn store_text(&mut self, key: &str, column: Option<&str>, value: &RichText) -> Result<()> {
        let block = self.doc.get_mut(key).ok_or(Refusal::NotFound)?;
        match column {
            Some(column) => {
                require(block["cells"].is_object())?;
                block["cells"][column] = value.to_value();
            }
            None => block["text"] = value.to_value(),
        }
        Ok(())
    }

    fn text_edit(&mut self, op: &Value, column: Option<&str>) -> Result<()> {
        let key = id(&op["id"])?;
        let mut current = self.text_of(key, column)?;
        if let Some(column) = column
            && self.block(key)?["cells"].get(column).is_none()
        {
            self.steps.push(Step::Cell {
                id: key.into(),
                column: column.into(),
            });
        }
        let owner = || (key.to_owned(), column.map(str::to_owned));
        let forms = ["replace", "set", "format"]
            .iter()
            .filter(|f| op.get(**f).is_some())
            .count();
        require(forms == 1)?;
        if let Some(replace) = op.get("replace") {
            keys(replace, &["find", "with"], &[])?;
            let (find, with) = (
                string(&replace["find"])?,
                plain_text(&replace["with"], limits::BLOCK_TEXT_BYTES)?,
            );
            require(!find.is_empty())?;
            let whole = current.string();
            let mut found = whole.match_indices(find);
            let (at, _) = found.next().ok_or(Refusal::TextNotFound)?;
            require(found.next().is_none()).map_err(|_| Refusal::TextAmbiguous)?;
            let from = whole[..at].chars().count();
            let to = from + find.chars().count();
            current.splice(from, to, with);
            let (id, column) = owner();
            self.steps.push(Step::Splice {
                id,
                column,
                from,
                to,
                text: with.into(),
            });
        } else if let Some(set) = op.get("set") {
            let set = plain_text(set, limits::BLOCK_TEXT_BYTES)?;
            let base = plain_text(op.get("base").ok_or(Invalid)?, limits::BLOCK_TEXT_BYTES)?;
            let whole = current.string();
            let overlap = match op.get("overlap").map(Value::as_str) {
                None | Some(Some("remote")) => merge::Overlap::Remote,
                Some(Some("both")) => merge::Overlap::Both,
                Some(_) => return Err(Refusal::Invalid),
            };
            let merged = merge::merge_with(base, &whole, set, overlap);
            let (before, after): (Vec<char>, Vec<char>) =
                (whole.chars().collect(), merged.text.chars().collect());
            // Last hunk first, so each offset still counts the text before it as the page holds it.
            for hunk in merge::hunks(&before, &after).into_iter().rev() {
                let replacement: String = hunk.text.iter().collect();
                current.splice(hunk.from, hunk.to, &replacement);
                let (id, column) = owner();
                self.steps.push(Step::Splice {
                    id,
                    column,
                    from: hunk.from,
                    to: hunk.to,
                    text: replacement,
                });
            }
            for dropped in merged.dropped {
                self.dropped.push(json!({
                    "id": key, "from": dropped.from, "to": dropped.to, "text": dropped.text
                }));
            }
        } else if let Some(format) = op.get("format") {
            keys(format, &["from", "to", "mark", "value"], &[])?;
            let (from, to) = (
                integer(&format["from"])? as usize,
                integer(&format["to"])? as usize,
            );
            let mark = string(&format["mark"])?;
            let value = match (&format["value"], mark) {
                (Value::Bool(true), "bold" | "italic" | "code") => Some("true".to_owned()),
                (Value::Bool(false), "bold" | "italic" | "code") => None,
                (Value::String(given), "link" | "agent" | "block") => Some(given.clone()),
                (Value::Null, "link" | "agent" | "block") => None,
                _ => return Err(Refusal::Invalid),
            };
            current.format(from, to, mark, value.as_deref())?;
            let (id, column) = owner();
            self.steps.push(Step::Format {
                id,
                column,
                from,
                to,
                mark: mark.into(),
                value,
            });
        }
        self.store_text(key, column, &current)?;
        Ok(())
    }

    fn text(&mut self, op: &Value) -> Result<()> {
        keys(
            op,
            &["op", "id"],
            &["cell", "replace", "set", "base", "overlap", "format"],
        )?;
        let column = op
            .get("cell")
            .map(|v| string(v).map(str::to_owned))
            .transpose()?;
        self.text_edit(op, column.as_deref())?;
        self.note("text", id(&op["id"])?);
        Ok(())
    }

    fn set_deleted(&mut self, op: &Value, deleted: bool) -> Result<()> {
        keys(op, &["op", "id"], &[])?;
        let key = id(&op["id"])?;
        let was = self.block(key)?.get("deleted").is_some();
        if was != deleted {
            let block = self.doc.get_mut(key).ok_or(Refusal::NotFound)?;
            if deleted {
                block["deleted"] = self.now.into();
                self.steps.push(Step::Delete {
                    id: key.into(),
                    at: self.now,
                });
            } else {
                block.as_object_mut().ok_or(Invalid)?.remove("deleted");
                self.steps.push(Step::Restore { id: key.into() });
            }
        }
        self.note(if deleted { "delete" } else { "restore" }, key);
        Ok(())
    }

    fn table(&mut self, op: &Value) -> Result<()> {
        let key = id(&op["id"])?;
        require(self.block_type(key)? == "table")?;
        let action = string(op.get("action").ok_or(Invalid)?)?;
        let mut columns: Vec<Value> = self.block(key)?["props"]
            .get("columns")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let column_at = |columns: &[Value], column: &Value| -> Result<usize> {
            let name = string(column)?;
            columns
                .iter()
                .position(|c| c["id"] == name)
                .ok_or(Refusal::NotFound)
        };
        match action {
            "add-row" => {
                keys(op, &["op", "id", "action", "row"], &["after", "cells"])?;
                let row = id(&op["row"])?;
                require(!self.doc.contains_key(row))?;
                require(self.doc.len() < limits::BLOCKS).map_err(|_| Refusal::Capacity)?;
                let rows = self
                    .doc
                    .values()
                    .filter(|b| b["parent"] == key && b["type"] == ROW)
                    .count();
                require(rows < limits::BLOCK_TABLE_ROWS).map_err(|_| Refusal::Capacity)?;
                let position = self.place(key, &after_of(op)?, None)?;
                let mut cells = Map::new();
                for (column, body) in op.get("cells").map_or(Ok(&Map::new()), object)?.iter() {
                    require(columns.iter().any(|c| c["id"] == column.as_str()))?;
                    cells.insert(
                        column.clone(),
                        plain_value(plain_text(body, limits::BLOCK_CELL_BYTES)?),
                    );
                }
                let block = json!({"type": ROW, "parent": key, "pos": position, "props": {}, "cells": cells});
                self.steps.push(Step::Put {
                    id: row.into(),
                    block: block.clone(),
                });
                self.doc.insert(row.into(), block);
                self.note("table.add-row", row);
            }
            "remove-row" => {
                keys(op, &["op", "id", "action", "row"], &[])?;
                let row = id(&op["row"])?;
                require(self.block_type(row)? == ROW && self.block(row)?["parent"] == key)?;
                self.set_deleted(&json!({"op": "delete", "id": row}), true)?;
                self.ops.pop();
                self.note("table.remove-row", row);
            }
            "set-cell" => {
                keys(
                    op,
                    &["op", "id", "action", "row", "column", "text"],
                    &["base", "overlap"],
                )?;
                let row = id(&op["row"])?;
                require(self.block_type(row)? == ROW && self.block(row)?["parent"] == key)?;
                let column = string(&op["column"])?;
                let body = &op["text"];
                let current = self.text_of(row, Some(column))?.string();
                let mut edit = json!({"id": row, "set": body, "base": op.get("base").cloned().unwrap_or_else(|| json!(current))});
                if let Some(overlap) = op.get("overlap") {
                    edit["overlap"] = overlap.clone();
                }
                self.text_edit(&edit, Some(column))?;
                self.note("table.set-cell", row);
            }
            "add-column" | "rename-column" | "move-column" | "remove-column" => {
                match action {
                    "add-column" => {
                        keys(op, &["op", "id", "action", "column"], &["after"])?;
                        require(columns.len() < limits::BLOCK_TABLE_COLUMNS)
                            .map_err(|_| Refusal::Capacity)?;
                        let at = match op.get("after") {
                            None => columns.len(),
                            Some(Value::Null) => 0,
                            Some(after) => {
                                column_at(&columns, after).map_err(|_| Refusal::BadAfter)? + 1
                            }
                        };
                        columns.insert(at, op["column"].clone());
                    }
                    "rename-column" => {
                        keys(op, &["op", "id", "action", "column", "name"], &[])?;
                        let at = column_at(&columns, &op["column"])?;
                        columns[at]["name"] = op["name"].clone();
                    }
                    "move-column" => {
                        keys(op, &["op", "id", "action", "column"], &["after"])?;
                        let moved = columns.remove(column_at(&columns, &op["column"])?);
                        let at = match op.get("after") {
                            None => columns.len(),
                            Some(Value::Null) => 0,
                            Some(after) => {
                                column_at(&columns, after).map_err(|_| Refusal::BadAfter)? + 1
                            }
                        };
                        columns.insert(at, moved);
                    }
                    _ => {
                        keys(op, &["op", "id", "action", "column"], &[])?;
                        columns.remove(column_at(&columns, &op["column"])?);
                    }
                }
                let props = self.doc.get_mut(key).ok_or(Refusal::NotFound)?["props"]
                    .as_object_mut()
                    .ok_or(Invalid)?;
                props.insert("columns".into(), Value::Array(columns.clone()));
                schema::validate_props("table", &Value::Object(props.clone()))?;
                self.steps.push(Step::Prop {
                    id: key.into(),
                    key: "columns".into(),
                    value: Some(Value::Array(columns)),
                });
                self.note(&format!("table.{action}"), key);
            }
            _ => return Err(Refusal::Invalid),
        }
        Ok(())
    }
}

/// Apply `body` (`{"ops":[…]}`, and optionally the typed `attachments` change that
/// [`super::attachments`] judges) to `base`, the page's current `blocks` value. `attribution`
/// carries the write owner's `timeMs`; nothing in `body` can set it. A batch with no ops is
/// allowed only when it carries an attachment change (attach or detach alone).
pub fn apply(base: &Value, body: &Value, attribution: &Value) -> Result<Applied> {
    keys(body, &["ops"], &["attachments"])?;
    let ops = body["ops"].as_array().ok_or(Invalid)?;
    let changes_attachments = super::attachments::change(body)?.is_some_and(|c| !c.is_empty());
    require((!ops.is_empty() || changes_attachments) && ops.len() <= limits::BLOCK_BATCH_OPS)
        .map_err(|_| Refusal::Capacity)?;
    require(canonical(body)?.len() <= limits::BLOCK_BATCH_BYTES).map_err(|_| Refusal::Capacity)?;
    let now = attribution["timeMs"].as_u64().ok_or(Invalid)?;
    values::time(now).map_err(|_| Invalid)?;
    schema::validate(base)?;
    let mut batch = Editing {
        doc: object(base)?.clone(),
        steps: Vec::new(),
        ops: Vec::new(),
        dropped: Vec::new(),
        now,
    };
    for op in ops {
        match string(op.get("op").ok_or(Invalid)?)? {
            "insert" => batch.insert(op),
            "move" => batch.move_block(op),
            "props" => batch.props(op),
            "text" => batch.text(op),
            "delete" => batch.set_deleted(op, true),
            "restore" => batch.set_deleted(op, false),
            "table" => batch.table(op),
            _ => Err(Refusal::Invalid),
        }?;
    }
    let next = Value::Object(batch.doc);
    schema::validate(&next)?;
    Ok(Applied {
        next,
        steps: batch.steps,
        receipt: json!({"ops": batch.ops, "droppedHunks": batch.dropped}),
    })
}

#[cfg(test)]
mod tests;
