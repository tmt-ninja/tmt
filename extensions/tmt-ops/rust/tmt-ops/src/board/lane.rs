//! The thread behind keys and clicks. A user action (send, jump, open, copy,
//! save a tab order) and the config read behind a picker both start commands or
//! take locks, so the session loop never runs them: it submits a [`Job`], paints
//! a placeholder notice, and applies the [`BoardEvent`] that comes back. Jobs run
//! in the order submitted.

use super::{BoardEvent, Request, execute};
use crate::{config::Config, core::Core, labels::Refresh};
use std::{
    sync::mpsc::{Sender, channel},
    thread::JoinHandle,
};

/// The overlay a config read is for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Opening {
    Settings,
    /// The settings overlay for this squad, opened from the Workspace settings menu.
    SquadSettings(String),
    HostAction(Box<super::settings::host_action::Selection>),
    /// The theme picker, for this squad tab (none on the aggregate tabs).
    ThemePicker(Option<String>),
}

#[derive(Debug)]
pub(super) enum Job {
    AnswerProviderForm(super::provider_answer::Send),
    Standalone(super::standalone::Task),
    Shell {
        key: (String, String),
        command: String,
    },
    Act(Request),
    OpenWorkPage(String),
    WorkOrder(super::work::OrderJob),
    Jump {
        member: String,
    },
    Send {
        request: Request,
        ticket: super::conversation::outgoing::Ticket,
    },
    Recovery(super::recovery::load::Task),
    Discovery(super::discovery::load::Task),
    MemberSession(super::member_session::Task),
    NewMember(super::new_member::Task),
    SwitchTool(super::switch_tool::Task),
    IdleAlert(super::idle_alert_editor::Task),
    Orchestration(super::orchestration::write::Task),
    Open(Opening),
    /// Save the header's token-rate window with no settings overlay open.
    TokenWindow(String),
    ViewState(super::view_state::Writer),
    LocalUnread(super::unread::local::Task),
    AcknowledgeAnswers(super::unread::publish::Writer),
    /// Read the checklist summary of the conversation on screen.
    Notes(super::conversation_checklist::Task),
    /// Read the skills the open composer's recipient can invoke.
    Skills(super::skills::Task),
    /// Read the running versions once, at start.
    Versions,
    /// List, open or close a built-in member's extra terminals.
    Terminals(super::member_terminals::Task),
    /// Read the built-in capture once, or relaunch one offline member; the dialog shows it.
    OfflineResume(super::offline_resume::Task),
}

impl Job {
    /// Whether the user is waiting on this job. Quiet work, and a choice saved with no
    /// overlay open, shows no progress; its failure still shows.
    pub fn shows_progress(&self) -> bool {
        !matches!(
            self,
            Self::Recovery(_)
                | Self::TokenWindow(_)
                | Self::ViewState(_)
                | Self::LocalUnread(_)
                | Self::AcknowledgeAnswers(_)
                | Self::Notes(_)
                | Self::Skills(_)
                | Self::Versions
                | Self::WorkOrder(_)
                | Self::OfflineResume(_)
                | Self::Standalone(_)
        ) && !matches!(self, Self::Terminals(task) if task.progress().is_none())
    }

    /// What the board shows until the job's event arrives.
    pub fn progress(&self) -> &'static str {
        match self {
            Self::Shell { .. } => "Running shell…",
            Self::Standalone(_) => "Working with the command…",
            Self::OpenWorkPage(_) => "Opening Colab page…",
            Self::WorkOrder(_) => "Working with the Colab project order…",
            Self::AnswerProviderForm(_) => "Sending form answer…",
            Self::Act(request) | Self::Send { request, .. } => request.progress(),
            Self::Jump { .. } => "Jumping…",
            Self::AcknowledgeAnswers(_) => "Acknowledging answers…",
            Self::Notes(_) => "Reading the checklist…",
            Self::Skills(_) => "Reading skills…",
            Self::Versions => "Reading the versions…",
            Self::Terminals(task) => task.progress().unwrap_or("Reading terminals…"),
            Self::OfflineResume(_) => "Resuming offline members…",
            Self::Recovery(_) => "Reading or applying the selected workspace snapshot…",
            Self::MemberSession(_) => "Loading session…",
            Self::SwitchTool(_) => "Preparing or switching AI tool…",
            Self::IdleAlert(_) => "Reading or saving idle alert…",
            Self::Orchestration(_) => "Asking Core about Orchestration…",
            Self::NewMember(_) => "Preparing or creating member…",
            Self::Discovery(_) => "Scanning or binding the selected agent…",
            Self::Open(Opening::Settings | Opening::SquadSettings(_) | Opening::HostAction(_)) => {
                "Loading settings…"
            }
            Self::Open(Opening::ThemePicker(_)) => "Loading themes…",
            Self::TokenWindow(_) => "Saving the token window…",
            Self::ViewState(_) => "Saving the board view…",
            Self::LocalUnread(_) => "Saving manual unread marks…",
        }
    }
}

