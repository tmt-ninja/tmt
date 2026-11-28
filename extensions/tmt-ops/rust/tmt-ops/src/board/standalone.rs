//! The board's Run command controller. Core owns execution, retained output and shells.

use super::app::{App, Effect, Overlay, Request};

mod saved;
mod worker;
use crate::core::{Core, SquadError};
use ratatui::{
    Frame,
    crossterm::event::{Event, KeyCode},
    layout::Rect,
    text::{Line, Span},
};
use saved::Moving;
pub use saved::{SavedRow, SavedTask};
use serde_json::{Value, json};
use std::{cell::RefCell, time::Instant};
use tmt_cli_style::Role;
use tmt_tui::components::{
    Button, Dialog, DialogHits, DialogInput, DialogKind, DialogState, Editor, FieldKind, Placement,
    strip,
};
use unicode_width::UnicodeWidthStr;
pub(super) use worker::Worker;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Task {
    Target(u64, String),
    Saved(SavedTask),
    Run(u64, Value),
    Keep(String),
    Discard,
    Stop,
}

pub(super) enum Completed {
    Target(u64, String, Result<Value, SquadError>),
    Saved(Box<SavedTask>, Result<Value, SquadError>),
    Output(u64, worker::Output),
    Run(u64, Result<Value, SquadError>),
    Keep(Result<Value, SquadError>),
}

pub(super) fn complete_read(core: &Core, task: Task) -> Completed {
    match task {
        Task::Target(generation, identity) => {
            let result = core.api("terminal.command.target", json!({"identityId": identity}));
            Completed::Target(generation, identity, result)
        }
        Task::Saved(task @ (SavedTask::List { .. } | SavedTask::Preview(_, _))) => {
            let result = task.complete(core);
            Completed::Saved(Box::new(task), result)
        }
        _ => unreachable!("read worker receives only target and list requests"),
    }
}

#[derive(Clone)]
struct Target {
    label: String,
    input: Value,
}

struct Form {
    command: Editor,
    saved: Option<Value>,
    targets: Vec<Target>,
    selected: usize,
    member: Option<(String, Option<String>, String)>,
    observing: bool,
    talk: Option<super::app::Input>,
    history: Option<usize>,
}

enum Page {
    Form(Box<Form>),
    Running {
        command: String,
        cwd: String,
        started: Instant,
        stopping: bool,
    },
    Finished {
        result: Value,
        keeping: bool,
    },
    Saved(Value),
    Remove {
        row: SavedRow,
    },
    Refused(String),
}

#[derive(Default)]
pub(super) struct Controller {
    pub(super) launch_directory: Option<String>,
    enabled: bool,
    saved_generation: u64,
    pub(super) saved_rows: Vec<SavedRow>,
    pub(super) local_folded: bool,
    pub(super) refresh_due: bool,
    pub(super) list_pending: bool,
    list_unsupported: bool,
    list_supported: bool,
    pub(super) shell: Option<(String, String, super::terminal_tab::discovery::Address)>,
    moving: Option<Moving>,
    pending: bool,
    page: Option<Page>,
    shown: bool,
    history: Vec<String>,
    request: Option<Value>,
    run_label: String,
    preview: Option<saved::Preview>,
    preview_pending: Option<(String, u64)>,
    dialog: Option<DialogState>,
    hits: RefCell<DialogHits>,
    scroll: usize,
    scroll_end: std::cell::Cell<usize>,
    live_viewport: std::cell::Cell<(u16, u16)>,
    follow_output: bool,
    live: Vec<OutputLine>,
    live_partial: bool,
    run_id: u64,
    target_generation: u64,
    run_draft: Option<super::app::Input>,
    run_recipient: Option<RunRecipient>,
    result_send: ResultSend,
    elapsed: std::cell::Cell<u64>,
    notice: Option<String>,
}

struct RunRecipient {
    draft: super::app::Input,
    button: String,
}

#[derive(Clone)]
struct OutputLine {
    text: String,
    stderr: bool,
}

#[derive(Default, PartialEq, Eq)]
enum ResultSend {
    #[default]
    Ready,
    Sending,
    Resolved,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ResultButton {
    Send,
    Again,
    Edit,
    Keep,
}

#[derive(Clone, Copy)]
enum OutputScroll {
    Lines(isize),
    Page(isize),
    Start,
    End,
}

const MAX_COMMAND: usize = tmt_pty_protocol::COMMAND_LIMIT;
const OUTPUT_LEFT_PADDING: u16 = 1;
const COMMAND_FIELD: &[FieldKind] = &[FieldKind::Text];
const LEGACY_OUTPUT: &str = "Live output needs a newer tmt.";

impl Controller {
    pub(super) fn start(&mut self, launch_directory: Option<String>) {
        self.launch_directory = launch_directory;
        self.enabled = true;
        self.refresh_due = true;
    }

    pub(in crate::board) fn tick(&self, now: Instant) -> bool {
        let Some(Page::Running { started, .. }) = &self.page else {
            return false;
        };
        let seconds = now.saturating_duration_since(*started).as_secs();
        self.shown && self.elapsed.replace(seconds) != seconds
    }

    pub(super) fn invalidate(&self) {
        self.hits.replace(DialogHits::default());
    }

    pub(super) fn outer(&self) -> Rect {
        self.hits.borrow().outer
    }

    pub(super) fn shown(&self) -> bool {
        self.shown
    }

    pub(super) fn editing(&self) -> bool {
        matches!(self.page, Some(Page::Form(_)))
    }

    pub(super) fn running(&self) -> bool {
        matches!(self.page, Some(Page::Running { .. }))
    }

