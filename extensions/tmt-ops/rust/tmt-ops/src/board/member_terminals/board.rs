//! What the board does with a member's terminals: when the lane asks Core, where the rows go in
//! the Agents tree, and which terminal is selected. Keys are in [`super::keys`].
use super::{Completed, Row, Task};
use crate::board::{
    app::App,
    workspace::{OpsTarget, OpsTreeRow},
};

impl App {
    /// The built-in-host members the board shows, each once.
    fn builtin_members(&self) -> Vec<String> {
        let Some(snapshot) = self.workspace_snapshot() else {
            return Vec::new();
        };
        let mut members: Vec<String> = snapshot
            .rows
            .iter()
            .filter_map(|(target, row)| match target {
                OpsTarget::Member { identity_id, .. }
                    if row["pane"]["location"]["host"].as_str() == Some("pty") =>
                {
                    Some(identity_id.clone())
                }
                _ => None,
            })
            .collect();
        members.sort();
        members.dedup();
        members
    }

    /// Whether `identity` is a member on the built-in host, as the board last read it.
    pub(in crate::board) fn builtin_member(&self, identity: &str) -> bool {
        self.workspace_snapshot().is_some_and(|snapshot| {
            snapshot.rows.iter().any(|(target, row)| {
                matches!(target, OpsTarget::Member { identity_id, .. } if identity_id == identity)
                    && row["pane"]["location"]["host"].as_str() == Some("pty")
            })
        })
    }

    /// The selected member, or the member of the selected terminal.
    pub(in crate::board) fn terminals_owner(&self) -> Option<&str> {
        match self.workspace.selected.as_ref()? {
            OpsTarget::Member { identity_id, .. } | OpsTarget::Terminal { identity_id, .. } => {
                Some(identity_id)
            }
            _ => None,
        }
    }

    /// The selected terminal row, with its member.
    pub(in crate::board) fn selected_terminal(&self) -> Option<(&str, &Row)> {
        let OpsTarget::Terminal {
            identity_id,
            terminal_id,
            ..
        } = self.workspace.selected.as_ref()?
        else {
            return None;
        };
        Some((identity_id, self.terminals.row(identity_id, terminal_id)?))
    }

    /// The next terminal call for the lane, if one is due.
    pub(in crate::board) fn terminals_offer(&mut self) -> Option<Task> {
        if self.loading() {
            return None;
        }
        let members = self.builtin_members();
        let selected = self
            .terminals_owner()
            .filter(|identity| members.iter().any(|member| member == identity))
            .map(str::to_owned);
        self.terminals
            .offer(&members, selected.as_deref(), crate::status::now_ms())
    }

    pub(in crate::board) fn terminals_done(&mut self, completed: Completed) {
        let applied = self.terminals.finished(completed, crate::status::now_ms());
        if let Some((identity, terminal)) = applied.select {
            // Under the member row the person was on, else its first row.
            let member = self
                .workspace
                .selected
                .clone()
                .filter(|target| {
                    matches!(target, OpsTarget::Member { identity_id, .. } if *identity_id == identity)
                })
                .or_else(|| {
                    self.workspace_rows().iter().find_map(|row| {
                        matches!(&row.target, OpsTarget::Member { identity_id, .. } if *identity_id == identity)
                            .then(|| row.target.clone())
                    })
                });
            if let Some(target) = member.and_then(|member| super::target(&member, &terminal)) {
                self.workspace.selected = Some(target);
                self.invalidate_frame_geometry();
            }
        }
        if let Some(notice) = applied.notice {
            let _ = self.say(notice);
        }
    }

    /// Puts each built-in member's terminal rows under its row, unless folded.
    pub(in crate::board) fn with_terminal_rows(&self, rows: Vec<OpsTreeRow>) -> Vec<OpsTreeRow> {
        let mut spliced = Vec::with_capacity(rows.len());
        for row in rows {
            let terminals = match &row.target {
                OpsTarget::Member { identity_id, .. } if !self.terminals.folded(identity_id) => {
                    self.terminals.rows(identity_id)
                }
                _ => &[],
            };
            let children: Vec<_> = terminals
                .iter()
                .filter_map(|terminal| {
                    Some(OpsTreeRow {
                        target: super::target(&row.target, &terminal.id)?,
                        title: terminal.title(),
                        depth: row.depth + 1,
                        lead: false,
                        state: Some(if terminal.ended { "ended" } else { "running" }.into()),
                        presence: None,
                        usage: None,
                        activity: None,
                        count: None,
                        observation: row.observation,
                    })
                })
                .collect();
            spliced.push(row);
            spliced.extend(children);
        }
        spliced
    }
}
