//! Work home projection and explicit order moves through the Colab CLI (#6474).
mod model;
mod order;
mod surface;
#[cfg(test)]
pub(in crate::board) mod tests;

use std::{
    cell::RefCell,
    collections::BTreeSet,
    time::{Duration, Instant},
};

use ratatui::layout::Rect;
use tmt_tui::components::{DialogHits, DialogState};

pub(super) use model::{Item, List, Progress, Status};
pub(super) use order::{Job as OrderJob, Move as OrderMove, Reply as OrderReply, run as run_order};
pub(super) use surface::render;

pub(super) fn age_label(at: Option<i64>, now: i64) -> String {
    at.filter(|at| *at <= now).map_or_else(
        || "—".into(),
        |at| {
            let minutes = (now - at) / 60_000;
            match minutes {
                0..=59 => format!("{minutes}m"),
                60..=1439 => format!("{}h", minutes / 60),
                _ => format!("{}d", minutes / 1440),
            }
        },
    )
}

const WITHIN: Duration = Duration::from_secs(3);
const REFRESH_EVERY: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(in crate::board) enum ViewSelection {
    #[default]
    All,
    NeedsYou,
    Blocked,
    Saved(String),
}

#[derive(Debug)]
pub(in crate::board) enum ViewDialog {
    Save {
        state: DialogState,
        hits: RefCell<DialogHits>,
    },
    Manage {
        state: DialogState,
        cursor: usize,
        hits: RefCell<DialogHits>,
    },
    ConfirmDelete {
        name: String,
        state: DialogState,
        hits: RefCell<DialogHits>,
    },
}

#[derive(Debug, Default)]
pub(in crate::board) struct State {
    pub list: Option<List>,
    pub notice: Option<String>,
    pub stale: bool,
    pub last_read_at: Option<i64>,
    pending: bool,
    next_read: Option<Instant>,
    explicit_refresh: bool,
    needs_update: bool,
    pub selected: Option<String>,
    pub project: Option<String>,
    pub recent: bool,
    pub period: usize,
    pub detail_collapsed: bool,
    pub inspector_focused: bool,
    pub inspector_cursor: usize,
    pub search: tmt_tui::components::Editor,
    pub searching: bool,
    pub active_view: ViewSelection,
    pub default_view_applied: bool,
    pub view_dialog: Option<ViewDialog>,
    pub view_draft_name: String,
    pub view_draft_default: bool,
    pub expanded: std::collections::BTreeSet<Option<String>>,
    pub hits: RefCell<Vec<(Rect, surface::Hit)>>,
    order_pending: bool,
    order_unsupported: bool,
    order_attempted: BTreeSet<String>,
    order_blocked: Option<order::Target>,
    order_recovery_read: bool,
    order_notice: Option<(order::Target, String)>,
}

impl State {
    pub fn request(&mut self, now: Instant) -> bool {
        if self.pending
            || (!self.explicit_refresh
                && (self.needs_update || self.next_read.is_some_and(|next| now < next)))
        {
            return false;
        }
        self.pending = true;
        self.order_recovery_read = self.order_blocked.is_some();
        self.explicit_refresh = false;
        true
    }

    pub fn refresh(&mut self) {
        self.explicit_refresh = true;
        if self.order_unsupported {
            self.order_notice = None;
        }
        self.order_unsupported = false;
    }

    pub fn cancel(&mut self, now: Instant) {
        self.pending = false;
        self.next_read = Some(now + REFRESH_EVERY);
    }

