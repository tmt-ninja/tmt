use std::{cmp::Reverse, collections::BTreeMap, sync::Arc};

use serde_json::Value;

use crate::board::{
    notes::single_line, recent_responses::canonical_identity, workspace::OpsRoster,
};

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

    pub fn label(self) -> &'static str {
        match self {
            Self::Blocked => "✗ Blocked",
            Self::Stalled => "◷ Possibly stalled",
            Self::NeedsYou => "◆ Needs you",
            Self::Working => "● Working",
            Self::WaitingCi => "○ Waiting for CI",
            Self::WaitingRelease => "○ Waiting for release",
            Self::Discussing => "◇ Discussing",
            Self::Unchecked => "· Not checked yet",
            Self::Unknown => "· Unknown",
            Self::Done => "✓ Done",
        }
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

#[derive(Debug)]
pub(in crate::board) struct Item {
    pub key: String,
    pub page: String,
    pub number: Option<String>,
    pub title: String,
    pub status: Status,
    pub high: bool,
    pub next: Option<String>,
    pub owner: Option<String>,
    page_owner_id: Option<String>,
    todo: bool,
    binding_name: Option<String>,
    pub last: Option<i64>,
    pub done: Option<i64>,
    pub release: Option<String>,
    pub can_open: bool,
    pub blocked_since: Option<i64>,
    pub projects: Arc<[String]>,
}

impl Item {
    fn order(&self) -> (u8, Reverse<bool>, Reverse<i64>, &str) {
        (
            self.status.rank(),
            Reverse(self.high),
            Reverse(self.last.unwrap_or(0)),
            &self.key,
        )
    }

    pub fn binding<'a>(&self, roster: &'a OpsRoster) -> Result<Option<&'a str>, &'static str> {
        if self.owner.is_none() {
            return Ok(None);
        }
        if !self.todo {
            return self
                .page_owner_id
                .as_ref()
                .and_then(|id| roster.members.get_key_value(id))
                .map(|(id, _)| Some(id.as_str()))
                .ok_or("unbound");
        }
        let name = self.binding_name.as_ref().ok_or("unbound")?;
        let mut matches = roster
            .members
            .iter()
            .filter(|(_, member)| member.name == *name);
        let Some((id, _)) = matches.next() else {
            return Err("unbound");
        };
        if matches.next().is_some() {
            return Err("ambiguous");
        }
        Ok(Some(id))
    }
}

#[derive(Debug)]
pub(in crate::board) struct List {
    pub space: String,
    pub projects: Vec<String>,
    pub items: Vec<Item>,
    pub missing: usize,
    pub omitted: usize,
    pub has_summary: bool,
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
            missing: 0,
            omitted: 0,
            has_summary: false,
        };
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
            let last = time(&page["lastUpdateAtMs"]);
            let can_open = ["link", "shortLink"].into_iter().any(|key| {
                page[key]
                    .as_str()
                    .is_some_and(|url| crate::effects::web_link(url).is_ok())
            });
            list.items.push(Item {
                key: id.into(),
                page: id.into(),
                number: text(&page["workNumber"], 64),
                title: title.clone(),
                status,
                high: fields["priority"] == "high",
                next: (status == Status::Blocked)
                    .then(|| text(&fields["blocked"], 4096))
                    .flatten()
                    .or_else(|| text(&fields["next"], 4096)),
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
            });
            let todos = summary["todos"].as_array();
            if summary["todosOmitted"] == true || todos.is_some_and(|todos| todos.len() > MAX_TODOS)
            {
                list.omitted += 1;
                continue;
            }
            for todo in todos.into_iter().flatten() {
                let (Some(block), Some(number), Some(owner), Some(checked)) = (
                    todo["id"]
                        .as_str()
                        .filter(|id| !id.is_empty() && id.len() <= 128 && single_line(id) == *id),
                    text(&todo["number"], 64),
                    text(&todo["assignee"], 128),
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
                list.items.push(Item {
                    key: format!("{id}:{block}"),
                    page: id.into(),
                    number: Some(number),
                    title: text(&todo["text"], 256).unwrap_or_else(|| title.clone()),
                    status,
                    high: false,
                    next: Some(if !checked && todo["ask"] == "answered" {
                        "Answered".into()
                    } else {
                        title.clone()
                    }),
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
                });
            }
        }
        list.items.sort_by(|a, b| a.order().cmp(&b.order()));
        Ok(list)
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
