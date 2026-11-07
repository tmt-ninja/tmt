//! The closed shape of a structured page's `blocks` value: a map from block id to block, each
//! block's type with its own props schema, its place in the tree, and its text. The decoder, both
//! folds and the batch validator accept exactly this; the TypeScript fold mirrors it and runs the
//! same `contracts/vectors/blocks-v1.json`.
use super::{pos, text::RichText};
use crate::{
    closed::{
        Invalid, Result, canonical, id, keys, multiline, nonempty, object, plain, require, text,
    },
    limits,
};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use tmt_colab_model::values;

/// The thirteen block types a page can insert. A table's rows are blocks too (type `row`), but only
/// `table add-row` makes one.
pub const TYPES: [&str; 13] = [
    "paragraph",
    "heading",
    "list",
    "todo",
    "table",
    "card",
    "question",
    "callout",
    "code",
    "image",
    "mockup",
    "work-bundle",
    "page-view",
];
pub const ROW: &str = "row";
/// The parent of a block that sits on the page itself.
pub const ROOT: &str = "root";

/// A block of this type has text, and may carry marks only when `rich`.
pub fn has_text(block_type: &str) -> bool {
    matches!(
        block_type,
        "paragraph" | "heading" | "list" | "todo" | "callout" | "code" | "question"
    )
}
pub fn rich(block_type: &str) -> bool {
    matches!(
        block_type,
        "paragraph" | "heading" | "list" | "todo" | "callout"
    )
}

enum Prop {
    Bool,
    Enum(&'static [&'static str]),
    Int(u64, u64),
    Text(usize),
    Date,
    Id,
    Custom(fn(&Value) -> Result<()>),
}

const INDENT: Prop = Prop::Int(0, 2);

fn schema(block_type: &str) -> &'static [(&'static str, Prop)] {
    match block_type {
        "paragraph" => &[("tone", Prop::Enum(&["default", "muted"]))],
        "heading" => &[("level", Prop::Int(2, 3))],
        "list" => &[
            ("style", Prop::Enum(&["bullet", "number"])),
            ("indent", INDENT),
        ],
        "todo" => &[
            ("checked", Prop::Bool),
            ("assignee", Prop::Text(128)),
            ("due", Prop::Date),
            ("indent", INDENT),
        ],
        "table" => &[
            ("label", Prop::Text(256)),
            ("columns", Prop::Custom(columns)),
            ("header", Prop::Bool),
            ("density", Prop::Enum(&["roomy", "compact"])),
        ],
        "card" => &[
            ("variant", Prop::Enum(&["card", "section"])),
            ("title", Prop::Text(256)),
            ("meta", Prop::Text(128)),
            ("collapsible", Prop::Bool),
            ("collapsed", Prop::Bool),
        ],
        "question" => &[
            ("kind", Prop::Enum(&["single", "multiple", "short"])),
            ("agent", Prop::Text(128)),
            ("choices", Prop::Custom(choices)),
            ("other", Prop::Bool),
            ("otherMax", Prop::Int(1, 2000)),
            ("state", Prop::Enum(&["waiting", "answered", "dismissed"])),
            ("answer", Prop::Text(2000)),
        ],
        "callout" => &[
            (
                "tone",
                Prop::Enum(&["working", "waiting", "review", "blocked"]),
            ),
            ("label", Prop::Text(64)),
            ("heading", Prop::Text(256)),
        ],
        "code" => &[("language", Prop::Text(32)), ("filename", Prop::Text(256))],
        "image" => &[
            ("images", Prop::Custom(images)),
            ("files", Prop::Custom(files)),
            ("layout", Prop::Enum(&["carousel", "grid", "single"])),
            ("size", Prop::Enum(&["s", "m", "l"])),
            ("variant", Prop::Enum(&["image", "file"])),
        ],
        "mockup" => &[
            ("system", Prop::Text(64)),
            ("lock", Prop::Text(64)),
            ("preset", Prop::Enum(&["390", "1440", "custom"])),
            ("width", Prop::Int(1, 4000)),
            ("height", Prop::Int(0, 100_000)),
            ("toolbarLabels", Prop::Text(512)),
            ("markup", Prop::Custom(markup)),
        ],
        "work-bundle" => &[
            ("page", Prop::Id),
            ("number", Prop::Int(1, u32::MAX as u64)),
            ("work", Prop::Text(2000)),
            ("editable", Prop::Bool),
            ("tickets", Prop::Custom(tickets)),
        ],
        "page-view" => &[
            ("label", Prop::Text(128)),
            ("rows", Prop::Custom(rows)),
            ("filters", Prop::Custom(filters)),
            ("columns", Prop::Custom(column_names)),
            ("sort", Prop::Enum(&["updated", "title"])),
            ("limit", Prop::Int(1, 200)),
            (
                "groupBy",
                Prop::Enum(&["state", "project", "owner", "none"]),
            ),
            ("state", Prop::Enum(&["auto", "loading", "empty", "error"])),
            ("density", Prop::Enum(&["compact", "comfortable"])),
            ("selected", Prop::Text(128)),
            ("selectable", Prop::Bool),
        ],
        _ => &[],
    }
}