    pub fn apply(&mut self, now: Instant, read: Result<List, ReadFailure>) {
        // Count from completion so time queued behind another worker job
        // cannot make two automatic Colab invocations land in one minute.
        self.cancel(now);
        self.needs_update = matches!(
            &read,
            Err(ReadFailure::NotInstalled | ReadFailure::UpdateNeeded)
        );
        match read {
            Ok(mut list) => {
                if self
                    .list
                    .as_ref()
                    .is_some_and(|previous| previous.space != list.space)
                {
                    self.selected = None;
                    self.project = None;
                    self.expanded.clear();
                    self.recent = false;
                    self.period = 0;
                    self.order_unsupported = false;
                    self.order_blocked = None;
                    self.order_notice = None;
                }
                if let Some(previous) = self.list.as_ref().filter(|old| old.space == list.space) {
                    for (project, current) in &mut list.orders {
                        if let Some(held) = previous.orders.get(project)
                            && held.revision > current.revision
                        {
                            *current = held.clone();
                        }
                    }
                    for project in &list.omitted_orders {
                        if let Some(held) = previous.orders.get(project) {
                            list.orders.insert(project.clone(), held.clone());
                        }
                    }
                }
                if self.order_recovery_read
                    && self.order_blocked.as_ref().is_some_and(|target| {
                        target.space == list.space
                            && list.orders.contains_key(&target.project)
                            && !list.omitted_orders.contains(&target.project)
                    })
                {
                    self.order_blocked = None;
                }
                self.order_attempted.clear();
                if self
                    .project
                    .as_ref()
                    .is_some_and(|name| !list.projects.contains(name))
                {
                    self.project = None;
                    self.selected = None;
                }
                self.list = Some(list);
                self.stale = false;
                self.notice = None;
                self.last_read_at = Some(crate::status::now_ms() as i64);
            }
            Err(error) => {
                self.stale = self.list.is_some();
                self.notice = Some(error.message());
            }
        }
        self.order_recovery_read = false;
        self.hits.get_mut().clear();
    }

    fn order_target(&self) -> Option<order::Target> {
        Some(order::Target {
            space: self.list.as_ref()?.space.clone(),
            project: self.project.clone()?,
        })
    }

    pub fn request_order_show(&mut self) -> Option<OrderJob> {
        if self.stale || self.order_pending || self.order_unsupported {
            return None;
        }
        let target = self.order_target()?;
        let list = self.list.as_ref()?;
        if !list.omitted_orders.contains(&target.project)
            || !self.order_attempted.insert(target.project.clone())
        {
            return None;
        }
        self.order_pending = true;
        self.order_notice = Some((target.clone(), "Reading project order…".into()));
        Some(OrderJob::Show(target))
    }

