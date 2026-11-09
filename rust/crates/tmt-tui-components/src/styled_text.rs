use super::{CellGrid, Component, Constraints, HitId, Rect, Size, Token};
use serde::{Deserialize, Serialize};
use unicode_width::UnicodeWidthStr;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TextSpan {
    pub text: String,
    pub role: Token,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TextProps {
    pub spans: Vec<TextSpan>,
}

/// A single line of role-styled text: `used  840M`.
/// Complete graphemes are clipped at the available width.
pub struct Text;

impl Component for Text {
    type Props = TextProps;

    fn measure(props: &Self::Props, constraints: Constraints) -> Size {
        let width: usize = props
            .spans
            .iter()
            .map(|span| UnicodeWidthStr::width(super::text::single_line(&span.text).as_str()))
            .sum();
        constraints.clamp(Size {
            width: width.min(u16::MAX as usize) as u16,
            height: 1,
        })
    }

    fn render(props: &Self::Props, area: Rect, grid: &mut CellGrid) -> Vec<(Rect, HitId)> {
        grid.clear(area);
        let mut x = area.x;
        let end = area.x.saturating_add(area.width);
        for span in &props.spans {
            let available = end.saturating_sub(x);
            let text = super::text::single_line(&span.text);
            grid.text(
                Rect {
                    x,
                    width: available,
                    ..area
                },
                &text,
                span.role.0,
                None,
            );
            x = x.saturating_add(
                UnicodeWidthStr::width(text.as_str()).min(available as usize) as u16,
            );
        }
        vec![]
    }
}
