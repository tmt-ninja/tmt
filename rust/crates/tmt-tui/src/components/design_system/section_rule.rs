use super::{CellGrid, Component, Constraints, HitId, Rect, Size, Token};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
use unicode_segmentation::UnicodeSegmentation;
use unicode_width::UnicodeWidthStr;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SectionRuleProps {
    pub title: String,
    pub note: Option<String>,
    pub note_role: Option<Token>,
    pub focused: bool,
}

/// A title with an optional right-aligned note.
///
/// `── Saved · 1d ───── 0.9% ──`
///
/// The note drops first; the title is then ellipsized.
pub struct SectionRule;

pub(super) fn fit(text: &str, width: usize) -> String {
    if UnicodeWidthStr::width(text) <= width {
        return text.into();
    }
    if width == 0 {
        return String::new();
    }
    let mut out = String::new();
    let mut used = 0;
    for grapheme in text.graphemes(true) {
        let grapheme_width = UnicodeWidthStr::width(grapheme);
        if used + grapheme_width >= width {
            break;
        }
        out.push_str(grapheme);
        used += grapheme_width;
    }
    out.push('…');
    out
}

impl Component for SectionRule {
    type Props = SectionRuleProps;

    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        let title = super::text::single_line(&props.title);
        let width = 4
            + UnicodeWidthStr::width(title.as_str())
            + props
                .note
                .as_ref()
                .map_or(0, |note| UnicodeWidthStr::width(note.as_str()) + 5);
        constraints.clamp(Size {
            width: width.min(usize::from(u16::MAX)) as u16,
            height: 1,
        })
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        if area.width == 0 || area.height == 0 {
            return vec![];
        }
        let width = usize::from(area.width);
        let title = super::text::single_line(&props.title);
        if title.is_empty() {
            grid.text(area, &"─".repeat(width), Role::Dim, None);
            return vec![];
        }
        let title_width = UnicodeWidthStr::width(title.as_str());
        let heading_width = title_width + 4;
        let note = props
            .note
            .as_deref()
            .filter(|note| !note.is_empty())
            .filter(|note| heading_width + UnicodeWidthStr::width(*note) + 5 <= width);
        let prefix = "── ".chars().take(width.min(3)).collect::<String>();
        let prefix_width = UnicodeWidthStr::width(prefix.as_str());
        grid.text(area, &prefix, Role::Dim, None);
        let shown = if note.is_some() {
            format!("{title} ")
        } else {
            let available = width.saturating_sub(prefix_width).min(title_width + 1);
            let value = format!("{title} ");
            let shown = fit(&value, available);
            format!(
                "{shown}{}",
                " ".repeat(available.saturating_sub(UnicodeWidthStr::width(shown.as_str())))
            )
        };
        let shown_width = UnicodeWidthStr::width(shown.as_str());
        let title_area = Rect {
            x: area.x.saturating_add(prefix_width as u16),
            width: shown_width as u16,
            ..area
        };
        grid.text(
            title_area,
            &shown,
            if props.focused {
                Role::Text
            } else {
                Role::Muted
            },
            None,
        );
        let after = prefix_width + shown_width;
        if let Some(note) = note {
            let note_width = UnicodeWidthStr::width(note);
            let fill = width - after - note_width - 4;
            grid.text(
                Rect {
                    x: area.x.saturating_add(after as u16),
                    width: fill as u16,
                    ..area
                },
                &"─".repeat(fill),
                Role::Dim,
                None,
            );
            grid.text_with(
                Rect {
                    x: area.x.saturating_add((after + fill) as u16),
                    width: 1,
                    ..area
                },
                " ",
                None,
                None,
                false,
            );
            grid.text_with(
                Rect {
                    x: area.x.saturating_add((after + fill + 1) as u16),
                    width: note_width as u16,
                    ..area
                },
                note,
                props.note_role.map(|role| role.0),
                None,
                false,
            );
            grid.text(
                Rect {
                    x: area.x.saturating_add((width - 3) as u16),
                    width: 3,
                    ..area
                },
                " ──",
                Role::Dim,
                None,
            );
        } else {
            let fill = width.saturating_sub(after);
            grid.text(
                Rect {
                    x: area.x.saturating_add(after as u16),
                    width: fill as u16,
                    ..area
                },
                &"─".repeat(fill),
                Role::Dim,
                None,
            );
        }
        vec![]
    }
}
