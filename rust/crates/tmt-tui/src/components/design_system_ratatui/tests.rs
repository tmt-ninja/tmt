use super::*;
use crate::components::design_system::*;
use ratatui::buffer::Buffer;
use std::fmt::Write;
use tmt_cli_style::{Depth, Theme, theme::Base};

#[test]
fn activity_ramp_matches_the_native_six_levels_and_no_color_glyphs() {
    for (base, depth) in [
        (Base::Tmt, Depth::TrueColor),
        (Base::TmtLight, Depth::TrueColor),
        (Base::Terminal, Depth::Ansi16),
        (Base::Tmt, Depth::None),
    ] {
        let theme = Theme::new(base);
        let mut grid = CellGrid::new(Size {
            width: 6,
            height: 1,
        });
        ActivityCells::render(
            &ActivityCellsProps {
                values: (1..=6).map(Some).collect(),
                selected: false,
            },
            Rect {
                x: 0,
                y: 0,
                width: 6,
                height: 1,
            },
            &mut grid,
        );
        let area = NativeRect::new(0, 0, 6, 1);
        let mut buffer = Buffer::empty(area);
        paint(&grid, area, &mut buffer, &theme, depth);
        for level in 0..6u16 {
            let expected = screen::neutral_ramp(&theme, depth, level as u8);
            let mut expected_cell = ratatui::buffer::Cell::default();
            expected_cell.set_style(expected);
            assert_eq!(buffer[(level, 0)].style(), expected_cell.style());
            assert_eq!(
                buffer[(level, 0)].symbol(),
                if expected.bg.is_some() {
                    " "
                } else {
                    ["▁", "▂", "▃", "▄", "▆", "█"][usize::from(level)]
                }
            );
        }
        let mut grid = CellGrid::new(Size {
            width: 2,
            height: 1,
        });
        ActivityCells::render(
            &ActivityCellsProps {
                values: vec![None, Some(0)],
                selected: true,
            },
            Rect {
                x: 0,
                y: 0,
                width: 2,
                height: 1,
            },
            &mut grid,
        );
        let mut buffer = Buffer::empty(NativeRect::new(0, 0, 2, 1));
        paint(
            &grid,
            NativeRect::new(0, 0, 2, 1),
            &mut buffer,
            &theme,
            depth,
        );
        let mut selection = screen::style(&theme, Role::Text, depth).patch(screen::style(
            &theme,
            Role::Selection,
            depth,
        ));
        if selection.bg.is_none() {
            selection = selection.add_modifier(ratatui::style::Modifier::REVERSED);
        }
        let mut expected_cell = ratatui::buffer::Cell::default();
        expected_cell.set_style(selection);
        assert_eq!(buffer[(0, 0)].style(), expected_cell.style());
        assert_eq!(buffer[(1, 0)].style(), expected_cell.style());
        assert_eq!(buffer[(0, 0)].symbol(), "·");
        assert_eq!(buffer[(1, 0)].symbol(), " ");
    }
}

