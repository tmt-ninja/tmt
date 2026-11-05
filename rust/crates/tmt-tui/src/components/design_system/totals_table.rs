use super::{CellGrid, Component, Constraints, HitId, Rect, Size};
use serde::{Deserialize, Serialize};
use tmt_cli_style::theme::Role;
use unicode_width::UnicodeWidthStr;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TotalColumn {
    pub heading: String,
    pub value: String,
    pub priority: u16,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TotalsTableProps {
    pub columns: Vec<TotalColumn>,
}
/// Column-aligned labels and values.
///
/// `TOK  saved` / `10k     4k`
///
/// Lower-priority columns drop whole; values are never split.
pub struct TotalsTable;
impl Component for TotalsTable {
    type Props = TotalsTableProps;
    fn measure(p: &Self::Props, c: Constraints) -> Size {
        let width: usize = p
            .columns
            .iter()
            .map(|v| {
                UnicodeWidthStr::width(v.heading.as_str())
                    .max(UnicodeWidthStr::width(v.value.as_str()))
                    + 1
            })
            .sum();
        c.clamp(Size {
            width: width.saturating_sub(1).min(usize::from(u16::MAX)) as u16,
            height: 2,
        })
    }
    fn render(p: &Self::Props, a: Rect, b: &mut CellGrid) -> Vec<(Rect, HitId)> {
        b.clear(a);
        if a.height == 0 {
            return vec![];
        }
        let width = |i: usize| {
            UnicodeWidthStr::width(p.columns[i].heading.as_str())
                .max(UnicodeWidthStr::width(p.columns[i].value.as_str()))
        };
        let mut ids: Vec<usize> = (0..p.columns.len()).collect();
        while ids
            .iter()
            .map(|i| width(*i) + 1)
            .sum::<usize>()
            .saturating_sub(1)
            > usize::from(a.width)
            && !ids.is_empty()
        {
            let remove = ids
                .iter()
                .enumerate()
                .max_by_key(|(_, i)| (p.columns[**i].priority, **i))
                .unwrap()
                .0;
            ids.remove(remove);
        }
        let mut x = a.x;
        for i in ids {
            let col = &p.columns[i];
            let w = width(i) as u16;
            let heading = format!(
                "{}{}",
                " ".repeat(
                    usize::from(w).saturating_sub(UnicodeWidthStr::width(col.heading.as_str()))
                ),
                col.heading
            );
            let value = format!(
                "{}{}",
                " ".repeat(
                    usize::from(w).saturating_sub(UnicodeWidthStr::width(col.value.as_str()))
                ),
                col.value
            );
            b.text(
                Rect {
                    x,
                    y: a.y,
                    width: w,
                    height: 1,
                },
                &heading,
                Role::Muted,
                None,
            );
            if a.height > 1 {
                b.text(
                    Rect {
                        x,
                        y: a.y.saturating_add(1),
                        width: w,
                        height: 1,
                    },
                    &value,
                    Role::Text,
                    None,
                );
            }
            x = x.saturating_add(w).saturating_add(1);
        }
        vec![]
    }
}
