use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::{mark::Mark as Symbol, theme::Role};
use unicode_width::UnicodeWidthStr;

/// The board's observable member states.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkState {
    Working,
    Waiting,
    Blocked,
    Review,
    Idle,
    Offline,
    Ended,
    Shell,
}

impl MarkState {
    fn glyph(self) -> &'static str {
        match self {
            Self::Working => Symbol::Running.symbol(),
            Self::Waiting => Symbol::Decision.symbol(),
            Self::Blocked => Symbol::Failed.symbol(),
            Self::Review => "◐",
            Self::Idle => Symbol::Idle.symbol(),
            Self::Offline | Self::Ended => Symbol::Offline.symbol(),
            Self::Shell => "▪",
        }
    }
    fn role(self) -> Role {
        match self {
            Self::Waiting => Role::Waiting,
            Self::Blocked => Role::Blocked,
            _ => Role::Muted,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MarkProps {
    pub state: MarkState,
    pub label: String,
    /// Emphasize the attention glyph in a selected row, count, or tab.
    pub emphasis: bool,
}

/// A board state glyph and its neutral word.
///
/// `● working`
///
/// Only waiting and blocked glyphs accept emphasis. Text is ellipsized at the available width.
pub struct Mark;

impl Component for Mark {
    type Props = MarkProps;
    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        let text = format!("{} {}", props.state.glyph(), props.label);
        constraints.clamp(Size {
            width: UnicodeWidthStr::width(text.as_str()).min(usize::from(u16::MAX)) as u16,
            height: 1,
        })
    }
    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        grid.clear(area);
        let glyph = props.state.glyph();
        let text =
            super::section_rule::fit(&format!("{glyph} {}", props.label), usize::from(area.width));
        if let Some(rest) = text.strip_prefix(glyph) {
            grid.text_bold(
                Rect { width: 1, ..area },
                glyph,
                props.state.role(),
                None,
                props.emphasis && matches!(props.state, MarkState::Waiting | MarkState::Blocked),
            );
            grid.text(
                Rect {
                    x: area.x.saturating_add(1),
                    width: area.width.saturating_sub(1),
                    ..area
                },
                rest,
                Role::Muted,
                None,
            );
        } else {
            grid.text(area, &text, Role::Muted, None);
        }
        vec![]
    }
}
