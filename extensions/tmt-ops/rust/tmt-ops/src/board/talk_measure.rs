//! The right pane's Talk/Measure control, painted at the start of its top rule, after the divider.
use crate::board::{
    app::{App, Choice},
    chip_group, conversation_checklist, keycap,
    shell::RightTab,
    workspace::OpsTarget,
};
use ratatui::{
    buffer::Buffer,
    layout::Rect,
    text::{Line, Span},
};
use tmt_cli_style::Role;
use tmt_tui::components::strip;
use unicode_width::UnicodeWidthStr;

/// The dash and space before the control.
const LEAD: u16 = 2;

/// The least room the rule keeps after the control for a short title.
const MIN_TITLE: usize = 14;

const OPTIONS: [(&str, &str, RightTab); 2] = [
    ("talk", "Talk", RightTab::Talk),
    ("measure", "Measure", RightTab::Measure),
];

/// Paints the control on `rule` and returns what is left of the rule for its own title.
/// Narrow rules keep the whole title and show no control. A squad member's `target` adds its
/// Checklist chip after the tabs (#5992) only while `keep` columns, what the rule's own title and
/// state need, stay free: the state outranks the chip, which loses its count and then itself first.
/// A state that would not fit even without the chip does not hold the chip back.
pub(in crate::board) fn paint(
    buffer: &mut Buffer,
    app: &App,
    rule: Rect,
    target: Option<&OpsTarget>,
    keep: usize,
) -> Rect {
    let look = app.look();
    let enabled = app.workspace_strip_enabled();
    let controls = OPTIONS.map(|(id, label, tab)| {
        let (action, preferred) = match tab {
            RightTab::Talk => (crate::action::OpsUiAction::PaneTalk, "T"),
            RightTab::Measure => (crate::action::OpsUiAction::PaneMeasure, "M"),
        };
        let cap =
            keycap::key(app, action, preferred).map(|key| keycap::control_span(app, &key, action));
        (id, label, tab, cap)
    });
    let width: usize = controls
        .iter()
        .map(|(_, label, _, cap)| cap.as_ref().map_or(0, Span::width) + label.width() + 3)
        .sum();
    if rule.height == 0 || usize::from(rule.width) < width + usize::from(LEAD) + MIN_TITLE {
        return rule;
    }
    strip::paint_left(
        buffer,
        Rect::new(rule.x, rule.y, LEAD, 1),
        Line::styled("─ ", look.role(Role::Dim)),
    );
    let mut used = LEAD;
    for (id, label, tab, cap) in controls {
        if let Some(cap) = cap {
            let width = cap.width() as u16;
            strip::paint_left(
                buffer,
                Rect::new(rule.x + used, rule.y, width, 1),
                Line::from(vec![cap]),
            );
            used += width;
        }
        let width = (label.width() + 3) as u16;
        let groups = [chip_group::ChipGroup {
            label: String::new(),
            choices: vec![chip_group::Choice {
                id: id.into(),
                actionable: true,
                text: format!(" {label} "),
                gap: " ".into(),
                selected: tab == app.right_tab,
                disabled: !enabled,
                cursor: false,
            }],
        }];
        for hit in chip_group::paint(
            buffer,
            Rect::new(rule.x + used, rule.y, width, 1),
            &groups,
            app,
            None,
        ) {
            app.workspace_strip_hits
                .borrow_mut()
                .push((hit.area, Choice::RightTab(tab)));
        }
        used += width;
    }
    if let Some(target) = target
        && let Some(width) = checklist(
            keep,
            buffer,
            app,
            Rect::new(rule.x + used, rule.y, rule.width - used, 1),
            target,
        )
    {
        used += width;
    }
    Rect::new(rule.x + used, rule.y, rule.width - used, 1)
}

/// ` C  Checklist 2 ` after the tabs: the keycap of the action that opens the list, then the
/// count. Returns the width it took, or nothing when `target` has no list or `rest` keeps too
/// little room for the title.
fn checklist(
    keep: usize,
    buffer: &mut Buffer,
    app: &App,
    rest: Rect,
    target: &OpsTarget,
) -> Option<u16> {
    let key = conversation_checklist::Key::of(target)?;
    let look = app.look();
    let action = crate::action::OpsUiAction::MemberNotes;
    let cap = if !app.modal_open()
        && app
            .composer_projection()
            .is_some_and(|projection| projection.focused)
    {
        Some(keycap::control_span(app, "^L", action))
    } else {
        keycap::key(app, action, "C").map(|key| keycap::control_span(app, &key, action))
    };
    // A state too wide for the rule even without the chip is not shown either way.
    let keep = if usize::from(rest.width) >= keep {
        keep
    } else {
        0
    };
    let room = usize::from(rest.width).saturating_sub(keep.max(MIN_TITLE));
    let full = conversation_checklist::chip(app.notes.summary(&key));
    let line = [full.as_str(), "Checklist"].into_iter().find_map(|text| {
        let mut spans = vec![Span::raw(" ")];
        spans.extend(cap.clone());
        spans.push(Span::styled(format!(" {text} "), look.role(Role::Muted)));
        let line = Line::from(spans);
        (line.width() <= room).then_some(line)
    })?;
    let width = line.width() as u16;
    let area = Rect::new(rest.x, rest.y, width, 1);
    strip::paint_left(buffer, area, line);
    // The chip opens the list where it is drawn, for the member that is selected.
    if app.workspace_selection_visible() {
        app.workspace_action_hits
            .borrow_mut()
            .push((area, target.clone(), Choice::MemberNotes));
    }
    Some(width)
}
