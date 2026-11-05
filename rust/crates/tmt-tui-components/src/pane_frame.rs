use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
use unicode_width::UnicodeWidthStr;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PaneFrameProps {
    pub title: String,
    pub focused: bool,
    pub ascii: bool,
    pub back_hint: bool,
}

/// A focus-aware pane frame.
///
/// `┏━ ▸ Agents ━━━━━━━━━━━━━━┓`
///
/// The hint is reserved before the title is ellipsized.
pub struct PaneFrame;

impl Component for PaneFrame {
    type Props = PaneFrameProps;

    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        let marker = usize::from(props.focused) * 2;
        let hint = usize::from(props.focused && props.back_hint) * 11;
        constraints.clamp(Size {
            width: (5 + marker + hint + UnicodeWidthStr::width(props.title.as_str()))
                .min(usize::from(u16::MAX)) as u16,
            height: 6,
        })
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        if area.height < 3 || area.width < 3 {
            return vec![];
        }
        let (line, corner_left, corner_right) = match (props.focused, props.ascii) {
            (true, false) => ("━", "┏", "┓"),
            (false, false) => ("─", "┌", "┐"),
            (true, true) => ("=", "+", "+"),
            (false, true) => ("-", "+", "+"),
        };
        let marker = match (props.focused, props.ascii) {
            (false, _) => "",
            (true, false) => "▸ ",
            (true, true) => "> ",
        };
        let hint = if props.focused && props.back_hint {
            " · Esc back"
        } else {
            ""
        };
        let title = tmt_cli_style::table::escape(&super::text::sanitize(&props.title));
        let width = usize::from(area.width);
        let title_budget = UnicodeWidthStr::width(title.as_str()).min(
            width.saturating_sub(5 + UnicodeWidthStr::width(marker) + UnicodeWidthStr::width(hint)),
        );
        let title = super::section_rule::fit(&title, title_budget);
        let padding = title_budget.saturating_sub(UnicodeWidthStr::width(title.as_str()));
        let head = format!(" {marker}{title}{}{hint} ", " ".repeat(padding));
        let head_width = UnicodeWidthStr::width(head.as_str());
        let boxed = area.height >= 6;
        let (open, close) = if boxed {
            (corner_left, corner_right)
        } else {
            (line, line)
        };
        let fill = width.saturating_sub(3 + head_width);
        let rule_role = if props.focused { Role::Text } else { Role::Dim };
        let head_role = if props.focused {
            Role::Text
        } else {
            Role::Muted
        };
        grid.text(
            Rect { width: 2, ..area },
            &format!("{open}{line}"),
            rule_role,
            None,
        );
        grid.text_bold(
            Rect {
                x: area.x.saturating_add(2),
                width: head_width as u16,
                ..area
            },
            &head,
            head_role,
            None,
            props.focused,
        );
        let tail = format!("{}{close}", line.repeat(fill));
        grid.text(
            Rect {
                x: area.x.saturating_add((2 + head_width) as u16),
                width: UnicodeWidthStr::width(tail.as_str()).min(usize::from(u16::MAX)) as u16,
                ..area
            },
            &tail,
            rule_role,
            None,
        );
        if boxed {
            let (vertical, bottom_left, bottom_right) = match (props.focused, props.ascii) {
                (true, false) => ("┃", "┗", "┛"),
                (false, false) => ("│", "└", "┘"),
                (true, true) => ("#", "+", "+"),
                (false, true) => ("|", "+", "+"),
            };
            for y in area.y.saturating_add(1)..area.y.saturating_add(area.height - 1) {
                for x in [area.x, area.x.saturating_add(area.width - 1)] {
                    grid.text(
                        Rect {
                            x,
                            y,
                            width: 1,
                            height: 1,
                        },
                        vertical,
                        rule_role,
                        None,
                    );
                }
            }
            let bottom = format!("{bottom_left}{}{bottom_right}", line.repeat(width - 2));
            grid.text(
                Rect {
                    x: area.x,
                    y: area.y.saturating_add(area.height - 1),
                    width: area.width,
                    height: 1,
                },
                &bottom,
                rule_role,
                None,
            );
        }
        vec![]
    }
}