    fn order_reason(&self, target: &order::Target) -> Option<&'static str> {
        if self.stale {
            return Some("Refresh Colab Work before moving items.");
        }
        if self.order_unsupported {
            return Some("Update Colab · project ordering is unavailable.");
        }
        if self.order_pending {
            return Some("A project order operation is running.");
        }
        if self.order_blocked.as_ref() == Some(target) {
            return Some("Refresh the project order before moving again.");
        }
        None
    }

    fn move_choices(
        &self,
        key: &str,
    ) -> Result<Vec<(&'static str, &'static str, OrderMove)>, &'static str> {
        let target = self
            .order_target()
            .ok_or("Choose one project to move work.")?;
        if let Some(reason) = self.order_reason(&target) {
            return Err(reason);
        }
        let list = self.list.as_ref().expect("target has a list");
        let order = list
            .orders
            .get(&target.project)
            .ok_or("Project order is unavailable.")?;
        let open: Vec<_> = list
            .items
            .iter()
            .filter(|item| item.status != Status::Done && item.projects.contains(&target.project))
            .collect();
        let item = open
            .iter()
            .find(|item| item.key == key)
            .ok_or("Work item is unavailable.")?;
        if order::now(item.status) {
            return Err("Now keeps its stored rank.");
        }
        if item.number.is_none() {
            return Err("Only numbered work can move.");
        }
        let next = order.next(&open);
        let task = |position| OrderMove {
            target: target.clone(),
            key: key.into(),
            revision: order.revision,
            position,
        };
        let Some(index) = next.iter().position(|item| item.key == key) else {
            return Ok(vec![("a", "Add to Next", task(order::Position::Last))]);
        };
        let complete = order
            .items
            .iter()
            .all(|key| open.iter().any(|item| item.key == *key));
        let mut choices = Vec::with_capacity(3);
        if let Some(previous) = index.checked_sub(1).map(|index| next[index])
            && previous.number.is_some()
            && complete
        {
            choices.push((
                "u",
                "Move up",
                task(order::Position::Before(previous.key.clone())),
            ));
        }
        let anchor = next.get(index + 2);
        if index + 1 < next.len() && complete && anchor.is_none_or(|item| item.number.is_some()) {
            choices.push((
                "d",
                "Move down",
                task(anchor.map_or(order::Position::Last, |item| {
                    order::Position::Before(item.key.clone())
                })),
            ));
        }
        choices.push(("r", "Remove from Next", task(order::Position::Unrank)));
        Ok(choices)
    }

    fn confirm_move(&mut self, task: &OrderMove) -> bool {
        if !self
            .move_choices(&task.key)
            .is_ok_and(|choices| choices.into_iter().any(|(_, _, current)| current == *task))
        {
            return false;
        }
        self.order_pending = true;
        self.order_notice = Some((task.target.clone(), "Saving project order…".into()));
        self.hits.get_mut().clear();
        true
    }

    pub fn apply_order(&mut self, reply: OrderReply) {
        self.order_pending = false;
        let order::Reply { job, outcome } = reply;
        let target = job.target();
        let wrote = matches!(job, OrderJob::Move(_));
        if wrote {
            self.explicit_refresh = true;
        }
        if self.order_target().as_ref() != Some(target) {
            if wrote
                && self
                    .list
                    .as_ref()
                    .is_some_and(|list| list.space == target.space)
            {
                self.order_blocked = Some(target.clone());
            }
            if !wrote {
                self.order_attempted.remove(&target.project);
            }
            return;
        }
        let list = self.list.as_mut().expect("matching owner list");
        let (order, message) = match outcome {
            order::Outcome::Read(order) => (Some(order), None),
            order::Outcome::Saved(order) => {
                let OrderJob::Move(task) = &job else {
                    unreachable!("only a move saves")
                };
                let open: Vec<_> = list
                    .items
                    .iter()
                    .filter(|item| item.projects.contains(&target.project))
                    .collect();
                let index = order
                    .next(&open)
                    .iter()
                    .position(|item| item.key == task.key);
                let message = index.map_or_else(
                    || "Moved to No preference.".to_owned(),
                    |index| format!("Moved to Next · position {}.", index + 1),
                );
                (Some(order), Some(message))
            }
            order::Outcome::Conflict(order) => {
                let message = if order.is_some() {
                    "↻ Order changed elsewhere; showing the current order"
                } else {
                    "↻ Order changed elsewhere; refresh to see the current order"
                };
                (order, Some(message.into()))
            }
            order::Outcome::Uncertain(order) => (
                order,
                Some("Move outcome unknown · check the current order.".into()),
            ),
            order::Outcome::Update => {
                self.order_unsupported = true;
                (
                    None,
                    Some("Update Colab · project ordering is unavailable.".into()),
                )
            }
            order::Outcome::Refused(message) => (None, Some(message)),
        };
        if let Some(order) = order {
            if list
                .orders
                .get(&target.project)
                .is_none_or(|held| order.revision >= held.revision)
            {
                list.orders.insert(target.project.clone(), order);
            }
            if self.order_blocked.as_ref() == Some(target) {
                self.order_blocked = None;
            }
        } else if !self.order_unsupported {
            self.order_blocked = Some(target.clone());
        }
        self.order_notice = message.map(|message| (target.clone(), message));
        self.hits.get_mut().clear();
    }
}

/// Colab 0.1.0-alpha.478 first carries the opt-in Work owner summaries.
const LAST_UNSUPPORTED: &str = "0.1.0-alpha.477";

#[derive(Debug)]
pub(super) enum ReadFailure {
    NotInstalled,
    UpdateNeeded,
    Unavailable(String),
}

impl ReadFailure {
    fn message(self) -> String {
        match self {
            Self::NotInstalled => "Colab is not installed.".into(),
            Self::UpdateNeeded => "Update Colab · Work requires the owner-summary list.".into(),
            Self::Unavailable(message) => message,
        }
    }
}

impl From<String> for ReadFailure {
    fn from(message: String) -> Self {
        Self::Unavailable(message)
    }
}

impl From<&str> for ReadFailure {
    fn from(message: &str) -> Self {
        Self::Unavailable(message.into())
    }
}

