//! Inert agent text and response source anchors. Agent text is untrusted, so every
//! terminal escape and control character is removed before display; this is
//! the plain rendering that Markdown rendering (#391) builds on.

use unicode_width::UnicodeWidthChar;

pub fn sanitize(text: &str) -> String {
    tmt_pty_protocol::sanitize_output(text.as_bytes())
}

/// Sanitizes a metadata label without admitting a second display row.
pub fn single_line(text: &str) -> String {
    sanitize(text).replace(['\n', '\u{2028}', '\u{2029}'], " ")
}

/// Wraps sanitized text to `width` display cells. Breaks at spaces where
/// possible; a longer word is split between characters, never inside one.
pub fn wrap(text: &str, width: usize) -> Vec<String> {
    let width = width.max(1);
    let mut lines = Vec::new();
    for paragraph in text.split('\n') {
        let mut line = String::new();
        let mut used = 0;
        for word in paragraph.split_inclusive(' ') {
            let body = word.trim_end_matches(' ');
            let spaces = word.len() - body.len();
            let cells: usize = body.chars().map(|c| c.width().unwrap_or(0)).sum();
            if used > 0 && used + cells > width {
                lines.push(line.trim_end().to_owned());
                line.clear();
                used = 0;
            }
            for character in body.chars() {
                let cells = character.width().unwrap_or(0);
                if used + cells > width {
                    lines.push(std::mem::take(&mut line));
                    used = 0;
                }
                line.push(character);
                used += cells;
            }
            for _ in 0..spaces {
                if used < width {
                    line.push(' ');
                    used += 1;
                }
            }
        }
        lines.push(line.trim_end().to_owned());
    }
    lines
}

/// Notebook text with the byte start of each `\n`-separated line, built once
/// where the text is built so a cursor never rescans it (a scroll step costs
/// the length of one line, not of the history).
#[derive(Default)]
pub(super) struct IndexedText {
    text: String,
    starts: Vec<usize>,
}

impl IndexedText {
    pub fn new(text: String) -> Self {
        let starts = std::iter::once(0)
            .chain(text.match_indices('\n').map(|(at, _)| at + 1))
            .collect();
        Self { text, starts }
    }

    /// `split('\n').count()`: an empty text has one empty line.
    pub fn line_count(&self) -> usize {
        self.starts.len()
    }

    pub fn line(&self, index: usize) -> Option<&str> {
        let start = *self.starts.get(index)?;
        let end = self
            .starts
            .get(index + 1)
            .map_or(self.text.len(), |next| next - 1);
        Some(&self.text[start..end])
    }
}

/// A response source anchor survives wrapping and refreshed content; Scrolls owns the viewport.
#[derive(Default)]
pub(super) struct NotesCursor {
    pub source: usize,
    part: usize,
    anchor: Option<String>,
}

impl NotesCursor {
    pub fn reconcile(&mut self, text: &IndexedText) {
        if let Some(anchor) = &self.anchor {
            self.source = (0..text.line_count())
                .filter(|index| text.line(*index) == Some(anchor.as_str()))
                .min_by_key(|index| (index.abs_diff(self.source), std::cmp::Reverse(*index)))
                .unwrap_or(self.source.min(text.line_count().saturating_sub(1)));
        }
        self.select(text, self.source);
    }

    pub fn select(&mut self, text: &IndexedText, source: usize) {
        self.source = source.min(text.line_count().saturating_sub(1));
        self.anchor = text.line(self.source).map(str::to_owned);
    }

    /// A continuation offset keeps click placement and paging within long lines.
    pub fn visual(&self, sources: &[usize]) -> Option<usize> {
        let first = sources.iter().position(|source| *source == self.source)?;
        let count = sources[first..]
            .iter()
            .take_while(|source| **source == self.source)
            .count();
        Some(first + self.part.min(count.saturating_sub(1)))
    }

