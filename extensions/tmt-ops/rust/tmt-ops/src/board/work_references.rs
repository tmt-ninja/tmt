//! One Colab owner-list read for Talk references and Agents ticket chips.
use super::{notes::single_line, recent_responses::canonical_identity, workspace::OpsRoster};
use serde_json::Value;
use std::{
    cmp::Reverse,
    collections::BTreeMap,
    sync::Arc,
    time::{Duration, Instant},
};

const WITHIN: Duration = Duration::from_secs(3);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::board) enum Status {
    Blocked,
    Stalled,
    NeedsYou,
    Working,
    WaitingCi,
    WaitingRelease,
    Discussing,
    Unchecked,
    Unknown,
    Done,
}

impl Status {
    pub(super) fn decode(value: &Value) -> Option<Self> {
        Some(match value.as_str() {
            Some("blocked") => Self::Blocked,
            Some("possibly-stalled") => Self::Stalled,
            Some("needs-you") => Self::NeedsYou,
            Some("working") => Self::Working,
            Some("waiting-ci") => Self::WaitingCi,
            Some("waiting-release") => Self::WaitingRelease,
            Some("discussing") => Self::Discussing,
            Some("unchecked") => Self::Unchecked,
            Some("unknown") => Self::Unknown,
            Some("done") => Self::Done,
            None if value.is_null() => Self::Unchecked,
            _ => return None,
        })
    }

    pub(super) fn rank(self) -> u8 {
        match self {
            Self::Blocked => 0,
            Self::Stalled => 1,
            Self::NeedsYou => 2,
            Self::Working => 3,
            Self::WaitingCi | Self::WaitingRelease => 4,
            _ => 5,
        }
    }