pub(super) fn read(core: &crate::core::Core) -> Result<List, ReadFailure> {
    let started = Instant::now();
    let output = core
        .json_finished(&["colab", "ls", "--work"], WITHIN)
        .map_err(|error| {
            format!(
                "Colab Work unavailable · {}",
                super::notes::single_line(&error.message)
            )
        })?;
    if !output.success {
        let error: serde_json::Value = if output.stdout.len() <= model::MAX_BYTES {
            serde_json::from_slice(&output.stdout).unwrap_or_default()
        } else {
            serde_json::Value::Null
        };
        let error = &error["error"];
        let message = error["message"].as_str().unwrap_or("check the owner space");
        match error["code"].as_str() {
            Some("EXTENSION_NOT_INSTALLED") => return Err(ReadFailure::NotInstalled),
            // Older Colab uses the general input error code for unknown options.
            Some("COLAB_INPUT_INVALID")
                if message.lines().next() == Some("error: unexpected argument '--work' found") =>
            {
                return Err(ReadFailure::UpdateNeeded);
            }
            _ => {}
        }
        return Err(format!(
            "Colab Work unavailable · {}",
            super::notes::single_line(message)
        )
        .into());
    }
    let list = List::decode_output(&output.stdout)?;
    if !list.has_summary {
        // An explicit retry must inspect the currently installed companion.
        let version = core
            .colab_version(WITHIN.saturating_sub(started.elapsed()))
            .ok_or("Colab Work unavailable · could not read the Colab version.")?;
        if version <= LAST_UNSUPPORTED.parse().expect("valid Colab version") {
            return Err(ReadFailure::UpdateNeeded);
        }
    }
    Ok(list)
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct OpenTarget {
    pub page: String,
    pub block: Option<String>,
}

pub(super) fn open(core: &crate::core::Core, target: &OpenTarget) -> Result<String, String> {
    let (link, notice) = open_link(core, target)?;
    crate::effects::open(&link, None)?;
    Ok(notice.into())
}

fn open_link(
    core: &crate::core::Core,
    target: &OpenTarget,
) -> Result<(String, &'static str), String> {
    let page = target.page.as_str();
    if !super::recent_responses::canonical_identity(page) {
        return Err("The Colab page ID is unavailable.".into());
    }
    let started = Instant::now();
    let page_args = ["colab", "open", page];
    let (value, block, notice) = if let Some(block) = target.block.as_deref() {
        let option = format!("--block={block}");
        match core.json_within(&["colab", "open", page, &option], WITHIN) {
            Err(error) if error.code == "COLAB_NOT_STRUCTURED" => (
                core.json_within(&page_args, WITHIN.saturating_sub(started.elapsed())),
                None,
                "Opened Colab page.",
            ),
            Err(error)
                if error.code == "COLAB_INPUT_INVALID"
                    && error.message.lines().next()
                        == Some("error: unexpected argument '--block' found") =>
            {
                (
                    core.json_within(&page_args, WITHIN.saturating_sub(started.elapsed())),
                    None,
                    "Opened the page; this Colab cannot open a section",
                )
            }
            result => (result, Some(block), "Opened Colab block."),
        }
    } else {
        (
            core.json_within(&page_args, WITHIN),
            None,
            "Opened Colab page.",
        )
    };
    let value = value.map_err(|error| super::notes::single_line(&error.message))?;
    if value["pageId"] != page {
        return Err("Colab did not confirm the selected page.".into());
    }
    if value["running"] != true {
        return Err("Colab is stopped · run tmt colab serve to open pages.".into());
    }
    let link = value["link"]
        .as_str()
        .or_else(|| value["shortLink"].as_str())
        .ok_or_else(|| "No Colab link · check serve and pairing.".to_owned())?;
    crate::effects::web_link(link)
        .map_err(|_| "Colab did not return a valid web link.".to_owned())?;
    if let Some(block) = block {
        let expected = format!("anchor=block-{block}");
        if link.split_once('#').map(|(_, fragment)| fragment) != Some(expected.as_str()) {
            return Err("Colab did not confirm the selected block.".into());
        }
    }
    Ok((link.to_owned(), notice))
}

pub(super) fn row_chip(item: &Item, count: usize) -> String {
    let number = item.number.as_deref().unwrap_or("—");
    let mark = item.status.mark();
    if count > 1 {
        format!("{mark} {number} +{}", count - 1)
    } else {
        format!("{mark} {number}")
    }
}

impl State {
    pub fn move_hit_visible(&self) -> bool {
        self.hits
            .borrow()
            .iter()
            .any(|(_, hit)| matches!(hit, surface::Hit::Move(_)))
    }

    pub fn has_project_orders(&self) -> bool {
        self.list
            .as_ref()
            .is_some_and(|list| !list.orders.is_empty())
    }

    pub fn open_hit_visible(&self) -> bool {
        !self.stale
            && self
                .hits
                .borrow()
                .iter()
                .any(|(_, hit)| matches!(hit, surface::Hit::Open(_)))
    }
}
