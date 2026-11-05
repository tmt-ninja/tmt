//! Bounded, role-only rendering of one registered component for WebAssembly.
use serde::{Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use tmt_tui_components::*;
use unicode_segmentation::UnicodeSegmentation;
use wasm_bindgen::prelude::*;

const MAX_INPUT: usize = 65_536;
const MAX_STRING: usize = 4_096;
const MAX_GRAPHEME: usize = 64;
const MAX_DEPTH: usize = 32;
const MAX_OUTPUT: usize = 16 * 1024 * 1024;
#[derive(Clone, Copy)]
enum Kind {
    SectionRule,
    PaneRule,
    PaneFrame,
    ChipRow,
    Gauge,
    Sparkline,
    StackedBars,
    Mark,
    MoreHint,
}
const COMPONENTS: &[(&str, Kind)] = &[
    ("section-rule", Kind::SectionRule),
    ("pane-rule", Kind::PaneRule),
    ("pane-frame", Kind::PaneFrame),
    ("chip-row", Kind::ChipRow),
    ("gauge", Kind::Gauge),
    ("sparkline", Kind::Sparkline),
    ("stacked-bars", Kind::StackedBars),
    ("mark", Kind::Mark),
    ("more-hint", Kind::MoreHint),
];

#[derive(Debug, Serialize)]
pub struct RenderError {
    pub code: &'static str,
}

type Result<T> = std::result::Result<T, RenderError>;
fn error(code: &'static str) -> RenderError {
    RenderError { code }
}

/// The closed versioned registry, also used to admit render requests.
pub fn registry_json() -> String {
    json!({"version": 1, "components": COMPONENTS.iter().map(|(name, _)| *name).collect::<Vec<_>>()}).to_string()
}

#[wasm_bindgen(js_name = registry)]
pub fn wasm_registry() -> String {
    registry_json()
}

#[wasm_bindgen(js_name = render)]
pub fn wasm_render(
    name: &str,
    props: &str,
    width: u32,
    height: u32,
) -> std::result::Result<String, JsValue> {
    render_json(name, props, width, height)
        .map_err(|e| JsValue::from_str(&serde_json::to_string(&e).unwrap()))
}

/// Validate all bounds before allocating the grid; input parsing is byte- and depth-bounded.
pub fn render_json(name: &str, props: &str, width: u32, height: u32) -> Result<String> {
    let kind = COMPONENTS
        .iter()
        .find(|(candidate, _)| *candidate == name)
        .map(|(_, kind)| *kind)
        .ok_or_else(|| error("unknown_component"))?;
    if width == 0 || width > 512 || height == 0 || height > 256 || width * height > 32_768 {
        return Err(error("dimensions"));
    }
    if props.len() > MAX_INPUT {
        return Err(error("input_size"));
    }
    // Count structural nesting outside strings, before serde allocates the value tree.
    let (mut depth, mut quoted, mut escaped) = (0usize, false, false);
    for c in props.chars() {
        if quoted {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                quoted = false;
            }
        } else if c == '"' {
            quoted = true;
        } else if c == '{' || c == '[' {
            depth += 1;
            if depth > MAX_DEPTH {
                return Err(error("depth"));
            }
        } else if c == '}' || c == ']' {
            depth = depth.saturating_sub(1);
        }
    }
    let mut value: Value = serde_json::from_str(props).map_err(|_| error("json"))?;
    strings_bounded(&value)?;
    let area = Rect {
        x: 0,
        y: 0,
        width: width as u16,
        height: height as u16,
    };
    let (grid, hits) = match kind {
        Kind::SectionRule => draw::<SectionRule>(
            &mut value,
            &["title", "note", "note_role", "focused"],
            &[],
            area,
        )?,
        Kind::PaneRule => draw::<PaneRule>(
            &mut value,
            &["title", "note", "note_role", "focused", "ascii"],
            &[],
            area,
        )?,
        Kind::PaneFrame => draw::<PaneFrame>(
            &mut value,
            &["title", "focused", "ascii", "back_hint"],
            &[],
            area,
        )?,
        Kind::ChipRow => {
            fields(
                &value,
                &["label", "chips", "selected", "cursor", "active"],
                &[],
            )?;
            let chips = value["chips"]
                .as_array_mut()
                .ok_or_else(|| error("props"))?;
            if chips.len() > 256 {
                return Err(error("collection_size"));
            }
            for chip in chips {
                fields(chip, &["id", "label", "gap", "enabled"], &[])?;
                decimal(&mut chip["id"])?;
            }
            let len = value["chips"].as_array().unwrap().len();
            for key in ["selected", "cursor"] {
                if !value[key].is_null() && value[key].as_u64().is_none_or(|v| v >= len as u64) {
                    return Err(error("props"));
                }
            }
            decode_draw::<ChipRow>(value, area)?
        }
        Kind::Gauge => {
            fields(
                &value,
                &[
                    "label",
                    "label_width",
                    "numerator",
                    "denominator",
                    "total",
                    "filled_role",
                    "rest_role",
                ],
                &[],
            )?;
            decimal(&mut value["numerator"])?;
            decimal(&mut value["denominator"])?;
            decode_draw::<Gauge>(value, area)?
        }
        Kind::Sparkline => {
            fields(&value, &["points", "scale", "unavailable"], &[])?;
            decimal(&mut value["scale"])?;
            let points = value["points"]
                .as_array_mut()
                .ok_or_else(|| error("props"))?;
            if points.len() > 4096 {
                return Err(error("collection_size"));
            }
            for p in points {
                if !p.is_null() {
                    decimal(p)?;
                }
            }
            decode_draw::<Sparkline>(value, area)?
        }
        Kind::StackedBars => {
            fields(
                &value,
                &["points", "used_role", "saved_role", "missing_role"],
                &[],
            )?;
            let points = value["points"]
                .as_array_mut()
                .ok_or_else(|| error("props"))?;
            if points.len() > 4096 {
                return Err(error("collection_size"));
            }
            for p in points {
                fields(p, &["used", "saved"], &[])?;
                for key in ["used", "saved"] {
                    if !p[key].is_null() {
                        decimal(&mut p[key])?;
                    }
                }
            }
            decode_draw::<StackedBars>(value, area)?
        }
        Kind::Mark => draw::<Mark>(&mut value, &["state", "label", "emphasis"], &[], area)?,
        Kind::MoreHint => {
            fields(&value, &["count", "ascii"], &["direction"])?;
            decimal(&mut value["count"])?;
            decode_draw::<MoreHint>(value, area)?
        }
    };
    let cells: Vec<_> = (0..height as u16)
        .flat_map(|y| (0..width as u16).map(move |x| (x, y)))
        .map(|(x, y)| grid.get(x, y).expect("bounded cell"))
        .collect();
    let hits: Vec<_> = hits
        .into_iter()
        .map(|(rect, id)| json!({"rect":rect,"id":id.to_string()}))
        .collect();
    let output =
        json!({"version":1,"width":width,"height":height,"cells":cells,"hits":hits}).to_string();
    if output.len() > MAX_OUTPUT {
        return Err(error("output_size"));
    }
    Ok(output)
}

