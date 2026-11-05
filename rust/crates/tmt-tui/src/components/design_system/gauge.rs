use super::{CellGrid, Component, Constraints, HitId, Rect, Size, Token};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
use unicode_width::UnicodeWidthStr;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GaugeProps {
    pub label: String,
    pub numerator: u64,
    pub denominator: u64,
    pub filled_role: Token,
    pub rest_role: Token,
}
/// A labelled proportion and dotted remainder.
///
/// `used ███·· 60%`
///
/// The bar shrinks before the label and value.
pub struct Gauge;
impl Component for Gauge {
    type Props = GaugeProps;
    fn measure(p: &Self::Props, c: Constraints) -> Size {
        c.clamp(Size {
            width: (UnicodeWidthStr::width(p.label.as_str()) + 16).min(usize::from(u16::MAX))
                as u16,
            height: 1,
        })
    }
    fn render(p: &Self::Props, a: Rect, b: &mut CellGrid) -> Vec<(Rect, HitId)> {
        b.clear(a);
        if a.height == 0 {
            return vec![];
        }
        let value = if p.denominator == 0 {
            "—".into()
        } else {
            format!(
                "{}%",
                (u128::from(p.numerator).min(u128::from(p.denominator)) * 100
                    / u128::from(p.denominator))
            )
        };
        let label = super::section_rule::fit(&p.label, usize::from(a.width));
        let lw = UnicodeWidthStr::width(label.as_str()).min(usize::from(a.width)) as u16;
        b.text(Rect { width: lw, ..a }, &label, Role::Text, None);
        let remaining = a.width.saturating_sub(lw.saturating_add(1));
        let value_w = UnicodeWidthStr::width(value.as_str()) as u16;
        if remaining >= value_w {
            let bars = remaining.saturating_sub(value_w + 1);
            let filled = if p.denominator == 0 {
                0
            } else {
                (u128::from(bars) * u128::from(p.numerator).min(u128::from(p.denominator))
                    / u128::from(p.denominator)) as u16
            };
            let start = a.x + lw + 1;
            b.text(
                Rect {
                    x: start,
                    width: filled,
                    ..a
                },
                &"█".repeat(usize::from(filled)),
                p.filled_role.0,
                None,
            );
            b.text(
                Rect {
                    x: start + filled,
                    width: bars - filled,
                    ..a
                },
                &"·".repeat(usize::from(bars - filled)),
                p.rest_role.0,
                None,
            );
            b.text(
                Rect {
                    x: a.x + a.width - value_w,
                    width: value_w,
                    ..a
                },
                &value,
                Role::Text,
                None,
            );
        }
        vec![]
    }
}
