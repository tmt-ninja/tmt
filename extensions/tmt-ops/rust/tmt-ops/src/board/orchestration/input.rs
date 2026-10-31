//! Declared tab controls; public reads are requested by demand, never from input.
use super::super::{
    app::{App, Effect},
    shell::OpsTab,
};
use ratatui::crossterm::event::{
    KeyCode, KeyEvent, KeyEventKind, KeyModifiers, MouseButton, MouseEvent, MouseEventKind,
};
#[derive(Clone, Copy)]
pub(in crate::board) enum Control {
    Range(u8),
    Member(usize),
    Plan(usize),
    Plans,
    PreviousTime,
    NextTime,
    Now,
}
impl App {
    pub(in crate::board) fn orchestration_key(&mut self, key: KeyEvent) -> Option<Effect> {
        if key.kind == KeyEventKind::Release
            || key
                .modifiers
                .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT)
        {
            return None;
        }
        let control = match key.code {
            KeyCode::Char('d') => Control::Range(1),
            KeyCode::Char('7') => Control::Range(7),
            KeyCode::Char('0') => Control::Range(30),
            KeyCode::Char('P') => Control::Plans,
            KeyCode::Char('N') => Control::Now,
            KeyCode::Left => Control::PreviousTime,
            KeyCode::Right => Control::NextTime,
            KeyCode::Up | KeyCode::Down | KeyCode::Home | KeyCode::End => {
                let state = &self.orchestration;
                let snapshot = state.snapshot()?;
                let ids: Vec<_> = if state.plans {
                    snapshot
                        .document
                        .plans
                        .iter()
                        .filter_map(|p| p["id"].as_str())
                        .collect()
                } else {
                    snapshot
                        .document
                        .members
                        .iter()
                        .map(|m| m.identity_id.as_str())
                        .collect()
                };
                let selected = if state.plans {
                    state.plan_selection.as_deref()
                } else {
                    state.selected.as_deref()
                };
                let index = ids.iter().position(|id| Some(*id) == selected).unwrap_or(0);
                let index = match key.code {
                    KeyCode::Up => index.saturating_sub(1),
                    KeyCode::Down => (index + 1).min(ids.len().saturating_sub(1)),
                    KeyCode::Home => 0,
                    _ => ids.len().saturating_sub(1),
                };
                if state.plans {
                    Control::Plan(index)
                } else {
                    Control::Member(index)
                }
            }
            _ => return None,
        };
        Some(self.orchestration_control(control))
    }
    pub(in crate::board) fn orchestration_mouse(&mut self, mouse: MouseEvent) -> Option<Effect> {
        if mouse.kind != MouseEventKind::Down(MouseButton::Left) {
            return None;
        }
        let control = self
            .orchestration
            .hits
            .borrow()
            .iter()
            .find(|(rect, _)| rect.contains((mouse.column, mouse.row).into()))
            .map(|(_, c)| *c)?;
        Some(self.orchestration_control(control))
    }
    fn orchestration_control(&mut self, control: Control) -> Effect {
        if self.shell.tab != OpsTab::Orchestration {
            return Effect::None;
        }
        let state = &mut self.orchestration;
        match control {
            Control::Range(days) => state.query.days = days,
            Control::Plans => state.plans = !state.plans,
            Control::Now => {
                state.follow_now = true;
                state.query.at_ms = crate::status::now_ms();
            }
            Control::Member(index) => {
                state.selected = state
                    .snapshot()
                    .and_then(|s| s.document.members.get(index))
                    .map(|m| m.identity_id.clone());
            }
            Control::Plan(index) => {
                state.plan_selection = state
                    .snapshot()
                    .and_then(|s| s.document.plans.get(index))
                    .and_then(|p| p["id"].as_str().map(str::to_owned));
            }
            Control::PreviousTime | Control::NextTime => {
                if let Some(snapshot) = state.snapshot() {
                    let mut boundaries: Vec<_> = snapshot
                        .document
                        .timeline
                        .iter()
                        .flat_map(|interval| [interval.start_ms, interval.end_ms])
                        .chain(
                            snapshot
                                .document
                                .members
                                .iter()
                                .filter_map(|member| member.next_change_at_ms),
                        )
                        .collect();
                    boundaries.sort_unstable();
                    boundaries.dedup();
                    let next = if matches!(control, Control::PreviousTime) {
                        boundaries
                            .into_iter()
                            .rev()
                            .find(|at| *at < state.query.at_ms)
                    } else {
                        boundaries.into_iter().find(|at| *at > state.query.at_ms)
                    };
                    if let Some(at) = next {
                        state.query.at_ms = at;
                        state.follow_now = false;
                    }
                }
            }
        }
        self.invalidate_frame_geometry();
        Effect::None
    }
}
