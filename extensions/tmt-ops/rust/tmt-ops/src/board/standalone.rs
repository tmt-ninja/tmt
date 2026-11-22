//! The board's Run command controller. Core owns execution, retained output and shells.

use super::app::{App, Effect, Overlay};

mod saved;
mod worker;
use crate::core::{Core, SquadError};
use ratatui::{
    Frame,
    crossterm::event::{Event, KeyCode},
    layout::Rect,
    text::Line,
};
use saved::Moving;
pub use saved::{SavedRow, SavedTask};
use serde_json::{Value, json};
use std::{cell::RefCell, time::Instant};
use tmt_tui::components::{
    Button, Dialog, DialogHits, DialogInput, DialogKind, DialogState, Editor, FieldKind, Placement,
    strip,
};
pub(super) use worker::Worker;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Task {
    Target(String),
    Saved(SavedTask),
    Run(u64, Value),
    Keep(String),
    Discard,
    Stop,
}

pub(super) enum Completed {
    Target(String, Result<Value, SquadError>),
    Saved(Box<SavedTask>, Result<Value, SquadError>),
    Output(u64, worker::Output),
    Run(u64, Result<Value, SquadError>),
    Keep(Result<Value, SquadError>),
}

pub(super) fn complete_read(core: &Core, task: Task) -> Completed {
    match task {
        Task::Target(identity) => {
            let result = core.api("terminal.command.target", json!({"identityId": identity}));
            Completed::Target(identity, result)
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
    history: Option<usize>,
}

enum Page {
    Form(Form),
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
    scroll_position: std::cell::Cell<usize>,
    scroll_end: std::cell::Cell<usize>,
    live_viewport: std::cell::Cell<(u16, u16)>,
    follow_output: bool,
    live: String,
    run_id: u64,
    elapsed: std::cell::Cell<u64>,
    notice: Option<String>,
}

const MAX_COMMAND: usize = tmt_pty_protocol::COMMAND_LIMIT;
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

    fn open(&mut self, member: Option<(String, Option<String>, String)>) -> Effect {
        if self.pending {
            return Effect::None;
        }
        self.shown = true;
        if self.page.is_some() {
            return Effect::None;
        }
        let targets = self
            .launch_directory
            .as_ref()
            .map(|cwd| Target {
                label: "Local".into(),
                input: json!({"kind":"local","cwd":cwd}),
            })
            .into_iter()
            .collect();
        let effect = member.as_ref().map_or(Effect::None, |(identity, _, _)| {
            Effect::Standalone(Task::Target(identity.clone()))
        });
        self.show(Page::Form(Form {
            saved: None,
            command: Editor::default(),
            targets,
            selected: 0,
            observing: member.is_some(),
            member,
            history: None,
        }));
        effect
    }

    fn show(&mut self, page: Page) {
        self.page = Some(page);
        self.shown = true;
        self.scroll = 0;
        self.scroll_position.set(0);
        self.scroll_end.set(0);
        self.live_viewport.set((0, 0));
        self.follow_output = false;
        self.live.clear();
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
            _ => {
                self.shown = false;
                self.page = None;
                if self.request.take().is_some() {
                    Effect::Standalone(Task::Discard)
                } else {
                    Effect::None
                }
            }
        }
    }

    fn run(&mut self, request: Value, command: String, cwd: String) -> Effect {
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

    fn progress(&mut self, run: u64, text: &str, legacy: bool) {
        if self.run_id == run && self.running() {
            self.live.push_str(text);
            if legacy {
                self.notice = Some(LEGACY_OUTPUT.into());
            }
        }
    }

    fn scroll_output(&mut self, step: isize) {
        let running = self.running();
        let end = if running {
            let (width, height) = self.live_viewport.get();
            // Progress can arrive before the next paint. Use the fresh tail
            // with the viewport's last painted geometry.
            wrapped_output(self.live.lines(), width)
                .count()
                .saturating_sub(height as usize)
        } else {
            self.scroll_end.get()
        };
        let start = if running && !self.follow_output {
            self.scroll
        } else {
            self.scroll_position.get()
        };
        self.scroll = start.min(end).saturating_add_signed(step).min(end);
        self.follow_output = running && step > 0 && self.scroll == end;
    }

    fn choose(&mut self, index: usize) -> Effect {
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
                self.run(request, command, cwd)
            }
            (Some(Page::Running { .. }), 0) => self.stop(),
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
            (Some(Page::Remove { row }), 1) if !self.pending => {
                self.pending = true;
                Effect::Standalone(Task::Saved(SavedTask::Remove(row.clone(), true)))
            }
            _ => self.close(),
        }
    }

    fn input(&mut self, event: &Event) -> Effect {
        if let Some(Page::Form(form)) = &mut self.page
            && form.saved.is_none()
        {
            match event {
                Event::Key(key) if key.modifiers.is_empty() && key.code == KeyCode::Tab => {
                    if !form.targets.is_empty() {
                        form.selected = (form.selected + 1) % form.targets.len();
                    }
                    return Effect::None;
                }
                Event::Key(key) if key.modifiers.is_empty() && key.code == KeyCode::Up => {
                    let index = form.history.map_or(0, |last| last + 1);
                    if let Some(command) = self.history.get(index) {
                        form.history = Some(index);
                        form.command = Editor::from(command.as_str());
                    }
                    return Effect::None;
                }
                Event::Paste(text) => {
                    if tmt_pty_protocol::valid_command(text) {
                        if !form.command.insert(text, MAX_COMMAND) {
                            self.notice = Some("The command is too long.".into());
                        }
                    } else {
                        self.notice = Some("Paste one command without control characters.".into());
                    }
                    return Effect::None;
                }
                _ => {}
            }
        }
        if let Event::Key(key) = event {
            if self.running() && key.code == KeyCode::End {
                self.follow_output = true;
                return Effect::None;
            }
            if key.modifiers.is_empty() && matches!(self.page, Some(Page::Finished { .. })) {
                match key.code {
                    KeyCode::Char('k') => return self.choose(0),
                    KeyCode::Char('r') => return self.choose(1),
                    _ => {}
                }
            }
            let step = match key.code {
                KeyCode::PageUp => Some(-10),
                KeyCode::PageDown => Some(10),
                KeyCode::Up
                    if matches!(
                        self.page,
                        Some(Page::Running { .. } | Page::Finished { .. } | Page::Saved(_))
                    ) =>
                {
                    Some(-1)
                }
                KeyCode::Down
                    if matches!(
                        self.page,
                        Some(Page::Running { .. } | Page::Finished { .. } | Page::Saved(_))
                    ) =>
                {
                    Some(1)
                }
                _ => None,
            };
            if let Some(step) = step {
                self.scroll_output(step);
                return Effect::None;
            }
        }
        if let Event::Mouse(mouse) = event
            && matches!(
                self.page,
                Some(Page::Running { .. } | Page::Finished { .. } | Page::Saved(_))
            )
        {
            use ratatui::crossterm::event::MouseEventKind;
            let step = match mouse.kind {
                MouseEventKind::ScrollUp => -3,
                MouseEventKind::ScrollDown => 3,
                _ => 0,
            };
            if step != 0 {
                self.scroll_output(step);
                return Effect::None;
            }
        }
        let (dialog, fields) = self.presentation();
        let mut state = self.dialog.take().expect("shown dialog owns state");
        let input = match event {
            Event::Key(key) => state.key(dialog.kind, key, fields, &dialog.buttons),
            Event::Mouse(mouse) if !self.hits.borrow().outer.is_empty() => {
                state.mouse(mouse, &self.hits.borrow(), &dialog.buttons)
            }
            _ => DialogInput::Ignored,
        };
        self.dialog = Some(state);
        match input {
            DialogInput::Choose(index) => self.choose(index),
            DialogInput::Cancel => self.close(),
            DialogInput::Field(_, key) => {
                if let Some(Page::Form(form)) = &mut self.page {
                    let width = self.hits.borrow().content.width.saturating_sub(2).max(1);
                    form.command.key(key, width, MAX_COMMAND);
                }
                Effect::None
            }
            _ => Effect::None,
        }
    }

    fn presentation(&self) -> (Dialog<'static>, &'static [FieldKind]) {
        let (title, kind, buttons, hints, fields) = match &self.page {
            Some(Page::Form(form)) => (
                "Run command",
                DialogKind::Form,
                vec![
                    Button::primary("Run").enabled(
                        !form.observing
                            && !form.targets.is_empty()
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
                    Button::secondary("Stop").enabled(!stopping),
                    Button::primary("Hide"),
                ],
                "ctrl-c stop · Esc hide, keeps running",
                &[][..],
            ),
            Some(Page::Finished { result, keeping }) => (
                "",
                DialogKind::Confirm,
                vec![
                    Button::primary("Keep in list")
                        .enabled(!keeping && result["runId"].is_string()),
                    Button::secondary("Run again").enabled(!keeping),
                    Button::secondary("Close").enabled(!keeping),
                ],
                "k keep · r run again · Esc close",
                &[][..],
            ),
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
        let title = match &self.page {
            Some(Page::Running { command, .. }) => command_title(command),
            Some(Page::Finished { result, .. } | Page::Saved(result)) => {
                command_title(result["command"].as_str().unwrap_or_default())
            }
            _ => title.into(),
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
        let rows = self.lines();
        let status = self.notice.is_some();
        let form = self.editing();
        // The shared modal reserves two borders, a position row and a footer.
        let wide = matches!(
            self.page,
            Some(Page::Running { .. } | Page::Finished { .. } | Page::Saved(_))
        );
        let demand = if wide {
            [(u32::from(body.width) * 3 / 4).clamp(76, 118) as u16, 18]
        } else {
            [
                dialog.footer_width().max(76),
                rows.len().min(14) as u16 + if form { 3 } else { 4 } + u16::from(status),
            ]
        };
        let area = dialog.areas(body, demand, status);
        let mut hits = super::buttons::paint_dialog(
            app,
            frame.buffer_mut(),
            &dialog,
            area,
            state,
            Overlay::Standalone,
        );
        if form {
            // The form uses the otherwise empty position row immediately above its buttons.
            hits.content.height += area.position.height;
        }
        let mut content = hits.content;
        let role = look.role(tmt_cli_style::Role::Text);
        let rows = if self.running() {
            if content.height > 0 {
                strip::paint_left(
                    frame.buffer_mut(),
                    Rect {
                        height: 1,
                        ..content
                    },
                    Line::styled(super::view::fit(&rows[0], content.width as usize), role),
                );
                content.y += 1;
                content.height -= 1;
            }
            self.live_viewport.set((content.width, content.height));
            wrapped_output(self.live.lines(), content.width).collect()
        } else if matches!(self.page, Some(Page::Finished { .. } | Page::Saved(_))) {
            wrapped_output(rows.iter().map(String::as_str), content.width).collect()
        } else {
            rows
        };
        let maximum_scroll = rows.len().saturating_sub(content.height as usize);
        self.scroll_end.set(maximum_scroll);
        self.scroll_position.set(if self.follow_output {
            maximum_scroll
        } else {
            self.scroll.min(maximum_scroll)
        });
        for (index, line) in rows
            .into_iter()
            .skip(self.scroll_position.get())
            .take(content.height as usize)
            .enumerate()
        {
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
                            || "In  No local directory".into(),
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
            Some(Page::Running { cwd, stopping, .. }) => {
                running_lines(&self.run_label, cwd, self.elapsed.get(), *stopping)
            }
            Some(Page::Finished { result, .. } | Page::Saved(result)) => {
                let label = if matches!(&self.page, Some(Page::Saved(_))) {
                    ""
                } else {
                    &self.run_label
                };
                let mut rows = vec![format!(
                    "{}  {}",
                    target_line(label, result["cwd"].as_str().unwrap_or_default()),
                    result_status(result)
                )];
                rows.extend(output_lines(result));
                rows
            }
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

fn wrapped_output<'a>(
    lines: impl Iterator<Item = &'a str>,
    width: u16,
) -> impl Iterator<Item = String> {
    lines.flat_map(move |line| tmt_tui::text::lines(line, width, tmt_tui::style::TextFlow::Wrap))
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

fn running_lines(label: &str, cwd: &str, elapsed: u64, stopping: bool) -> Vec<String> {
    let status = if stopping {
        "⠋ stopping"
    } else {
        "⠋ running"
    };
    vec![format!(
        "{}  {status} {}:{:02}",
        target_line(label, cwd),
        elapsed / 60,
        elapsed % 60
    )]
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
        status.push_str(&format!(" after {}s", end.saturating_sub(start) / 1000));
    }
    if result["truncated"] == true && !status.contains("truncated") {
        status.push_str(" · output truncated");
    }
    status
}

fn output_lines(result: &Value) -> Vec<String> {
    let stdout = super::notes::sanitize(result["stdout"].as_str().unwrap_or_default());
    let stderr = super::notes::sanitize(result["stderr"].as_str().unwrap_or_default());
    stdout
        .lines()
        .map(str::to_owned)
        .chain(stderr.lines().map(|line| format!("stderr · {line}")))
        .collect()
}

impl App {
    pub(super) fn open_standalone(&mut self) -> Effect {
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
        self.standalone.open(member)
    }

    pub(super) fn standalone_event(&mut self, event: &Event) -> Effect {
        self.standalone.input(event)
    }

    pub(super) fn standalone_completed(&mut self, completed: Completed) {
        match completed {
            Completed::Target(identity, result) => {
                if let Some(Page::Form(form)) = &mut self.standalone.page
                    && let Some((id, room, label)) = &form.member
                    && *id == identity
                {
                    form.observing = false;
                    match result {
                        Ok(mut input) => {
                            input["kind"] = "member".into();
                            input["identityId"] = json!(identity);
                            input["roomId"] = json!(room);
                            form.targets.insert(
                                0,
                                Target {
                                    label: label.clone(),
                                    input,
                                },
                            );
                            form.selected = 0;
                        }
                        Err(error) => self.standalone.notice = Some(error.message),
                    }
                }
            }
            Completed::Saved(task, result) => self.saved_completed(*task, result),
            Completed::Output(run, output) => {
                let (text, legacy) = output.take();
                self.standalone.progress(run, &text, legacy);
            }
            Completed::Run(run, result) => {
                if self.standalone.run_id != run || !self.standalone.running() {
                    return;
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
    }
}

#[cfg(test)]
pub(super) mod scenes;
