use super::*;
use tmt_cli_style::theme::Role;

fn area(width: u16, height: u16) -> Rect {
    Rect {
        x: 0,
        y: 0,
        width,
        height,
    }
}

fn lines(grid: &CellGrid) -> Vec<String> {
    (0..grid.size().height)
        .map(|y| {
            (0..grid.size().width)
                .map(|x| grid.get(x, y).unwrap().glyph.as_str())
                .collect()
        })
        .collect()
}

#[test]
fn serde_and_grapheme_cells_round_trip_without_partial_wide_characters() {
    let p = GaugeProps {
        label: "usage".into(),
        label_width: 17,
        total: None,
        numerator: 2,
        denominator: 3,
        filled_role: Token(Role::Working),
        rest_role: Token(Role::Dim),
    };
    let json = serde_json::to_string(&p).unwrap();
    let decoded: GaugeProps = serde_json::from_str(&json).unwrap();
    assert_eq!(decoded.filled_role.0, Role::Working);
    assert!(serde_json::from_str::<Token>("\"unknown\"").is_err());
    let mut grid = CellGrid::new(Size {
        width: 3,
        height: 1,
    });
    grid.text(area(3, 1), "a世x", Role::Text, None);
    assert_eq!(grid.get(1, 0).unwrap().glyph, "世");
    assert!(grid.get(2, 0).unwrap().continuation);
}

#[test]
fn section_drops_note_before_ellipsizing_title() {
    let p = SectionRuleProps {
        title: "An unusually long title".into(),
        note: Some("important note".into()),
        note_role: Some(Token(Role::Muted)),
        focused: false,
    };
    let mut grid = CellGrid::new(Size {
        width: 18,
        height: 1,
    });
    SectionRule::render(&p, area(18, 1), &mut grid);
    let s = &lines(&grid)[0];
    assert!(!s.contains("important"));
    assert!(s.ends_with('…'));
}

#[test]
fn chip_hits_are_emitted_only_for_a_complete_visible_prefix() {
    let props = ChipRowProps {
        label: "".into(),
        chips: vec![
            Chip {
                id: 7,
                label: "first".into(),
                gap: " ".into(),
                enabled: true,
            },
            Chip {
                id: 8,
                label: "selected".into(),
                gap: "".into(),
                enabled: true,
            },
        ],
        selected: Some(1),
        cursor: Some(1),
        active: true,
    };
    let mut grid = CellGrid::new(Size {
        width: 12,
        height: 1,
    });
    let hits = ChipRow::render(&props, area(12, 1), &mut grid);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].1, 7);
    assert!(!lines(&grid)[0].contains("selected"));
}

#[test]
fn stacked_mixed_cell_keeps_fraction_and_role_background() {
    let p = StackedBarsProps {
        points: vec![StackedPoint {
            used: Some(14),
            saved: Some(2),
        }],
        used_role: Token(Role::Text),
        saved_role: Token(Role::Accent),
        missing_role: Token(Role::Dim),
    };
    let mut grid = CellGrid::new(Size {
        width: 1,
        height: 2,
    });
    StackedBars::render(&p, area(1, 2), &mut grid);
    let cell = grid.get(0, 1).unwrap();
    assert_eq!(cell.glyph, "▂");
    assert_eq!(cell.fg, Some(Role::Accent));
    assert_eq!(cell.bg, Some(Role::Text));
}

#[test]
fn stacked_saved_is_part_of_used_not_added_to_its_height() {
    let props = StackedBarsProps {
        points: vec![
            StackedPoint {
                used: Some(8),
                saved: Some(8),
            },
            StackedPoint {
                used: Some(8),
                saved: Some(0),
            },
        ],
        used_role: Token(Role::Text),
        saved_role: Token(Role::Accent),
        missing_role: Token(Role::Dim),
    };
    let mut grid = CellGrid::new(Size {
        width: 2,
        height: 2,
    });
    StackedBars::render(&props, area(2, 2), &mut grid);
    assert_eq!(grid.get(0, 0).unwrap().glyph, "█");
    assert_eq!(grid.get(1, 0).unwrap().glyph, "█");
    assert_eq!(grid.get(0, 0).unwrap().fg, Some(Role::Accent));
    assert_eq!(grid.get(1, 0).unwrap().fg, Some(Role::Text));
}