    pub(super) fn stop(&mut self) -> Effect {
        if let Some(Page::Running { stopping, .. }) = &mut self.page
            && !*stopping
        {
            *stopping = true;
            return Effect::Standalone(Task::Stop);
        }
        Effect::None
    }

    pub(super) fn result_sent(&mut self, run: u64, notice: &str) {
        if self.run_id == run && self.result_send == ResultSend::Sending {
            // A worker error can represent an ambiguous delivery even without a receipt.
            // This result remains resolved so a second press cannot resend it.
            self.result_send = ResultSend::Resolved;
            self.notice = Some(notice.into());
        }
    }

    fn local_target(&self) -> Option<Target> {
        self.launch_directory.as_ref().map(|cwd| Target {
            label: "Local".into(),
            input: json!({"kind":"local","cwd":cwd}),
        })
    }

    fn open_form(
        &mut self,
        member: Option<(String, Option<String>, String)>,
        command: Editor,
        talk: Option<super::app::Input>,
    ) -> Effect {
        self.target_generation = self.target_generation.wrapping_add(1);
        let effect = member.as_ref().map_or(Effect::None, |(identity, _, _)| {
            Effect::Standalone(Task::Target(self.target_generation, identity.clone()))
        });
        let targets = if talk.is_none() {
            self.local_target().into_iter().collect()
        } else {
            Vec::new()
        };
        self.show(Page::Form(Box::new(Form {
            saved: None,
            command,
            targets,
            selected: 0,
            observing: member.is_some(),
            member,
            talk,
            history: None,
        })));
        effect
    }

    fn edit_result(&mut self) -> Effect {
        let Some(mut request) = self.request.take() else {
            return Effect::None;
        };
        let input = request["target"].take();
        let command = Editor::from(request["command"].as_str().unwrap_or_default());
        let mut targets = vec![Target {
            label: self.run_label.clone(),
            input,
        }];
        if let Some(local) = self.local_target()
            && targets[0].input != local.input
        {
            targets.push(local);
        }
        self.show(Page::Form(Box::new(Form {
            command,
            saved: None,
            targets,
            selected: 0,
            member: None,
            observing: false,
            talk: None,
            history: None,
        })));
        Effect::Standalone(Task::Discard)
    }

    fn show(&mut self, page: Page) {
        self.page = Some(page);
        self.shown = true;
        self.scroll = 0;
        self.scroll_end.set(0);
        self.live_viewport.set((0, 0));
        self.follow_output = false;
        self.live.clear();
        self.live_partial = false;
        self.notice = None;
        self.hits.replace(DialogHits::default());
        let (dialog, fields) = self.presentation();
        self.dialog = Some(DialogState::new(fields, &dialog.buttons));
    }

    pub(super) fn close(&mut self) -> Effect {
        if self.pending {
            return Effect::None;
        }
        match &self.page {
            Some(Page::Running { .. }) => {
                self.shown = false;
                Effect::None
            }
            Some(Page::Finished { keeping: true, .. }) => Effect::None,
            Some(Page::Finished { .. }) if self.result_send == ResultSend::Sending => Effect::None,
            _ => {
                self.shown = false;
                self.page = None;
                self.run_recipient = None;
                if self.request.take().is_some() {
                    Effect::Standalone(Task::Discard)
                } else {
                    Effect::None
                }
            }
        }
    }

    fn run(&mut self, request: Value, command: String, cwd: String) -> Effect {
        self.result_send = ResultSend::Ready;
        self.request = Some(request.clone());
        self.elapsed.set(0);
        self.show(Page::Running {
            command,
            cwd,
            started: Instant::now(),
            stopping: false,
        });
        self.run_id = self.run_id.wrapping_add(1);
        self.follow_output = true;
        Effect::Standalone(Task::Run(self.run_id, request))
    }

    fn progress(&mut self, run: u64, text: &str, stderr: bool, legacy: bool) {
        if self.run_id != run || !self.running() {
            return;
        }
        for chunk in text.split_inclusive('\n') {
            if self.live_partial && self.live.last().is_some_and(|line| line.stderr == stderr) {
                self.live
                    .last_mut()
                    .unwrap()
                    .text
                    .push_str(chunk.trim_end_matches('\n'));
            } else {
                self.live.push(OutputLine {
                    text: chunk.trim_end_matches('\n').into(),
                    stderr,
                });
            }
            self.live_partial = !chunk.ends_with('\n');
        }
        if legacy {
            self.notice = Some(LEGACY_OUTPUT.into());
        }
    }

    fn output_page(&self) -> bool {
        matches!(
            self.page,
            Some(Page::Running { .. } | Page::Finished { .. } | Page::Saved(_))
        )
    }

    fn scroll_output(&mut self, key: OutputScroll) {
        let running = self.running();
        let (width, height) = self.live_viewport.get();
        let end = if running {
            wrapped_rows(&self.live, width)
                .len()
                .saturating_sub(height as usize)
        } else {
            self.scroll_end.get()
        };
        let start = if self.follow_output {
            end
        } else {
            self.scroll.min(end)
        };
        self.scroll = match key {
            OutputScroll::Lines(step) => start.saturating_add_signed(step).min(end),
            OutputScroll::Page(direction) => start
                .saturating_add_signed(direction * (height.max(1) as isize))
                .min(end),
            OutputScroll::Start => 0,
            OutputScroll::End => end,
        };
        if end != 0 || matches!(key, OutputScroll::Start | OutputScroll::End) {
            self.follow_output =
                running && self.scroll == end && !matches!(key, OutputScroll::Start);
        }
    }

