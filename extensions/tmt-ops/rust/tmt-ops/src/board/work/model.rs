use std::{cmp::Reverse, collections::BTreeMap, sync::Arc};

use serde_json::Value;

use crate::board::{
    notes::single_line, recent_responses::canonical_identity, workspace::OpsRoster,
};

use super::order::ProjectOrder;

const MAX_PAGES: usize = 1_000;
const MAX_TODOS: usize = 64;
pub(super) const MAX_BYTES: usize = 2 * 1024 * 1024;

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
    fn decode(value: &Value) -> Option<Self> {
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

    fn rank(self) -> u8 {
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

    pub fn overview(self) -> Option<usize> {
        Some(match self {
            Self::Working => 0,
            Self::WaitingCi | Self::WaitingRelease => 1,
            Self::NeedsYou => 2,
            Self::Blocked => 3,
            Self::Stalled => 4,
            Self::Discussing => 5,
            Self::Unknown | Self::Unchecked => 6,
            Self::Done => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(in crate::board) struct Progress {
    pub done: u64,
    pub total: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::board) struct Section {
    pub id: String,
    pub title: String,
    pub level: u8,
    pub done: u64,
    pub total: u64,
    pub state: Status,
}

#[derive(Debug)]
pub(in crate::board) struct Item {
    pub key: String,
    pub page: String,
    pub number: Option<String>,
    pub title: String,
    pub status: Status,
    pub needs_you: u64,
    pub high: bool,
    pub next: Option<String>,
    pub parent: Option<String>,
    pub owner: Option<String>,
    page_owner_id: Option<String>,
    pub todo: bool,
    binding_name: Option<String>,
    pub last: Option<i64>,
    pub done: Option<i64>,
    pub release: Option<String>,
    pub can_open: bool,
    pub blocked_since: Option<i64>,
    pub projects: Arc<[String]>,
    pub progress: Option<Progress>,
    pub sections: Arc<[Section]>,
    pub sections_omitted: bool,
}

fn html_ordinal(id: &str) -> bool {
    id.strip_prefix('h').is_some_and(|digits| {
        !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit())
    })
}

impl Item {
    fn open_block(&self, section: Option<usize>) -> Option<&str> {
        if self.todo {
            self.key.split_once(':').map(|(_, block)| block)
        } else {
            section
                .and_then(|index| self.sections.get(index))
                .map(|section| section.id.as_str())
        }
    }

    pub fn opens_block(&self, section: Option<usize>) -> bool {
        self.open_block(section).is_some_and(|id| !html_ordinal(id))
    }

    pub fn open_label(&self, section: Option<usize>) -> &'static str {
        if self.opens_block(section) {
            "Open block"
        } else {
            "Open page"
        }
    }

    pub fn open_target(&self, section: Option<usize>) -> super::OpenTarget {
        super::OpenTarget {
            page: self.page.clone(),
            block: self.open_block(section).map(str::to_owned),
        }
    }

    fn order(&self) -> (u8, Reverse<bool>, Reverse<i64>, &str) {
        (
            self.status.rank(),
            Reverse(self.high),
            Reverse(self.last.unwrap_or(0)),
            &self.key,
        )
    }

    pub fn owner_name<'a>(&'a self, roster: Option<&'a OpsRoster>) -> Option<&'a str> {
        self.page_owner_id
            .as_ref()
            .and_then(|id| roster?.members.get(id))
            .map(|member| member.name.as_str())
            .or(self.owner.as_deref())
    }

    pub fn owner_target(&self, roster: &OpsRoster) -> Option<crate::board::workspace::OpsTarget> {
        let id = if self.todo {
            let name = self.binding_name.as_deref()?;
            let mut matches = roster
                .members
                .iter()
                .filter(|(_, member)| member.name == name)
                .map(|(id, _)| id.as_str());
            let first = matches.next()?;
            if matches.next().is_some() {
                return None;
            }
            first
        } else {
            self.page_owner_id.as_deref()?
        };
        roster.members.get(id).map(|_| {
            let room_id = roster
                .squads
                .iter()
                .find(|squad| squad.members.iter().any(|member| member == id))
                .map(|squad| squad.room_id.clone());
            crate::board::workspace::OpsTarget::Member {
                room_id,
                identity_id: id.to_owned(),
            }
        })
    }

    pub fn matches_query(&self, query: &str, roster: Option<&OpsRoster>) -> bool {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return true;
        }
        let contains = |value: &str| value.to_lowercase().contains(&needle);
        self.number.as_deref().is_some_and(contains)
            || contains(&self.title)
            || contains(self.status.label())
            || self.owner_name(roster).is_some_and(contains)
            || self.next.as_deref().is_some_and(contains)
            || self.projects.iter().any(|project| contains(project))
            || self.sections.iter().any(|section| contains(&section.title))
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(in crate::board) struct Reference {
    pub number: String,
    pub title: String,
    pub status: Status,
    pub target: super::OpenTarget,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub(in crate::board) struct References(BTreeMap<String, Option<Reference>>);

impl References {
    fn add(&mut self, number: &str, title: &str, status: Status, page: &str, block: Option<&str>) {
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
                    target: super::OpenTarget {
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

#[derive(Debug)]
pub(in crate::board) struct List {
    pub space: String,
    pub projects: Vec<String>,
    pub items: Vec<Item>,
    pub references: Arc<References>,
    pub missing: usize,
    pub omitted: usize,
    pub has_summary: bool,
    pub(super) orders: BTreeMap<String, ProjectOrder>,
    pub(super) omitted_orders: std::collections::BTreeSet<String>,
}

fn text(value: &Value, max_bytes: usize) -> Option<String> {
    let raw = value.as_str()?;
    (raw.len() <= max_bytes)
        .then(|| single_line(raw).trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Sanitized labels can be displayed, but only unchanged text is binding evidence.
fn binding_name(raw: &Value, clean: &str) -> Option<String> {
    (raw.as_str() == Some(clean)).then(|| clean.to_owned())
}

fn names(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .take(MAX_PAGES)
        .filter_map(|name| text(name, 256))
        .scan(std::collections::BTreeSet::new(), |seen, name| {
            Some(seen.insert(name.clone()).then_some(name))
        })
        .flatten()
        .collect()
}

fn decode_sections(value: &Value) -> Arc<[Section]> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .take(MAX_TODOS)
        .filter_map(|section| {
            let id = text(&section["id"], 128)?;
            // Display text may be cleaned, but an opening target must be exact.
            binding_name(&section["id"], &id)?;
            let title = text(&section["title"], 256)?;
            let done = section["done"].as_u64()?;
            let total = section["total"].as_u64()?;
            let level = section["level"]
                .as_u64()
                .and_then(|value| u8::try_from(value).ok())
                .unwrap_or(2);
            let state = Status::decode(&section["state"]).unwrap_or(Status::Unknown);
            Some(Section {
                id,
                title,
                level,
                done,
                total,
                state,
            })
        })
        .collect::<Vec<_>>()
        .into()
}

fn decode_progress(value: &Value) -> Option<Progress> {
    let total = value["total"].as_u64()?;
    let done = value["done"].as_u64()?;
    (total > 0).then_some(Progress {
        done: done.min(total),
        total,
    })
}

fn time(value: &Value) -> Option<i64> {
    let at = value.as_i64()?;
    (0..=9_007_199_254_740_991).contains(&at).then_some(at)
}

impl List {
    pub fn decode_output(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_BYTES {
            return Err("Colab Work list exceeded its read limit.".into());
        }
        let value =
            serde_json::from_slice(bytes).map_err(|_| "Colab did not return an owner list.")?;
        Self::decode(&value)
    }

    pub fn decode(value: &Value) -> Result<Self, String> {
        let pages = value["pages"]
            .as_array()
            .ok_or("Colab did not return an owner list.")?;
        if value.get("spaceId").is_some_and(Value::is_null) && pages.is_empty() {
            return Err("Colab has no owner space · check Colab serve and pairing.".into());
        }
        let space = text(&value["spaceId"], 128).ok_or("Colab did not name its owner space.")?;
        if pages.len() > MAX_PAGES {
            return Err("Colab Work list exceeded its read limit.".into());
        }
        let mut list = Self {
            space,
            projects: names(&value["projects"]),
            items: Vec::new(),
            references: Default::default(),
            missing: 0,
            omitted: 0,
            has_summary: false,
            orders: BTreeMap::new(),
            omitted_orders: Default::default(),
        };
        let mut references = References::default();
        for page in pages {
            if page["archived"] == true {
                continue;
            }
            let Some(id) = page["pageId"].as_str().filter(|id| canonical_identity(id)) else {
                list.missing += 1;
                continue;
            };
            let summary = &page["summary"];
            let Some(status) = summary
                .is_object()
                .then(|| Status::decode(&summary["status"]))
                .flatten()
            else {
                list.missing += 1;
                continue;
            };
            list.has_summary = true;
            let fields = &summary["fields"];
            let projects: Arc<[String]> = names(&page["projects"]).into();
            for project in projects.iter() {
                if !list.projects.contains(project) {
                    list.projects.push(project.clone());
                }
            }
            let title = text(&page["title"], 4096).unwrap_or_else(|| "Untitled".into());
            let number = text(&page["workNumber"], 64);
            if let Some(number) = number.as_deref() {
                references.add(number, &title, status, id, None);
            }
            let last = time(&page["lastUpdateAtMs"]);
            let can_open = ["link", "shortLink"].into_iter().any(|key| {
                page[key]
                    .as_str()
                    .is_some_and(|url| crate::effects::web_link(url).is_ok())
            });
            let sections_omitted = summary["sectionsOmitted"] == true;
            let sections = decode_sections(&summary["sections"]);
            let progress = decode_progress(&summary["sectionProgress"]);
            let needs_you = summary["needsYou"].as_u64().unwrap_or(0);
            list.items.push(Item {
                key: id.into(),
                page: id.into(),
                number: number.clone(),
                title: title.clone(),
                status,
                needs_you,
                high: fields["priority"] == "high",
                next: (status == Status::Blocked)
                    .then(|| text(&fields["blocked"], 4096))
                    .flatten()
                    .or_else(|| text(&fields["next"], 4096)),
                parent: None,
                owner: text(&fields["owner"]["name"], 128),
                page_owner_id: fields["owner"]["id"]
                    .as_str()
                    .filter(|id| canonical_identity(id))
                    .map(str::to_owned),
                todo: false,
                binding_name: None,
                last,
                done: time(&summary["doneAtMs"]),
                release: text(&summary["release"], 256),
                blocked_since: time(&summary["blockedSinceMs"]),
                can_open,
                projects: projects.clone(),
                progress,
                sections,
                sections_omitted,
            });
            let todos = summary["todos"].as_array();
            if summary["todosOmitted"] == true || todos.is_some_and(|todos| todos.len() > MAX_TODOS)
            {
                list.omitted += 1;
                continue;
            }
            let parent = number.as_deref().unwrap_or(&title);
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
                let todo_title = text(&todo["text"], 256).unwrap_or_else(|| title.clone());
                if canonical_identity(block) {
                    references.add(&number, &todo_title, status, id, Some(block));
                }
                let Some(owner) = text(&todo["assignee"], 128) else {
                    continue;
                };
                list.items.push(Item {
                    key: format!("{id}:{block}"),
                    page: id.into(),
                    number: Some(number),
                    title: todo_title,
                    status,
                    needs_you: u64::from(status == Status::NeedsYou),
                    high: false,
                    next: (!checked && todo["ask"] == "answered").then(|| "Answered".into()),
                    parent: Some(format!("in {parent}")),
                    binding_name: binding_name(&todo["assignee"], &owner),
                    owner: Some(owner),
                    page_owner_id: None,
                    todo: true,
                    last,
                    done: time(&todo["doneAtMs"]),
                    release: None,
                    blocked_since: None,
                    can_open,
                    projects: projects.clone(),
                    progress: None,
                    sections: Arc::from([]),
                    sections_omitted: false,
                });
            }
        }
        for project in &list.projects {
            if let Some(order) = ProjectOrder::decode(&value["projectOrders"][project]) {
                list.orders.insert(project.clone(), order);
            }
        }
        list.omitted_orders = value["projectOrdersOmitted"]
            .as_array()
            .into_iter()
            .flatten()
            .take(MAX_PAGES)
            .filter_map(Value::as_str)
            .filter(|name| {
                !list.orders.contains_key(*name) && list.projects.iter().any(|p| p == name)
            })
            .map(str::to_owned)
            .collect();
        list.references = Arc::new(references);
        list.items.sort_by(|a, b| a.order().cmp(&b.order()));
        Ok(list)
    }

    pub fn project_progress(&self, project: &str) -> Option<Progress> {
        let mut seen = std::collections::BTreeSet::new();
        let mut done = 0_u64;
        let mut total = 0_u64;
        for item in &self.items {
            if item.todo
                || !item.projects.iter().any(|candidate| candidate == project)
                || !seen.insert(item.page.as_str())
            {
                continue;
            }
            if item.sections_omitted && item.progress.is_none() {
                return None;
            }
            if let Some(progress) = item.progress {
                done = done.saturating_add(progress.done);
                total = total.saturating_add(progress.total);
            }
        }
        (total > 0).then_some(Progress { done, total })
    }

    pub fn bindings<'a>(&'a self, roster: &'a OpsRoster) -> BTreeMap<&'a str, (&'a Item, usize)> {
        let mut result = BTreeMap::new();
        let mut unique = BTreeMap::new();
        for (id, member) in &roster.members {
            unique
                .entry(member.name.as_str())
                .and_modify(|entry| *entry = None)
                .or_insert(Some(id.as_str()));
        }
        for item in &self.items {
            if item.status != Status::Done
                && item.number.is_some()
                && let Some(id) = if item.todo {
                    item.binding_name
                        .as_deref()
                        .and_then(|name| unique.get(name).copied().flatten())
                } else {
                    item.page_owner_id
                        .as_ref()
                        .and_then(|id| roster.members.get_key_value(id))
                        .map(|(id, _)| id.as_str())
                }
            {
                result.entry(id).or_insert((item, 0)).1 += 1;
            }
        }
        result
    }
}
