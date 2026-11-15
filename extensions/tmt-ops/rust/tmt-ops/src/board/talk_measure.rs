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

fn checklist_cap(app: &App) -> Option<Span<'static>> {
    let action = crate::action::OpsUiAction::MemberNotes;
    if !app.modal_open()
        && app
            .composer_projection()
            .is_some_and(|projection| projection.focused)
    {
        (!app.bindings().contains_key("ctrl-l")).then(|| keycap::control_span(app, "^L", action))
    } else {
        keycap::key(app, action, "C").map(|key| keycap::control_span(app, &key, action))
    }
}

/// Paints the control on `rule` and returns what is left of the rule for its own title.
/// Inactive controls yield to the title and state. When Checklist is active, its chip instead
/// survives narrow widths: the inactive tabs go first, then its label shortens if necessary.
pub(in crate::board) fn paint(
    buffer: &mut Buffer,
    app: &App,
    rule: Rect,
    target: Option<&OpsTarget>,
    keep: usize,
) -> Rect {
    let look = app.look();
    let enabled = app.workspace_strip_enabled();
    let mut controls: Vec<_> = OPTIONS
        .map(|(id, label, tab)| {
            let (action, preferred) = match tab {
                RightTab::Talk => (crate::action::OpsUiAction::PaneTalk, "T"),
                RightTab::Measure => (crate::action::OpsUiAction::PaneMeasure, "M"),
                RightTab::Checklist => unreachable!("Checklist is painted by its own control"),
            };
            let cap = keycap::key(app, action, preferred)
                .map(|key| keycap::control_span(app, &key, action));
            (id, label, tab, cap)
        })
        .into();
    let width: usize = controls
        .iter()
        .map(|(_, label, _, cap)| cap.as_ref().map_or(0, Span::width) + label.width() + 3)
        .sum();
    if rule.height == 0 || rule.width <= LEAD {
        return rule;
    }
    let checklist_active = app.right_tab == RightTab::Checklist
        && target.and_then(conversation_checklist::Key::of).is_some();
    if checklist_active {
        let cap = checklist_cap(app).as_ref().map_or(0, Span::width);
        let title = if usize::from(rule.width) >= keep {
            keep.max(MIN_TITLE)
        } else {
            MIN_TITLE
        };
        if usize::from(rule.width) < usize::from(LEAD) + width + cap + " Checklist ".width() + title
        {
            controls.clear();
        }
    } else if usize::from(rule.width) < width + usize::from(LEAD) + MIN_TITLE {
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
    let cap = checklist_cap(app);
    // A state too wide for the rule even without the chip is not shown either way.
    let keep = if usize::from(rest.width) >= keep {
        keep
    } else {
        0
    };
    let active = app.right_tab == RightTab::Checklist;
    let room = usize::from(rest.width).saturating_sub(if active {
        let minimum = cap.as_ref().map_or(0, Span::width) + " C ".width();
        keep.min(usize::from(rest.width).saturating_sub(minimum))
    } else {
        keep.max(MIN_TITLE)
    });
    let full = conversation_checklist::chip(app.notes.summary(&key));
    let choices: &[&str] = if active {
        &[full.as_str(), "Checklist", "Check", "C"]
    } else {
        &[full.as_str(), "Checklist"]
    };
    let line = choices.iter().find_map(|text| {
        let mut spans = Vec::new();
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