#[test]
fn stacked_missing_saved_is_not_invented_as_zero() {
    let props = StackedBarsProps {
        points: vec![StackedPoint {
            used: Some(8),
            saved: None,
        }],
        used_role: Token(Role::Text),
        saved_role: Token(Role::Accent),
        missing_role: Token(Role::Dim),
    };
    let mut grid = CellGrid::new(Size {
        width: 1,
        height: 2,
    });
    StackedBars::render(&props, area(1, 2), &mut grid);
    assert_eq!(grid.get(0, 0).unwrap().glyph, "·");
    assert_eq!(grid.get(0, 1).unwrap().glyph, "·");
}

#[test]
fn stacked_saved_larger_than_used_is_unknown() {
    let props = StackedBarsProps {
        points: vec![StackedPoint {
            used: Some(2),
            saved: Some(3),
        }],
        used_role: Token(Role::Text),
        saved_role: Token(Role::Accent),
        missing_role: Token(Role::Dim),
    };
    let mut grid = CellGrid::new(Size {
        width: 1,
        height: 2,
    });
    StackedBars::render(&props, area(1, 2), &mut grid);
    assert_eq!(grid.get(0, 0).unwrap().glyph, "·");
    assert_eq!(grid.get(0, 1).unwrap().glyph, "·");
}

#[test]
fn activity_keeps_missing_zero_and_all_six_semantic_levels() {
    let props = ActivityCellsProps {
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
        selected: false,
    };
    let mut grid = CellGrid::new(Size {
        width: 8,
        height: 1,
    });
    ActivityCells::render(&props, area(8, 1), &mut grid);
    assert_eq!(grid.get(0, 0).unwrap().glyph, "·");
    assert_eq!(grid.get(1, 0).unwrap().glyph, " ");
    for level in 0..6 {
        assert_eq!(
            grid.get(level + 2, 0).unwrap().heat_level.map(u8::from),
            Some(level as u8)
        );
    }
}

#[test]
fn totals_keep_values_whole_and_publish_only_visible_rows() {
    let props = TotalsTableProps {
        columns: vec![
            TotalsColumn {
                header: "TOK".into(),
                width: 4,
                role: Token(Role::Text),
                right_aligned: true,
            },
            TotalsColumn {
                header: "saved".into(),
                width: 5,
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
                values: vec!["9".into(), "too-long".into()],
                selected: false,
                id: Some(8),
            },
        ],
    };
    let mut grid = CellGrid::new(Size {
        width: 10,
        height: 2,
    });
    let hits = TotalsTable::render(&props, area(10, 2), &mut grid);
    assert_eq!(lines(&grid)[0], " TOK      ");
    assert_eq!(lines(&grid)[1], "840M      ");
    assert_eq!(
        hits,
        vec![(
            Rect {
                x: 0,
                y: 1,
                width: 10,
                height: 1
            },
            7
        )]
    );
    assert_eq!(grid.get(0, 1).unwrap().underlay, Some(Role::Selection));
}

#[test]
fn styled_text_strips_terminal_controls_and_preserves_span_roles() {
    let props = TextProps {
        spans: vec![
            TextSpan {
                text: "A\u{1b}[31m".into(),
                role: Token(Role::Text),
                bold: false,
            },
            TextSpan {
                text: "世".into(),
                role: Token(Role::Accent),
                bold: true,
            },
        ],
    };
    let mut grid = CellGrid::new(Size {
        width: 3,
        height: 1,
    });
    Text::render(&props, area(3, 1), &mut grid);
    assert_eq!(grid.get(0, 0).unwrap().glyph, "A");
    assert_eq!(grid.get(1, 0).unwrap().glyph, "世");
    assert_eq!(grid.get(1, 0).unwrap().fg, Some(Role::Accent));
    assert!(!grid.get(0, 0).unwrap().bold);
    assert!(grid.get(1, 0).unwrap().bold);
    assert!(
        grid.get(2, 0).unwrap().bold,
        "wide-cell continuation keeps emphasis"
    );
    assert!(grid.get(2, 0).unwrap().continuation);
}

