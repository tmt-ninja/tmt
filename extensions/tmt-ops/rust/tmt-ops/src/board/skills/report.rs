//! Bounded Core skills reports and lane reads.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in crate::board) enum Syntax {
    /// The name follows this character: Claude Code `/`, Codex `$`.
    Prefix(char),
    /// No skill invocation: the menu lists TMT's skills and writes a sentence.
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub(in crate::board) enum Group {
    Tmt,
    Own,
    Project,
}

impl Group {
    pub(super) fn kind(self) -> &'static str {
        match self {
            Self::Tmt => "tmt",
            Self::Own => "own",
            Self::Project => "project",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Skill {
    pub name: String,
    pub description: String,
    pub group: Group,
}

/// One member's `skills.list` answer. Every name and description is display data.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Report {
    pub syntax: Syntax,
    pub driver: Option<String>,
    pub skills: Vec<Skill>,
    pub(super) stamp: String,
}

impl Report {
    pub(super) fn parse(value: &Value) -> Option<Self> {
        let syntax = match value["syntax"]["kind"].as_str()? {
            "prefix" => {
                let sigil = value["syntax"]["sigil"].as_str()?;
                let mut chars = sigil.chars();
                let (Some(sigil), None) = (chars.next(), chars.next()) else {
                    return None;
                };
                Syntax::Prefix(sigil)
            }
            "unsupported" => Syntax::Unsupported,
            _ => return None,
        };
        let skills = value["skills"]
            .as_array()?
            .iter()
            .filter_map(|skill| {
                let group = match skill["source"]["group"].as_str()? {
                    "tmt" => Group::Tmt,
                    "user" | "plugin" => Group::Own,
                    "project" => Group::Project,
                    _ => return None,
                };
                Some(Skill {
                    name: skill["name"].as_str()?.to_owned(),
                    description: skill["description"].as_str().unwrap_or_default().to_owned(),
                    group,
                })
            })
            .collect();
        Some(Self {
            syntax,
            driver: value["driver"].as_str().map(str::to_owned),
            skills,
            stamp: value["rootsStamp"].as_str()?.to_owned(),
        })
    }

    /// How a chosen skill is written for this recipient.
    pub(super) fn sent(&self, name: &str) -> String {
        match self.syntax {
            Syntax::Prefix(sigil) => format!("{sigil}{name}"),
            Syntax::Unsupported => format!("Please use {name}:"),
        }
    }

    /// The hint's example of what a chosen skill becomes.
    pub(super) fn sent_as(&self) -> String {
        match self.syntax {
            Syntax::Prefix(sigil) => format!("sent as {sigil}name"),
            Syntax::Unsupported => "sent as a sentence".to_owned(),
        }
    }

    pub(super) fn own_title(&self) -> String {
        match self.driver.as_deref() {
            Some("claude") => "Claude Code's own".to_owned(),
            Some("codex") => "Codex's own".to_owned(),
            _ => "The agent's own".to_owned(),
        }
    }

    pub(super) fn candidates(&self) -> Vec<(Candidate, String)> {
        self.skills
            .iter()
            .enumerate()
            .map(|(index, skill)| {
                (
                    Candidate {
                        id: format!("skill:{index}"),
                        kind: skill.group.kind().to_owned(),
                        label: skill.name.clone(),
                        insertion: format!("{TRIGGER}{}", skill.name),
                    },
                    skill.description.clone(),
                )
            })
            .collect()
    }

    pub(super) fn skill(&self, id: &str) -> Option<&Skill> {
        let index = id.strip_prefix("skill:")?.parse::<usize>().ok()?;
        self.skills.get(index)
    }
}

/// One read for the board's I/O lane.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Task {
    pub(super) identity: String,
    pub(super) stamp: Option<String>,
}

#[derive(Debug)]
pub(super) enum Outcome {
    Report(Report),
    Unchanged,
    /// An older Core, a refusal or a failed read: no skills, never an error to show.
    Unavailable,
}

#[derive(Debug)]
pub(in crate::board) struct Completed {
    pub(super) identity: String,
    pub(super) outcome: Outcome,
}

/// Runs on the I/O lane, never on paint or input.
pub(in crate::board) fn complete(core: &Core, task: Task) -> Completed {
    let mut input = json!({"identityId": task.identity});
    if let Some(stamp) = &task.stamp {
        input["ifStamp"] = json!(stamp);
    }
    let outcome = match core.api("skills.list", input) {
        Ok(value) if value["unchanged"] == json!(true) && task.stamp.is_some() => {
            Outcome::Unchanged
        }
        Ok(value) => Report::parse(&value).map_or(Outcome::Unavailable, Outcome::Report),
        Err(_) => Outcome::Unavailable,
    };
    Completed {
        identity: task.identity,
        outcome,
    }
}
