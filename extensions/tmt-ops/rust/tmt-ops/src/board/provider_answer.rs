//! User-owned answer drafts and the single public write for a selected provider form.

use super::{
    app::{App, Effect, Overlay},
    shell::{OpsTab, RightTab},
    workspace::{OpsTarget, observe::ProviderForm},
};
use crate::{config::Pane, core::Core};
use ratatui::{
    Frame,
    crossterm::event::{Event, KeyCode, KeyEventKind, MouseButton, MouseEvent, MouseEventKind},
    layout::Rect,
    text::Line,
};
use serde_json::{Value, json};
use std::{
    cell::{Cell, RefCell},
    collections::BTreeMap,
    time::Duration,
};
use tmt_cli_style::Role;
use tmt_tui::components::{
    Button, Dialog, DialogHits, DialogInput, DialogKind, DialogLook, DialogState, Editor,
    FieldKind, Focus, Placement, strip,
};

const OTHER_LIMIT: usize = 2048;
const KEY: &str = "f";

#[derive(PartialEq, Eq)]
pub struct Send {
    form_id: String,
    identity_id: String,
    answer: Value,
}

impl std::fmt::Debug for Send {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ProviderAnswer")
            .field("form_id", &self.form_id)
            .finish_non_exhaustive()
    }
}

#[derive(Debug)]
pub(super) struct Completed {
    form_id: String,
    identity_id: String,
    outcome: Outcome,
}

#[derive(Debug)]
enum Outcome {
    Sending,
    Delivered,
    Uncertain,
    Refused { text: String, edit: bool },
}

impl Outcome {
    fn text(&self) -> &str {
        match self {
            Self::Sending => "◌ Sending form answer…",
            Self::Delivered => "✓ Form answer delivered",
            Self::Uncertain => "? Delivery unconfirmed · check the terminal",
            Self::Refused { text, .. } => text,
        }
    }

    fn blocks_send(&self) -> bool {
        !matches!(self, Self::Refused { edit: true, .. })
    }
}

pub(super) fn send(core: &Core, task: Send) -> Completed {
    // Use a single invocation, independent of the shared API session's negotiation.
    let outcome = match core.one_shot().api_within(
        "forms.answer",
        json!({"formId": task.form_id, "answer": task.answer}),
        Duration::from_secs(8),
    ) {
        Ok(value) if value["formId"] == task.form_id && value["delivered"] == true => {
            Outcome::Delivered
        }
        Err(error) => match error.code.as_str() {
            "FORM_DELIVERY_UNCERTAIN" | "SQUAD_CORE_UNAVAILABLE" => Outcome::Uncertain,
            _ => Outcome::Refused {
                text: format!("✗ {}", super::notes::single_line(&error.message)),
                edit: error.code == "FORM_ANSWER_INVALID",
            },
        },
        Ok(_) => Outcome::Uncertain,
    };
    Completed {
        form_id: task.form_id,
        identity_id: task.identity_id,
        outcome,
    }
}

#[derive(Default)]
pub(super) struct State {
    pub(super) action_hit: Cell<Option<Rect>>,
    dialog: Option<Surface>,
    draft: Option<Draft>,
    outcomes: BTreeMap<String, (String, Outcome)>,
    hits: RefCell<DialogHits>,
    top: Cell<usize>,
    limit: Cell<usize>,
    reveal: Cell<bool>,
}

enum Surface {
    Pick {
        forms: Vec<ProviderForm>,
        index: usize,
        focus: DialogState,
    },
    Edit(DialogState),
}

struct Draft {
    form: ProviderForm,
    questions: Vec<Answer>,
}

#[derive(Default)]
struct Answer {
    choices: Vec<usize>,
    other: Editor,
}

#[derive(Clone, Copy)]
enum Field {
    Option(usize, usize),
    Other(usize),
}

impl Draft {
    fn new(form: ProviderForm) -> Self {
        let questions = (0..form.questions.len())
            .map(|_| Answer::default())
            .collect();
        Self { form, questions }
    }

    fn fields(&self) -> Vec<Field> {
        self.form
            .questions
            .iter()
            .enumerate()
            .flat_map(|(index, question)| {
                (0..question.options.len())
                    .map(move |option| Field::Option(index, option))
                    .chain(question.free_text.then_some(Field::Other(index)))
            })
            .collect()
    }