fn record<C: Component>(
    out: &mut String,
    name: &str,
    props: &C::Props,
    width: u16,
    theme: &Theme,
    depth: Depth,
) {
    let height = if name.starts_with("frame-") {
        6
    } else if name == "totals-table" {
        3
    } else {
        2
    };
    let mut grid = CellGrid::new(Size { width, height });
    let hits = C::render(
        props,
        Rect {
            x: 0,
            y: 0,
            width,
            height: if name.starts_with("pane") { 6 } else { height },
        },
        &mut grid,
    );
    let mut buffer = Buffer::empty(NativeRect::new(0, 0, width, height));
    paint(
        &grid,
        NativeRect::new(0, 0, width, height),
        &mut buffer,
        theme,
        depth,
    );
    writeln!(out, "[{name}] hits={hits:?}").unwrap();
    for y in 0..height {
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
            for selected in [false, true] {
                record::<ActivityCells>(
                    &mut out,
                    if selected {
                        "activity-selected"
                    } else {
                        "activity"
                    },
                    &ActivityCellsProps {
                        values: vec![
                            None,
                            Some(0),
                            Some(1),
                            Some(2),
                            Some(3),
                            Some(4),
                            Some(5),
                            Some(6),
                        ],
                        selected,
                    },
                    width,
                    &theme,
                    depth,
                );
            }
            record::<TotalsTable>(
                &mut out,
                "totals-table",
                &TotalsTableProps {
                    columns: vec![
                        TotalsColumn {
                            header: "TOK".into(),
                            width: 8,
                            role: Token(Role::Text),
                            right_aligned: true,
                        },
                        TotalsColumn {
                            header: "saved".into(),
                            width: 8,
                            role: Token(Role::Accent),
                            right_aligned: true,
                        },
                    ],
                    rows: vec![
                        TotalsRow {
                            values: vec!["840M".into(), "7.8M".into()],
                            selected: true,
                            id: Some(7),
                        },
                        TotalsRow {
                            values: vec!["0".into(), "—".into()],
                            selected: false,
                            id: None,
                        },
                    ],
                },
                width,
                &theme,
                depth,
            );
            record::<Text>(
                &mut out,
                "styled-text",
                &TextProps {
                    spans: vec![
                        TextSpan {
                            text: "used ".into(),
                            role: Token(Role::Text),
                        },
                        TextSpan {
                            text: "840M".into(),
                            role: Token(Role::Accent),
                        },
                    ],
                },
                width,
                &theme,
                depth,
            );
            for focused in [false, true] {
                record::<PaneFrame>(
                    &mut out,
                    if focused {
                        "frame-focused"
                    } else {
                        "frame-idle"
                    },
                    &PaneFrameProps {
                        title: "Conversation".into(),
                        focused,
                        ascii: false,
                        back_hint: true,
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
                    points: vec![Some(0), Some(1), None, Some(4), Some(8)],
                    scale: 8,
                    unavailable: false,
                },
                width,
                &theme,
                depth,
            );
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
                        note: Some("Search".into()),
                        note_role: Some(Token(Role::Muted)),
                        focused,
                        ascii: false,
                    },
                    width,
                    &theme,
                    depth,
                );
            }
            for focused in [false, true] {
                record::<PaneRule>(
                    &mut out,
                    "pane-ascii",
                    &PaneRuleProps {
                        title: "Agents".into(),
                        note: Some("Search".into()),
                        note_role: Some(Token(Role::Muted)),
                        focused,
                        ascii: true,
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
                "stacked-partial-and-inconsistent",
                &StackedBarsProps {
                    points: vec![
                        StackedPoint {
                            used: Some(8),
                            saved: None,
                        },
                        StackedPoint {
                            used: Some(2),
                            saved: Some(3),
                        },
                        StackedPoint {
                            used: Some(8),
                            saved: Some(4),
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
            record::<Mark>(
                &mut out,
                "mark",
                &MarkProps {
                    state: MarkState::Working,
                    label: "working".into(),
                    emphasis: false,
                },
                width,
                &theme,
                depth,
            );
            for state in [MarkState::Blocked, MarkState::Waiting] {
                record::<Mark>(
                    &mut out,
                    "mark-bold",
                    &MarkProps {
                        state,
                        label: "attention".into(),
                        emphasis: true,
                    },
                    width,
                    &theme,
                    depth,
                );
            }
            for (name, state) in [
                ("mark-offline", MarkState::Offline),
                ("mark-ended", MarkState::Ended),
                ("mark-idle", MarkState::Idle),
                ("mark-review", MarkState::Review),
                ("mark-shell", MarkState::Shell),
            ] {
                record::<Mark>(
                    &mut out,
                    name,
                    &MarkProps {
                        state,
                        label: "state".into(),
                        emphasis: false,
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
                    direction: MoreDirection::Down,
                    ascii: true,
                },
                width,
                &theme,
                depth,
            );
            for (name, direction) in [
                ("more-up", MoreDirection::Up),
                ("more-right", MoreDirection::Right),
                ("more-truncated", MoreDirection::Truncated),
            ] {
                record::<MoreHint>(
                    &mut out,
                    name,
                    &MoreHintProps {
                        count: 2,
                        direction,
                        ascii: false,
                    },
                    width,
                    &theme,
                    depth,
                );
            }
            record::<MoreHint>(
                &mut out,
                "more",
                &MoreHintProps {
                    count: 2,
                    direction: MoreDirection::Down,
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
