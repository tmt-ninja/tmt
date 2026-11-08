//! One block's text: characters with the inline marks a `Y.Text` carries as attributes (bold,
//! italic, code, link, @agent, @block), in the canonical projection `{"s": text, "marks": [...]}`.
//! Offsets count Unicode scalar values, as in [`super::merge`]. Pure: no Yjs.
use crate::closed::{Invalid, Result, integer, keys, require, text};
use serde_json::{Value, json};
use tmt_colab_model::values;

/// Every mark, in the order that breaks a tie between two ranges that start and end together.
pub const MARKS: [&str; 6] = ["bold", "italic", "code", "link", "agent", "block"];
const FLAGS: usize = 3;

fn kind(mark: &str) -> Result<usize> {
    MARKS.iter().position(|m| *m == mark).ok_or(Invalid)
}

/// The schemes a link mark, and a file's `href`, may use.
pub const LINK_SCHEMES: [&str; 3] = ["https://", "http://", "mailto:"];
const ATTACHMENT: &str = "colab-attachment:";

/// The one URL rule: at most 2048 bytes, one of `schemes` followed by something, and no control or
/// whitespace character. A `javascript:` or `data:` URL, a relative one and one with a space are
/// all refused, whatever block or mark carries them.
pub fn safe_url(value: &str, schemes: &[&str]) -> bool {
    value.len() <= 2048
        && schemes
            .iter()
            .any(|scheme| value.len() > scheme.len() && value.starts_with(scheme))
        && !value.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// The token of a `colab-attachment:` reference, the grammar an HTML page uses: 8 lowercase hex
/// digits (a unique ID prefix) or a full attachment ID. `None` is anything else.
pub fn attachment_token(value: &str) -> Option<&str> {
    let token = value.strip_prefix(ATTACHMENT)?;
    let prefix = token.len() == 8
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));
    (prefix || values::generated_id(token).is_ok()).then_some(token)
}

/// An image's `src`: an attachment reference or an `https` URL, nothing else (an image is fetched
/// when its page opens, so no plain `http`, and no scheme that runs).
pub fn image_source(value: &str) -> bool {
    attachment_token(value).is_some() || safe_url(value, &LINK_SCHEMES[..1])
}

/// A file's `href`: an attachment reference or a link's URL.
pub fn file_href(value: &str) -> bool {
    attachment_token(value).is_some() || safe_url(value, &LINK_SCHEMES)
}

/// The value of a link, agent or block mark; the three flag marks carry none.
pub fn valid_mark_value(mark: &str, value: &str) -> bool {
    match mark {
        "link" => safe_url(value, &LINK_SCHEMES),
        "agent" => {
            !value.is_empty()
                && value.len() <= 128
                && !value.chars().any(|c| c.is_control() || c.is_whitespace())
        }
        // A block on this page by its ID, or on another page as `<pageId>/<blockId>` (#6208).
        "block" => match value.split_once('/') {
            None => values::generated_id(value).is_ok(),
            Some((page, block)) => {
                values::generated_id(page).is_ok() && values::generated_id(block).is_ok()
            }
        },
        _ => false,
    }
}

/// Line feeds and tabs are text; every other control character is not.
pub fn valid_text(value: &str, bytes: usize) -> bool {
    value.len() <= bytes
        && !value
            .chars()
            .any(|c| c.is_control() && c != '\n' && c != '\t')
}

/// Per-character marks: three flags and the interned values of the three valued marks (0 = none).
#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Attrs {
    flags: u8,
    values: [u32; 3],
}
impl Attrs {
    fn get(self, mark: usize) -> u32 {
        if mark < FLAGS {
            u32::from(self.flags >> mark & 1)
        } else {
            self.values[mark - FLAGS]
        }
    }
    fn set(&mut self, mark: usize, value: u32) {
        if mark < FLAGS {
            self.flags = self.flags & !(1 << mark) | (u8::from(value != 0) << mark);
        } else {
            self.values[mark - FLAGS] = value;
        }
    }
}

/// One run of a `Y.Text`: its characters and the marks (name, and value for a valued mark) on them.
pub type Run = (String, Vec<(String, Option<String>)>);

#[derive(Clone, Default, PartialEq, Eq)]
pub struct RichText {
    chars: Vec<char>,
    attrs: Vec<Attrs>,
    table: Vec<String>,
}

impl RichText {
    pub fn plain(value: &str) -> Self {
        let chars: Vec<char> = value.chars().collect();
        Self {
            attrs: vec![Attrs::default(); chars.len()],
            chars,
            table: Vec::new(),
        }
    }
    pub fn len(&self) -> usize {
        self.chars.len()
    }
    pub fn is_empty(&self) -> bool {
        self.chars.is_empty()
    }
    pub fn string(&self) -> String {
        self.chars.iter().collect()
    }
    fn intern(&mut self, value: &str) -> u32 {
        let index = self
            .table
            .iter()
            .position(|v| v == value)
            .unwrap_or_else(|| {
                self.table.push(value.into());
                self.table.len() - 1
            });
        index as u32 + 1
    }

