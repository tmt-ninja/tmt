//! Colab work-number references used by the Talk composer and transcript.
use std::{collections::BTreeMap, time::Duration};

pub(super) const WITHIN: Duration = Duration::from_secs(3);

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

pub(super) fn open_link(
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
