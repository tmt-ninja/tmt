//! Read-only Work home projection from the Colab owner list (#6474).
mod model;
mod surface;
#[cfg(test)]
pub(in crate::board) mod tests;

use std::{
    cell::RefCell,
    time::{Duration, Instant},
};

use ratatui::layout::Rect;

pub(super) use model::{Item, List, Status};
pub(super) use surface::render;

const WITHIN: Duration = Duration::from_secs(3);
const REFRESH_EVERY: Duration = Duration::from_secs(60);

#[derive(Debug, Default)]
pub(in crate::board) struct State {
    pub list: Option<List>,
    pub notice: Option<String>,
    pub stale: bool,
    pending: bool,
    next_read: Option<Instant>,
    explicit_refresh: bool,
    needs_update: bool,
    pub selected: Option<String>,
    pub project: Option<String>,
    pub recent: bool,
    pub period: usize,
    pub expanded: std::collections::BTreeSet<Option<String>>,
    pub hits: RefCell<Vec<(Rect, surface::Hit)>>,
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

    pub fn apply(&mut self, now: Instant, read: Result<List, ReadFailure>) {
        // Count from completion so time queued behind another worker job
        // cannot make two automatic Colab invocations land in one minute.
        self.cancel(now);
        self.needs_update = matches!(
            &read,
            Err(ReadFailure::NotInstalled | ReadFailure::UpdateNeeded)
        );
        match read {
            Ok(list) => {
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
                }
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
            }
            Err(error) => {
                self.stale = self.list.is_some();
                self.notice = Some(error.message());
            }
        }
        self.hits.get_mut().clear();
    }
}

/// Versions below the shared owner-list projection. Pin the containing release
/// once it ships; a development build can still prove support by its wire shape.
const LAST_UNSUPPORTED: &str = "0.1.0-alpha.472";

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
        .json_finished(&["colab", "ls"], WITHIN)
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
        if error["error"]["code"] == "EXTENSION_NOT_INSTALLED" {
            return Err(ReadFailure::NotInstalled);
        }
        let message = error["error"]["message"]
            .as_str()
            .unwrap_or("check the owner space");
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

pub(super) fn open(core: &crate::core::Core, page: &str) -> Result<(), String> {
    if !super::recent_responses::canonical_identity(page) {
        return Err("The Colab page ID is unavailable.".into());
    }
    let value = core
        .json_within(&["colab", "open", page], WITHIN)
        .map_err(|error| super::notes::single_line(&error.message))?;
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
    crate::effects::open(link, None)
}

/// A whole chip uses the same status and attention order as Work home.
pub(super) fn chip(item: &Item, count: usize) -> String {
    let number = item.number.as_deref().unwrap_or("—");
    let status = item.status.marked_label();
    if count > 1 {
        format!("{number} · {status} +{}", count - 1)
    } else {
        format!("{number} · {status}")
    }
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
    pub fn open_hit_visible(&self) -> bool {
        !self.stale
            && self
                .hits
                .borrow()
                .iter()
                .any(|(_, hit)| matches!(hit, surface::Hit::Open(_)))
    }
}
