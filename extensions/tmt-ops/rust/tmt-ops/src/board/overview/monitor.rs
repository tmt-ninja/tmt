//! One identity row over the existing acquired workspace and label/meter owners.
use super::{columns::Column, cron_counts};
use crate::board::{
    app::App,
    workspace::{OpsTarget, OpsTreeRow, observe::OpsWorkspaceSnapshot},
};
use std::rc::Rc;

pub(in crate::board) struct Values {
    shared: crate::board::workspace::columns::WorkspaceColumnValues,
    pub cron: Option<cron_counts::Count>,
}
impl std::ops::Deref for Values {
    type Target = crate::board::workspace::columns::WorkspaceColumnValues;
    fn deref(&self) -> &Self::Target {
        &self.shared
    }
}
impl Values {
    pub fn text(&self, column: Column, row: &OpsTreeRow) -> String {
        if column == Column::Cron {
            cron_counts::label(self.cron, false)
        } else {
            self.shared.text(column, row)
        }
    }
}

pub(in crate::board) fn values(
    app: &App,
    snapshot: &OpsWorkspaceSnapshot,
    row: &OpsTreeRow,
) -> Values {
    let OpsTarget::Member { identity_id, .. } = &row.target else {
        unreachable!("monitor identity")
    };
    let cron = app.cron.counts.count(cron_counts::CronCountScope::Owner {
        id: identity_id,
        room: None,
    });
    let shared = crate::board::workspace::columns::project(
        crate::board::workspace::columns::WorkspaceColumnInput {
            row,
            snapshot,
            labels: &app.labels,
            usage: app.overview_member_usage(identity_id),
            agent: app.references.agents.get(identity_id),
            timers: cron.map(|count| (count.active, count.total)),
        },
    )
    .expect("monitor member projection");
    Values { shared, cron }
}

#[derive(Default)]
pub(in crate::board) struct Cache {
    held: Option<(Key, Rc<Scene>)>,
}
pub(in crate::board) struct Scene {
    pub summary: super::summary::Summary,
}
#[derive(PartialEq, Eq)]
struct Key {
    hidden: std::collections::BTreeSet<String>,
    digest_window: crate::config::DigestWindow,
    savings_unit: crate::config::SavingsUnit,
    visibility: crate::board::workspace::OpsVisibility,
    /// Crossing the stale rule changes the activity counts.
    activity_stale: bool,
}
impl Cache {
    pub fn clear(&mut self) {
        self.held = None;
    }
}

pub(in crate::board) fn scene(app: &App, snapshot: &OpsWorkspaceSnapshot) -> Rc<Scene> {
    let key = Key {
        hidden: snapshot.preferences.hidden.clone(),
        digest_window: app.digest_window(),
        savings_unit: snapshot.preferences.savings_unit,
        visibility: app.workspace.visibility.clone(),
        activity_stale: app.activity_stale(std::time::Instant::now()),
    };
    let mut cache = app.overview_rows.borrow_mut();
    if let Some((old, scene)) = &cache.held
        && *old == key
    {
        return Rc::clone(scene);
    }
    let scene = Rc::new(Scene {
        summary: super::summary::project(
            snapshot,
            &app.labels,
            &key.visibility,
            key.activity_stale,
            key.digest_window,
        ),
    });
    cache.held = Some((key, Rc::clone(&scene)));
    scene
}

#[cfg(test)]
mod tests;
