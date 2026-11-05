use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::mark::Mark as Symbol;

/// Stable semantic states use the existing CLI mark table.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkState {
    Running,
    Offline,
    Idle,
    Resumable,
    Done,
    Failed,
    Warning,
    Decision,
}

impl MarkState {
    fn symbol(self) -> Symbol {
        match self {
            Self::Running => Symbol::Running,
            Self::Offline => Symbol::Offline,
            Self::Idle => Symbol::Idle,
            Self::Resumable => Symbol::Resumable,
            Self::Done => Symbol::Done,
            Self::Failed => Symbol::Failed,
            Self::Warning => Symbol::Warning,
            Self::Decision => Symbol::Decision,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MarkProps {
    pub state: MarkState,
    pub label: String,
}

/// A semantic mark and its word.
///
/// `● working`
///
/// The text is ellipsized at the available width. ASCII marks await the shared symbol table.
pub struct Mark;

impl Component for Mark {
    type Props = MarkProps;

    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        use unicode_width::UnicodeWidthStr;
        let text = format!("{} {}", props.state.symbol().symbol(), props.label);
        constraints.clamp(Size {
            width: UnicodeWidthStr::width(text.as_str()).min(usize::from(u16::MAX)) as u16,
            height: 1,
        })
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        grid.clear(area);
        let symbol = props.state.symbol();
        let role = symbol.token().role().expect("mark tokens have a role");
        grid.text_bold(
            area,
            &super::section_rule::fit(
                &format!("{} {}", symbol.symbol(), props.label),
                usize::from(area.width),
            ),
            role,
            None,
            matches!(props.state, MarkState::Failed | MarkState::Decision),
        );
        vec![]
    }
}
