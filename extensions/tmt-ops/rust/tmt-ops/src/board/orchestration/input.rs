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
    /// A timeline cell: the start of the first interval inside it.
    At(u64),
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
    /// Tab: the next section of the left column.
    Section,
    /// A Talks row: its pair becomes the selected route.
    Talk(usize),
    /// A Jobs row.
    Job(usize),
    /// Pause or resume, run now, edit or add a job.
    JobPause,
    JobRun,
    JobEdit,
    JobNew,
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
            Ui::OrchestrationSection => Control::Section,
            Ui::JobPause => Control::JobPause,
            Ui::JobRun => Control::JobRun,
            Ui::JobEdit => Control::JobEdit,
            Ui::JobNew => Control::JobNew,
            Ui::Fold | Ui::Expand => {
                let state = &self.orchestration;
                let snapshot = state.snapshot()?;
                if snapshot.sending.routes.is_none()
                    || state.plans
                    || state.focus() != super::Section::Routes
                {
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
            Ui::Previous | Ui::Next | Ui::First | Ui::Last
                if self.orchestration.focus() != super::Section::Routes =>
            {
                let state = &self.orchestration;
                let snapshot = state.snapshot()?;
                let jobs = state.focus() == super::Section::Jobs;
                let (count, index) = if jobs {
                    let rows = snapshot.jobs.as_ref().map_or(&[][..], |j| &j.rows[..]);
                    (
                        rows.len(),
                        rows.iter()
                            .position(|job| Some(&job.job_id) == state.job.as_ref()),
                    )
                } else {
                    let pairs = snapshot.sending.talks.as_deref().unwrap_or_default();
                    (
                        pairs.len(),
                        pairs.iter().position(|pair| {
                            let (a, b) = (&pair.ids.0, &pair.ids.1);
                            let (from, to) = (state.selected.as_ref(), state.target.as_ref());
                            (Some(a), Some(b)) == (from, to) || (Some(b), Some(a)) == (from, to)
                        }),
                    )
                };
                let index = index.unwrap_or(0);
                let index = match action {
                    Ui::Previous => index.saturating_sub(1),
                    Ui::Next => (index + 1).min(count.saturating_sub(1)),
                    Ui::First => 0,
                    _ => count.saturating_sub(1),
                };
                if jobs {
                    Control::Job(index)
                } else {
                    Control::Talk(index)
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
            Control::Allow
            | Control::Focus(_)
            | Control::Resume
            | Control::Why
            | Control::JobPause
            | Control::JobRun
            | Control::JobEdit
            | Control::JobNew => {}
            Control::Section => {
                let sections = state.sections();
                let at = sections
                    .iter()
                    .position(|s| *s == state.focus())
                    .unwrap_or(0);
                state.section = sections[(at + 1) % sections.len()];
            }
            Control::Talk(index) => {
                let pair = state
                    .snapshot()
                    .and_then(|s| s.sending.talks.as_ref()?.get(index))
                    .map(|pair| pair.ids.clone());
                if let Some((a, b)) = pair {
                    state.section = super::Section::Talks;
                    state.selected = Some(a);
                    state.target = Some(b);
                }
            }
            Control::Job(index) => {
                let job = state
                    .snapshot()
                    .and_then(|s| s.jobs.as_ref()?.rows.get(index))
                    .map(|job| job.job_id.clone());
                if job.is_some() {
                    state.section = super::Section::Jobs;
                    state.job = job;
                }
            }
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
            Control::Range(days) => state.range(days),
            Control::Plans => state.plans = !state.plans,
            Control::Now => state.now(crate::status::now_ms()),
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
                state.step(matches!(control, Control::NextTime));
            }
            Control::At(at) => state.at(at),
        }
        self.invalidate_frame_geometry();
        self.orchestration_job_message()
    }
    /// With Jobs focused, the selected job's full message is read once.
    fn orchestration_job_message(&self) -> Effect {
        let state = &self.orchestration;
        let Some(job) = state
            .selected_job()
            .filter(|_| state.focus() == super::Section::Jobs)
        else {
            return Effect::None;
        };
        if state
            .job_message
            .as_ref()
            .is_some_and(|(id, _)| id == &job.job_id)
        {
            return Effect::None;
        }
        Effect::Orchestration(super::write::Task {
            step: super::write::Step::JobMessage {
                job_id: job.job_id.clone(),
            },
        })
    }
}