    fn question_answer(&self) -> Option<Value> {
        let mut choices = Vec::new();
        let mut other = Vec::new();
        for (answer, question) in self.questions.iter().zip(&self.form.questions) {
            let text = answer.other.as_str();
            let supplied = !text.is_empty();
            let count = answer.choices.len() + usize::from(supplied);
            if count == 0
                || (question.choice == "single" && count != 1)
                || (supplied
                    && (!question.free_text
                        || text.len() > OTHER_LIMIT
                        || text.chars().any(char::is_control)))
                || answer
                    .choices
                    .iter()
                    .any(|&index| index >= question.options.len())
            {
                return None;
            }
            choices.push(&answer.choices);
            other.push(supplied.then_some(text));
        }
        (!choices.is_empty()).then(|| json!({"choices": choices, "other": other}))
    }

    fn edit(&mut self, field: Field, key: ratatui::crossterm::event::KeyEvent) {
        match field {
            Field::Other(index) => {
                if matches!(key.code, KeyCode::Char(ch) if ch.is_control()) {
                    return;
                }
                let answer = &mut self.questions[index];
                if answer.other.key(key, 64, OTHER_LIMIT)
                    && !answer.other.as_str().is_empty()
                    && self.form.questions[index].choice == "single"
                {
                    answer.choices.clear();
                }
            }
            Field::Option(index, pick) => {
                let answer = &mut self.questions[index];
                if let Some(at) = answer.choices.iter().position(|&choice| choice == pick) {
                    answer.choices.remove(at);
                } else {
                    if self.form.questions[index].choice == "single" {
                        answer.choices.clear();
                        answer.other = Editor::default();
                    }
                    answer.choices.push(pick);
                    answer.choices.sort_unstable();
                }
            }
        }
    }

    fn buttons(&self, eligible: bool) -> Vec<Button<'static>> {
        if self.form.kind == "planApproval" {
            vec![
                Button::secondary("Approve plan").enabled(eligible),
                Button::secondary("Keep planning").enabled(eligible),
                Button::primary("Cancel"),
            ]
        } else {
            vec![
                Button::secondary("Send answer")
                    .enabled(eligible && self.question_answer().is_some()),
                Button::primary("Cancel"),
            ]
        }
    }
}

impl State {
    pub(super) fn shown(&self) -> bool {
        self.dialog.is_some()
    }

    pub(super) fn close(&mut self) {
        self.dialog = None;
        self.invalidate();
    }

    pub(super) fn invalidate(&self) {
        self.action_hit.set(None);
        *self.hits.borrow_mut() = DialogHits::default();
    }

    pub(super) fn owns_typing(&self) -> bool {
        matches!((&self.dialog, &self.draft), (Some(Surface::Edit(focus)), Some(draft))
            if matches!(focus.focus, Focus::Field(index)
                if matches!(draft.fields().get(index), Some(Field::Other(_)))))
    }

    fn open(&mut self, mut forms: Vec<ProviderForm>) {
        self.top.set(0);
        self.limit.set(0);
        self.reveal.set(true);
        *self.hits.get_mut() = DialogHits::default();
        if forms.len() == 1 {
            self.edit(forms.remove(0));
        } else {
            self.dialog = Some(Surface::Pick {
                forms,
                index: 0,
                focus: DialogState::new(&[], &[]),
            });
        }
    }

    fn edit(&mut self, form: ProviderForm) {
        if self.draft.as_ref().is_none_or(|draft| draft.form != form) {
            self.draft = Some(Draft::new(form));
        }
        let draft = self.draft.as_ref().unwrap();
        let fields = kinds(&draft.fields());
        self.top.set(0);
        self.reveal.set(true);
        *self.hits.get_mut() = DialogHits::default();
        self.dialog = Some(Surface::Edit(DialogState::new(
            &fields,
            &draft.buttons(true),
        )));
    }

    pub(super) fn completed(&mut self, completed: Completed) {
        if !matches!(completed.outcome, Outcome::Refused { edit: true, .. })
            && self
                .draft
                .as_ref()
                .is_some_and(|draft| draft.form.form_id == completed.form_id)
        {
            self.draft = None;
        }
        self.outcomes.insert(
            completed.form_id,
            (completed.identity_id, completed.outcome),
        );
    }