#[test]
fn styled_text_emphasis_defaults_to_false() {
    let span: TextSpan = serde_json::from_str(r#"{"text":"label","role":"text"}"#).unwrap();
    assert!(!span.bold);
    let bold: TextSpan =
        serde_json::from_str(r#"{"text":"label","role":"text","bold":true}"#).unwrap();
    assert!(bold.bold);
}

#[test]
fn layout_allocates_bounded_tracks_without_gaps() {
    let rects = split(
        area(10, 1),
        &[Track::Fixed(3), Track::Fill(1), Track::Fill(2)],
        true,
    );
    assert_eq!(rects.iter().map(|r| r.width).collect::<Vec<_>>(), [3, 2, 5]);
}

#[test]
fn pure_design_system_does_not_import_terminal_or_board_modules() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_none_or(|ext| ext != "rs")
            || path.file_name().is_some_and(|name| name == "tests.rs")
        {
            continue;
        }
        let source = std::fs::read_to_string(&path).unwrap();
        for forbidden in ["ratatui", "crossterm", "crate::board"] {
            assert!(
                !source.contains(forbidden),
                "{} imports {forbidden}",
                path.display()
            );
        }
    }
}

#[test]
fn clipped_chips_never_publish_hits() {
    let props = ChipRowProps {
        label: "".into(),
        chips: vec![Chip {
            id: 7,
            label: "selected".into(),
            gap: "".into(),
            enabled: true,
        }],
        selected: Some(0),
        cursor: None,
        active: true,
    };
    let mut grid = CellGrid::new(Size {
        width: 5,
        height: 1,
    });
    assert!(ChipRow::render(&props, area(20, 1), &mut grid).is_empty());
}

#[test]
fn row_and_column_use_the_same_track_rules() {
    let tracks = [Track::Fixed(2), Track::Fill(1)];
    assert_eq!(
        serde_json::from_str::<Track>(&serde_json::to_string(&tracks[0]).unwrap()).unwrap(),
        tracks[0]
    );
    assert_eq!(
        row(area(8, 6), &tracks)
            .iter()
            .map(|r| r.width)
            .collect::<Vec<_>>(),
        [2, 6]
    );
    assert_eq!(
        column(area(8, 6), &tracks)
            .iter()
            .map(|r| r.height)
            .collect::<Vec<_>>(),
        [2, 4]
    );
}

#[test]
fn gauge_matches_the_two_model_rows_in_digest_spec_f21e67b7() {
    for (label, numerator, total, expected) in [
        (
            "claude-opus-5.5",
            78,
            "655M",
            "claude-opus-5.5   ███████████████████·····  78%   655M",
        ),
        (
            "claude-sonnet-5.5",
            19,
            "160M",
            "claude-sonnet-5.5 █████···················  19%   160M",
        ),
    ] {
        let props = GaugeProps {
            label: label.into(),
            label_width: 17,
            numerator,
            denominator: 100,
            total: Some(total.into()),
            filled_role: Token(Role::Text),
            rest_role: Token(Role::Dim),
        };
        let mut grid = CellGrid::new(Size {
            width: 80,
            height: 1,
        });
        Gauge::render(&props, area(80, 1), &mut grid);
        assert_eq!(lines(&grid)[0].trim_end(), expected);
        assert_eq!(grid.get(18, 0).unwrap().fg, Some(Role::Text));
        assert_eq!(grid.get(41, 0).unwrap().fg, Some(Role::Dim));
    }
}

