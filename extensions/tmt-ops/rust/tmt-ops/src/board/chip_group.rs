//! ChipGroup: shared admitted options, selected padding and clipped hit IDs.
use super::app::{App, Overlay};
use ratatui::{buffer::Buffer, layout::Rect};
use serde_json::json;
use std::{collections::BTreeMap, sync::OnceLock};
use tmt_cli_style::{Role, grid::Align};
use tmt_tui::{
    binding::{Node, Schema, Schemas, Scopes, Sources, Template},
    geometry, text,
};
const FILE: &str = "ops.board.chip-group.xml";
const MARKUP: &str = r#"<tmt-view version="1" class="w-full"><tmt-repeat each="$.rows" as="row"><tmt-row class="h-1 w-full"><tmt-text bind="row.label" class="shrink-0"/><tmt-repeat each="row.options" as="option"><tmt-text id-bind="option.id" bind="option.text" class="shrink-0"/><tmt-text bind="option.gap" class="shrink-0"/></tmt-repeat></tmt-row></tmt-repeat></tmt-view>"#;
struct Data;
impl Sources for Data {
    type Source = ();
    fn compile(&self, _: &str, _: &str, _: &Schemas<'_>) -> Result<(), String> {
        Err("controls use bound values only".into())
    }
    fn resolve(&self, _: &(), _: &Scopes<'_>) -> Result<Option<String>, String> {
        Err("controls use bound values only".into())
    }
}

#[derive(Clone)]
pub(in crate::board) struct Choice {
    pub id: String,
    pub actionable: bool,
    pub text: String,
    pub gap: String,
    pub selected: bool,
    pub disabled: bool,
    pub cursor: bool,
}
pub(in crate::board) struct ChipGroup {
    pub label: String,
    pub choices: Vec<Choice>,
}
pub(in crate::board) struct Hit {
    pub area: Rect,
    pub id: String,
}
fn node(groups: &[ChipGroup]) -> Node {
    static TEMPLATE: OnceLock<Template<()>> = OnceLock::new();
    let template = TEMPLATE.get_or_init(|| {
        let option = Schema::Object(BTreeMap::from([
            ("id".into(), Schema::StableId),
            ("text".into(), Schema::Scalar),
            ("gap".into(), Schema::Scalar),
        ]));
        let row = Schema::Object(BTreeMap::from([
            ("label".into(), Schema::Scalar),
            ("options".into(), Schema::Collection(Box::new(option))),
        ]));
        let schema = Schema::Object(BTreeMap::from([(
            "rows".into(),
            Schema::Collection(Box::new(row)),
        )]));
        let parsed = tmt_tui::parse(FILE, MARKUP).expect("embedded usage controls");
        tmt_tui::binding::compile(FILE, &parsed, &schema, &Data).expect("typed usage controls")
    });
    let rows:Vec<_>=groups.iter().map(|group|json!({"label":group.label,"options":group.choices.iter().map(|choice|json!({"id":choice.id,"text":choice.text,"gap":choice.gap})).collect::<Vec<_>>()})).collect();
    template
        .materialize(FILE, &json!({"rows":rows}), &Data)
        .expect("admitted shared chip group")
}
/// Shared option geometry delegates every actionable chip to the board button painter.
pub(in crate::board) fn paint(
    buffer: &mut Buffer,
    area: Rect,
    groups: &[ChipGroup],
    app: &App,
    owner: Option<Overlay>,
) -> Vec<Hit> {
    paint_with_idle(
        buffer,
        area,
        groups,
        app,
        owner,
        app.look().role(Role::Muted),
    )
}
/// The same geometry and hover owner also serves filled dropdown triggers.
pub(in crate::board) fn paint_with_idle(
    buffer: &mut Buffer,
    area: Rect,
    groups: &[ChipGroup],
    app: &App,
    owner: Option<Overlay>,
    idle: ratatui::style::Style,
) -> Vec<Hit> {
    use ratatui::text::Line;
    use tmt_tui::components::strip;
    let look = app.look();
    let choices: Vec<_> = groups.iter().flat_map(|group| &group.choices).collect();
    let node = node(groups);
    let cells = geometry::layout(&node, [area.width, area.height], text::measure)
        .expect("shared chip group geometry");
    let mut hits = Vec::new();
    for cell in cells {
        let Some(value) = cell.node.text.as_deref() else {
            continue;
        };
        let rect = cell.rect;
        let Ok(x) = u16::try_from(rect.x) else {
            continue;
        };
        let Ok(y) = u16::try_from(rect.y) else {
            continue;
        };
        let Ok(width) = u16::try_from(rect.width) else {
            continue;
        };
        let Ok(height) = u16::try_from(rect.height) else {
            continue;
        };
        let rect = Rect::new(
            area.x.saturating_add(x),
            area.y.saturating_add(y),
            width,
            height,
        )
        .intersection(area)
        .intersection(buffer.area);
        let choice = cell
            .node
            .id
            .as_ref()
            .and_then(|id| id.last())
            .and_then(|id| choices.iter().find(|choice| choice.id == *id));
        if let Some(choice) = choice.filter(|choice| choice.actionable) {
            if cell.cut {
                continue;
            }
            let label = value
                .strip_prefix(' ')
                .and_then(|value| value.strip_suffix(' '))
                .unwrap_or(value);
            let button = super::buttons::Button::secondary(label)
                .selected(choice.selected)
                .focused(choice.cursor)
                .enabled(!choice.disabled)
                .idle(idle);
            if let Some(rect) =
                super::buttons::paint(app, buffer, rect, &[button], Align::Left, owner)[0]
                && !choice.disabled
            {
                hits.push(Hit {
                    area: rect,
                    id: choice.id.clone(),
                });
            }
        } else {
            strip::paint_left(buffer, rect, Line::styled(value, look.role(Role::Muted)));
        }
    }
    hits
}