    pub(super) fn message(&self, form: &ProviderForm) -> Option<&str> {
        self.outcomes
            .get(&form.form_id)
            .filter(|(identity, _)| *identity == form.identity_id)
            .map(|(_, result)| result.text())
    }

    pub(super) fn reconcile(&mut self, forms: &[ProviderForm]) {
        self.outcomes.retain(|id, (_, outcome)| {
            matches!(outcome, Outcome::Sending) || forms.iter().any(|form| form.form_id == *id)
        });
        if self
            .draft
            .as_ref()
            .is_some_and(|draft| !forms.contains(&draft.form))
        {
            self.draft = None;
            if matches!(self.dialog, Some(Surface::Edit(_))) {
                self.close();
            }
        }
    }

    pub(super) fn terminal_only(&self, form: &ProviderForm) -> bool {
        self.outcomes
            .get(&form.form_id)
            .is_some_and(|(_, result)| result.blocks_send())
    }

    pub(super) fn eligible(&self, form: &ProviderForm) -> bool {
        form.tool.is_none()
            && form.answerable
            && form.answer_in == "client"
            && !form.truncated
            && !self.terminal_only(form)
            && match form.kind.as_str() {
                "question" => {
                    form.plan.is_none()
                        && !form.questions.is_empty()
                        && form.questions.iter().all(|question| {
                            !question.text.is_empty()
                                && (!question.options.is_empty() || question.free_text)
                        })
                }
                "planApproval" => {
                    form.questions.is_empty()
                        && form.plan.as_ref().is_some_and(|plan| !plan.is_empty())
                }
                _ => false,
            }
    }

    fn scroll(&self, delta: isize) {
        self.reveal.set(false);
        self.top.set(
            self.top
                .get()
                .saturating_add_signed(delta)
                .min(self.limit.get()),
        );
    }
}

fn kinds(fields: &[Field]) -> Vec<FieldKind> {
    fields
        .iter()
        .map(|field| match field {
            Field::Option(..) => FieldKind::Choice,
            Field::Other(_) => FieldKind::Text,
        })
        .collect()
}

impl App {
    pub(super) fn provider_answer_completed(&mut self, completed: Completed) {
        let selected = matches!(self.workspace.selected.as_ref(),
            Some(OpsTarget::Member { identity_id, .. }) if *identity_id == completed.identity_id);
        if selected {
            self.set_notice(
                Some(completed.outcome.text().into()),
                !matches!(completed.outcome, Outcome::Delivered),
            );
        }
        self.provider_answer.completed(completed);
    }

    fn answer_forms(&self) -> impl Iterator<Item = &ProviderForm> {
        let selected = self.workspace.selected.as_ref();
        self.workspace_snapshot().filter(|snapshot| !snapshot.forms_stale)
            .and_then(|snapshot| snapshot.forms.as_deref()).unwrap_or_default()
            .iter().filter(move |form| {
                matches!(selected, Some(OpsTarget::Member { identity_id, .. }) if *identity_id == form.identity_id)
                    && self.provider_answer.eligible(form)
            })
    }

