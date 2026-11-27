//! A built-in member's extra terminals on the board (#5991): login shells Core opens under the
//! member (`terminal.open`, `terminal.list`, `terminal.close`). Core keeps no record of a terminal
//! once its shell ends; the board keeps the row it last saw, greyed as ended, for this session
//! only, so the tree does not lose a terminal the person was looking at. Nothing here is saved.
//! Every Core call runs on the lane ([`complete`]); the loop only asks [`Terminals::offer`] for
//! the next one and applies what comes back.
use crate::{board::workspace::OpsTarget, core::Core};
use std::{
    cell::RefCell,
    collections::{BTreeMap, VecDeque},
    path::PathBuf,
    time::Duration,
};

/// How old the selected member's list may get before Core is asked again.
const SELECTED_FOR_MS: u64 = 2_000;
/// How long a member with no built-in terminal is believed before it is asked again.
const UNAVAILABLE_FOR_MS: u64 = 60_000;
/// Each `terminal.list` asks every supervisor within 500 ms; this leaves room for the process.
const LIST_WITHIN: Duration = Duration::from_secs(3);
/// Opening waits for the new supervisor to confirm; closing for it to end.
const ACT_WITHIN: Duration = Duration::from_secs(10);

/// One terminal row under a member.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Row {
    pub id: String,
    /// "Terminal N": numbered per member in the order this board first saw them.
    pub number: u32,
    pub socket: PathBuf,
    /// A program other than the shell runs in the foreground.
    pub busy: bool,
    /// Core no longer lists it: its shell ended.
    pub ended: bool,
    /// The shell's name as Core last reported it (#6112); kept once it ended.
    pub shell: Option<String>,
    /// The foreground program's name, only while `busy` and Core knows it.
    pub program: Option<String>,
}

impl Row {
    pub(in crate::board) fn title(&self) -> String {
        format!("Terminal {}", self.number)
    }
}

