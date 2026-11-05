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
fn chip_hits_are_emitted_from_the_painted_layout() {
    let p = ChipRowProps {
        chips: vec![
            Chip {
                id: 7,
                label: "first".into(),
                enabled: true,
            },
            Chip {
                id: 8,
                label: "selected".into(),
                enabled: true,
            },
            Chip {
                id: 9,
                label: "last".into(),
                enabled: true,
            },
        ],
        selected: Some(1),
        focused: true,
    };
    let mut grid = CellGrid::new(Size {
        width: 12,
        height: 1,
    });
    let hits = ChipRow::render(&p, area(12, 1), &mut grid);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].1, 8);
    assert!(lines(&grid)[0].contains("selected"));
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
    assert_eq!(cell.fg, Role::Accent);
    assert_eq!(cell.bg, Some(Role::Text));
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
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/components/design_system");
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
fn totals_remove_low_priority_columns_without_truncating_values() {
    let p = TotalsTableProps {
        columns: vec![
            TotalColumn {
                heading: "used".into(),
                value: "12.3k".into(),
                priority: 0,
            },
            TotalColumn {
                heading: "saved".into(),
                value: "999k".into(),
                priority: 10,
            },
        ],
    };
    let mut grid = CellGrid::new(Size {
        width: 6,
        height: 2,
    });
    TotalsTable::render(&p, area(6, 2), &mut grid);
    let rows = lines(&grid);
    assert!(rows[0].contains("used"));
    assert!(rows[1].contains("12.3k"));
    assert!(!rows[1].contains("999"));
}

#[test]
fn chip_hits_are_clipped_to_the_actual_grid() {
    let p = ChipRowProps {
        chips: vec![Chip {
            id: 7,
            label: "selected".into(),
            enabled: true,
        }],
        selected: Some(0),
        focused: true,
    };
    let mut grid = CellGrid::new(Size {
        width: 5,
        height: 1,
    });
    let hits = ChipRow::render(&p, area(20, 1), &mut grid);
    assert_eq!(hits[0].0.width, 5);
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