#[cfg(test)]
mod design_system_parity {
    use super::*;
    use tmt_cli_style::{Depth, Theme, theme::Base};
    use tmt_tui::components::{
        design_system::{CellGrid, Chip, ChipRow, ChipRowProps, Component, Rect as GridRect, Size},
        design_system_ratatui,
    };

    #[test]
    fn chip_row_matches_board_cells_styles_and_hits() {
        for (base, depth) in [
            (Base::Tmt, Depth::TrueColor),
            (Base::TmtLight, Depth::TrueColor),
            (Base::Terminal, Depth::Ansi16),
            (Base::Tmt, Depth::None),
        ] {
            let look = crate::look::Look {
                theme: Theme::new(base),
                depth,
            };
            let app = crate::board::app::workspace::tests::capture_case("agents", look);
            for width in [40, 60, 80, 120, 160] {
                for (selected, cursor) in [(None, None), (Some(1), None), (None, Some(0))] {
                    let labels = [
                        "first option with a long label",
                        "second selected option",
                        "disabled option",
                    ];
                    let choices = labels
                        .iter()
                        .enumerate()
                        .map(|(index, label)| Choice {
                            id: format!("chip-{index}"),
                            actionable: true,
                            text: format!(" {label} "),
                            gap: " ".into(),
                            selected: selected == Some(index),
                            disabled: index == 2,
                            cursor: cursor == Some(index),
                        })
                        .collect();
                    let groups = [ChipGroup {
                        label: "Range ".into(),
                        choices,
                    }];
                    let area = Rect::new(0, 0, width, 1);
                    let mut original = Buffer::empty(area);
                    let expected = paint(&mut original, area, &groups, &app, None);
                    let mut grid = CellGrid::new(Size { width, height: 1 });
                    let chips = labels
                        .iter()
                        .enumerate()
                        .map(|(index, label)| Chip {
                            id: index as u64,
                            label: (*label).into(),
                            gap: " ".into(),
                            enabled: index != 2,
                        })
                        .collect();
                    let hits = ChipRow::render(
                        &ChipRowProps {
                            label: "Range ".into(),
                            chips,
                            selected,
                            cursor,
                            active: true,
                        },
                        GridRect {
                            x: 0,
                            y: 0,
                            width,
                            height: 1,
                        },
                        &mut grid,
                    );
                    let mut actual = Buffer::empty(area);
                    design_system_ratatui::paint(&grid, area, &mut actual, &look.theme, look.depth);
                    assert_eq!(
                        actual, original,
                        "width={width}, selected={selected:?}, look={base:?}/{depth:?}"
                    );
                    let expected: Vec<_> = expected
                        .iter()
                        .map(|hit| {
                            (
                                hit.area.x,
                                hit.area.width,
                                hit.id
                                    .strip_prefix("chip-")
                                    .unwrap()
                                    .parse::<u64>()
                                    .unwrap(),
                            )
                        })
                        .collect();
                    let hits: Vec<_> = hits
                        .iter()
                        .map(|(rect, id)| (rect.x, rect.width, *id))
                        .collect();
                    assert_eq!(hits, expected, "width={width}, selected={selected:?}");
                }
            }
        }
    }
}