    /// Parse `{"s","marks"}`: exact keys, text within `bytes`, marks only when `rich`, ranges
    /// inside the text, valid values, one value per mark and character, and the canonical
    /// order and run merging (so a value has exactly one spelling).
    pub fn from_value(value: &Value, rich: bool, bytes: usize) -> Result<Self> {
        keys(value, &["s", "marks"], &[])?;
        let s = text(&value["s"])?;
        require(valid_text(s, bytes))?;
        let marks = value["marks"].as_array().ok_or(Invalid)?;
        require(rich || marks.is_empty())?;
        let mut out = Self::plain(s);
        for mark in marks {
            keys(mark, &["from", "to", "mark"], &["value"])?;
            let name = text(&mark["mark"])?;
            let index = kind(name)?;
            let (from, to) = (
                integer(&mark["from"])? as usize,
                integer(&mark["to"])? as usize,
            );
            require(from < to && to <= out.len())?;
            let id = if index < FLAGS {
                require(mark.get("value").is_none())?;
                1
            } else {
                let given = text(mark.get("value").ok_or(Invalid)?)?;
                require(valid_mark_value(name, given))?;
                out.intern(given)
            };
            for attrs in &mut out.attrs[from..to] {
                require(attrs.get(index) == 0)?;
                attrs.set(index, id);
            }
        }
        require(out.to_value() == *value)?;
        Ok(out)
    }

    /// The canonical projection: maximal runs of one mark and value, ordered by start, end and
    /// mark.
    pub fn to_value(&self) -> Value {
        let mut runs: Vec<(usize, usize, usize, u32)> = Vec::new();
        for mark in 0..MARKS.len() {
            let mut start = 0;
            while start < self.attrs.len() {
                let id = self.attrs[start].get(mark);
                let mut end = start + 1;
                while end < self.attrs.len() && self.attrs[end].get(mark) == id {
                    end += 1;
                }
                if id != 0 {
                    runs.push((start, end, mark, id));
                }
                start = end;
            }
        }
        runs.sort_unstable();
        let marks: Vec<Value> = runs
            .into_iter()
            .map(|(from, to, mark, id)| {
                let mut value = json!({"from": from, "to": to, "mark": MARKS[mark]});
                if mark >= FLAGS {
                    value["value"] = Value::String(self.table[id as usize - 1].clone());
                }
                value
            })
            .collect();
        json!({"s": self.string(), "marks": marks})
    }

    /// Replace `[from, to)` by unmarked text, as the decoder writes an edit: the new characters
    /// carry no mark, and a range that spanned the edit is split around it.
    pub fn splice(&mut self, from: usize, to: usize, replacement: &str) {
        let added: Vec<char> = replacement.chars().collect();
        self.attrs
            .splice(from..to, vec![Attrs::default(); added.len()]);
        self.chars.splice(from..to, added);
    }

    /// Set (`value` is the mark's value, `true` for a flag) or clear one mark on `[from, to)`.
    pub fn format(
        &mut self,
        from: usize,
        to: usize,
        mark: &str,
        value: Option<&str>,
    ) -> Result<()> {
        let index = kind(mark)?;
        require(from < to && to <= self.len())?;
        let id = match (index < FLAGS, value) {
            (_, None) => 0,
            (true, Some(_)) => 1,
            (false, Some(given)) => {
                require(valid_mark_value(mark, given))?;
                self.intern(given)
            }
        };
        for attrs in &mut self.attrs[from..to] {
            attrs.set(index, id);
        }
        Ok(())
    }

    /// Build from the runs of a `Y.Text`: each run's text and its marks.
    pub fn from_runs(runs: &[Run]) -> Result<Self> {
        let mut out = Self::default();
        for (piece, marks) in runs {
            let mut attrs = Attrs::default();
            for (name, value) in marks {
                let index = kind(name)?;
                let id = match (index < FLAGS, value) {
                    (true, None) => 1,
                    (false, Some(given)) => {
                        require(valid_mark_value(name, given))?;
                        out.intern(given)
                    }
                    _ => return Err(Invalid),
                };
                attrs.set(index, id);
            }
            for c in piece.chars() {
                out.chars.push(c);
                out.attrs.push(attrs);
            }
        }
        Ok(out)
    }
}

/// A `{"s","marks"}` value that is not rich text (a code block, a question): no marks.
pub fn plain_value(value: &str) -> Value {
    json!({"s": value, "marks": []})
}

pub fn empty_value() -> Value {
    plain_value("")
}

#[cfg(test)]
mod url_tests {
    use super::*;

    #[test]
    fn one_rule_admits_what_a_renderer_may_write_and_nothing_that_runs_or_leaks() {
        let id = "30000000-0000-4000-8000-00000000000a";
        let attachment = format!("colab-attachment:{id}");
        for ok in ["https://a.example/p.png", "colab-attachment:abcdef01"] {
            assert!(image_source(ok), "{ok}");
        }
        assert!(image_source(&attachment));
        for ok in [
            "https://a/f",
            "http://a/f",
            "mailto:a@b",
            "colab-attachment:abcdef01",
        ] {
            assert!(file_href(ok), "{ok}");
            assert!(
                valid_mark_value("link", ok) == (!ok.starts_with("colab")),
                "{ok}"
            );
        }
        for bad in [
            "javascript:alert(1)",
            "data:image/png;base64,AAAA",
            "http://a/p.png",
            "mailto:a@b",
            "/p.png",
            "p.png",
            "https://a/a b",
            "https://a/a\u{a0}b",
            "https://a/a\n",
            "https://",
            "HTTPS://a/p.png",
            "colab-attachment:ABCDEF01",
            "colab-attachment:abcdef0",
            "colab-attachment:",
            "",
        ] {
            assert!(!image_source(bad), "{bad:?}");
        }
        assert!(!file_href("javascript:alert(1)") && !file_href("ftp://a/f") && !file_href(""));
        assert!(!safe_url(
            &format!("https://{}", "a".repeat(2048)),
            &LINK_SCHEMES
        ));
        assert_eq!(attachment_token(&attachment), Some(id));
        assert_eq!(
            attachment_token("colab-attachment:abcdef01"),
            Some("abcdef01")
        );
        assert_eq!(attachment_token("https://a/b"), None);
    }
}