    /// Cost is the wrapped continuation of one source line: the rows of a source
    /// are contiguous (`visual` relies on it), so its first row is found by
    /// walking back from `visual`, and an unchanged source keeps its anchor.
    pub fn select_visual(&mut self, text: &IndexedText, sources: &[usize], visual: usize) {
        let Some(&source) = sources.get(visual) else {
            return;
        };
        let first = sources[..visual]
            .iter()
            .rposition(|line| *line != source)
            .map_or(0, |before| before + 1);
        if source != self.source || self.anchor.is_none() {
            self.select(text, source);
        }
        self.part = visual - first;
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn metadata_labels_keep_words_on_one_row_and_strip_terminal_controls() {
        assert_eq!(
            super::single_line("one\n\u{2028}two\u{2029}three\x1b[31m!\x1b[0m"),
            "one  two three!"
        );
        assert_eq!(super::sanitize("one\ntwo"), "one\ntwo");
    }
    use super::*;

    #[test]
    fn wrapped_continuation_survives_resize_and_content_insertion() {
        let text = &IndexedText::new("long notebook line\nnext".into());
        let sources = [0, 0, 0, 0, 0, 1];
        let mut cursor = NotesCursor::default();
        cursor.select_visual(text, &sources, 2);
        assert_eq!(cursor.visual(&sources), Some(2));
        cursor.select_visual(text, &sources, 4);
        assert_eq!(cursor.source, 0);
        assert_eq!(cursor.visual(&sources), Some(4));
        assert_eq!(
            cursor.visual(&[0, 0, 1]),
            Some(1),
            "resize clamps the continuation"
        );
        cursor.reconcile(&IndexedText::new(
            "inserted\nlong notebook line\nnext".into(),
        ));
        assert_eq!(cursor.source, 1);
        assert_eq!(cursor.visual(&[0, 1, 1, 1, 1, 1, 2]), Some(5));
    }

    #[test]
    fn cursor_follows_content_and_clamps_deleted_lines() {
        let mut cursor = NotesCursor::default();
        cursor.select(&IndexedText::new("first\nselected\nlast".into()), 1);
        cursor.reconcile(&IndexedText::new("new\nfirst\nselected\nlast".into()));
        assert_eq!(cursor.source, 2);
        cursor.reconcile(&IndexedText::new("only".into()));
        assert_eq!(cursor.source, 0);
    }

    /// The index and the walk-back must answer exactly what a rescan answered.
    #[test]
    fn the_index_and_the_walked_back_part_equal_a_full_rescan() {
        for text in ["", "a", "a\n", "\n\n", "one\ntwo\n\nthree", "x\ny\n"] {
            let indexed = IndexedText::new(text.into());
            let lines: Vec<_> = text.split('\n').collect();
            assert_eq!(indexed.line_count(), lines.len(), "{text:?}");
            for (index, line) in lines.iter().enumerate() {
                assert_eq!(indexed.line(index), Some(*line), "{text:?} line {index}");
            }
            assert_eq!(indexed.line(lines.len()), None);
        }
        // Wrapped rows: every source repeated 1..=3 times, in order.
        let sources: Vec<usize> = (0..40)
            .flat_map(|source| vec![source; source % 3 + 1])
            .collect();
        let text = IndexedText::new(
            (0..40)
                .map(|n| format!("line {n}"))
                .collect::<Vec<_>>()
                .join("\n"),
        );
        let mut cursor = NotesCursor::default();
        for visual in (0..sources.len()).chain((0..sources.len()).rev()) {
            cursor.select_visual(&text, &sources, visual);
            let first = sources.iter().position(|s| *s == sources[visual]).unwrap();
            assert_eq!(cursor.source, sources[visual]);
            assert_eq!(cursor.visual(&sources), Some(visual), "visual {visual}");
            assert_eq!(cursor.part, visual - first);
        }
    }

    #[test]
    fn duplicate_lines_keep_the_nearest_anchor() {
        let mut cursor = NotesCursor::default();
        cursor.select(&IndexedText::new("repeat\nother\nrepeat".into()), 2);
        cursor.reconcile(&IndexedText::new("new\nrepeat\nother\nrepeat".into()));
        assert_eq!(cursor.source, 3);
    }

    #[test]
    fn escapes_and_controls_cannot_reach_the_terminal() {
        let hostile = concat!(
            "\u{1b}[31mred\u{1b}[0m ",
            "\u{1b}[2J\u{1b}[H",
            "\u{1b}]52;c;cGF3bmVk\u{7}",
            "\u{1b}]0;title\u{1b}\\",
            "\u{1b}Pdevice\u{1b}\\",
            "\u{9b}31mc1\u{9c}",
            "\u{9d}8;;https://x\u{9c}",
            "\u{1b}7saved\u{1b}8",
            "bell\u{7}\u{0}\r\n",
            "tab\there",
        );
        let clean = sanitize(hostile);
        assert_eq!(clean, "red c1savedbell\ntab    here");
        assert!(!clean.chars().any(|c| c.is_control() && c != '\n'));
        assert_eq!(
            sanitize("## Now\n- 安装指南: one page"),
            "## Now\n- 安装指南: one page"
        );
        // An unterminated sequence consumes the rest rather than leaking it.
        assert_eq!(sanitize("ok\u{1b}]52;c;unterminated"), "ok");
    }

    #[test]
    fn bidi_and_invisible_format_characters_are_removed() {
        // "Trojan Source": an override makes text display in a different order.
        let spoofed = "approve \u{202e}evil\u{202c} plan \u{2066}x\u{2069}\u{200e}\u{200f}";
        assert_eq!(sanitize(spoofed), "approve evil plan x");
        let hidden = "a\u{200b}b\u{2060}c\u{feff}d\u{061c}e\u{2064}f\u{fff9}g";
        assert_eq!(sanitize(hidden), "abcdefg");
        // Joiners are kept: they are needed to render scripts and emoji.
        assert_eq!(
            sanitize("👩\u{200d}💻 می\u{200c}خواهم"),
            "👩\u{200d}💻 می\u{200c}خواهم"
        );
    }

    #[test]
    fn wrapping_counts_display_cells_and_never_splits_a_wide_character() {
        assert_eq!(wrap("one two three", 7), ["one two", "three"]);
        assert_eq!(
            wrap("整理安装指南文件", 5),
            ["整理", "安装", "指南", "文件"]
        );
        assert_eq!(wrap("abcdefghij", 4), ["abcd", "efgh", "ij"]);
        assert_eq!(wrap("a\n\nb", 10), ["a", "", "b"]);
        for line in wrap("mixed 中文 and English words with 宽字符 inside", 9) {
            let cells: usize = line.chars().map(|c| c.width().unwrap_or(0)).sum();
            assert!(cells <= 9, "{line:?}");
        }
    }

    #[test]
    fn plain_output_is_the_notebook_after_control_removal() {
        let raw =
            "## Now\n- tokens: \u{1b}[31mwaiting\u{1b}[0m on Ben\n\n| a | b |\n安装指南\u{202e}x";
        let clean = sanitize(raw);
        assert_eq!(wrap(&clean, 10_000).join("\n"), clean);
        assert_eq!(
            clean,
            "## Now\n- tokens: waiting on Ben\n\n| a | b |\n安装指南x"
        );
    }
}