fn draw<C: Component>(
    value: &mut Value,
    required: &[&str],
    optional: &[&str],
    area: Rect,
) -> Result<(CellGrid, Vec<(Rect, HitId)>)> {
    fields(value, required, optional)?;
    decode_draw::<C>(std::mem::take(value), area)
}
fn decode_draw<C: Component>(value: Value, area: Rect) -> Result<(CellGrid, Vec<(Rect, HitId)>)>
where
    C::Props: DeserializeOwned,
{
    let props = serde_json::from_value(value).map_err(|_| error("props"))?;
    let mut grid = CellGrid::new(Size {
        width: area.width,
        height: area.height,
    });
    let hits = C::render(&props, area, &mut grid);
    Ok((grid, hits))
}
fn fields(value: &Value, required: &[&str], optional: &[&str]) -> Result<()> {
    let object = value.as_object().ok_or_else(|| error("props"))?;
    if required.iter().any(|key| !object.contains_key(*key))
        || object
            .keys()
            .any(|key| !required.contains(&key.as_str()) && !optional.contains(&key.as_str()))
    {
        return Err(error("props"));
    }
    Ok(())
}
fn decimal(value: &mut Value) -> Result<()> {
    let text = value.as_str().ok_or_else(|| error("decimal"))?;
    if text.is_empty()
        || (text.len() > 1 && text.starts_with('0'))
        || !text.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(error("decimal"));
    }
    let number = text.parse::<u64>().map_err(|_| error("decimal"))?;
    *value = json!(number);
    Ok(())
}
fn strings_bounded(value: &Value) -> Result<()> {
    match value {
        Value::String(s) => {
            if s.len() > MAX_STRING || s.graphemes(true).any(|g| g.len() > MAX_GRAPHEME) {
                return Err(error("string_size"));
            }
        }
        Value::Array(a) => {
            for v in a {
                strings_bounded(v)?;
            }
        }
        Value::Object(o) => {
            for (k, v) in o {
                if k.len() > MAX_STRING {
                    return Err(error("string_size"));
                }
                strings_bounded(v)?;
            }
        }
        _ => {}
    }
    Ok(())
}