impl App {
    /// The write and journal controls: each starts Core's preview (or read) on the lane.
    fn orchestration_action(&mut self, control: Control) -> Option<Effect> {
        if let Some(result) = self.orchestration_job(control) {
            return Some(result.unwrap_or_else(|notice| self.say(notice)));
        }
        match self.orchestration_request(control)? {
            Ok(effect) => Some(effect),
            Err(notice) => Some(self.say(notice)),
        }
    }
    /// The squad that holds `room_id`, by name, from the workspace roster.
    fn orchestration_squad(&self, room_id: &str) -> String {
        self.workspace_snapshot()
            .and_then(|w| w.roster.squads.iter().find(|s| s.room_id == room_id))
            .map_or_else(|| room_id.to_owned(), |s| s.name.clone())
    }
    /// The job controls: pause and run now confirm first; edit and new open the Timers forms.
    /// `Err` is a notice for a control that has nothing to do here.
    fn orchestration_job(&mut self, control: Control) -> Option<Result<Effect, String>> {
        use super::write::{JobForm, JobOp, Step, Task};
        use crate::cron_service::rows::JobState;
        if !matches!(
            control,
            Control::JobPause | Control::JobRun | Control::JobEdit | Control::JobNew
        ) {
            return None;
        }
        let state = &self.orchestration;
        let snapshot = state.snapshot()?;
        if snapshot.jobs.is_none() {
            return Some(Err("This Core does not list jobs.".into()));
        }
        if matches!(control, Control::JobNew) {
            let member = snapshot
                .document
                .members
                .iter()
                .find(|m| Some(&m.identity_id) == state.selected.as_ref())?;
            let room = self.workspace_snapshot().and_then(|w| {
                w.roster
                    .squads
                    .iter()
                    .find(|s| s.members.contains(&member.identity_id))
                    .map(|s| (s.name.clone(), s.room_id.clone()))
            });
            let Some((squad, room_id)) = room else {
                return Some(Err(format!(
                    "{} is in no squad to add a job to.",
                    member.name
                )));
            };
            return Some(Ok(Effect::Orchestration(Task {
                step: Step::JobForm(JobForm::New {
                    squad,
                    room_id,
                    owner: member.name.clone(),
                }),
            })));
        }
        let Some(job) = state
            .selected_job()
            .filter(|_| state.focus() == super::Section::Jobs)
        else {
            return Some(Err("Tab to Jobs and select a job first.".into()));
        };
        let Some(key) = job.key.clone() else {
            return Some(Err(format!(
                "{} was made with tmt orch job; change it there.",
                job.display_id
            )));
        };
        let squad = self.orchestration_squad(&key.room_id);
        let name = format!("{} · {}", job.display_id, job.name());
        let revision = job.revision;
        let task = |op| {
            Box::new(Task {
                step: Step::Job {
                    key: key.clone(),
                    revision,
                    squad: squad.clone(),
                    op,
                },
            })
        };
        let choice = super::super::app::Choice::OrchestrationTask;
        Some(Ok(match control {
            Control::JobPause => match job.state {
                JobState::NoOwner => {
                    return Some(Err(format!(
                        "{} has no owner; reassign it in Timers.",
                        job.display_id
                    )));
                }
                JobState::Paused => self.confirm(
                    format!("Resume {name}?"),
                    vec![format!("{} runs on its schedule again.", job.display_id)],
                    "Resume".into(),
                    choice(task(JobOp::Resume)),
                ),
                _ => self.confirm(
                    format!("Pause {name}?"),
                    vec![format!(
                        "{} stops running until it is resumed.",
                        job.display_id
                    )],
                    "Pause".into(),
                    choice(task(JobOp::Pause)),
                ),
            },
            Control::JobRun => self.confirm(
                format!("Run {name} now?"),
                vec![format!(
                    "Sends its message to {} once now; the schedule does not change.",
                    job.owner_name.as_deref().unwrap_or("its owner")
                )],
                "Run now".into(),
                choice(task(JobOp::Run)),
            ),
            _ => Effect::Orchestration(Task {
                step: Step::JobForm(JobForm::Edit {
                    job_id: job.job_id.clone(),
                    key,
                    revision,
                    squad,
                }),
            }),
        }))
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
                // The button names what it does, as every confirm in the board does.
                let action = match preview["mutation"]["kind"].as_str() {
                    Some("talks.resume") => "Release",
                    Some("route.allow") => "Allow once",
                    Some("focus.set") => "Focus",
                    Some("focus.clear") => "End focus",
                    _ => "Apply",
                };
                self.confirm(
                    title,
                    lines,
                    action.into(),
                    super::super::app::Choice::OrchestrationApply(Box::new(preview)),
                )
            }
            (Step::Apply(_), Ok(_)) => {
                self.set_notice(Some("Orchestration saved".into()), false);
                Effect::Refresh
            }
            (Step::Job { .. }, Ok(done)) => {
                self.set_notice(done["done"].as_str().map(str::to_owned), false);
                self.orchestration.job_message = None;
                Effect::Refresh
            }
            (Step::JobMessage { job_id }, Ok(page)) => {
                if let Some(message) = page["job"]["definition"]["message"].as_str() {
                    self.orchestration.job_message = Some((job_id, message.to_owned()));
                    self.invalidate_frame_geometry();
                }
                Effect::None
            }
            (Step::JobForm(form), Ok(found)) => {
                let actor = crate::cron_service::CronActor {
                    id: found["actorId"].as_str().unwrap_or_default().to_owned(),
                    name: found["actorName"].as_str().unwrap_or_default().to_owned(),
                };
                match form {
                    super::write::JobForm::New {
                        squad,
                        room_id,
                        owner,
                    } => self.cron_new_form(actor, squad, room_id, owner),
                    super::write::JobForm::Edit {
                        key,
                        revision,
                        squad,
                        ..
                    } => {
                        let definition = &found["job"]["definition"];
                        let schedule =
                            match tmt_ops::cron::Schedule::from_document(&definition["schedule"]) {
                                Ok(schedule) => schedule,
                                Err(error) => return self.say(error.message),
                            };
                        self.cron_change_form(
                            super::super::cronboard::FormKind::Edit,
                            actor,
                            squad,
                            key,
                            revision,
                            definition["message"]
                                .as_str()
                                .unwrap_or_default()
                                .to_owned(),
                            &schedule,
                            found["job"]["target"]["identityName"]
                                .as_str()
                                .map(str::to_owned),
                        )
                    }
                }
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
