use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
use unicode_width::UnicodeWidthStr;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Chip {
    pub id: HitId,
    pub label: String,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChipRowProps {
    pub chips: Vec<Chip>,
    pub selected: Option<usize>,
    pub focused: bool,
}
/// A row of caller-owned selectable chips.
///
/// `[1d]  7d  30d`
///
/// Unselected chips drop from the end before remaining labels truncate.
pub struct ChipRow;
impl Component for ChipRow {
    type Props = ChipRowProps;
    fn measure(p: &Self::Props, c: Constraints) -> Size {
        let width: usize = p
            .chips
            .iter()
            .map(|v| UnicodeWidthStr::width(v.label.as_str()) + 2)
            .sum();
        c.clamp(Size {
            width: width.min(usize::from(u16::MAX)) as u16,
            height: 1,
        })
    }
    fn render(p: &Self::Props, a: Rect, b: &mut CellGrid) -> Vec<(Rect, HitId)> {
        b.clear(a);
        if a.height == 0 || a.y >= b.size().height || a.x >= b.size().width {
            return vec![];
        }
        let mut visible: Vec<usize> = (0..p.chips.len()).collect();
        let natural = |ids: &[usize]| -> usize {
            ids.iter()
                .map(|i| UnicodeWidthStr::width(p.chips[*i].label.as_str()) + 2)
                .sum()
        };
        while natural(&visible) > usize::from(a.width) && visible.len() > 1 {
            if let Some(at) = visible.iter().rposition(|i| Some(*i) != p.selected) {
                visible.remove(at);
            } else {
                break;
            }
        }
        let mut x = a.x;
        let end = a.x.saturating_add(a.width).min(b.size().width);
        let mut hits = Vec::new();
        for i in visible {
            let chip = &p.chips[i];
            let selected = Some(i) == p.selected;
            let label = if selected {
                format!("[{}]", chip.label)
            } else {
                format!(" {} ", chip.label)
            };
            let width = (UnicodeWidthStr::width(label.as_str())
                .min(usize::from(end.saturating_sub(x)))) as u16;
            if width == 0 {
                break;
            }
            let rect = Rect {
                x,
                y: a.y,
                width,
                height: 1,
            };
            let role = if !chip.enabled {
                Role::Dim
            } else if selected && p.focused {
                Role::Accent
            } else {
                Role::Text
            };
            b.text(
                rect,
                &super::section_rule::fit(&label, usize::from(width)),
                role,
                None,
            );
            if chip.enabled {
                hits.push((rect, chip.id));
            }
            x += width;
        }
        hits
    }
}
