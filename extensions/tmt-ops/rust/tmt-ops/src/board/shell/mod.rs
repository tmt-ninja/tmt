//! Session-only shell selection. The host supplies the current input owner;
//! terminal input, effects, drafts and conversation state remain with App.

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum OpsTab {
    #[default]
    Agents,
    Digest,
    Orchestration,
}

impl OpsTab {
    pub fn label(self) -> &'static str {
        match self {
            Self::Agents => "Agents",
            Self::Digest => "Digest",
            Self::Orchestration => "Orchestration",
        }
    }
}

/// The right column of the Agents tab: the selected agent's conversation, or the measures of the
/// selected squad (all agents when the Agents chip is active).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum RightTab {
    #[default]
    Talk,
    Measure,
}

impl RightTab {
    pub fn next(self) -> Self {
        match self {
            Self::Talk => Self::Measure,
            Self::Measure => Self::Talk,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpsInputOwner {
    List,
    Composer,
    Search,
    Completion,
    Reader,
    Popup,
}

#[derive(Debug, Default)]
pub struct OpsShell {
    pub tab: OpsTab,
    anchors: [Option<super::workspace::OpsTarget>; 2],
}

impl OpsShell {
    /// Workspace destinations retain their own anchors; Orchestration owns no
    /// workspace row. Neither anchors nor visit history are persisted.
    pub fn select(&mut self, tab: OpsTab, selected: &mut Option<super::workspace::OpsTarget>) {
        if self.tab == tab {
            return;
        }
        let previous = match self.tab {
            OpsTab::Agents => Some(0),
            OpsTab::Digest => Some(1),
            OpsTab::Orchestration => None,
        };
        let destination = match tab {
            OpsTab::Agents => self.anchors[0].take(),
            OpsTab::Digest => self.anchors[1]
                .take()
                .or(Some(super::workspace::OpsTarget::DigestAll)),
            OpsTab::Orchestration => None,
        };
        if let Some(index) = previous {
            self.anchors[index] = selected.take();
        }
        *selected = destination;
        self.tab = tab;
    }

    /// Returns true only when the shell consumed the digit. Active editors,
    /// search and completion receive their input unchanged; the host dismisses
    /// non-typing overlays before applying the destination.
    pub fn select_digit(
        &mut self,
        digit: char,
        owner: OpsInputOwner,
        selected: &mut Option<super::workspace::OpsTarget>,
    ) -> bool {
        if matches!(
            owner,
            OpsInputOwner::Composer | OpsInputOwner::Search | OpsInputOwner::Completion
        ) {
            return false;
        }
        let tab = match digit {
            '1' => OpsTab::Agents,
            '2' => OpsTab::Digest,
            '3' => OpsTab::Orchestration,
            _ => return false,
        };
        self.select(tab, selected);
        true
    }
}

#[cfg(test)]
mod tests;