    pub fn mark(self) -> &'static str {
        match self {
            Self::Blocked => "✗",
            Self::Stalled => "◷",
            Self::NeedsYou => "◆",
            Self::Working => "●",
            Self::WaitingCi | Self::WaitingRelease => "○",
            Self::Discussing => "◇",
            Self::Unchecked | Self::Unknown => "·",
            Self::Done => "✓",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Blocked => "Blocked",
            Self::Stalled => "Possibly stalled",
            Self::NeedsYou => "Needs you",
            Self::Working => "In progress",
            Self::WaitingCi => "Waiting for CI",
            Self::WaitingRelease => "Waiting for release",
            Self::Discussing => "Discussing",
            Self::Unchecked => "Not checked yet",
            Self::Unknown => "Status unknown",
            Self::Done => "Done",
        }
    }

    pub fn marked_label(self) -> String {
        format!("{} {}", self.mark(), self.label())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(in crate::board) struct Reference {
    pub number: String,
    pub title: String,
    pub status: Status,
    pub target: OpenTarget,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(in crate::board) struct References(BTreeMap<String, Option<Reference>>);

impl References {
    pub(super) fn add(
        &mut self,
        number: &str,
        title: &str,
        status: Status,
        page: &str,
        block: Option<&str>,
    ) {
        let Some((prefix, serial)) = number.split_once('-') else {
            return;
        };
        if !(1..=6).contains(&prefix.len())
            || !prefix.bytes().all(|ch| ch.is_ascii_alphabetic())
            || !serial.bytes().all(|byte| byte.is_ascii_digit())
            || serial.parse::<u64>().ok().is_none_or(|serial| serial == 0)
        {
            return;
        }
        self.0
            .entry(number.to_ascii_uppercase())
            .and_modify(|entry| *entry = None)
            .or_insert_with(|| {
                Some(Reference {
                    number: number.to_ascii_uppercase(),
                    title: title.to_owned(),
                    status,
                    target: OpenTarget {
                        page: page.into(),
                        block: block.map(str::to_owned),
                    },
                })
            });
    }

    pub fn get(&self, number: &str) -> Option<&Reference> {
        if number.len() > 26 {
            return None;
        }
        self.0.get(&number.to_ascii_uppercase())?.as_ref()
    }

    pub fn iter(&self) -> impl Iterator<Item = &Reference> {
        self.0.values().filter_map(Option::as_ref)
    }
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

const MAX_PAGES: usize = 1_000;
const MAX_TODOS: usize = 64;
const MAX_BYTES: usize = 2 * 1024 * 1024;
const REFRESH_EVERY: Duration = Duration::from_secs(60);

#[derive(Debug)]
enum Owner {
    Page(String),
    Todo(String),
}

#[derive(Debug)]
pub(super) struct Binding {
    owner: Owner,
    number: String,
    status: Status,
    high: bool,
    updated: i64,
    key: String,
}

impl Binding {
    pub(super) fn chip(&self, count: usize) -> String {
        let chip = format!("{} {}", self.status.mark(), self.number);
        if count > 1 {
            format!("{chip} +{}", count - 1)
        } else {
            chip
        }
    }
}

#[derive(Debug)]
pub(in crate::board) struct Snapshot {
    space: String,
    references: Arc<References>,
    bindings: Vec<Binding>,
}

fn text(value: &Value, max_bytes: usize) -> Option<String> {
    let raw = value.as_str()?;
    (raw.len() <= max_bytes)
        .then(|| single_line(raw).trim().to_owned())
        .filter(|value| !value.is_empty())
}

impl Snapshot {
    pub(in crate::board) fn decode(value: &Value) -> Result<Self, String> {
        let pages = value["pages"]
            .as_array()
            .ok_or("Colab did not return an owner list.")?;
        let space = text(&value["spaceId"], 128).ok_or("Colab did not name its owner space.")?;
        if pages.len() > MAX_PAGES {
            return Err("Colab owner list exceeded its read limit.".into());
        }
        let mut references = References::default();
        let mut bindings = Vec::new();
        for page in pages {
            if page["archived"] == true {
                continue;
            }
            let Some(id) = page["pageId"].as_str().filter(|id| canonical_identity(id)) else {
                continue;
            };
            let summary = &page["summary"];
            let Some(status) = summary
                .is_object()
                .then(|| Status::decode(&summary["status"]))
                .flatten()
            else {
                continue;
            };
            let fields = &summary["fields"];
            let title = text(&page["title"], 4096).unwrap_or_else(|| "Untitled".into());
            let updated = page["lastUpdateAtMs"]
                .as_i64()
                .filter(|at| (0..=9_007_199_254_740_991).contains(at))
                .unwrap_or_default();
            if let Some(number) = text(&page["workNumber"], 64) {
                references.add(&number, &title, status, id, None);
                if let Some(owner) = fields["owner"]["id"]
                    .as_str()
                    .filter(|id| canonical_identity(id))
                    && status != Status::Done
                {
                    bindings.push(Binding {
                        owner: Owner::Page(owner.into()),
                        number,
                        status,
                        high: fields["priority"] == "high",
                        updated,
                        key: id.into(),
                    });
                }
            }
            let todos = summary["todos"].as_array();
            if summary["todosOmitted"] == true || todos.is_some_and(|todos| todos.len() > MAX_TODOS)
            {
                continue;
            }
            for todo in todos.into_iter().flatten() {
                let (Some(block), Some(number), Some(checked)) = (
                    todo["id"]
                        .as_str()
                        .filter(|id| !id.is_empty() && id.len() <= 128 && single_line(id) == *id),
                    text(&todo["number"], 64),
                    todo["checked"].as_bool(),
                ) else {
                    continue;
                };
                let status = if checked {
                    Status::Done
                } else {
                    match todo["ask"].as_str() {
                        Some("needs-you") => Status::NeedsYou,
                        Some("sent" | "answered") => Status::Working,
                        _ => Status::Discussing,
                    }
                };
                if canonical_identity(block) {
                    let todo_title = text(&todo["text"], 256).unwrap_or_else(|| title.clone());
                    references.add(&number, &todo_title, status, id, Some(block));
                }
                if let Some(owner) = text(&todo["assignee"], 128)
                    && todo["assignee"] == owner
                    && status != Status::Done
                {
                    bindings.push(Binding {
                        owner: Owner::Todo(owner),
                        number,
                        status,
                        high: false,
                        updated,
                        key: format!("{id}:{block}"),
                    });
                }
            }
        }
        let order = |binding: &Binding| {
            (
                binding.status.rank(),
                Reverse(binding.high),
                Reverse(binding.updated),
            )
        };
        bindings.sort_by(|a, b| order(a).cmp(&order(b)).then_with(|| a.key.cmp(&b.key)));
        Ok(Self {
            space,
            references: Arc::new(references),
            bindings,
        })
    }

    fn bindings<'a>(&'a self, roster: &'a OpsRoster) -> BTreeMap<&'a str, (&'a Binding, usize)> {
        let mut unique = BTreeMap::new();
        for (id, member) in &roster.members {
            unique
                .entry(member.name.as_str())
                .and_modify(|entry| *entry = None)
                .or_insert(Some(id.as_str()));
        }
        let mut bound = BTreeMap::new();
        for binding in &self.bindings {
            let id = match &binding.owner {
                Owner::Todo(name) => unique.get(name.as_str()).copied().flatten(),
                Owner::Page(id) => roster.members.get_key_value(id).map(|(id, _)| id.as_str()),
            };
            if let Some(id) = id {
                bound.entry(id).or_insert((binding, 0usize)).1 += 1;
            }
        }
        bound
    }
}

#[derive(Debug)]
pub(super) enum ReadFailure {
    NotInstalled,
    UpdateNeeded,
    Unavailable,
}

pub(super) fn read(core: &crate::core::Core) -> Result<Snapshot, ReadFailure> {
    let output = core
        .json_finished(&["colab", "ls", "--work"], WITHIN)
        .map_err(|_| ReadFailure::Unavailable)?;
    if output.stdout.len() > MAX_BYTES {
        return Err(ReadFailure::Unavailable);
    }
    let value: Value =
        serde_json::from_slice(&output.stdout).map_err(|_| ReadFailure::Unavailable)?;
    if output.success {
        return Snapshot::decode(&value).map_err(|_| ReadFailure::Unavailable);
    }
    let error = &value["error"];
    Err(match error["code"].as_str() {
        Some("EXTENSION_NOT_INSTALLED") => ReadFailure::NotInstalled,
        Some("COLAB_INPUT_INVALID")
            if error["message"]
                .as_str()
                .and_then(|message| message.lines().next())
                == Some("error: unexpected argument '--work' found") =>
        {
            ReadFailure::UpdateNeeded
        }
        _ => ReadFailure::Unavailable,
    })
}

#[derive(Debug, Default)]
pub(in crate::board) struct State {
    snapshot: Option<Snapshot>,
    stale: bool,
    pending: bool,
    next_read: Option<Instant>,
    explicit_refresh: bool,
    needs_update: bool,
}

impl State {
    pub fn references(&self) -> Option<&Arc<References>> {
        self.snapshot.as_ref().map(|snapshot| &snapshot.references)
    }

    pub fn bindings<'a>(
        &'a self,
        roster: &'a OpsRoster,
    ) -> BTreeMap<&'a str, (&'a Binding, usize)> {
        self.snapshot
            .as_ref()
            .filter(|_| !self.stale)
            .map_or_else(BTreeMap::new, |snapshot| snapshot.bindings(roster))
    }

    pub fn request(&mut self, now: Instant) -> bool {
        if self.pending
            || (!self.explicit_refresh
                && (self.needs_update || self.next_read.is_some_and(|next| now < next)))
        {
            return false;
        }
        self.pending = true;
        self.explicit_refresh = false;
        true
    }

    pub fn refresh(&mut self) {
        self.explicit_refresh = true;
    }

    pub fn cancel(&mut self, now: Instant) {
        self.pending = false;
        self.next_read = Some(now + REFRESH_EVERY);
    }

    pub fn apply(&mut self, now: Instant, read: Result<Snapshot, ReadFailure>) {
        // Count from completion, including time queued behind other worker jobs.
        self.cancel(now);
        self.needs_update = matches!(
            &read,
            Err(ReadFailure::NotInstalled | ReadFailure::UpdateNeeded)
        );
        match read {
            Ok(mut snapshot) => {
                if let Some(previous) = &self.snapshot
                    && previous.space == snapshot.space
                    && previous.references == snapshot.references
                {
                    snapshot.references = previous.references.clone();
                }
                self.snapshot = Some(snapshot);
                self.stale = false;
            }
            Err(_) => self.stale = self.snapshot.is_some(),
        }
    }
}

#[cfg(test)]
pub(in crate::board) mod tests;
