use super::{CellGrid, ChipSurface, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
use unicode_width::UnicodeWidthStr;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Chip {
    pub id: HitId,
    pub label: String,
    pub gap: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ChipRowProps {
    pub label: String,
    pub chips: Vec<Chip>,
    pub selected: Option<usize>,
    pub cursor: Option<usize>,
    pub active: bool,
}

/// A caption and a row of caller-owned selectable chips.
///
/// `Range  1d   7d   30d `
///
/// Only a prefix of completely visible chips is painted and receives hits.
pub struct ChipRow;

impl Component for ChipRow {
    type Props = ChipRowProps;

    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        let width = UnicodeWidthStr::width(props.label.as_str())
            + props
                .chips
                .iter()
                .map(|chip| {
                    UnicodeWidthStr::width(chip.label.as_str())
                        + 2
                        + UnicodeWidthStr::width(chip.gap.as_str())
                })
                .sum::<usize>();
        constraints.clamp(Size {
            width: width.min(usize::from(u16::MAX)) as u16,
            height: 1,
        })
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        if area.height == 0 || area.y >= grid.size().height || area.x >= grid.size().width {
            return vec![];
        }
        let end = area.x.saturating_add(area.width).min(grid.size().width);
        let caption_width = UnicodeWidthStr::width(props.label.as_str())
            .min(usize::from(end.saturating_sub(area.x))) as u16;
        grid.text(
            Rect {
                width: caption_width,
                height: 1,
                ..area
            },
            &props.label,
            Role::Muted,
            None,
        );
        let mut x = area.x.saturating_add(caption_width);
        let mut hits = Vec::new();
        for (index, chip) in props.chips.iter().enumerate() {
            let label = format!(" {} ", chip.label);
            let natural_width = UnicodeWidthStr::width(label.as_str());
            if natural_width > usize::from(end.saturating_sub(x)) {
                break;
            }
            let width = natural_width as u16;
            let rect = Rect {
                x,
                y: area.y,
                width,
                height: 1,
            };
            let state = if !chip.enabled {
                Some(ChipSurface::Disabled)
            } else if props.selected == Some(index) || props.active && props.cursor == Some(index) {
                Some(ChipSurface::Hot)
            } else {
                None
            };
            if let Some(surface) = state {
                grid.chip(rect, &label, surface);
            } else {
                grid.text(rect, &label, Role::Muted, None);
            }
            if chip.enabled {
                hits.push((rect, chip.id));
            }
            x = x.saturating_add(width);
            let gap_width = UnicodeWidthStr::width(chip.gap.as_str())
                .min(usize::from(end.saturating_sub(x))) as u16;
            grid.text(
                Rect {
                    x,
                    y: area.y,
                    width: gap_width,
                    height: 1,
                },
                &chip.gap,
                Role::Muted,
                None,
            );
            x = x.saturating_add(gap_width);
        }
        hits
    }
}