/// What a type's props may hold in all, as canonical JSON bytes.
fn props_bytes(block_type: &str) -> usize {
    match block_type {
        "mockup" => 72 * 1024,
        "image" | "page-view" => 32 * 1024,
        _ => limits::BLOCK_PROPS_BYTES,
    }
}

fn int(value: &Value, low: u64, high: u64) -> Result<()> {
    require(value.as_u64().is_some_and(|n| (low..=high).contains(&n)))
}
fn date(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && b.iter()
            .enumerate()
            .all(|(i, c)| matches!(i, 4 | 7) || c.is_ascii_digit())
        && matches!(
            &value[5..7],
            "01" | "02" | "03" | "04" | "05" | "06" | "07" | "08" | "09" | "10" | "11" | "12"
        )
        && matches!(value[8..10].parse::<u8>(), Ok(1..=31))
}
fn list<'a>(value: &'a Value, max: usize) -> Result<&'a Vec<Value>> {
    let items = value.as_array().ok_or(Invalid)?;
    require(items.len() <= max)?;
    Ok(items)
}
fn column_id(value: &Value) -> Result<&str> {
    let value = text(value)?;
    require(
        (1..=32).contains(&value.len())
            && value
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'),
    )?;
    Ok(value)
}
fn columns(value: &Value) -> Result<()> {
    let mut seen = std::collections::BTreeSet::new();
    for column in list(value, limits::BLOCK_TABLE_COLUMNS)? {
        keys(column, &["id", "name"], &["width", "hideNarrow"])?;
        require(seen.insert(column_id(&column["id"])?))?;
        nonempty(&column["name"], 128)?;
        if let Some(width) = column.get("width") {
            require(matches!(text(width)?, "auto" | "narrow"))?;
        }
        if let Some(hide) = column.get("hideNarrow") {
            require(hide.is_boolean())?;
        }
    }
    Ok(())
}
fn choices(value: &Value) -> Result<()> {
    list(value, 20)?
        .iter()
        .try_for_each(|c| nonempty(c, 256).map(drop))
}
fn images(value: &Value) -> Result<()> {
    for image in list(value, 100)? {
        keys(
            image,
            &["src"],
            &["alt", "caption", "tag", "filename", "status"],
        )?;
        nonempty(&image["src"], 2048)?;
        for key in ["alt", "caption", "tag", "filename"] {
            image.get(key).map(|v| plain(v, 1024)).transpose()?;
        }
        if let Some(status) = image.get("status") {
            require(matches!(text(status)?, "loading" | "error"))?;
        }
    }
    Ok(())
}
fn files(value: &Value) -> Result<()> {
    for file in list(value, 100)? {
        keys(file, &["name"], &["size", "type", "href"])?;
        nonempty(&file["name"], 256)?;
        for (key, max) in [("size", 32), ("type", 128), ("href", 2048)] {
            file.get(key).map(|v| plain(v, max)).transpose()?;
        }
    }
    Ok(())
}
fn tickets(value: &Value) -> Result<()> {
    for ticket in list(value, 20)? {
        keys(ticket, &["label", "href"], &[])?;
        nonempty(&ticket["label"], 128)?;
        require(plain(&ticket["href"], 2048)?.starts_with("https://github.com/"))?;
    }
    Ok(())
}
fn rows(value: &Value) -> Result<()> {
    list(value, 200)?;
    require(canonical(value)?.len() <= 24 * 1024 && json_shape(value, 0))
}
/// Strings, integers, booleans, arrays and objects of bounded depth: no floats, no null.
fn json_shape(value: &Value, depth: usize) -> bool {
    depth <= 4
        && match value {
            Value::String(s) => s.len() <= 1024 && !s.chars().any(char::is_control),
            Value::Bool(_) => true,
            Value::Number(n) => n.is_u64(),
            Value::Array(items) => items.iter().all(|v| json_shape(v, depth + 1)),
            Value::Object(map) => map
                .iter()
                .all(|(k, v)| k.len() <= 64 && json_shape(v, depth + 1)),
            Value::Null => false,
        }
}
fn filters(value: &Value) -> Result<()> {
    for filter in list(value, 20)? {
        keys(filter, &["field", "value"], &[])?;
        require(matches!(
            text(&filter["field"])?,
            "project" | "state" | "owner"
        ))?;
        plain(&filter["value"], 128)?;
    }
    Ok(())
}
fn column_names(value: &Value) -> Result<()> {
    list(value, 32)?
        .iter()
        .try_for_each(|c| nonempty(c, 64).map(drop))
}
fn markup(value: &Value) -> Result<()> {
    multiline(value, 64 * 1024).map(drop)
}

