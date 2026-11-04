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

const OPTIONS: [(&str, &str, RightTab); 2] = [
    ("talk", "Talk", RightTab::Talk),
    ("measure", "Measure", RightTab::Measure),
];

/// Paints the control on `rule` and returns what is left of the rule for its own title.
/// Narrow rules keep the whole title and show no control. A squad member's `target` adds its
/// Checklist chip after the tabs (#5992) when the rule has room for it too.
pub(in crate::board) fn paint(
    buffer: &mut Buffer,
    app: &App,
    rule: Rect,
    target: Option<&OpsTarget>,
) -> Rect {
    let look = app.look();
    let key = keycap::key(app, crate::action::OpsUiAction::TalkMeasure, "M");
    let cap = key
        .as_deref()
        .map(|key| keycap::control_span(app, key, crate::action::OpsUiAction::TalkMeasure));
    let enabled = app.workspace_strip_enabled();
    let cap_width = cap.as_ref().map_or(0, Span::width);
    let chips = OPTIONS
        .iter()
        .map(|(_, label, _)| label.width() + 3)
        .sum::<usize>();
    let width = (cap_width + chips) as u16;
    // The control leads the rule, right after the divider: `┬─ M  Talk  Measure ── worker ──`.
    // Keep room for a short title after it.
    if rule.height == 0 || rule.width < width + LEAD + 14 {
        return rule;
    }
    strip::paint_left(
        buffer,
        Rect::new(rule.x, rule.y, LEAD, 1),
        Line::styled("─ ", look.role(Role::Dim)),
    );
    let area = Rect::new(rule.x + LEAD, rule.y, width, 1);
    if let Some(cap) = cap {
        strip::paint_left(buffer, area, Line::from(vec![cap]));
    }
    let groups = [chip_group::ChipGroup {
        label: String::new(),
        choices: OPTIONS
            .iter()
            .map(|(id, label, tab)| chip_group::Choice {
                id: (*id).into(),
                actionable: true,
                text: format!(" {label} "),
                gap: " ".into(),
                selected: *tab == app.right_tab,
                disabled: !enabled,
                cursor: false,
            })
            .collect(),
    }];
    let rect = Rect::new(area.x + cap_width as u16, area.y, chips as u16, 1);
    for hit in chip_group::paint(buffer, rect, &groups, app, None) {
        if let Some((_, _, tab)) = OPTIONS.iter().find(|(id, _, _)| *id == hit.id) {
            app.workspace_strip_hits
                .borrow_mut()
                .push((hit.area, Choice::RightTab(*tab)));
        }
    }
    let mut used = LEAD + width;
    if let Some(target) = target
        && let Some(width) = checklist(
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
fn checklist(buffer: &mut Buffer, app: &App, rest: Rect, target: &OpsTarget) -> Option<u16> {
    let key = conversation_checklist::Key::of(target)?;
    let look = app.look();
    let action = crate::action::OpsUiAction::MemberNotes;
    let cap = keycap::key(app, action, "C").map(|key| keycap::control_span(app, &key, action));
    let text = format!(
        " {} ",
        conversation_checklist::chip(app.notes.summary(&key))
    );
    let mut spans = vec![Span::raw(" ")];
    spans.extend(cap);
    spans.push(Span::styled(text, look.role(Role::Muted)));
    let line = Line::from(spans);
    let width = line.width() as u16;
    if rest.width < width + 14 {
        return None;
    }
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