    pub(super) fn provider_answer_hint(&self) -> Option<&'static str> {
        (!self.loading()
            && self.shell.tab == OpsTab::Agents
            && self.right_tab == RightTab::Talk
            && self.input.is_none()
            && !self.searching
            && self.answer_forms().next().is_some())
        .then_some(if self.bindings().contains_key(KEY) {
            "Answer form…"
        } else {
            "f answer form…"
        })
    }

    fn open_provider_answer(&mut self) -> Effect {
        if self.provider_answer_hint().is_some() {
            let forms = self.answer_forms().cloned().collect();
            self.provider_answer.open(forms);
        }
        Effect::None
    }

    pub(super) fn provider_answer_key(
        &mut self,
        key: ratatui::crossterm::event::KeyEvent,
    ) -> Option<Effect> {
        (key.kind == KeyEventKind::Press
            && key.modifiers.is_empty()
            && key.code == KeyCode::Char('f')
            && self.focused() == Pane::Replies
            && !self.bindings().contains_key(KEY)
            && self.provider_answer_hint().is_some())
        .then(|| self.open_provider_answer())
    }

    pub(super) fn provider_answer_mouse(&mut self, mouse: MouseEvent) -> Option<Effect> {
        (mouse.kind == MouseEventKind::Down(MouseButton::Left)
            && self
                .provider_answer
                .action_hit
                .get()
                .is_some_and(|hit| hit.contains((mouse.column, mouse.row).into())))
        .then(|| self.open_provider_answer())
    }

    fn draft_is_current(&self) -> bool {
        self.provider_answer
            .draft
            .as_ref()
            .is_some_and(|draft| self.answer_forms().any(|form| *form == draft.form))
    }

    pub(super) fn provider_answer_event(&mut self, event: &Event) -> Effect {
        let eligible = self.draft_is_current();
        let state = &mut self.provider_answer;
        match event {
            Event::Mouse(mouse)
                if mouse.kind == MouseEventKind::ScrollUp
                    && !matches!(state.dialog, Some(Surface::Pick { .. })) =>
            {
                state.scroll(-3);
                return Effect::None;
            }
            Event::Mouse(mouse)
                if mouse.kind == MouseEventKind::ScrollDown
                    && !matches!(state.dialog, Some(Surface::Pick { .. })) =>
            {
                state.scroll(3);
                return Effect::None;
            }
            Event::Key(key)
                if key.code == KeyCode::PageUp
                    && !matches!(state.dialog, Some(Surface::Pick { .. })) =>
            {
                state.scroll(-6);
                return Effect::None;
            }
            Event::Key(key)
                if key.code == KeyCode::PageDown
                    && !matches!(state.dialog, Some(Surface::Pick { .. })) =>
            {
                state.scroll(6);
                return Effect::None;
            }
            _ => {}
        }

        match state.dialog.as_mut() {
            Some(Surface::Pick {
                forms,
                index,
                focus,
            }) => {
                let key_action = match event {
                    Event::Key(key) => focus.key(DialogKind::List, key, &[], &[]),
                    Event::Mouse(mouse) if mouse.kind == MouseEventKind::ScrollUp => {
                        *index = index.saturating_sub(1);
                        DialogInput::Moved
                    }
                    Event::Mouse(mouse) if mouse.kind == MouseEventKind::ScrollDown => {
                        *index = (*index + 1).min(forms.len() - 1);
                        DialogInput::Moved
                    }
                    Event::Mouse(mouse) if !state.hits.borrow().outer.is_empty() => {
                        focus.mouse(mouse, &state.hits.borrow(), &[])
                    }
                    _ => DialogInput::Ignored,
                };
                let pick = match key_action {
                    DialogInput::Cancel => {
                        state.close();
                        return Effect::None;
                    }
                    DialogInput::Content(key) if key.code == KeyCode::Up => {
                        *index = index.saturating_sub(1);
                        None
                    }
                    DialogInput::Content(key) if key.code == KeyCode::Down => {
                        *index = (*index + 1).min(forms.len() - 1);
                        None
                    }
                    DialogInput::Content(key)
                        if key.code == KeyCode::Enter && key.kind == KeyEventKind::Press =>
                    {
                        forms.get(*index).cloned()
                    }
                    DialogInput::Moved if matches!(event, Event::Mouse(mouse) if mouse.kind == MouseEventKind::Down(MouseButton::Left)) => {
                        match focus.focus {
                            Focus::Field(row) => forms.get(row).cloned(),
                            _ => None,
                        }
                    }
                    _ => None,
                };
                state.reveal.set(true);
                if let Some(form) = pick {
                    if self.answer_forms().any(|current| *current == form) {
                        self.provider_answer.edit(form);
                    } else {
                        self.provider_answer.close();
                        self.set_notice(
                            Some("Form changed · check its current status.".into()),
                            true,
                        );
                    }
                }
                Effect::None
            }
            Some(Surface::Edit(focus)) => {
                let draft = state.draft.as_mut().expect("edit dialog has a draft");
                let fields = draft.fields();
                let buttons = draft.buttons(eligible);
                let kind = if draft.form.kind == "planApproval" {
                    DialogKind::Confirm
                } else {
                    DialogKind::Form
                };
                let input = match event {
                    Event::Key(key)
                        if !(key.kind == KeyEventKind::Repeat && key.code == KeyCode::Enter) =>
                    {
                        focus.key(kind, key, &kinds(&fields), &buttons)
                    }
                    Event::Mouse(mouse) if !state.hits.borrow().outer.is_empty() => {
                        focus.mouse(mouse, &state.hits.borrow(), &buttons)
                    }
                    Event::Paste(text) if !text.chars().any(char::is_control) => {
                        if let Focus::Field(field) = focus.focus
                            && let Some(Field::Other(index)) = fields.get(field).copied()
                            && draft.questions[index].other.insert(text, OTHER_LIMIT)
                            && draft.form.questions[index].choice == "single"
                        {
                            draft.questions[index].choices.clear();
                        }
                        DialogInput::Ignored
                    }
                    _ => DialogInput::Ignored,
                };
                match input {
                    DialogInput::Field(index, key) => {
                        draft.edit(fields[index], key);
                        state.reveal.set(true);
                    }
                    DialogInput::Moved => state.reveal.set(true),
                    DialogInput::Cancel => state.close(),
                    DialogInput::Choose(index) if index == buttons.len() - 1 => state.close(),
                    DialogInput::Choose(index) if eligible => {
                        let answer = if kind == DialogKind::Confirm {
                            Some(json!({"decision": if index == 0 {"allow"} else {"deny"}}))
                        } else {
                            draft.question_answer()
                        };
                        if let Some(answer) = answer {
                            let form_id = draft.form.form_id.clone();
                            let identity_id = draft.form.identity_id.clone();
                            state
                                .outcomes
                                .insert(form_id.clone(), (identity_id.clone(), Outcome::Sending));
                            state.close();
                            return Effect::AnswerProviderForm(Send {
                                form_id,
                                identity_id,
                                answer,
                            });
                        }
                    }
                    _ => {}
                }
                Effect::None
            }
            None => Effect::None,
        }
    }

    pub(super) fn render_provider_answer(&self, frame: &mut Frame, body: Rect) -> Option<Rect> {
        let state = &self.provider_answer;
        let surface = state.dialog.as_ref()?;
        let draft = state.draft.as_ref();
        let (title, kind, buttons, focus, selected) = match surface {
            Surface::Pick { focus, index, .. } => (
                "Choose provider form".into(),
                DialogKind::List,
                vec![],
                focus,
                Some(*index),
            ),
            Surface::Edit(focus) => {
                let draft = draft?;
                let plan = draft.form.kind == "planApproval";
                let member = self
                    .workspace_snapshot()
                    .and_then(|snapshot| snapshot.roster.members.get(&draft.form.identity_id))
                    .map_or("member".into(), |member| {
                        super::notes::single_line(&member.name)
                    });
                (
                    format!(
                        "{} · {member}",
                        if plan {
                            "Review plan"
                        } else {
                            "Answer questions"
                        }
                    ),
                    if plan {
                        DialogKind::Confirm
                    } else {
                        DialogKind::Form
                    },
                    draft.buttons(self.draft_is_current()),
                    focus,
                    match focus.focus {
                        Focus::Field(index) => Some(index),
                        _ => None,
                    },
                )
            }
        };
        let plan_note = kind == DialogKind::Confirm;
        let dialog = Dialog {
            title,
            kind,
            placement: Placement::Center,
            buttons,
            hints: if kind == DialogKind::List {
                "↑↓ choose · ⏎ open · Esc cancel"
            } else {
                "↑↓ fields · ←→ choose · Esc cancel"
            }
            .into(),
        };
        let area = dialog.areas(body, [76, 24], plan_note);
        let look = self.look();
        let mut hits = dialog.paint(
            area,
            focus,
            frame.buffer_mut(),
            DialogLook {
                theme: &look.theme,
                depth: look.depth,
                active: true,
                hovered: None,
            },
        );
        if plan_note {
            strip::paint_left(
                frame.buffer_mut(),
                area.status,
                Line::styled("Approve plan uses manual edits.", look.role(Role::Dim)),
            );
        }
        let width = usize::from(area.content.width);
        let height = usize::from(area.content.height);
        let mut lines = Vec::<(String, Option<usize>, Role)>::new();
        let mut add = |text: &str, field, role| {
            for line in super::notes::wrap(&super::notes::sanitize(text), width.max(1)) {
                lines.push((line, field, role));
            }
        };
        if let Surface::Pick { forms, .. } = surface {
            for (index, form) in forms.iter().enumerate() {
                let label = if form.kind == "planApproval" {
                    "Plan approval"
                } else {
                    "Question form"
                };
                add(
                    &format!("{label} · {}", super::notes::single_line(&form.summary())),
                    Some(index),
                    Role::Text,
                );
            }
            hits.fields.resize(forms.len(), Rect::ZERO);
        } else if let Some(draft) = draft {
            if !self.draft_is_current() {
                add(
                    "Form changed · check the terminal or wait for a fresh read.",
                    None,
                    Role::Muted,
                );
            }
            if let Some((_, status)) = state.outcomes.get(&draft.form.form_id) {
                add(status.text(), None, Role::Muted);
            }
            if let Some(plan) = &draft.form.plan {
                add(plan, None, Role::Text);
            }
            let mut field = 0;
            for (question, answer) in draft.form.questions.iter().zip(&draft.questions) {
                if let Some(header) = &question.header {
                    add(header, None, Role::Muted);
                }
                add(&question.text, None, Role::Text);
                for (index, option) in question.options.iter().enumerate() {
                    let picked = answer.choices.contains(&index);
                    let mark = match (question.choice.as_str(), picked) {
                        ("single", true) => "●",
                        ("single", false) => "○",
                        (_, true) => "☑",
                        (_, false) => "☐",
                    };
                    add(&format!("{mark} {}", option.label), Some(field), Role::Text);
                    if let Some(description) = &option.description {
                        add(description, Some(field), Role::Muted);
                    }
                    field += 1;
                }
                if question.free_text {
                    add("Other:", Some(field), Role::Text);
                    field += 1;
                }
            }
            hits.fields.resize(field, Rect::ZERO);
        }
        let max_top = lines.len().saturating_sub(height);
        state.limit.set(max_top);
        let mut top = state.top.get().min(max_top);
        if state.reveal.replace(false)
            && let Some(at) =
                selected.and_then(|field| lines.iter().position(|line| line.1 == Some(field)))
        {
            if at < top {
                top = at;
            }
            if at >= top + height {
                top = at.saturating_sub(height.saturating_sub(1));
            }
        }
        state.top.set(top);
        if max_top > 0 {
            let position = format!(
                "{}–{} of {} · PgUp/PgDn",
                top + 1,
                (top + height).min(lines.len()),
                lines.len()
            );
            strip::paint_right(
                frame.buffer_mut(),
                area.position,
                Line::styled(position, look.role(Role::Muted)),
            );
        }
        for (row, (line, field, role)) in lines.into_iter().skip(top).take(height).enumerate() {
            let rect = Rect::new(
                area.content.x,
                area.content.y + row as u16,
                area.content.width,
                1,
            );
            let active = field.is_some() && field == selected;
            let style = if active {
                look.selection()
            } else {
                look.role(role)
            };
            frame.buffer_mut().set_style(rect, style);
            strip::paint_left(frame.buffer_mut(), rect, Line::styled(line, style));
            if let Some(field) = field {
                hits.fields[field] = if hits.fields[field].is_empty() {
                    rect
                } else {
                    hits.fields[field].union(rect)
                };
            }
        }
        if matches!(surface, Surface::Edit(_))
            && let Some(draft) = draft
        {
            for (field, kind) in draft.fields().into_iter().enumerate() {
                let Field::Other(question) = kind else {
                    continue;
                };
                let hit = hits.fields[field];
                if hit.width <= 7 {
                    continue;
                }
                let area = Rect::new(hit.x + 7, hit.y, hit.width - 7, 1);
                let editor = &draft.questions[question].other;
                let layout = editor.layout(area.width);
                let focused = Some(field) == selected;
                let style = if focused {
                    look.selection()
                } else {
                    look.role(Role::Text)
                };
                let offset = if focused { layout.reveal(0, 1) } else { 0 };
                if let Some(cursor) = layout.paint(
                    frame.buffer_mut(),
                    area,
                    offset,
                    editor.selection(),
                    style,
                    look.role(Role::Accent),
                ) && focused
                {
                    frame.set_cursor_position(cursor);
                }
            }
        }
        *state.hits.borrow_mut() = hits;
        self.peek_areas
            .set(Overlay::ProviderAnswer, Some(area.outer));
        Some(area.outer)
    }
}
