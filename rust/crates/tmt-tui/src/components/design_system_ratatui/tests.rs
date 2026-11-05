use super::*;
use crate::components::design_system::*;
use ratatui::buffer::Buffer;
use std::fmt::Write;
use tmt_cli_style::{Depth, Theme, theme::Base};

fn record<C: Component>(
    out: &mut String,
    name: &str,
    props: &C::Props,
    width: u16,
    theme: &Theme,
    depth: Depth,
) {
    let mut grid = CellGrid::new(Size { width, height: 2 });
    let hits = C::render(
        props,
        Rect {
            x: 0,
            y: 0,
            width,
            height: if name.starts_with("pane") { 6 } else { 2 },
        },
        &mut grid,
    );
    let mut buffer = Buffer::empty(NativeRect::new(0, 0, width, 2));
    paint(
        &grid,
        NativeRect::new(0, 0, width, 2),
        &mut buffer,
        theme,
        depth,
    );
    writeln!(out, "[{name}] hits={hits:?}").unwrap();
    for y in 0..2 {
        let row: String = (0..width).map(|x| buffer[(x, y)].symbol()).collect();
        write!(out, "{row} | ").unwrap();
        let mut start = 0;
        for x in 1..=width {
            let current = &buffer[(start, y)];
            if x == width
                || (
                    current.fg,
                    current.bg,
                    current.underline_color,
                    current.modifier,
                ) != (
                    buffer[(x, y)].fg,
                    buffer[(x, y)].bg,
                    buffer[(x, y)].underline_color,
                    buffer[(x, y)].modifier,
                )
            {
                write!(
                    out,
                    "{start}..{}:{:?}/{:?}/{:?}/{:?};",
                    x - 1,
                    current.fg,
                    current.bg,
                    current.underline_color,
                    current.modifier
                )
                .unwrap();
                start = x;
            }
        }
        out.push('\n');
    }
}
#[test]
fn component_cell_grids_match_all_looks_and_widths() {
    let mut out = String::new();
    for (base, depth, name) in [
        (Base::Tmt, Depth::TrueColor, "tmt"),
        (Base::TmtLight, Depth::TrueColor, "tmt-light"),
        (Base::Terminal, Depth::Ansi16, "terminal"),
        (Base::Tmt, Depth::None, "no-color"),
    ] {
        let theme = Theme::new(base);
        for width in [40, 60, 80, 120, 160] {
            writeln!(&mut out, "\n=== {name} {width} ===").unwrap();
            record::<SectionRule>(
                &mut out,
                "section-note",
                &SectionRuleProps {
                    title: "Saved · 1d".into(),
                    note: Some("0.9% of input".into()),
                    note_role: Some(Token(Role::Muted)),
                    focused: false,
                },
                width,
                &theme,
                depth,
            );
            record::<SectionRule>(
                &mut out,
                "section-narrow",
                &SectionRuleProps {
                    title: "A long title that must remain visible when the width becomes narrow"
                        .into(),
                    note: Some("a note to drop first".into()),
                    note_role: Some(Token(Role::Muted)),
                    focused: false,
                },
                width,
                &theme,
                depth,
            );
            for focused in [false, true] {
                record::<PaneRule>(
                    &mut out,
                    "pane",
                    &PaneRuleProps {
                        title: "Agents".into(),
                        focused,
                        ascii: false,
                        back_hint: false,
                    },
                    width,
                    &theme,
                    depth,
                );
            }
            for focused in [false, true] {
                record::<PaneRule>(
                    &mut out,
                    "pane-ascii-back",
                    &PaneRuleProps {
                        title: "Replies".into(),
                        focused,
                        ascii: true,
                        back_hint: true,
                    },
                    width,
                    &theme,
                    depth,
                );
            }
            for focused in [false, true] {
                record::<ChipRow>(
                    &mut out,
                    "chips",
                    &ChipRowProps {
                        label: "Range ".into(),
                        chips: vec![
                            Chip {
                                id: 1,
                                label: "1d".into(),
                                gap: " ".into(),
                                enabled: true,
                            },
                            Chip {
                                id: 2,
                                label: "7d".into(),
                                gap: " ".into(),
                                enabled: true,
                            },
                            Chip {
                                id: 3,
                                label: "30d".into(),
                                gap: " ".into(),
                                enabled: false,
                            },
                        ],
                        selected: Some(0),
                        cursor: Some(1),
                        active: focused,
                    },
                    width,
                    &theme,
                    depth,
                );
            }
            record::<ChipRow>(
                &mut out,
                "chips-narrow",
                &ChipRowProps {
                    label: "Range ".into(),
                    chips: vec![
                        Chip {
                            id: 10,
                            label: "a long unselected first choice".into(),
                            gap: " ".into(),
                            enabled: true,
                        },
                        Chip {
                            id: 11,
                            label: "the selected choice survives".into(),
                            gap: " ".into(),
                            enabled: true,
                        },
                        Chip {
                            id: 12,
                            label: "another lengthy option".into(),
                            gap: " ".into(),
                            enabled: true,
                        },
                    ],
                    selected: Some(1),
                    cursor: Some(1),
                    active: true,
                },
                width,
                &theme,
                depth,
            );
            for denominator in [0, 10] {
                record::<Gauge>(
                    &mut out,
                    "gauge",
                    &GaugeProps {
                        label: "usage".into(),
                        label_width: 17,
                        total: (denominator != 0).then(|| "655M".into()),
                        numerator: 6,
                        denominator,
                        filled_role: Token(Role::Working),
                        rest_role: Token(Role::Dim),
                    },
                    width,
                    &theme,
                    depth,
                );
            }
            record::<Sparkline>(
                &mut out,
                "sparkline",
                &SparklineProps {
                    points: vec![Some(0), Some(2), None, Some(9)],
                    role: Token(Role::Accent),
                },
                width,
                &theme,
                depth,
            );
            record::<StackedBars>(
                &mut out,
                "stacked",
                &StackedBarsProps {
                    points: vec![
                        StackedPoint {
                            used: Some(14),
                            saved: Some(2),
                        },
                        StackedPoint {
                            used: None,
                            saved: None,
                        },
                        StackedPoint {
                            used: Some(0),
                            saved: Some(0),
                        },
                    ],
                    used_role: Token(Role::Text),
                    saved_role: Token(Role::Accent),
                    missing_role: Token(Role::Dim),
                },
                width,
                &theme,
                depth,
            );
            record::<StackedBars>(
                &mut out,
                "stacked-empty",
                &StackedBarsProps {
                    points: vec![],
                    used_role: Token(Role::Text),
                    saved_role: Token(Role::Accent),
                    missing_role: Token(Role::Muted),
                },
                width,
                &theme,
                depth,
            );
            record::<Sparkline>(
                &mut out,
                "sparkline-empty",
                &SparklineProps {
                    points: vec![],
                    role: Token(Role::Accent),
                },
                width,
                &theme,
                depth,
            );
            record::<TotalsTable>(
                &mut out,
                "totals",
                &TotalsTableProps {
                    columns: vec![
                        TotalColumn {
                            heading: "TOK".into(),
                            value: "1.2M".into(),
                            priority: 0,
                        },
                        TotalColumn {
                            heading: "saved".into(),
                            value: "320k".into(),
                            priority: 1,
                        },
                        TotalColumn {
                            heading: "saved %".into(),
                            value: "21%".into(),
                            priority: 2,
                        },
                        TotalColumn {
                            heading: "estimated dollar savings".into(),
                            value: "$12.50".into(),
                            priority: 3,
                        },
                    ],
                },
                width,
                &theme,
                depth,
            );
            record::<Mark>(
                &mut out,
                "mark",
                &MarkProps {
                    state: MarkState::Running,
                    label: "working".into(),
                    role: Token(Role::Working),
                    bold: false,
                },
                width,
                &theme,
                depth,
            );
            for state in [MarkState::Failed, MarkState::Decision] {
                record::<Mark>(
                    &mut out,
                    "mark-bold",
                    &MarkProps {
                        state,
                        label: "attention".into(),
                        role: Token(Role::Blocked),
                        bold: true,
                    },
                    width,
                    &theme,
                    depth,
                );
            }
            record::<MoreHint>(
                &mut out,
                "more-ascii",
                &MoreHintProps {
                    count: 2,
                    ascii: true,
                },
                width,
                &theme,
                depth,
            );
            record::<MoreHint>(
                &mut out,
                "more",
                &MoreHintProps {
                    count: 2,
                    ascii: false,
                },
                width,
                &theme,
                depth,
            );
        }
    }
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/components/design_system_ratatui/cell-grids.txt"
    );
    if let Some(export) = std::env::var_os("TMT_COMPONENT_GRID_EXPORT") {
        std::fs::write(export, &out).unwrap();
    } else {
        assert_eq!(out, std::fs::read_to_string(path).unwrap());
    }
}