/// One terminal as Core lists it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Listed {
    pub id: String,
    pub socket: PathBuf,
    pub busy: bool,
    pub created_ms: u64,
    pub shell: Option<String>,
    pub program: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum List {
    Terminals(Vec<Listed>),
    /// Not a bound member, or its owner is gone: it has no terminals.
    Unavailable,
    Failed(String),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum Task {
    List(Vec<String>),
    Open(String),
    Close {
        identity: String,
        terminal: String,
        force: bool,
    },
}

impl Task {
    /// Listing is quiet; explicit terminal actions show their progress.
    pub(in crate::board) fn progress(&self) -> Option<&'static str> {
        match self {
            Self::List(_) => None,
            Self::Open(_) => Some("Opening a terminal…"),
            Self::Close { .. } => Some("Closing the terminal…"),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum Completed {
    Listed(Vec<(String, List)>),
    Opened {
        identity: String,
        outcome: Result<Listed, String>,
    },
    Closed {
        identity: String,
        terminal: String,
        outcome: Result<(), String>,
    },
}

/// What the board does after a result: select a new row, say something, or both.
#[derive(Debug, Default, PartialEq, Eq)]
pub(in crate::board) struct Applied {
    pub select: Option<(String, String)>,
    pub notice: Option<String>,
}

#[derive(Default)]
struct Member {
    rows: Vec<Row>,
    /// The last number given; numbers are never reused while a row shows.
    numbered: u32,
    listed_ms: Option<u64>,
    unavailable_ms: Option<u64>,
}

pub(in crate::board) struct Terminals {
    members: BTreeMap<String, Member>,
    /// Members whose terminal rows are folded away.
    /// Terminal actions the person confirmed, in order.
    queued: VecDeque<Task>,
    /// A task is on the lane; the next waits for its result.
    out: bool,
    /// Every member was listed once after the board started.
    swept: bool,
    /// Core is asked on its own: the start sweep and the selected member's re-list. Always on
    /// in production; the test default turns it off so a strict stand-in lane sees only the
    /// jobs a test asks for (#6301).
    automatic: bool,
    /// Keys go to this terminal in the right panel until the back key.
    typing: Option<String>,
    /// The selected terminal panel painted in the latest frame.
    panel: RefCell<Option<(String, ratatui::layout::Rect)>>,
}

impl Default for Terminals {
    /// `automatic` is off only in tests; this module's tests turn it on to cover the sweep and
    /// the re-list (#6301).
    fn default() -> Self {
        Self {
            members: BTreeMap::new(),
            queued: VecDeque::new(),
            out: false,
            swept: false,
            automatic: !cfg!(test),
            typing: None,
            panel: RefCell::new(None),
        }
    }
}

impl Terminals {
    pub(in crate::board) fn clear_panel(&self) {
        self.panel.borrow_mut().take();
    }

    pub(in crate::board) fn drew_panel(&self, id: &str, area: ratatui::layout::Rect) {
        *self.panel.borrow_mut() = Some((id.to_owned(), area));
    }

    pub(in crate::board) fn panel_contains(
        &self,
        id: &str,
        point: ratatui::layout::Position,
    ) -> bool {
        self.panel
            .borrow()
            .as_ref()
            .is_some_and(|(shown, area)| shown == id && area.contains(point))
    }
    /// The terminal rows shown under `identity`, oldest first.
    pub(in crate::board) fn rows(&self, identity: &str) -> &[Row] {
        self.members
            .get(identity)
            .map_or(&[], |member| member.rows.as_slice())
    }

    pub(in crate::board) fn row(&self, identity: &str, terminal: &str) -> Option<&Row> {
        self.rows(identity).iter().find(|row| row.id == terminal)
    }

    /// The member and row of `terminal`, wherever it is listed.
    pub(in crate::board) fn find(&self, terminal: &str) -> Option<(&str, &Row)> {
        self.members.iter().find_map(|(identity, member)| {
            member
                .rows
                .iter()
                .find(|row| row.id == terminal)
                .map(|row| (identity.as_str(), row))
        })
    }

    pub(in crate::board) fn typing(&self) -> Option<&str> {
        self.typing.as_deref()
    }

    pub(in crate::board) fn set_typing(&mut self, terminal: Option<&str>) {
        self.typing = terminal.map(str::to_owned);
    }

    pub(in crate::board) fn open(&mut self, identity: &str) {
        self.queued.push_back(Task::Open(identity.to_owned()));
    }

    pub(in crate::board) fn close(&mut self, identity: &str, terminal: &str, force: bool) {
        self.queued.push_back(Task::Close {
            identity: identity.to_owned(),
            terminal: terminal.to_owned(),
            force,
        });
    }

    /// Drops an ended row; Core is never asked about it.
    pub(in crate::board) fn forget(&mut self, identity: &str, terminal: &str) -> bool {
        let Some(member) = self.members.get_mut(identity) else {
            return false;
        };
        let before = member.rows.len();
        member.rows.retain(|row| !(row.ended && row.id == terminal));
        before != member.rows.len()
    }

    /// The next Core call for the lane, if one is due: what the person asked for first, then one
    /// list of every member after start, then the selected member's list when it is old.
    pub(in crate::board) fn offer(
        &mut self,
        members: &[String],
        selected: Option<&str>,
        now_ms: u64,
    ) -> Option<Task> {
        if self.out {
            return None;
        }
        let task = self.queued.pop_front().or_else(|| {
            if !self.automatic {
                return None;
            }
            if !self.swept && !members.is_empty() {
                self.swept = true;
                return Some(Task::List(members.to_vec()));
            }
            let identity = selected?;
            let member = self.members.get(identity);
            let unavailable = member
                .and_then(|member| member.unavailable_ms)
                .is_some_and(|at| now_ms < at + UNAVAILABLE_FOR_MS);
            let fresh = member
                .and_then(|member| member.listed_ms)
                .is_some_and(|at| now_ms < at + SELECTED_FOR_MS);
            (!unavailable && !fresh).then(|| Task::List(vec![identity.to_owned()]))
        })?;
        self.out = true;
        Some(task)
    }

    pub(in crate::board) fn finished(&mut self, completed: Completed, now_ms: u64) -> Applied {
        self.out = false;
        match completed {
            Completed::Listed(lists) => {
                for (identity, list) in lists {
                    self.listed(&identity, list, now_ms);
                }
                Applied::default()
            }
            Completed::Opened {
                identity,
                outcome: Ok(opened),
            } => {
                let terminal = opened.id.clone();
                self.add(&identity, opened);
                Applied {
                    select: Some((identity, terminal)),
                    notice: None,
                }
            }
            Completed::Opened {
                identity,
                outcome: Err(message),
            } => {
                self.expire(&identity);
                Applied {
                    select: None,
                    notice: Some(message),
                }
            }
            Completed::Closed {
                identity,
                terminal,
                outcome,
            } => {
                if let Some(member) = self.members.get_mut(&identity) {
                    member
                        .rows
                        .retain(|row| row.id != terminal || outcome.is_err());
                }
                self.expire(&identity);
                Applied {
                    select: None,
                    notice: outcome.err(),
                }
            }
        }
    }

    /// The member's list is asked again on the next pass.
    fn expire(&mut self, identity: &str) {
        if let Some(member) = self.members.get_mut(identity) {
            member.listed_ms = None;
        }
    }

    fn listed(&mut self, identity: &str, list: List, now_ms: u64) {
        match list {
            List::Terminals(mut listed) => {
                listed.sort_by(|a, b| a.created_ms.cmp(&b.created_ms).then(a.id.cmp(&b.id)));
                let member = self.members.entry(identity.to_owned()).or_default();
                member.listed_ms = Some(now_ms);
                member.unavailable_ms = None;
                for row in &mut member.rows {
                    row.ended = !listed.iter().any(|terminal| terminal.id == row.id);
                }
                for terminal in listed {
                    self.add(identity, terminal);
                }
            }
            // The member is closed or unbound: nothing it owned is shown.
            List::Unavailable => {
                let member = self.members.entry(identity.to_owned()).or_default();
                member.rows.clear();
                member.listed_ms = Some(now_ms);
                member.unavailable_ms = Some(now_ms);
            }
            // Kept as last seen; asked again when it is due.
            List::Failed(_) => {
                if let Some(member) = self.members.get_mut(identity) {
                    member.listed_ms = Some(now_ms);
                }
            }
        }
    }

    fn add(&mut self, identity: &str, terminal: Listed) {
        let member = self.members.entry(identity.to_owned()).or_default();
        if let Some(row) = member.rows.iter_mut().find(|row| row.id == terminal.id) {
            row.busy = terminal.busy;
            row.ended = false;
            row.shell = terminal.shell.or(row.shell.take());
            row.program = terminal.program;
            return;
        }
        member.numbered += 1;
        member.rows.push(Row {
            id: terminal.id,
            number: member.numbered,
            socket: terminal.socket,
            busy: terminal.busy,
            ended: false,
            shell: terminal.shell,
            program: terminal.program,
        });
    }
}

/// The selection target of one terminal row, under the member row it belongs to.
pub(in crate::board) fn target(member: &OpsTarget, terminal: &str) -> Option<OpsTarget> {
    let OpsTarget::Member {
        room_id,
        identity_id,
    } = member
    else {
        return None;
    };
    Some(OpsTarget::Terminal {
        room_id: room_id.clone(),
        identity_id: identity_id.clone(),
        terminal_id: terminal.to_owned(),
    })
}

/// One lane task through Core. Runs on the lane, never the loop.
pub(in crate::board) fn complete(core: &Core, task: Task) -> Completed {
    match task {
        Task::List(identities) => Completed::Listed(list(core, identities)),
        Task::Open(identity) => {
            let outcome = core
                .api_within(
                    "terminal.open",
                    serde_json::json!({"identityId": identity}),
                    ACT_WITHIN,
                )
                .map_err(|error| match error.code.as_str() {
                    "TERMINAL_LIMIT" => "This member already has 8 terminals.".to_owned(),
                    _ => crate::board::notes::single_line(&error.message),
                })
                .and_then(|value| {
                    listed(&value).ok_or_else(|| "Core's answer named no terminal.".to_owned())
                });
            Completed::Opened { identity, outcome }
        }
        Task::Close {
            identity,
            terminal,
            force,
        } => {
            let outcome = match core.api_within(
                "terminal.close",
                serde_json::json!({"terminalId": terminal, "force": force}),
                ACT_WITHIN,
            ) {
                Ok(_) => Ok(()),
                // Already gone: closing it is done.
                Err(error) if error.code == "TERMINAL_NOT_FOUND" => Ok(()),
                Err(error) => Err(crate::board::notes::single_line(&error.message)),
            };
            Completed::Closed {
                identity,
                terminal,
                outcome,
            }
        }
    }
}

/// Every member's terminals in one Core call (#6301), so a sweep of a whole board is one lane
/// job however many members it has. A member Core leaves out has no stored binding.
fn list(core: &Core, identities: Vec<String>) -> Vec<(String, List)> {
    match core.api_within(
        "terminal.list",
        serde_json::json!({"identityIds": identities}),
        LIST_WITHIN,
    ) {
        Ok(value) => {
            let lists = value["lists"].as_array().cloned().unwrap_or_default();
            identities
                .into_iter()
                .map(|identity| {
                    let list = lists
                        .iter()
                        .find(|entry| entry["identityId"] == identity.as_str())
                        .map_or(List::Unavailable, |entry| {
                            List::Terminals(
                                entry["terminals"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .filter_map(listed)
                                    .collect(),
                            )
                        });
                    (identity, list)
                })
                .collect()
        }
        Err(error) => {
            let failed = crate::board::notes::single_line(&error.message);
            identities
                .into_iter()
                .map(|identity| (identity, List::Failed(failed.clone())))
                .collect()
        }
    }
}

/// One terminal from Core's answer; its id must have Core's shape.
fn listed(value: &serde_json::Value) -> Option<Listed> {
    let id = value["terminalId"].as_str()?;
    let shaped = id.strip_prefix("term_").is_some_and(|hex| {
        hex.len() == 32
            && hex
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    });
    let socket = PathBuf::from(value["socket"].as_str()?);
    (shaped && socket.is_absolute()).then(|| Listed {
        id: id.to_owned(),
        socket,
        busy: value["busy"].as_bool().unwrap_or(false),
        created_ms: value["createdMs"].as_u64().unwrap_or(0),
        shell: name(&value["shell"]),
        program: name(&value["program"]).filter(|_| value["busy"] == true),
    })
}

/// A shell or program name from Core: display text only. Core cleans and bounds it;
/// the board drops control characters again before it can reach the screen.
fn name(value: &serde_json::Value) -> Option<String> {
    let name: String = value
        .as_str()?
        .chars()
        .filter(|c| !c.is_control())
        .take(64)
        .collect();
    let name = name.trim();
    (!name.is_empty()).then(|| name.to_owned())
}

mod board;
mod keys;
pub(in crate::board) mod panel;
#[cfg(test)]
pub(in crate::board) mod scenes;

pub(in crate::board) use keys::is_terminal_key;

#[cfg(test)]
mod tests;