    fn result_buttons(&self) -> &'static [ResultButton] {
        use ResultButton::*;
        if self.run_recipient.is_some() {
            &[Send, Again, Edit, Keep]
        } else {
            &[Keep, Again, Edit]
        }
    }

    fn choose(&mut self, index: usize) -> Effect {
        let index = if matches!(self.page, Some(Page::Finished { .. })) {
            if self.result_send == ResultSend::Sending {
                return Effect::None;
            }
            match self.result_buttons().get(index) {
                Some(ResultButton::Keep) => 0,
                Some(ResultButton::Again) => 1,
                Some(ResultButton::Edit) => 3,
                _ => return Effect::None,
            }
        } else {
            index
        };
        match (&mut self.page, index) {
            (Some(Page::Form(form)), 0) => {
                let command = form.command.as_str().to_owned();
                let Some(target) = form.targets.get(form.selected) else {
                    return Effect::None;
                };
                if form.observing || !tmt_pty_protocol::valid_command(&command) {
                    return Effect::None;
                }
                let cwd = target.input["cwd"].as_str().unwrap_or_default().to_owned();
                let request = form
                    .saved
                    .clone()
                    .unwrap_or_else(|| json!({"target":target.input,"command":command}));
                self.run_label.clone_from(&target.label);
                self.history.retain(|previous| previous != &command);
                self.history.insert(0, command.clone());
                self.history.truncate(32);
                self.run_draft = form.talk.take();
                if let Some(draft) = &self.run_draft {
                    self.run_recipient = Some(RunRecipient {
                        button: format!(
                            "➤ Send to {}",
                            super::notes::single_line(
                                &draft.row_send.as_ref().expect("admitted Talk draft").name,
                            )
                        ),
                        draft: draft.clone(),
                    });
                } else if target.input["kind"] != "member"
                    || self
                        .run_recipient
                        .as_ref()
                        .and_then(|recipient| recipient.draft.draft_key.as_ref())
                        .is_some_and(|(_, member)| {
                            target.input["identityId"].as_str() != Some(member)
                        })
                {
                    self.run_recipient = None;
                }
                self.run(request, command, cwd)
            }
            (Some(Page::Running { .. }), 1) => self.stop(),
            (Some(Page::Finished { result, keeping }), 0) if !*keeping => {
                if let Some(run_id) = result["runId"].as_str() {
                    *keeping = true;
                    Effect::Standalone(Task::Keep(run_id.to_owned()))
                } else {
                    Effect::None
                }
            }
            (
                Some(Page::Finished {
                    result,
                    keeping: false,
                }),
                1,
            ) => {
                let command = result["command"].as_str().unwrap_or_default().to_owned();
                let cwd = result["cwd"].as_str().unwrap_or_default().to_owned();
                self.request
                    .clone()
                    .map_or(Effect::None, |request| self.run(request, command, cwd))
            }
            (Some(Page::Finished { keeping: false, .. }), 3) => {
                if self
                    .request
                    .as_ref()
                    .is_some_and(|request| request["command"].is_string())
                {
                    self.edit_result()
                } else {
                    Effect::None
                }
            }
            (Some(Page::Remove { row }), 1) if !self.pending => {
                self.pending = true;
                Effect::Standalone(Task::Saved(SavedTask::Remove(row.clone(), true)))
            }
            _ => self.close(),
        }
    }

    fn input(&mut self, event: &Event) -> DialogInput {
        if let Some(Page::Form(form)) = &mut self.page
            && form.saved.is_none()
            && form.talk.is_none()
        {
            match event {
                Event::Key(key) if key.modifiers.is_empty() && key.code == KeyCode::Tab => {
                    if !form.targets.is_empty() {
                        form.selected = if form.selected + 1 < form.targets.len() {
                            form.selected + 1
                        } else {
                            0
                        };
                    }
                    return DialogInput::Ignored;
                }
                Event::Key(key) if key.modifiers.is_empty() && key.code == KeyCode::Up => {
                    let index = form.history.map_or(0, |last| last + 1);
                    if let Some(command) = self.history.get(index) {
                        form.history = Some(index);
                        form.command = Editor::from(command.as_str());
                    }
                    return DialogInput::Ignored;
                }
                Event::Paste(text) => {
                    if tmt_pty_protocol::valid_command(text) {
                        if !form.command.insert(text, MAX_COMMAND) {
                            self.notice = Some("The command is too long.".into());
                        }
                    } else {
                        self.notice = Some("Paste one command without control characters.".into());
                    }
                    return DialogInput::Ignored;
                }
                _ => {}
            }
        }
        if let Event::Key(key) = event {
            if key.modifiers.is_empty() && matches!(self.page, Some(Page::Finished { .. })) {
                let button = match key.code {
                    KeyCode::Char('s') => Some(ResultButton::Send),
                    KeyCode::Char('k') => Some(ResultButton::Keep),
                    KeyCode::Char('r') => Some(ResultButton::Again),
                    KeyCode::Char('e') => Some(ResultButton::Edit),
                    _ => None,
                };
                if let Some(button) = button {
                    return self
                        .result_buttons()
                        .iter()
                        .position(|item| *item == button)
                        .map_or(DialogInput::Ignored, DialogInput::Choose);
                }
            }
            if self.output_page() && key.modifiers.is_empty() {
                let scroll = match key.code {
                    KeyCode::Up => Some(OutputScroll::Lines(-1)),
                    KeyCode::Down => Some(OutputScroll::Lines(1)),
                    KeyCode::PageUp => Some(OutputScroll::Page(-1)),
                    KeyCode::PageDown => Some(OutputScroll::Page(1)),
                    KeyCode::Home => Some(OutputScroll::Start),
                    KeyCode::End => Some(OutputScroll::End),
                    _ => None,
                };
                if let Some(scroll) = scroll {
                    self.scroll_output(scroll);
                    return DialogInput::Ignored;
                }
            }
        }
        if let Event::Mouse(mouse) = event
            && self.output_page()
        {
            use ratatui::crossterm::event::MouseEventKind;
            let step = match mouse.kind {
                MouseEventKind::ScrollUp => -3,
                MouseEventKind::ScrollDown => 3,
                _ => 0,
            };
            if step != 0 {
                if self
                    .hits
                    .borrow()
                    .content
                    .contains((mouse.column, mouse.row).into())
                {
                    self.scroll_output(OutputScroll::Lines(step));
                }
                return DialogInput::Ignored;
            }
        }
        let mut state = self.dialog.take().expect("shown dialog owns state");
        let (dialog, fields) = self.presentation();
        let input = match event {
            Event::Key(key) => state.key(dialog.kind, key, fields, &dialog.buttons),
            Event::Mouse(mouse) if !self.hits.borrow().outer.is_empty() => {
                state.mouse(mouse, &self.hits.borrow(), &dialog.buttons)
            }
            _ => DialogInput::Ignored,
        };
        drop(dialog);
        self.dialog = Some(state);
        if let DialogInput::Field(_, key) = input {
            if let Some(Page::Form(form)) = &mut self.page
                && form.talk.is_none()
            {
                let width = self.hits.borrow().content.width.saturating_sub(2).max(1);
                form.command.key(key, width, MAX_COMMAND);
            }
            return DialogInput::Ignored;
        }
        input
    }