/// The props of one block: only keys of its type's schema, each valid, within the type's size.
pub fn validate_props(block_type: &str, props: &Value) -> Result<()> {
    let map = object(props)?;
    require(canonical(props)?.len() <= props_bytes(block_type))?;
    for (key, value) in map {
        let (_, kind) = schema(block_type)
            .iter()
            .find(|(name, _)| name == key)
            .ok_or(Invalid)?;
        match kind {
            Prop::Bool => require(value.is_boolean()),
            Prop::Enum(allowed) => require(allowed.contains(&text(value)?)),
            Prop::Int(low, high) => int(value, *low, *high),
            Prop::Text(max) => plain(value, *max).map(drop),
            Prop::Date => require(date(text(value)?)),
            Prop::Id => id(value).map(drop),
            Prop::Custom(check) => check(value),
        }?;
    }
    // A mockup draws nothing without its markup, and a work card nothing without its page.
    match block_type {
        "mockup" => require(map.contains_key("markup")),
        "work-bundle" => require(map.contains_key("page")),
        _ => Ok(()),
    }
}

/// A block of a valid document, read from its projection.
pub struct Block<'a> {
    pub id: &'a str,
    pub value: &'a Value,
}
impl Block<'_> {
    pub fn block_type(&self) -> &str {
        self.value["type"].as_str().unwrap_or_default()
    }
    pub fn parent(&self) -> &str {
        self.value["parent"].as_str().unwrap_or_default()
    }
    pub fn pos(&self) -> &str {
        self.value["pos"].as_str().unwrap_or_default()
    }
    pub fn deleted(&self) -> Option<u64> {
        self.value.get("deleted").and_then(Value::as_u64)
    }
}

fn validate_block(key: &str, block: &Value, all: &Map<String, Value>) -> Result<()> {
    keys(
        block,
        &["type", "parent", "pos", "props"],
        &["text", "cells", "deleted"],
    )?;
    let block_type = text(&block["type"])?;
    let parent = text(&block["parent"])?;
    require(parent != key && pos::valid(text(&block["pos"])?))?;
    if let Some(deleted) = block.get("deleted") {
        values::time(crate::closed::integer(deleted)?).map_err(|_| Invalid)?;
        require(deleted.is_u64())?;
    }
    let parent_type = all
        .get(parent)
        .and_then(|p| p["type"].as_str())
        .unwrap_or_default();
    if block_type == ROW {
        require(
            block["props"].as_object().is_some_and(Map::is_empty) && block.get("text").is_none(),
        )?;
        require(parent_type == "table")?;
        let cells = object(block.get("cells").ok_or(Invalid)?)?;
        require(cells.len() <= limits::BLOCK_ROW_CELLS)?;
        for (column, cell) in cells {
            column_id(&Value::String(column.clone()))?;
            RichText::from_value(cell, true, limits::BLOCK_CELL_BYTES)?;
        }
        return Ok(());
    }
    require(TYPES.contains(&block_type) && block.get("cells").is_none())?;
    require(parent == ROOT || (parent_type == "card" && block_type != "card"))?;
    validate_props(block_type, &block["props"])?;
    match (has_text(block_type), block.get("text")) {
        (true, Some(value)) => {
            RichText::from_value(value, rich(block_type), limits::BLOCK_TEXT_BYTES)?;
        }
        (false, None) => {}
        _ => return Err(Invalid),
    }
    Ok(())
}

/// The whole `blocks` value: at most [`limits::BLOCKS`] entries (tombstones included), every one
/// valid, no table holding too many rows, and the whole within the document size.
pub fn validate(blocks: &Value) -> Result<()> {
    let all = object(blocks)?;
    require(all.len() <= limits::BLOCKS)?;
    let mut rows: BTreeMap<&str, usize> = BTreeMap::new();
    for (key, block) in all {
        values::generated_id(key).map_err(|_| Invalid)?;
        validate_block(key, block, all)?;
        if block["type"] == ROW {
            let count = rows
                .entry(block["parent"].as_str().unwrap_or_default())
                .or_default();
            *count += 1;
            require(*count <= limits::BLOCK_TABLE_ROWS)?;
        }
    }
    require(canonical(blocks)?.len() <= limits::BLOCK_DOCUMENT_BYTES)
}

pub fn empty() -> Value {
    Value::Object(Map::new())
}