#[test]
fn portable_cell_serializes_bold_and_semantic_chip_surface() {
    let cell = Cell {
        glyph: "x".into(),
        underlay: Some(Role::Dim),
        fg: Some(Role::Text),
        bg: None,
        bold: true,
        chip_surface: Some(ChipSurface::Hot),
        heat_level: None,
        continuation: false,
    };
    let serialized = serde_json::to_string(&cell).unwrap();
    assert_eq!(serde_json::from_str::<Cell>(&serialized).unwrap(), cell);
    assert!(serialized.contains("\"underlay\":\"dim\""));
    assert!(serialized.contains("\"bold\":true"));
    assert!(serialized.contains("\"chip_surface\":\"hot\""));
}

#[test]
fn empty_section_title_is_a_plain_rule() {
    let props = SectionRuleProps {
        title: String::new(),
        note: None,
        note_role: None,
        focused: false,
    };
    let mut grid = CellGrid::new(Size {
        width: 8,
        height: 1,
    });
    SectionRule::render(&props, area(8, 1), &mut grid);
    assert_eq!(lines(&grid)[0], "────────");
    assert!((0..8).all(|x| grid.get(x, 0).unwrap().fg == Some(Role::Dim)));
}

#[test]
fn mark_state_owns_attention_role_and_limits_emphasis() {
    for (state, role, bold) in [
        (MarkState::Working, Role::Muted, false),
        (MarkState::Waiting, Role::Waiting, true),
        (MarkState::Blocked, Role::Blocked, true),
        (MarkState::Review, Role::Muted, false),
        (MarkState::Idle, Role::Muted, false),
        (MarkState::Offline, Role::Muted, false),
        (MarkState::Ended, Role::Muted, false),
        (MarkState::Shell, Role::Muted, false),
    ] {
        let mut grid = CellGrid::new(Size {
            width: 20,
            height: 1,
        });
        Mark::render(
            &MarkProps {
                state,
                label: "state".into(),
                emphasis: true,
            },
            area(20, 1),
            &mut grid,
        );
        assert_eq!(grid.get(0, 0).unwrap().fg, Some(role));
        assert_eq!(grid.get(0, 0).unwrap().bold, bold);
    }
}

#[test]
fn sparkline_preserves_missing_zero_scale_and_insufficient_track() {
    let mut grid = CellGrid::new(Size {
        width: 5,
        height: 1,
    });
    let mut props = SparklineProps {
        points: vec![None, Some(0), Some(1), Some(4), Some(8)],
        scale: 8,
        unavailable: false,
    };
    Sparkline::render(&props, area(5, 1), &mut grid);
    assert_eq!(lines(&grid), ["· ▁▄█"]);
    props.unavailable = true;
    Sparkline::render(&props, area(5, 1), &mut grid);
    assert_eq!(lines(&grid), ["     "]);
    let before = grid.clone();
    Sparkline::render(&props, area(4, 1), &mut grid);
    assert_eq!(grid, before);
}

#[test]
fn more_hints_distinguish_directions_and_truncation_in_unicode_and_ascii() {
    for (direction, unicode, ascii) in [
        (MoreDirection::Down, "12 more ↓", "12 more v"),
        (MoreDirection::Up, "12 more ↑", "12 more ^"),
        (MoreDirection::Right, "12 more →", "12 more >"),
        (MoreDirection::Truncated, "+12 more", "+12 more"),
    ] {
        assert_eq!(MoreHint::label(12, direction, false), unicode);
        assert_eq!(MoreHint::label(12, direction, true), ascii);
        let mut grid = CellGrid::new(Size {
            width: 20,
            height: 1,
        });
        MoreHint::render(
            &MoreHintProps {
                count: 12,
                direction,
                ascii: false,
            },
            area(20, 1),
            &mut grid,
        );
        assert_eq!(lines(&grid)[0].trim_end(), unicode);
    }
}