    fn presentation(&self) -> (Dialog<'_>, &'static [FieldKind]) {
        let (title, kind, buttons, hints, fields) = match &self.page {
            Some(Page::Form(form)) => (
                "Run command",
                DialogKind::Form,
                vec![
                    Button::primary("Run").enabled(
                        !form.observing
                            && form.targets.get(form.selected).is_some()
                            && tmt_pty_protocol::valid_command(form.command.as_str()),
                    ),
                    Button::secondary("Cancel"),
                ],
                if form.saved.is_some() {
                    "⏎ run · Esc cancel"
                } else {
                    "↑ history · Tab where · ⏎ run"
                },
                if form.saved.is_some() {
                    &[][..]
                } else {
                    COMMAND_FIELD
                },
            ),
            Some(Page::Running { stopping, .. }) => (
                "",
                DialogKind::Confirm,
                vec![
                    Button::primary("Hide"),
                    Button::secondary("Stop").enabled(!stopping),
                ],
                "^C stop · Esc hide, keeps running",
                &[][..],
            ),
            Some(Page::Finished { result, keeping }) => {
                let idle = !keeping && self.result_send != ResultSend::Sending;
                let buttons = self
                    .result_buttons()
                    .iter()
                    .map(|action| match action {
                        ResultButton::Send => {
                            Button::primary(&self.run_recipient.as_ref().unwrap().button)
                                .enabled(idle && self.result_send == ResultSend::Ready)
                        }
                        ResultButton::Again => Button::secondary("Run again").enabled(idle),
                        ResultButton::Edit => Button::secondary("Edit").enabled(
                            idle && self
                                .request
                                .as_ref()
                                .is_some_and(|request| request["command"].is_string()),
                        ),
                        ResultButton::Keep if self.run_recipient.is_some() => {
                            Button::secondary("Keep").enabled(idle && result["runId"].is_string())
                        }
                        ResultButton::Keep => Button::primary("Keep in list")
                            .enabled(idle && result["runId"].is_string()),
                    })
                    .collect();
                ("", DialogKind::Confirm, buttons, "", &[][..])
            }
            Some(Page::Remove { .. }) => (
                "Remove saved terminal",
                DialogKind::Confirm,
                vec![
                    Button::primary("Cancel").enabled(!self.pending),
                    Button::secondary("Close shell and remove")
                        .destructive(true)
                        .enabled(!self.pending),
                ],
                "Esc cancel",
                &[][..],
            ),
            _ => (
                "Command result",
                DialogKind::Confirm,
                vec![Button::primary("Close")],
                "Esc close",
                &[][..],
            ),
        };
        let title = if self.output_page() {
            String::new()
        } else {
            title.into()
        };
        (
            Dialog {
                title,
                kind,
                placement: Placement::Center,
                buttons,
                hints: hints.into(),
            },
            fields,
        )
    }