/// Checklist counts and previews use the worker so they cannot hold an
/// explicit jump behind a read on the action lane.
pub(super) fn route(
    job: Job,
    read_checklist: impl FnOnce(super::conversation_checklist::Task),
    action: impl FnOnce(Job),
) {
    match job {
        Job::Notes(task) if task.read_only() => read_checklist(task),
        job => action(job),
    }
}

/// The result of one job.
pub(super) fn run(core: &Core, labels: Option<&Refresh>, job: Job) -> BoardEvent {
    match job {
        Job::AnswerProviderForm(answer) => {
            BoardEvent::ProviderAnswer(super::provider_answer::send(core, answer))
        }
        Job::Shell { .. } => unreachable!("shell has a dedicated worker"),
        Job::Standalone(super::standalone::Task::Saved(task)) => {
            let result = task.complete(core);
            BoardEvent::Standalone(super::standalone::Completed::Saved(task, result))
        }
        Job::Standalone(_) => unreachable!("standalone session has a dedicated worker"),
        Job::OpenWorkPage(page) => BoardEvent::WorkOpened(super::work::open(core, &page)),
        Job::WorkOrder(job) => BoardEvent::WorkOrder(super::work::run_order(core, job)),
        Job::LocalUnread(task) => {
            let actor = task.actor().to_owned();
            BoardEvent::LocalUnreadPublished {
                actor,
                result: task.publish(),
            }
        }
        Job::AcknowledgeAnswers(writer) => BoardEvent::AnswersAcknowledged(writer.publish(core)),
        Job::Notes(task) => {
            BoardEvent::NotesRead(super::conversation_checklist::complete(core, task))
        }
        Job::Skills(task) => BoardEvent::SkillsRead(super::skills::complete(core, task)),
        Job::Versions => BoardEvent::VersionsRead(super::versions::Versions::read(core)),
        Job::Terminals(task) => {
            BoardEvent::TerminalsDone(super::member_terminals::complete(core, task))
        }
        Job::OfflineResume(task) => {
            BoardEvent::OfflineResume(super::offline_resume::complete(core, task))
        }
        Job::Jump { member } => BoardEvent::Acted {
            jump: true,
            sends: false,
            outcome: execute(core, Request::Jump(member)),
        },
        Job::ViewState(writer) => {
            writer.publish(std::time::Instant::now(), false);
            BoardEvent::ViewStatePublished
        }
        Job::Recovery(task) => BoardEvent::Recovery(super::recovery::load::complete(core, task)),
        Job::SwitchTool(task) => BoardEvent::SwitchTool(super::switch_tool::complete(core, task)),
        Job::IdleAlert(task) => {
            BoardEvent::IdleAlert(super::idle_alert_editor::complete(core, task))
        }
        Job::Orchestration(task) => {
            BoardEvent::Orchestration(super::orchestration::write::complete(core, task))
        }
        Job::NewMember(task) => BoardEvent::NewMember(super::new_member::complete(core, task)),
        Job::MemberSession(task) => {
            BoardEvent::MemberSession(super::member_session::complete(core, task))
        }
        Job::Discovery(task) => BoardEvent::Discovery(super::discovery::load::complete(core, task)),
        Job::Send { request, ticket } => {
            let mut outcome = execute(core, request);
            if let Ok(super::ActionOutcome::Send(completed)) = &mut outcome {
                completed.ticket = Some(ticket);
            }
            BoardEvent::Acted {
                jump: false,
                sends: true,
                outcome,
            }
        }
        Job::Act(request) => {
            let jump = matches!(request, Request::Jump(_));
            let sends = request.sends();
            let digest = matches!(request, Request::Digest(_) | Request::DigestSwitch(_));
            let outcome = execute(core, request);
            // What the extension supplies changed: read it now, not at the next tick.
            if let (true, Ok(_), Some(labels)) = (digest, &outcome, labels) {
                labels.now();
            }
            BoardEvent::Acted {
                jump,
                sends,
                outcome,
            }
        }
        Job::Open(opening) => {
            let board_pane = matches!(&opening, Opening::HostAction(_))
                .then(|| {
                    core.json(&["whoami"]).ok().and_then(|caller| {
                        caller["pane"]
                            .as_str()
                            .filter(|pane| !pane.is_empty())
                            .map(str::to_owned)
                    })
                })
                .flatten();
            BoardEvent::Opened {
                opening,
                config: Config::load(core).map_err(|error| error.message),
                board_pane,
            }
        }
        Job::TokenWindow(window) => BoardEvent::TokenWindowSaved(
            Config::load(core)
                .and_then(|mut config| {
                    config.set_setting(None, "board.token_rate.window", &window)?;
                    Ok(config)
                })
                .map_err(|error| error.message),
        ),
    }
}

