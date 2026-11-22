//! Durable display order of roster appearances. The live roster still owns membership.

use super::{OpsObservation, OpsRoster, OpsTarget};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    fs,
    os::unix::fs::DirBuilderExt,
    path::Path,
};
use tmt_extension_state::{Document, UpdateError};

const FILE: &str = "member-placement.json";
const LIMIT: u64 = 4 * 1024 * 1024;
const RETRY: &str = "Reopen the board before moving members again.";

#[derive(Debug, Clone, Default, Eq, PartialEq)]
pub(in crate::board) struct MemberOrder(Vec<Entry>);

#[derive(Debug, Clone, Eq, PartialEq)]
struct Entry {
    member: String,
    parent: Option<String>,
}

pub(super) enum Shift {
    Earlier,
    Later,
    Nest,
    Outdent,
}

impl MemberOrder {
    /// Admit only roster members. Broken parent links and cyclic components render
    /// as roots. An iterative walk keeps even very deep placement off the call stack.
    pub(super) fn walk<'a>(
        &'a self,
        members: &'a [&'a str],
    ) -> impl Iterator<Item = (&'a str, usize)> + use<'a> {
        let live: HashSet<_> = members.iter().copied().collect();
        let mut seen = HashSet::new();
        let mut children: HashMap<Option<&str>, Vec<&str>> = HashMap::new();
        for entry in &self.0 {
            let id = entry.member.as_str();
            if live.contains(id) && seen.insert(id) {
                let parent = entry
                    .parent
                    .as_deref()
                    .filter(|parent| live.contains(parent));
                children.entry(parent).or_default().push(id);
            }
        }
        let roots = children.entry(None).or_default();
        roots.extend(members.iter().copied().filter(|id| !seen.contains(id)));

        seen.clear();
        let mut stack: Vec<_> = children
            .remove(&None)
            .unwrap_or_default()
            .into_iter()
            .rev()
            .map(|id| (id, 0))
            .collect();
        let mut invalid = members.iter().copied();
        std::iter::from_fn(move || {
            loop {
                let (id, depth) = match stack.pop() {
                    Some(node) => node,
                    None => {
                        let id = invalid.find(|id| !seen.contains(id))?;
                        seen.insert(id);
                        return Some((id, 0));
                    }
                };
                if seen.insert(id) {
                    stack.extend(
                        children
                            .remove(&Some(id))
                            .into_iter()
                            .flatten()
                            .rev()
                            .map(|child| (child, depth + 1)),
                    );
                    return Some((id, depth));
                }
            }
        })
    }

    /// Freeze the current admitted order for the lift. The supplied member IDs
    /// use the same default order as the Agents list.
    pub(super) fn admitted(&self, members: &[&str]) -> Self {
        let mut parents: Vec<String> = Vec::new();
        let mut entries = Vec::with_capacity(members.len());
        for (id, depth) in self.walk(members) {
            parents.truncate(depth);
            entries.push(Entry {
                member: id.into(),
                parent: parents.last().cloned(),
            });
            parents.push(id.into());
        }
        Self(entries)
    }

    pub(super) fn same_members(&self, members: &[&str]) -> bool {
        self.0.len() == members.len() && {
            let admitted: HashSet<_> = members.iter().copied().collect();
            self.0
                .iter()
                .all(|entry| admitted.contains(entry.member.as_str()))
        }
    }

    pub(super) fn has_visible_child(&self, parent: &str, admitted: impl Fn(&str) -> bool) -> bool {
        self.0.iter().any(|entry| {
            entry.parent.as_deref() == Some(parent)
                && entry.member != parent
                && admitted(&entry.member)
        })
    }

    pub(super) fn parent(&self, member: &str) -> Option<&str> {
        self.0
            .iter()
            .find(|entry| entry.member == member)?
            .parent
            .as_deref()
    }

    pub(super) fn shift(&mut self, member: &str, direction: Shift) {
        let Some(index) = self.0.iter().position(|entry| entry.member == member) else {
            return;
        };
        let parent = self.0[index].parent.clone();
        let sibling = |entry: &Entry| entry.parent == parent;
        match direction {
            Shift::Earlier => {
                if let Some(previous) = self.0[..index].iter().rposition(sibling) {
                    self.0.swap(previous, index);
                }
            }
            Shift::Later => {
                if let Some(next) = self.0[index + 1..].iter().position(sibling) {
                    self.0.swap(index, index + 1 + next);
                }
            }
            Shift::Nest => {
                if let Some(previous) = self.0[..index].iter().rfind(|entry| sibling(entry)) {
                    // A preceding sibling is outside the moving member's subtree.
                    let parent = previous.member.clone();
                    let mut entry = self.0.remove(index);
                    entry.parent = Some(parent);
                    self.0.push(entry);
                }
            }
            Shift::Outdent => {
                if let Some(parent_index) = parent
                    .as_ref()
                    .and_then(|parent| self.0.iter().position(|entry| entry.member == *parent))
                {
                    let mut entry = self.0.remove(index);
                    let parent_index = parent_index - usize::from(index < parent_index);
                    entry.parent = self.0[parent_index].parent.clone();
                    self.0.insert(parent_index + 1, entry);
                }
            }
        }
    }

    fn remove(&mut self, member: &str) {
        let Some(index) = self.0.iter().position(|entry| entry.member == member) else {
            return;
        };
        let parent = self.0[index].parent.clone();
        let mut promoted = Vec::new();
        let mut insert = 0;
        self.0 = std::mem::take(&mut self.0)
            .into_iter()
            .enumerate()
            .filter_map(|(at, mut entry)| {
                if at == index {
                    None
                } else if entry.parent.as_deref() == Some(member) {
                    entry.parent.clone_from(&parent);
                    promoted.push(entry);
                    None
                } else {
                    insert += usize::from(at < index);
                    Some(entry)
                }
            })
            .collect();
        self.0.splice(insert..insert, promoted);
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Placements(BTreeMap<String, MemberOrder>);

impl Placements {
    fn key(room: Option<&str>) -> &str {
        room.unwrap_or("")
    }

    pub(in crate::board) fn group(&self, room: Option<&str>) -> Option<&MemberOrder> {
        self.0.get(Self::key(room))
    }

    pub(super) fn replace(&mut self, room: Option<&str>, group: MemberOrder) {
        self.0.insert(Self::key(room).into(), group);
    }

    fn decode(bytes: Option<&[u8]>) -> Result<Self, String> {
        let Some(bytes) = bytes else {
            return Ok(Self::default());
        };
        let value: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
        if value["version"] != 1 {
            return Err("Unsupported member placement version.".into());
        }
        let invalid = || "Invalid member placement document.".to_owned();
        let groups = value["groups"].as_object().ok_or_else(invalid)?;
        let mut placements = BTreeMap::new();
        for (room, raw) in groups {
            if !room.is_empty() && !crate::config::uuid_like(room) {
                return Err(invalid());
            }
            let mut entries = Vec::new();
            let mut members = HashSet::new();
            for value in raw.as_array().ok_or_else(invalid)? {
                let member = value["member"]
                    .as_str()
                    .filter(|id| crate::config::uuid_like(id) && members.insert(*id))
                    .ok_or_else(invalid)?;
                let parent = match &value["parent"] {
                    Value::Null => None,
                    Value::String(parent) if crate::config::uuid_like(parent) => {
                        Some(parent.clone())
                    }
                    _ => return Err(invalid()),
                };
                entries.push(Entry {
                    member: member.into(),
                    parent,
                });
            }
            placements.insert(room.clone(), MemberOrder(entries));
        }
        Ok(Self(placements))
    }

    fn encode(&self) -> Value {
        let groups: BTreeMap<_, _> = self
            .0
            .iter()
            .map(|(room, group)| {
                (
                    room,
                    group
                        .0
                        .iter()
                        .map(|entry| json!({"member": entry.member, "parent": entry.parent}))
                        .collect::<Vec<_>>(),
                )
            })
            .collect();
        json!({"version": 1, "groups": groups})
    }

    fn document(root: &Path) -> Result<Document, String> {
        Document::new(root, &root.join(FILE), LIMIT, RETRY).map_err(|e| e.to_string())
    }

    pub(in crate::board) fn load(root: &Path) -> Result<Self, String> {
        Self::decode(
            Self::document(root)?
                .read()
                .map_err(|e| e.to_string())?
                .as_deref(),
        )
    }

    /// Only a complete read for an appearance's scope proves removal.
    pub(in crate::board) fn pruned(&self, roster: &OpsRoster) -> Option<Self> {
        if self.0.is_empty() || roster.observation != OpsObservation::Complete {
            return None;
        }
        let mut next = None;
        for (room, group) in &self.0 {
            let squad = roster.squads.iter().find(|squad| squad.room_id == *room);
            let observed: HashSet<&str> = match squad {
                Some(squad) if squad.observation == OpsObservation::Complete => {
                    squad.members.iter().map(String::as_str).collect()
                }
                None if room.is_empty() && roster.complete() => {
                    roster.pool().map(|member| member.id.as_str()).collect()
                }
                None if roster.complete() => HashSet::new(),
                _ => continue,
            };
            let removed: Vec<_> = group
                .0
                .iter()
                .filter(|entry| !observed.contains(entry.member.as_str()))
                .map(|entry| entry.member.clone())
                .collect();
            if !removed.is_empty() {
                let group = next
                    .get_or_insert_with(|| self.clone())
                    .0
                    .get_mut(room)
                    .expect("the group was cloned");
                for id in removed {
                    group.remove(&id);
                }
            }
        }
        let mut next = next?;
        next.0.retain(|_, group| !group.0.is_empty());
        Some(next)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Save {
    pub(super) expected: Placements,
    pub(super) next: Placements,
    pub(super) notice: Option<String>,
    pub(super) reveal: Option<OpsTarget>,
}

impl Save {
    pub(in crate::board) fn write(&self, root: &Path) -> Result<Placements, String> {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(root)
            .map_err(|e| e.to_string())?;
        let mut published = None;
        Placements::document(root)?
            .update(|bytes| {
                let mut current = Placements::decode(bytes)?;
                // Compare and replace only the changed groups. Two boards editing
                // different squads must not erase one another's order.
                let keys: HashSet<_> = self.expected.0.keys().chain(self.next.0.keys()).collect();
                for key in keys {
                    let before = self.expected.0.get(key);
                    let after = self.next.0.get(key);
                    if before == after {
                        continue;
                    }
                    if current.0.get(key) != before {
                        return Err(format!("Member placement changed. {RETRY}"));
                    }
                    if let Some(group) = after {
                        current.0.insert(key.clone(), group.clone());
                    } else {
                        current.0.remove(key);
                    }
                }
                let bytes =
                    serde_json::to_vec(&current.encode()).map_err(|error| error.to_string())?;
                published = Some(current);
                Ok(bytes)
            })
            .map_err(|error| match error {
                UpdateError::Change(error) => error,
                UpdateError::State(error) => error.to_string(),
            })?;
        Ok(published.expect("successful update publishes one document"))
    }

    pub(in crate::board) fn finish(
        self,
        app: &mut crate::board::app::App,
        result: Result<Placements, String>,
    ) {
        app.workspace.saving_placement = false;
        let notice = match result {
            Ok(placements) => {
                app.workspace.placements = placements;
                if let Some(parent) = &self.reveal {
                    app.workspace.set_member_folded(parent, false);
                }
                app.invalidate_frame_geometry();
                app.workspace_reconcile();
                app.workspace.placement_prune_failed = false;
                self.notice
            }
            Err(error) => {
                app.workspace.placement_prune_failed |= self.notice.is_none();
                Some(error)
            }
        };
        if let Some(notice) = notice {
            app.set_notice(Some(notice), false);
        }
    }
}

/// Per-appearance fold state, shared by nested members and their terminal leaves.
pub(super) fn member_parts(target: &OpsTarget) -> Option<(Option<&str>, &str)> {
    match target {
        OpsTarget::Member {
            room_id,
            identity_id,
        } => Some((room_id.as_deref(), identity_id)),
        _ => None,
    }
}