    pub(super) fn render(&self, frame: &mut Frame, app: &App, body: Rect) {
        let (dialog, _) = self.presentation();
        let state = self.dialog.as_ref().expect("shown dialog owns state");
        let look = app.look();
        let status = self.notice.is_some();
        let form = self.editing();
        let rows = self.lines();
        let output = self.output_page();
        let width = (u32::from(body.width) * 3 / 4).clamp(76, 118) as u16;
        let mut area = if output {
            dialog.areas(body, [width.max(dialog.footer_width()), u16::MAX], status)
        } else {
            dialog.areas(
                body,
                [
                    dialog.footer_width().max(76),
                    rows.len().min(14) as u16 + if form { 3 } else { 4 } + u16::from(status),
                ],
                status,
            )
        };
        let live;
        let output_rows = if output {
            let lines = match &self.page {
                Some(Page::Running { .. }) => &self.live,
                Some(Page::Finished { result, .. } | Page::Saved(result)) => {
                    live = captured_output(result);
                    &live
                }
                _ => unreachable!("output page"),
            };
            let output_rows = wrapped_rows(lines, area.content.width);
            let demand = output_rows
                .len()
                .max(1)
                .saturating_add(5 + usize::from(status));
            area = dialog.areas(
                body,
                [
                    width.max(dialog.footer_width()),
                    demand.min(u16::MAX as usize) as u16,
                ],
                status,
            );
            output_rows
        } else {
            Vec::new()
        };
        let mut hits = super::buttons::paint_dialog(
            app,
            frame.buffer_mut(),
            &dialog,
            area,
            state,
            Overlay::Standalone,
        );
        let finished = matches!(self.page, Some(Page::Finished { .. }));
        if form {
            // The position row above the buttons carries content on these pages.
            hits.content.height += area.position.height;
        }
        if finished {
            let button_end = hits
                .buttons
                .iter()
                .flatten()
                .map(|rect| rect.right())
                .max()
                .unwrap_or(area.footer.x);
            let available = area
                .footer
                .right()
                .saturating_sub(button_end)
                .saturating_sub(2);
            if let Some(hint) = result_hints_that_fit(self.run_recipient.is_some(), available) {
                strip::paint_right(
                    frame.buffer_mut(),
                    area.footer,
                    Line::styled(hint, look.role(tmt_cli_style::Role::Dim)),
                );
            }
        }
        if output {
            self.paint_output(frame, app, area, &mut hits, &output_rows);
        }
        let content = hits.content;
        let role = look.role(Role::Text);
        for (index, line) in rows.into_iter().take(content.height as usize).enumerate() {
            let rect = Rect::new(content.x, content.y + index as u16, content.width, 1);
            strip::paint_left(
                frame.buffer_mut(),
                rect,
                Line::styled(super::view::fit(&line, rect.width as usize), role),
            );
            if index == 0
                && let Some(Page::Form(form)) = &self.page
                && form.saved.is_none()
            {
                let prefix = 2.min(rect.width);
                let input = Rect::new(rect.x + prefix, rect.y, rect.width - prefix, 1);
                hits.fields.push(input);
                if !input.is_empty()
                    && (form.command.as_str().is_empty()
                        || tmt_pty_protocol::valid_command(form.command.as_str()))
                {
                    let layout = form.command.layout(input.width);
                    let offset = layout.reveal(0, 1);
                    if let Some(cursor) = layout.paint(
                        frame.buffer_mut(),
                        input,
                        offset,
                        form.command.selection(),
                        look.role(tmt_cli_style::Role::Accent),
                        look.selection(),
                    ) && state.focus == tmt_tui::components::Focus::Field(0)
                    {
                        frame.set_cursor_position(cursor);
                    }
                }
            }
        }
        if let Some(notice) = &self.notice {
            let status = area.status;
            strip::paint_left(
                frame.buffer_mut(),
                status,
                Line::styled(super::view::fit(notice, status.width as usize), role),
            );
        }
        self.hits.replace(hits);
    }

    fn paint_output(
        &self,
        frame: &mut Frame,
        app: &App,
        area: tmt_tui::components::ModalAreas,
        hits: &mut DialogHits,
        rows: &[OutputLine],
    ) {
        let look = app.look();
        let (command, target, status, role) = match &self.page {
            Some(Page::Running {
                command,
                cwd,
                stopping,
                ..
            }) => {
                let elapsed = self.elapsed.get();
                let state = if *stopping { "stopping" } else { "running" };
                (
                    command.as_str(),
                    target_line(&self.run_label, cwd),
                    format!("⠋ {state} {}:{:02}", elapsed / 60, elapsed % 60),
                    Role::Waiting,
                )
            }
            Some(Page::Finished { result, .. } | Page::Saved(result)) => (
                result["command"].as_str().unwrap_or_default(),
                target_line(
                    if matches!(self.page, Some(Page::Saved(_))) {
                        ""
                    } else {
                        &self.run_label
                    },
                    result["cwd"].as_str().unwrap_or_default(),
                ),
                result_status(result),
                if result["exitCode"] == 0 && result["timedOut"] != true {
                    Role::Working
                } else {
                    Role::Blocked
                },
            ),
            _ => unreachable!("output page"),
        };
        let title = Rect::new(
            area.outer.x.saturating_add(1),
            area.outer.y,
            area.outer.width.saturating_sub(2),
            u16::from(area.outer.height > 0),
        );
        let (mark, status) = status.split_once(' ').unwrap_or(("", &status));
        let status = format!(" {status} ");
        let left_width = title.width.saturating_sub(status.width() as u16);
        let left = Rect {
            width: left_width,
            ..title
        };
        strip::paint_left(
            frame.buffer_mut(),
            left,
            Line::from(vec![
                Span::styled(format!(" {mark} "), look.role(role)),
                Span::styled("! ", look.role(Role::Accent)),
                Span::styled(
                    super::view::fit(
                        &format!("{} ", super::notes::single_line(command)),
                        left_width.saturating_sub(mark.width() as u16 + 4) as usize,
                    ),
                    look.role(Role::Code),
                ),
            ]),
        );
        let right = Rect {
            x: title.x + left_width,
            width: title.width - left_width,
            ..title
        };
        strip::paint_right(
            frame.buffer_mut(),
            right,
            Line::styled(
                super::view::fit(&status, right.width as usize),
                look.role(role),
            ),
        );

        let mut content = hits.content;
        if content.height > 0 {
            strip::paint_left(
                frame.buffer_mut(),
                Rect {
                    height: 1,
                    ..content
                },
                Line::styled(
                    super::view::fit(&target, content.width as usize),
                    look.role(Role::Muted),
                ),
            );
            content.y += 1;
            content.height -= 1;
        }
        hits.content = content;
        self.live_viewport.set((content.width, content.height));
        let end = rows.len().saturating_sub(content.height as usize);
        let start = if self.follow_output {
            end
        } else {
            self.scroll.min(end)
        };
        self.scroll_end.set(end);
        for (index, row) in rows
            .iter()
            .skip(start)
            .take(content.height as usize)
            .enumerate()
        {
            let rect = Rect::new(content.x, content.y + index as u16, content.width, 1);
            let style = look
                .role(if row.stderr {
                    Role::Blocked
                } else {
                    Role::Code
                })
                .patch(look.role(Role::Track));
            frame.buffer_mut().set_style(rect, style);
            strip::paint_left(
                frame.buffer_mut(),
                output_text_area(rect),
                Line::styled(&row.text, style),
            );
        }
        if rows.is_empty() && content.height > 0 {
            let style = look.role(Role::Muted).patch(look.role(Role::Track));
            let rect = Rect {
                height: 1,
                ..content
            };
            frame.buffer_mut().set_style(rect, style);
            strip::paint_left(
                frame.buffer_mut(),
                output_text_area(rect),
                Line::styled("No output.", style),
            );
        }
        let shown = rows.len().min(start + content.height as usize);
        let units = if rows.len() == 1 { "line" } else { "lines" };
        let count = format!("{} {units}", rows.len());
        let position = if shown == start {
            count
        } else if end == 0 {
            format!("{count} · showing 1–{shown}")
        } else {
            format!("{count} · showing {}–{shown} · ↑↓ scroll", start + 1)
        };
        strip::paint_left(
            frame.buffer_mut(),
            area.position,
            Line::styled(
                super::view::fit(&position, area.position.width as usize),
                look.role(Role::Dim),
            ),
        );
    }