pub(super) struct Lane {
    jobs: Option<Sender<Job>>,
    thread: Option<JoinHandle<()>>,
    shell_core: Core,
    standalone: std::cell::OnceCell<super::standalone::Worker>,
    shell_events: Sender<BoardEvent>,
    shell_threads: std::cell::RefCell<Vec<JoinHandle<()>>>,
    shell_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl Lane {
    pub fn spawn(core: Core, labels: Option<Refresh>, events: Sender<BoardEvent>) -> Self {
        let shell_core = core.one_shot();
        let shell_events = events.clone();
        let core = core.interactive();
        let (jobs, queue) = channel();
        let thread = std::thread::spawn(move || {
            for job in queue {
                if events.send(run(&core, labels.as_ref(), job)).is_err() {
                    break;
                }
            }
        });
        Self {
            jobs: Some(jobs),
            thread: Some(thread),
            shell_core,
            standalone: Default::default(),
            shell_events,
            shell_threads: Default::default(),
            shell_stop: Default::default(),
        }
    }

    pub fn submit(&self, job: Job) {
        if let Job::Standalone(
            task @ (super::standalone::Task::Run(_)
            | super::standalone::Task::Keep(_)
            | super::standalone::Task::Discard
            | super::standalone::Task::Stop),
        ) = job
        {
            self.standalone
                .get_or_init(|| {
                    super::standalone::Worker::spawn(
                        self.shell_core.clone(),
                        self.shell_events.clone(),
                    )
                })
                .submit(task);
            return;
        }
        if let Job::Shell { key, command } = job {
            let core = self.shell_core.clone();
            let events = self.shell_events.clone();
            let stopped = self.shell_stop.clone();
            let mut threads = self.shell_threads.borrow_mut();
            let mut index = 0;
            while index < threads.len() {
                if threads[index].is_finished() {
                    let _ = threads.swap_remove(index).join();
                } else {
                    index += 1;
                }
            }
            let failure_key = key.clone();
            let worker = std::thread::Builder::new()
                .name("ops-shell".into())
                .spawn(move || {
                    let result = core.shell_run(
                        serde_json::json!({"identityId":key.1,"command":command}),
                        &stopped,
                    );
                    let event = match result {
                        Err(error) if error.code == "SHELL_RUN_CANCELLED" => {
                            BoardEvent::ShellCancelled {
                                key,
                                confirmed: true,
                            }
                        }
                        Err(error)
                            if !matches!(
                                error.code.as_str(),
                                "SHELL_RUN_UNAVAILABLE" | "SHELL_RUN_FAILED" | "API_INPUT_INVALID"
                            ) =>
                        {
                            BoardEvent::ShellCancelled {
                                key,
                                confirmed: false,
                            }
                        }
                        Err(error) => BoardEvent::ShellDone {
                            key,
                            result: Err(if error.code == "SHELL_RUN_FAILED" {
                                "Could not start; nothing was run.".into()
                            } else {
                                error.message
                            }),
                        },
                        Ok(value) if super::conversation::shell::valid_result(&key.1, &value) => {
                            BoardEvent::ShellDone {
                                key,
                                result: Ok(value),
                            }
                        }
                        Ok(_) => BoardEvent::ShellCancelled {
                            key,
                            confirmed: false,
                        },
                    };
                    let _ = events.send(event);
                });
            match worker {
                Ok(thread) => threads.push(thread),
                Err(_) => {
                    let _ = self.shell_events.send(BoardEvent::ShellDone {
                        key: failure_key,
                        result: Err("Shell could not start; nothing was run.".into()),
                    });
                }
            }
            return;
        }
        if let Some(jobs) = &self.jobs {
            let _ = jobs.send(job);
        }
    }

    /// Ends the lane once its queued jobs finish; each command has its own deadline.
    pub fn finish(mut self) {
        self.shell_stop
            .store(true, std::sync::atomic::Ordering::Release);
        self.standalone.take();
        self.jobs = None;
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        // The CLOEXEC request pipe closes on board exit or reload; Core reaps.
        drop(self.shell_threads.into_inner());
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod progress_tests {
    use super::*;

    #[test]
    fn only_jobs_the_user_waits_on_show_progress() {
        assert!(Job::Act(Request::Back).shows_progress());
        assert!(Job::Open(Opening::Settings).shows_progress());
        assert!(!Job::TokenWindow("1h".into()).shows_progress());
    }
}
