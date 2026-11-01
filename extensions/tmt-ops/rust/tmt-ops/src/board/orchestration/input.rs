//! Declared tab controls; public reads are requested by demand, never from input.
use super::super::{
    app::{App, Effect},
    shell::OpsTab,
};
use ratatui::crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
#[derive(Clone, Copy)]
pub(in crate::board) enum Control {
    Range(u8),
    Member(usize),
    Plan(usize),
    Plans,
    PreviousTime,
    NextTime,
    Now,
    /// A matrix cell: sender row, recipient column.
    Cell(usize, usize),
    /// Allow the selected blocked route once.
    Allow,
    /// Personal focus for the selected member: `Some` for one hour, `None` ends it.
    Focus(bool),
    /// Release the selected pair's held messages.
    Resume,
    /// Read the selected member's decisions.
    Why,
}
impl App {
    /// A bound action on the Orchestration tab: its own controls, and the list moves read as moves
    /// through members, plans or matrix cells. Any other action keeps its usual meaning.
    pub(in crate::board) fn orchestration_bound(
        &mut self,
        action: crate::action::OpsUiAction,
    ) -> Option<Effect> {
        use crate::action::OpsUiAction as Ui;
        let control = match action {
            Ui::OrchestrationDay => Control::Range(1),
            Ui::OrchestrationWeek => Control::Range(7),
            Ui::OrchestrationMonth => Control::Range(30),
            Ui::OrchestrationPlans => Control::Plans,
            Ui::OrchestrationNow => Control::Now,
            Ui::OrchestrationEarlier => Control::PreviousTime,
            Ui::OrchestrationLater => Control::NextTime,
            Ui::AllowOnce => Control::Allow,
            Ui::FocusHour => Control::Focus(true),
            Ui::EndFocus => Control::Focus(false),
            Ui::ReleaseHeld => Control::Resume,
            Ui::Why => Control::Why,
            Ui::Fold | Ui::Expand => {
                let state = &self.orchestration;
                let snapshot = state.snapshot()?;
                if snapshot.sending.routes.is_none() || state.plans {
                    // Without a route matrix the sideways moves keep moving the selected time.
                    if action == Ui::Fold {
                        Control::PreviousTime
                    } else {
                        Control::NextTime
                    }
                } else {
                    let members = &snapshot.document.members;
                    let row = members
                        .iter()
                        .position(|m| Some(&m.identity_id) == state.selected.as_ref())
                        .unwrap_or(0);
                    let column = members
                        .iter()
                        .position(|m| Some(&m.identity_id) == state.target.as_ref())
                        .unwrap_or(0);
                    let column = if action == Ui::Fold {
                        column.saturating_sub(1)
                    } else {
                        (column + 1).min(members.len().saturating_sub(1))
                    };
                    Control::Cell(row, column)
                }
            }
            Ui::Previous | Ui::Next | Ui::First | Ui::Last => {
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
                let index = match action {
                    Ui::Previous => index.saturating_sub(1),
                    Ui::Next => (index + 1).min(ids.len().saturating_sub(1)),
                    Ui::First => 0,
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
        if let Some(effect) = self.orchestration_action(control) {
            return effect;
        }
        let state = &mut self.orchestration;
        match control {
            Control::Allow | Control::Focus(_) | Control::Resume | Control::Why => {}
            Control::Cell(row, column) => {
                if let Some(snapshot) = state.snapshot() {
                    let members = &snapshot.document.members;
                    let row = members.get(row).map(|m| m.identity_id.clone());
                    let column = members.get(column).map(|m| m.identity_id.clone());
                    if row.is_some() {
                        state.selected = row;
                    }
                    if column.is_some() {
                        state.target = column;
                    }
                }
            }
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

impl App {
    /// The write and journal controls: each starts Core's preview (or read) on the lane.
    fn orchestration_action(&mut self, control: Control) -> Option<Effect> {
        match self.orchestration_request(control)? {
            Ok(effect) => Some(effect),
            Err(notice) => Some(self.say(notice)),
        }
    }
    /// `Err` is a notice for a control that has nothing to do here.
    fn orchestration_request(&self, control: Control) -> Option<Result<Effect, String>> {
        use super::write::{Step, Task};
        let state = &self.orchestration;
        let snapshot = state.snapshot()?;
        let members = &snapshot.document.members;
        let member =
            |id: &Option<String>| members.iter().find(|m| Some(&m.identity_id) == id.as_ref());
        let preview = |title: String, mutation: serde_json::Value| {
            Some(Ok(Effect::Orchestration(Task {
                step: Step::Preview { title, mutation },
            })))
        };
        if !snapshot.writes
            && matches!(
                control,
                Control::Allow | Control::Focus(_) | Control::Resume
            )
        {
            return Some(Err("This Core does not offer Orchestration changes.".into()));
        }
        let now = crate::status::now_ms();
        match control {
            Control::Allow => {
                let (from, to) = (member(&state.selected)?, member(&state.target)?);
                let route = snapshot.sending.route(&from.identity_id, &to.identity_id)?;
                if route.verdict != super::model::Verdict::Blocked {
                    return Some(Err(format!(
                        "{} may already message {}; nothing to allow.",
                        from.name, to.name
                    )));
                }
                // Until the sender's current slot ends, at most 24 hours.
                let cap = now + 86_400_000;
                let until = from.next_change_at_ms.map_or(cap, |end| end.min(cap));
                preview(
                    format!("Allow {} → {} once", from.name, to.name),
                    serde_json::json!({"kind": "route.allow", "fromId": from.identity_id, "toId": to.identity_id, "untilMs": until}),
                )
            }
            Control::Focus(on) => {
                let who = member(&state.selected)?;
                if on {
                    preview(
                        format!("Focus {} for one hour", who.name),
                        serde_json::json!({"kind": "focus.set", "identityId": who.identity_id, "startMs": now, "endMs": now + 3_600_000}),
                    )
                } else {
                    preview(
                        format!("End {}'s focus", who.name),
                        serde_json::json!({"kind": "focus.clear", "identityId": who.identity_id}),
                    )
                }
            }
            Control::Resume => {
                let (a, b) = (member(&state.selected)?, member(&state.target)?);
                let held = snapshot
                    .sending
                    .pair(&a.identity_id, &b.identity_id)
                    .is_some_and(|pair| pair.held);
                if !held {
                    return Some(Err(format!(
                        "Nothing is held between {} and {}.",
                        a.name, b.name
                    )));
                }
                preview(
                    format!("Release held {} ⇄ {}", a.name, b.name),
                    serde_json::json!({"kind": "talks.resume", "aId": a.identity_id, "bId": b.identity_id}),
                )
            }
            Control::Why => {
                let who = member(&state.selected)?;
                Some(Ok(Effect::Orchestration(Task {
                    step: Step::Why {
                        identity_id: who.identity_id.clone(),
                        name: who.name.clone(),
                    },
                })))
            }
            _ => None,
        }
    }

    pub(in crate::board) fn finished_orchestration(
        &mut self,
        completed: super::write::Completed,
    ) -> Effect {
        use super::write::{Step, preview_lines, why_lines};
        match (completed.task.step, completed.result) {
            (Step::Preview { title, .. }, Ok(preview)) => {
                let names = self
                    .orchestration
                    .snapshot()
                    .map(|s| s.document.members.clone())
                    .unwrap_or_default();
                let lines = preview_lines(&preview, |id| {
                    names
                        .iter()
                        .find(|m| m.identity_id == id)
                        .map_or_else(|| id.to_owned(), |m| m.name.clone())
                });
                self.confirm(
                    title,
                    lines,
                    "Save".into(),
                    super::super::app::Choice::OrchestrationApply(Box::new(preview)),
                )
            }
            (Step::Apply(_), Ok(_)) => {
                self.set_notice(Some("Orchestration saved".into()), false);
                Effect::Refresh
            }
            (Step::Why { identity_id, name }, Ok(page)) => {
                let mut lines = vec![format!("Why · {name}")];
                lines.extend(why_lines(&page));
                self.orchestration.why = Some((identity_id, lines));
                self.invalidate_frame_geometry();
                Effect::None
            }
            (_, Err(error)) => {
                let text = match error.code.as_str() {
                    "ORCH_CONFLICT" => {
                        "Orchestration changed since the preview; nothing was saved. Try again."
                            .to_owned()
                    }
                    _ => error.message,
                };
                self.set_notice(Some(text), true);
                Effect::None
            }
        }
    }
}