    fn lines(&self) -> Vec<String> {
        match &self.page {
            Some(Page::Form(form)) => {
                let target = form.targets.get(form.selected);
                vec![
                    command_title(form.command.as_str()),
                    if form.observing {
                        "In  Resolving member directory…".into()
                    } else {
                        target.map_or_else(
                            || {
                                if form.targets.is_empty() {
                                    "In  No local directory".into()
                                } else {
                                    "In  Choose a place with Tab".into()
                                }
                            },
                            |target| {
                                let suffix = if form.saved.is_none() { "  ▾" } else { "" };
                                format!(
                                    "In  {}{suffix}",
                                    target_line(
                                        &target.label,
                                        target.input["cwd"].as_str().unwrap_or_default()
                                    )
                                )
                            },
                        )
                    },
                ]
            }
            Some(Page::Running { .. } | Page::Finished { .. } | Page::Saved(_)) => Vec::new(),
            Some(Page::Remove { row }) => vec![
                format!("The shell for {} is busy.", row.command),
                "Close the shell and remove the saved result?".into(),
            ],
            Some(Page::Refused(message)) => super::notes::sanitize(message)
                .lines()
                .map(str::to_owned)
                .collect(),
            None => Vec::new(),
        }
    }
}

fn result_hints_that_fit(talk: bool, width: u16) -> Option<&'static str> {
    if talk {
        return [
            "s send · k keep · r run again · e edit · Esc close",
            "s send · Esc close",
            "s send",
        ]
        .into_iter()
        .find(|hint| hint.width() <= usize::from(width));
    }
    let mut hints = "k keep · r run again · e edit · Esc close";
    while hints.width() > usize::from(width) {
        hints = hints.split_once(" · ")?.1;
    }
    Some(hints)
}

fn output_text_area(area: Rect) -> Rect {
    let left = OUTPUT_LEFT_PADDING.min(area.width);
    Rect {
        x: area.x + left,
        width: area.width - left,
        ..area
    }
}

fn wrapped_rows(lines: &[OutputLine], width: u16) -> Vec<OutputLine> {
    let text_width = width.saturating_sub(OUTPUT_LEFT_PADDING).max(1);
    lines
        .iter()
        .flat_map(|line| {
            let shown = line.labelled();
            let rows = tmt_tui::text::lines(&shown, text_width, tmt_tui::style::TextFlow::Wrap);
            rows.into_iter().map(|text| OutputLine {
                text,
                stderr: line.stderr,
            })
        })
        .collect()
}

fn command_title(command: &str) -> String {
    format!("! {}", super::notes::single_line(command))
}

fn target_line(label: &str, cwd: &str) -> String {
    let cwd = super::notes::single_line(cwd);
    if label.is_empty() {
        cwd
    } else {
        format!("{label} · {cwd}")
    }
}

fn result_status(result: &Value) -> String {
    let mut status = if result["timedOut"] == true {
        "✗ timed out".into()
    } else if let Some(code) = result["exitCode"].as_i64() {
        let mark = if code == 0 { "✓" } else { "✗" };
        format!("{mark} exited {code}")
    } else if let Some(signal) = result["signal"].as_i64() {
        format!("✗ ended by signal {signal}")
    } else if result["truncated"] == true {
        "✗ output truncated".into()
    } else {
        "✗ exit status unavailable".into()
    };
    if let (Some(start), Some(end)) = (result["startedMs"].as_u64(), result["endedMs"].as_u64()) {
        status.push_str(&format!(" · {}s", end.saturating_sub(start) / 1000));
    }
    if result["truncated"] == true && !status.contains("truncated") {
        status.push_str(" · output truncated");
    }
    status
}

impl OutputLine {
    fn labelled(&self) -> String {
        if self.stderr {
            format!("stderr · {}", self.text)
        } else {
            self.text.clone()
        }
    }
}

