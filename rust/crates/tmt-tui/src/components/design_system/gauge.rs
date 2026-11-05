use super::{CellGrid, Component, Constraints, HitId, Rect, Size, Token};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
use unicode_width::UnicodeWidthStr;

/// The per-model comparison in Digest spec f21e67b7 uses a 24-cell bar.
const SPEC_BAR_CELLS: usize = 24;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GaugeProps {
    pub label: String,
    pub label_width: u16,
    pub numerator: u64,
    pub denominator: u64,
    pub total: Option<String>,
    pub filled_role: Token,
    pub rest_role: Token,
}

/// A model share, its proportion and optional total, per Digest spec f21e67b7.
///
/// `claude-opus-5.5   ███████████████████·····  78%   655M`
///
/// The bar shrinks before the label and values.
pub struct Gauge;

impl Component for Gauge {
    type Props = GaugeProps;

    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        let total_width = props
            .total
            .as_ref()
            .map_or(0, |total| 3 + UnicodeWidthStr::width(total.as_str()));
        // Label, separator, the spec's 24-cell bar, two spaces and a 4-cell percent.
        let width = usize::from(props.label_width) + 1 + SPEC_BAR_CELLS + 2 + 4 + total_width;
        constraints.clamp(Size {
            width: width.min(usize::from(u16::MAX)) as u16,
            height: 1,
        })
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        grid.clear(area);
        if area.height == 0 {
            return vec![];
        }
        let percent = if props.denominator == 0 {
            "—".into()
        } else {
            let value = (u128::from(props.numerator).min(u128::from(props.denominator)) * 100
                + u128::from(props.denominator) / 2)
                / u128::from(props.denominator);
            format!("{value}%")
        };
        let label_width = props.label_width.min(area.width);
        let label = super::section_rule::fit(&props.label, usize::from(label_width));
        grid.text(
            Rect {
                width: label_width,
                ..area
            },
            &label,
            Role::Text,
            None,
        );
        let total_width = props
            .total
            .as_ref()
            .map_or(0, |total| 3 + UnicodeWidthStr::width(total.as_str()));
        let percent_width = UnicodeWidthStr::width(percent.as_str());
        let fixed = usize::from(label_width) + 1 + 2 + percent_width + total_width;
        let bar_width = usize::from(area.width)
            .saturating_sub(fixed)
            .min(SPEC_BAR_CELLS);
        if fixed > usize::from(area.width) {
            return vec![];
        }
        let start = area.x.saturating_add(label_width).saturating_add(1);
        let filled = if props.denominator == 0 {
            0
        } else {
            let denominator = u128::from(props.denominator);
            ((bar_width as u128 * u128::from(props.numerator).min(denominator) + denominator / 2)
                / denominator) as usize
        };
        grid.text(
            Rect {
                x: start,
                width: filled as u16,
                ..area
            },
            &"█".repeat(filled),
            props.filled_role.0,
            None,
        );
        grid.text(
            Rect {
                x: start.saturating_add(filled as u16),
                width: (bar_width - filled) as u16,
                ..area
            },
            &"·".repeat(bar_width - filled),
            props.rest_role.0,
            None,
        );
        let value_x = start.saturating_add(bar_width as u16).saturating_add(2);
        grid.text(
            Rect {
                x: value_x,
                width: percent_width as u16,
                ..area
            },
            &percent,
            Role::Text,
            None,
        );
        if let Some(total) = &props.total {
            grid.text(
                Rect {
                    x: value_x
                        .saturating_add(percent_width as u16)
                        .saturating_add(3),
                    width: UnicodeWidthStr::width(total.as_str()).min(usize::from(u16::MAX)) as u16,
                    ..area
                },
                total,
                Role::Text,
                None,
            );
        }
        vec![]
    }
}
