//! The Colab project order, separate from attention order and work status.
use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use crate::board::{notes::single_line, recent_responses::canonical_identity};

use super::{Item, Status};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct ProjectOrder {
    pub revision: i64,
    pub items: Vec<String>,
}

impl ProjectOrder {
    pub fn decode(value: &Value) -> Option<Self> {
        let revision = value["revision"]
            .as_i64()
            .filter(|revision| (0..=9_007_199_254_740_991).contains(revision))?;
        let items = value["items"].as_array()?;
        if items.len() > 256 {
            return None;
        }
        let mut unique = BTreeSet::new();
        let items = items
            .iter()
            .map(|item| {
                let key = item.as_str()?;
                let (page, block) = key
                    .split_once(':')
                    .map_or((key, None), |(page, block)| (page, Some(block)));
                (canonical_identity(page)
                    && block.is_none_or(|block| {
                        !block.is_empty()
                            && block.len() <= 128
                            && !block.contains(':')
                            && single_line(block) == block
                    })
                    && unique.insert(key))
                .then(|| key.to_owned())
            })
            .collect::<Option<_>>()?;
        Some(Self { revision, items })
    }

    pub fn next<'a>(&self, open: &[&'a Item]) -> Vec<&'a Item> {
        let available: BTreeMap<_, _> = open
            .iter()
            .copied()
            .filter(|item| !now(item.status) && item.status != Status::Done)
            .map(|item| (item.key.as_str(), item))
            .collect();
        self.items
            .iter()
            .filter_map(|key| available.get(key.as_str()).copied())
            .collect()
    }
}

pub(super) fn now(status: Status) -> bool {
    matches!(
        status,
        Status::Working
            | Status::WaitingCi
            | Status::WaitingRelease
            | Status::Blocked
            | Status::NeedsYou
            | Status::Stalled
    )
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::board) struct Target {
    pub space: String,
    pub project: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) enum Position {
    Before(String),
    Last,
    Unrank,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(in crate::board) struct Move {
    pub(super) target: Target,
    pub(super) key: String,
    pub(super) revision: i64,
    pub(super) position: Position,
}

#[derive(Clone, Debug)]
pub(in crate::board) enum Job {
    Show(Target),
    Move(Move),
}

impl Job {
    pub fn target(&self) -> &Target {
        match self {
            Self::Show(target) => target,
            Self::Move(task) => &task.target,
        }
    }
}

#[derive(Debug)]
pub(in crate::board) struct Reply {
    pub(super) job: Job,
    pub(super) outcome: Outcome,
}

#[derive(Debug)]
pub(super) enum Outcome {
    Read(ProjectOrder),
    Saved(ProjectOrder),
    Conflict(Option<ProjectOrder>),
    Uncertain(Option<ProjectOrder>),
    Update,
    Refused(String),
}

fn output(
    core: &crate::core::Core,
    options: &[&str],
    operands: &[&str],
) -> Option<Result<Value, Value>> {
    let result = core
        .json_finished_with_operands(options, operands, super::WITHIN)
        .ok()?;
    if result.stdout.len() > super::model::MAX_BYTES {
        return None;
    }
    let body: Value = serde_json::from_slice(&result.stdout).ok()?;
    if result.success {
        Some(Ok(body))
    } else if body["error"]["code"].is_string() {
        Some(Err(body))
    } else {
        None
    }
}

fn show(core: &crate::core::Core, project: &str) -> Option<Result<Value, Value>> {
    output(core, &["colab", "work", "order", "show"], &[project])
}

impl Move {
    fn send(&self, core: &crate::core::Core) -> Option<Result<Value, Value>> {
        let revision = self.revision.to_string();
        let mut options = vec!["colab", "work", "order", "move", "--revision", &revision];
        match &self.position {
            Position::Before(anchor) => options.extend(["--before", anchor]),
            Position::Last => options.push("--last"),
            Position::Unrank => options.push("--unrank"),
        }
        output(core, &options, &[&self.target.project, &self.key])
    }
}

fn unsupported(value: &Value) -> bool {
    value["error"]["code"] == "COLAB_INPUT_INVALID"
        && matches!(
            value["error"]["message"]
                .as_str()
                .and_then(|text| text.lines().next()),
            Some(
                "error: unrecognized subcommand 'work'"
                    | "error: unrecognized subcommand 'order'"
                    | "error: unrecognized subcommand 'move'"
                    | "error: unrecognized subcommand 'show'"
            )
        )
}

fn refusal(value: &Value) -> Option<String> {
    let message = value["error"]["message"].as_str()?;
    Some(single_line(message).chars().take(512).collect())
}

/// Only a confirmed Move job writes. A lost response or conflict reads
/// the owner once and never submits a second write.
pub(in crate::board) fn run(core: &crate::core::Core, job: Job) -> Reply {
    let project = &job.target().project;
    let body = match &job {
        Job::Show(_) => show(core, project),
        Job::Move(task) => task.send(core),
    };
    let read = || {
        show(core, project)
            .and_then(Result::ok)
            .as_ref()
            .and_then(ProjectOrder::decode)
    };
    let order = body
        .as_ref()
        .and_then(|result| result.as_ref().ok())
        .and_then(ProjectOrder::decode);
    let outcome = match (&job, body, order) {
        (_, Some(Err(value)), _) if unsupported(&value) => Outcome::Update,
        (Job::Show(_), _, Some(order)) => Outcome::Read(order),
        (Job::Show(_), body, _) => Outcome::Refused(
            body.as_ref()
                .and_then(|result| result.as_ref().err())
                .and_then(refusal)
                .unwrap_or_else(|| "Project order unavailable.".into()),
        ),
        (Job::Move(_), _, Some(order)) => Outcome::Saved(order),
        (Job::Move(_), Some(Err(value)), _) if value["error"]["code"] == "COLAB_ORDER_CONFLICT" => {
            Outcome::Conflict(read())
        }
        (Job::Move(_), Some(Err(value)), _)
            if value["error"]["code"] == "COLAB_OUTCOME_UNKNOWN" =>
        {
            Outcome::Uncertain(read())
        }
        (Job::Move(_), Some(Err(value)), _) => {
            Outcome::Refused(refusal(&value).unwrap_or_else(|| "Colab refused the move.".into()))
        }
        (Job::Move(_), _, _) => Outcome::Uncertain(read()),
    };
    Reply { job, outcome }
}