fn captured_output(result: &Value) -> Vec<OutputLine> {
    [("stdout", false), ("stderr", true)]
        .into_iter()
        .flat_map(|(stream, stderr)| {
            super::notes::sanitize(result[stream].as_str().unwrap_or_default())
                .lines()
                .map(|text| OutputLine {
                    text: text.into(),
                    stderr,
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

fn output_lines(result: &Value) -> Vec<String> {
    captured_output(result)
        .iter()
        .map(OutputLine::labelled)
        .collect()
}

fn result_message(command: &str, result: &Value, limit: usize) -> Option<String> {
    let command = command_title(command);
    let status = result_status(result);
    let lines = output_lines(result);
    let mut bytes = 0;
    let mut longest_tildes = 0;
    let mut longest_ticks = 0;
    let mut retained = None;
    for keep in 0..=lines.len().min(200) {
        let omitted = lines.len() - keep;
        if keep > 0 {
            let line = &lines[omitted];
            bytes += line.len() + usize::from(keep > 1);
            longest_tildes = longest_tildes.max(longest_run(line, '~'));
            longest_ticks = longest_ticks.max(longest_run(line, '`'));
        }
        let (token, longest) = if longest_ticks <= longest_tildes {
            ("`", longest_ticks)
        } else {
            ("~", longest_tildes)
        };
        let fence_len = 3.max(longest + 1);
        let omission = if omitted == 0 {
            String::new()
        } else {
            format!("\n({omitted} earlier lines omitted)")
        };
        if command.len() + status.len() + omission.len() + bytes + 2 * fence_len + 5 <= limit {
            retained = Some((omitted, token, fence_len, omission));
        }
    }
    let (omitted, token, fence_len, omission) = retained?;
    let body = lines[omitted..].join("\n");
    let fence = token.repeat(fence_len);
    Some(format!(
        "{command}\n{status}{omission}\n\n{fence}\n{body}\n{fence}"
    ))
}

fn longest_run(text: &str, token: char) -> usize {
    let mut longest = 0;
    let mut current = 0;
    for ch in text.chars() {
        if ch == token {
            current += 1;
            longest = longest.max(current);
        } else {
            current = 0;
        }
    }
    longest
}

impl App {
    pub(super) fn open_standalone(&mut self) -> Effect {
        if self.standalone.pending {
            return Effect::None;
        }
        if self.standalone.page.is_some() {
            self.standalone.shown = true;
            return Effect::None;
        }
        let member = match self.workspace_selected_member() {
            Some(super::workspace::OpsTarget::Member {
                identity_id,
                room_id,
            }) => {
                let label = self
                    .workspace_rows()
                    .iter()
                    .find(|row| self.workspace.selected.as_ref() == Some(&row.target))
                    .map_or_else(|| "Member".into(), |row| row.title.clone());
                Some((identity_id.clone(), room_id.clone(), label))
            }
            _ => None,
        };
        self.open_run_form(member, Editor::default(), None)
    }

    pub(super) fn standalone_event(&mut self, event: &Event) -> Effect {
        match self.standalone.input(event) {
            DialogInput::Choose(index)
                if matches!(self.standalone.page, Some(Page::Finished { .. }))
                    && self.standalone.result_buttons().get(index) == Some(&ResultButton::Send) =>
            {
                self.send_run_result()
            }
            DialogInput::Choose(index) => self.standalone.choose(index),
            DialogInput::Cancel => self.standalone.close(),
            _ => Effect::None,
        }
    }

    fn send_run_result(&mut self) -> Effect {
        let Some(Page::Finished {
            result,
            keeping: false,
        }) = &self.standalone.page
        else {
            return Effect::None;
        };
        if self.standalone.result_send != ResultSend::Ready || self.in_flight > 0 {
            return Effect::None;
        }
        let Some(mut draft) = self
            .standalone
            .run_recipient
            .as_ref()
            .map(|recipient| recipient.draft.clone())
        else {
            return Effect::None;
        };
        let Some(send) = draft
            .row_send
            .as_ref()
            .filter(|send| send.valid(self, &draft))
        else {
            return self.say("The original Talk member or sender changed; nothing sent.");
        };
        let Some((sender, recipient)) = draft.draft_key.clone() else {
            return Effect::None;
        };
        let name = send.name.clone();
        let overhead = crate::requests::message::tag(&draft.squad, &name).len();
        let limit = super::app::MESSAGE_LIMIT.saturating_sub(overhead);
        let Some(command) = self
            .standalone
            .request
            .as_ref()
            .and_then(|request| request["command"].as_str())
        else {
            return self.say("The command is unavailable; nothing sent.");
        };
        let Some(text) = result_message(command, result, limit) else {
            return self.say("The command result exceeds the Talk message limit; nothing sent.");
        };
        let fallback =
            crate::requests::message::inline_body(Some((&draft.squad, &name)), &text, false);
        draft.keep_reply = false;
        self.standalone.result_send = ResultSend::Sending;
        self.standalone.notice = Some("Sending result…".into());
        self.begin_outgoing_for(&draft, &text, Some(self.standalone.run_id));
        Effect::Act(Request::Chat {
            sender,
            recipient,
            name,
            text,
            fallback,
            keep_reply: false,
        })
    }

    pub(super) fn open_talk_run(&mut self, command: &str, draft: super::app::Input) -> Effect {
        let Some((_, identity)) = draft.draft_key.as_ref() else {
            return self.say("Select a member; nothing was run.");
        };
        let room = match draft.target() {
            Some(super::app::RowTarget::Workspace(super::workspace::OpsTarget::Member {
                room_id,
                ..
            })) => room_id.clone(),
            _ => None,
        };
        let label = draft
            .row_send
            .as_ref()
            .expect("admitted Talk draft")
            .name
            .clone();
        let member = (identity.clone(), room, label);
        self.open_prefilled_run(member, command, Some(draft))
    }

    pub(super) fn open_prefilled_run(
        &mut self,
        member: (String, Option<String>, String),
        command: &str,
        talk: Option<super::app::Input>,
    ) -> Effect {
        if self.standalone.pending || self.standalone.page.is_some() {
            return self.say("Open or close the current command result first. Nothing was run.");
        }
        self.open_run_form(Some(member), Editor::from(command), talk)
    }

    fn open_run_form(
        &mut self,
        member: Option<(String, Option<String>, String)>,
        command: Editor,
        talk: Option<super::app::Input>,
    ) -> Effect {
        let offline = member.as_ref().is_some_and(|(identity, _, _)| {
            self.workspace_snapshot()
                .and_then(|snapshot| snapshot.roster.members.get(identity))
                .is_some_and(|member| member.presence == Some(false))
        });
        self.standalone.run_recipient = None;
        let effect = self.standalone.open_form(member, command, talk);
        if offline && let Effect::Standalone(Task::Target(generation, identity)) = effect {
            return self.standalone_completed(Completed::Target(
                generation,
                identity,
                Err(SquadError::new(
                    "SHELL_RUN_UNAVAILABLE",
                    "No live terminal.",
                )),
            ));
        }
        effect
    }

    fn same_talk_run_draft(&self, draft: &super::app::Input) -> bool {
        self.input.as_ref().is_some_and(|input| {
            input.draft_key == draft.draft_key
                && input.text == draft.text
                && input.inline_quotes == draft.inline_quotes
                && self.draft_identity(input) == draft.draft_key
                && draft
                    .row_send
                    .as_ref()
                    .is_some_and(|send| send.valid(self, input))
        })
    }

    pub(super) fn standalone_completed(&mut self, completed: Completed) -> Effect {
        match completed {
            Completed::Target(generation, identity, result) => {
                if generation != self.standalone.target_generation {
                    return Effect::None;
                }
                let Some(Page::Form(form)) = &mut self.standalone.page else {
                    return Effect::None;
                };
                let Some((id, room, label)) = &form.member else {
                    return Effect::None;
                };
                if *id != identity || !form.observing {
                    return Effect::None;
                }
                let label = label.clone();
                form.observing = false;
                match result {
                    Ok(mut input) => {
                        input["kind"] = "member".into();
                        input["identityId"] = json!(identity);
                        input["roomId"] = json!(room);
                        form.targets.insert(0, Target { label, input });
                        form.selected = 0;
                        let talk = form.talk.clone();
                        if let Some(draft) = talk {
                            if self.same_talk_run_draft(&draft) {
                                return self.standalone.choose(0);
                            }
                            self.standalone.close();
                            return self.say(
                                "The member or draft changed; nothing was run. Draft retained.",
                            );
                        }
                    }
                    Err(error) => {
                        let message = if form.talk.is_some() {
                            format!("{label}: {} Draft retained.", error.message)
                        } else if error.code == "SHELL_RUN_UNAVAILABLE" {
                            format!("{label}: no live terminal directory · Tab choose a place")
                        } else {
                            format!("{label}: {} Choose another place with Tab.", error.message)
                        };
                        if form.talk.is_some() {
                            self.standalone.close();
                            return self.say(message);
                        }
                        form.selected = form.targets.len();
                        self.standalone.notice = Some(message);
                    }
                }
            }
            Completed::Saved(task, result) => self.saved_completed(*task, result),
            Completed::Output(run, output) => {
                let (chunks, legacy) = output.take();
                self.standalone.progress(run, "", false, legacy);
                for (stderr, text) in chunks {
                    self.standalone.progress(run, &text, stderr, false);
                }
            }
            Completed::Run(run, result) => {
                if self.standalone.run_id != run || !self.standalone.running() {
                    return Effect::None;
                }
                if let Some(draft) = self.standalone.run_draft.take()
                    && result.is_ok()
                    && self.same_talk_run_draft(&draft)
                    && let Some(input) = self.input.as_mut()
                {
                    input.text.clear();
                    input.inline_quotes.clear();
                    self.remember_draft();
                }
                let was_shown = self.standalone.shown;
                let legacy = self.standalone.notice.as_deref() == Some(LEGACY_OUTPUT);
                match result {
                    Ok(result) => self.standalone.show(Page::Finished {
                        result,
                        keeping: false,
                    }),
                    Err(error) => self.standalone.show(Page::Refused(error.message)),
                }
                if legacy {
                    self.standalone.notice = Some(LEGACY_OUTPUT.into());
                }
                self.standalone.shown = was_shown;
                if !was_shown {
                    self.set_notice(
                        Some("Command finished. Run command shows its result.".into()),
                        false,
                    );
                }
            }
            Completed::Keep(result) => match result {
                Ok(value) => {
                    if let Some(row) = SavedRow::parse(&value) {
                        self.standalone.update_row(row);
                    }
                    self.standalone.saved_changed();
                    self.standalone.page = None;
                    self.standalone.request = None;
                    self.standalone.shown = false;
                    self.set_notice(Some("Kept in list.".into()), false);
                }
                Err(error) => {
                    if let Some(Page::Finished { keeping, .. }) = &mut self.standalone.page {
                        *keeping = false;
                    }
                    self.standalone.notice = Some(error.message);
                }
            },
        }
        Effect::None
    }
}

#[cfg(test)]
pub(super) mod scenes;
