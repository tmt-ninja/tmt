//! Workspace projection and frozen management over worker-acquired rosters.
//! Core owns membership and identity state; input and paint perform no I/O.

pub(crate) mod close_member;
pub(crate) mod columns;
pub(crate) mod manage;
pub(crate) mod moving;
pub(crate) mod observe;
pub(in crate::board) mod placement;
pub(crate) mod rename_member;
pub(crate) mod render;

use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum OpsObservation {
    Complete,
    Stale,
    Partial,
    #[default]
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpsMember {
    pub id: String,
    pub name: String,
    pub state: Option<String>,
    pub waiting: bool,
    pub presence: Option<bool>,
    pub usage: Option<u64>,
    /// Core's provider activity from the global observation, one per identity.
    pub activity: super::activity::ObservedActivity,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct OpsMembershipState {
    pub state: Option<String>,
    pub waiting: bool,
    pub rank: Option<crate::config::Rank>,
    /// Core's idle alert marks this member over in this squad.
    pub idle_over: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpsSquad {
    pub room_id: String,
    pub name: String,
    pub members: Vec<String>,
    pub lead: Option<String>,
    /// Squad metadata is scoped even when an identity belongs to several rooms.
    pub member_states: BTreeMap<String, OpsMembershipState>,
    pub observation: OpsObservation,
    /// The squad's `idle_alert` setting, published only while Core read it.
    pub idle_alert: Option<IdleAlertSetting>,
}

/// `squad.idleAlert` from Core's squad document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IdleAlertSetting {
    pub enabled: bool,
    pub after_ms: u64,
}

impl IdleAlertSetting {
    pub fn of(document: &serde_json::Value) -> Option<Self> {
        let setting = &document["squad"]["idleAlert"];
        Some(Self {
            enabled: setting["enabled"].as_bool()?,
            after_ms: setting["afterMs"].as_u64()?,
        })
    }
    /// Compact, editable squad-cell value; an absent observation stays absent.
    pub fn label(self, _width: usize) -> Option<String> {
        Some(if self.enabled {
            format!(
                "◷ {}",
                crate::idle_alert::threshold(std::time::Duration::from_millis(self.after_ms))
            )
        } else {
            "○ off".into()
        })
    }
}

#[derive(Debug, Default)]
pub struct OpsRoster {
    pub members: BTreeMap<String, OpsMember>,
    pub observation: OpsObservation,
    pub squads: Vec<OpsSquad>,
    /// False when any source needed to prove zero memberships was not read.
    pub membership_complete: bool,
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ShellCounts {
    pub online: usize,
    pub waiting: usize,
    pub blocked: usize,
    pub complete: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum OpsTarget {
    /// The read-only aggregate row in Digest; never a recipient or room.
    DigestAll,
    Pool,
    LocalTerminals,
    SavedTerminal(String),
    /// The folding group of hidden squads at the end of the Agents list; it only
    /// selects, folds and counts, and is never a recipient or room.
    Hidden,
    Squad(String),
    Member {
        room_id: Option<String>,
        identity_id: String,
    },
    /// One of a built-in member's extra terminals (#5991), under that member's row. It is
    /// never a recipient, a room or a Talk target.
    Terminal {
        room_id: Option<String>,
        identity_id: String,
        terminal_id: String,
    },
}

pub use crate::config::{OpsPreferences, OpsSort};

/// Display scope and explicit hidden-room reveal belong to this UI session,
/// never the acquired roster or retained view preferences.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct OpsVisibility {
    pub scope: Vec<String>,
    pub reveal_hidden: bool,
}

impl OpsVisibility {
    fn unrestricted(&self, roster: &OpsRoster, preferences: &OpsPreferences) -> bool {
        self.scope.is_empty()
            && (self.reveal_hidden
                || !roster
                    .squads
                    .iter()
                    .any(|squad| preferences.hidden.contains(&squad.room_id)))
    }

    /// Admission for view totals uses the same room visibility as the tree.
    /// Unassigned identities remain visible only outside an explicit scope;
    /// a hidden membership never turns its agent into a Common pool member.
    pub(super) fn member_ids<'a>(
        &self,
        roster: &'a OpsRoster,
        preferences: &OpsPreferences,
    ) -> Option<BTreeSet<&'a String>> {
        if self.unrestricted(roster, preferences) {
            return None;
        }
        let mut visible: BTreeSet<_> = roster
            .squads
            .iter()
            .filter(|squad| self.shows_squad(&squad.room_id, preferences))
            .flat_map(|squad| squad.members.iter())
            .filter(|id| roster.members.contains_key(*id))
            .collect();
        if self.scope.is_empty() {
            visible.extend(roster.pool().map(|member| &member.id));
        }
        Some(visible)
    }

    pub fn shows_squad(&self, id: &str, preferences: &OpsPreferences) -> bool {
        if self.scope.is_empty() {
            self.reveal_hidden || !preferences.hidden.contains(id)
        } else {
            self.scope.iter().any(|scoped| scoped == id)
        }
    }
}

#[derive(Debug, Default)]
pub struct OpsWorkspace {
    pub selected: Option<OpsTarget>,
    pub expanded: BTreeSet<String>,
    pub pool_expanded: bool,
    pub query: String,
    pub(in crate::board) order: Option<crate::board::view_state::Order>,
    pub visibility: OpsVisibility,
    pub(in crate::board) placements: placement::Placements,
    pub(in crate::board) saving_placement: bool,
    pub(in crate::board) placement_prune_failed: bool,
    pub(in crate::board) folded_members: BTreeSet<OpsTarget>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SelectionState {
    None,
    Visible,
    Hidden,
    Missing,
    Unknown,
}

#[derive(Debug, PartialEq, Eq)]
pub struct OpsTreeRow {
    pub target: OpsTarget,
    pub title: String,
    pub depth: usize,
    pub lead: bool,
    pub state: Option<String>,
    pub presence: Option<bool>,
    pub usage: Option<u64>,
    /// A member row's STATE cell inputs; group rows have none.
    pub activity: Option<super::activity::Member>,
    /// A total is known only after a complete observation, never from a
    /// failed/partial/stale read. Observed children can still be displayed.
    pub count: Option<usize>,
    pub observation: OpsObservation,
}

impl OpsRoster {
    /// Independent UUID sets; presence and request attention are different facts.
    pub fn shell_counts(&self) -> ShellCounts {
        self.counts(None)
    }

    pub(super) fn hidden_counts(&self, rooms: &BTreeSet<String>) -> ShellCounts {
        self.counts(Some(rooms))
    }

    fn counts(&self, rooms: Option<&BTreeSet<String>>) -> ShellCounts {
        let identities: Option<BTreeSet<_>> = rooms.map(|rooms| {
            self.squads
                .iter()
                .filter(|squad| rooms.contains(&squad.room_id))
                .flat_map(|squad| squad.members.iter())
                .collect()
        });
        let admitted = |id: &String| identities.as_ref().is_none_or(|ids| ids.contains(id));
        let mut waiting = BTreeSet::new();
        let mut blocked = BTreeSet::new();
        for member in self.members.values().filter(|member| admitted(&member.id)) {
            if member.waiting {
                waiting.insert(&member.id);
            }
            if member.state.as_deref() == Some("blocked") {
                blocked.insert(&member.id);
            }
        }
        for squad in self
            .squads
            .iter()
            .filter(|squad| rooms.is_none_or(|rooms| rooms.contains(&squad.room_id)))
        {
            let members: BTreeSet<_> = squad.members.iter().collect();
            for (id, state) in &squad.member_states {
                if !members.contains(id) || !self.members.contains_key(id) {
                    continue;
                }
                if state.waiting {
                    waiting.insert(id);
                }
                if state.state.as_deref() == Some("blocked") {
                    blocked.insert(id);
                }
            }
        }
        ShellCounts {
            online: self
                .members
                .values()
                .filter(|member| admitted(&member.id) && member.presence == Some(true))
                .count(),
            waiting: waiting.len(),
            blocked: blocked.len(),
            complete: self.complete()
                && self
                    .members
                    .values()
                    .filter(|member| admitted(&member.id))
                    .all(|member| member.presence.is_some()),
        }
    }

    fn members<'a>(&'a self, squad: &'a OpsSquad) -> impl Iterator<Item = &'a OpsMember> {
        squad.members.iter().filter_map(|id| self.members.get(id))
    }

    pub(in crate::board) fn pool(&self) -> impl Iterator<Item = &OpsMember> {
        let complete = self.membership_complete
            && matches!(
                self.observation,
                OpsObservation::Complete | OpsObservation::Stale
            )
            && self.squads.iter().all(|squad| {
                matches!(
                    squad.observation,
                    OpsObservation::Complete | OpsObservation::Stale
                )
            });
        let assigned: BTreeSet<_> = self
            .squads
            .iter()
            .flat_map(|squad| squad.members.iter())
            .collect();
        self.members
            .values()
            .filter(move |member| complete && !assigned.contains(&member.id))
    }

    fn attention(&self, squad: &OpsSquad) -> u8 {
        let states = || {
            squad
                .members
                .iter()
                .filter_map(|id| squad.member_states.get(id))
        };
        if states().any(|member| member.waiting) {
            2
        } else if states().any(|member| member.state.as_deref() == Some("blocked")) {
            1
        } else {
            0
        }
    }

    pub(in crate::board) fn contains(&self, target: &OpsTarget) -> bool {
        match target {
            OpsTarget::Pool | OpsTarget::DigestAll | OpsTarget::Hidden => true,
            // Core's roster has no terminals: a terminal row that is gone is missing.
            OpsTarget::Terminal { .. }
            | OpsTarget::LocalTerminals
            | OpsTarget::SavedTerminal(_) => false,
            OpsTarget::Squad(id) => self.squads.iter().any(|squad| squad.room_id == *id),
            OpsTarget::Member {
                room_id: Some(room),
                identity_id,
            } => {
                self.members.contains_key(identity_id)
                    && self
                        .squads
                        .iter()
                        .any(|squad| squad.room_id == *room && squad.members.contains(identity_id))
            }
            OpsTarget::Member {
                room_id: None,
                identity_id,
            } => self.pool().any(|member| member.id == *identity_id),
        }
    }

    pub(in crate::board) fn complete(&self) -> bool {
        self.membership_complete
            && self.observation == OpsObservation::Complete
            && self
                .squads
                .iter()
                .all(|squad| squad.observation == OpsObservation::Complete)
    }
}

/// Project admitted UUID occurrences without imposing a destination's display
/// order. Digest ranks by TOK and must not first sort the same rows by name.
pub(in crate::board) fn admitted_identity_rows(
    snapshot: &observe::OpsWorkspaceSnapshot,
    query: &str,
    preferred: Option<&OpsTarget>,
    visibility: &OpsVisibility,
    admit: impl Fn(&OpsTreeRow) -> bool,
) -> Vec<OpsTreeRow> {
    let query = query.to_lowercase();
    // Canonical roster projection owns membership and unknown-pool admission.
    // Deduplicate its occurrences once; stale row documents grant no authority.
    let workspace = OpsWorkspace {
        expanded: snapshot
            .roster
            .squads
            .iter()
            .map(|squad| squad.room_id.clone())
            .collect(),
        pool_expanded: true,
        visibility: visibility.clone(),
        ..Default::default()
    };
    let mut identities: std::collections::BTreeMap<String, OpsTreeRow> = Default::default();
    for mut row in workspace.rows(&snapshot.roster, &snapshot.preferences) {
        let OpsTarget::Member { identity_id, .. } = &row.target else {
            continue;
        };
        if !snapshot.rows.contains_key(&row.target)
            || !row.title.to_lowercase().contains(&query)
            || !admit(&row)
        {
            continue;
        }
        let id = identity_id.clone();
        let replace = identities.get(&id).is_none_or(|current| {
            Some(&row.target) == preferred
                || (Some(&current.target) != preferred && row.target < current.target)
        });
        if replace {
            row.depth = 0;
            identities.insert(id, row);
        }
    }
    identities.into_values().collect()
}

impl OpsWorkspace {
    pub fn toggle_expanded(&mut self, target: &OpsTarget) -> bool {
        match target {
            OpsTarget::Pool => self.pool_expanded = !self.pool_expanded,
            OpsTarget::Hidden => self.visibility.reveal_hidden = !self.visibility.reveal_hidden,
            OpsTarget::Squad(id) => {
                if !self.expanded.remove(id) {
                    self.expanded.insert(id.clone());
                }
            }
            OpsTarget::Member { .. }
            | OpsTarget::Terminal { .. }
            | OpsTarget::DigestAll
            | OpsTarget::LocalTerminals
            | OpsTarget::SavedTerminal(_) => {
                return false;
            }
        }
        true
    }

    pub fn selection_state(&self, roster: &OpsRoster, rows: &[OpsTreeRow]) -> SelectionState {
        let Some(selected) = &self.selected else {
            return SelectionState::None;
        };
        if rows.iter().any(|row| row.target == *selected) {
            SelectionState::Visible
        } else if roster.contains(selected) {
            SelectionState::Hidden
        } else if roster.complete() {
            SelectionState::Missing
        } else {
            SelectionState::Unknown
        }
    }

    pub fn rows(&self, roster: &OpsRoster, preferences: &OpsPreferences) -> Vec<OpsTreeRow> {
        self.rows_with_draft(roster, preferences, None)
    }

    pub(in crate::board) fn rows_with_draft(
        &self,
        roster: &OpsRoster,
        preferences: &OpsPreferences,
        draft: Option<(Option<&str>, &placement::MemberOrder)>,
    ) -> Vec<OpsTreeRow> {
        self.project_rows(roster, preferences, &self.query, false, draft)
    }

    /// Count identities, not their repeated memberships or collapsed rows.
    pub fn search_counts<'a>(
        &self,
        roster: &'a OpsRoster,
        preferences: &OpsPreferences,
    ) -> (usize, usize) {
        let query = self.query.to_lowercase();
        // A complete, unrestricted All view admits every acquired identity,
        // including the proven Common pool; no membership scan is needed.
        if query.is_empty()
            && roster.complete()
            && self.visibility.unrestricted(roster, preferences)
        {
            return (roster.members.len(), roster.members.len());
        }
        let mut total = BTreeSet::new();
        let mut matched = BTreeSet::new();
        let mut admit = |member: &'a OpsMember, group_matches: bool| {
            total.insert(&member.id);
            if !query.is_empty() && (group_matches || member.name.to_lowercase().contains(&query)) {
                matched.insert(&member.id);
            }
        };
        if self.visibility.scope.is_empty() {
            let group_matches = "common pool".contains(&query);
            for member in roster.pool() {
                admit(member, group_matches);
            }
        }
        // Outside a scope, search lists hidden squads too, under the Hidden group.
        for squad in roster.squads.iter().filter(|squad| {
            self.visibility.scope.is_empty()
                || self.visibility.shows_squad(&squad.room_id, preferences)
        }) {
            let group_matches = squad.name.to_lowercase().contains(&query);
            for member in roster.members(squad) {
                admit(member, group_matches);
            }
        }
        (
            if query.is_empty() {
                total.len()
            } else {
                matched.len()
            },
            total.len(),
        )
    }

    pub(super) fn complete_for_placement(roster: &OpsRoster, room: Option<&str>) -> bool {
        roster.observation == OpsObservation::Complete
            && room.map_or_else(
                || roster.complete(),
                |room| {
                    roster.squads.iter().any(|squad| {
                        squad.room_id == room && squad.observation == OpsObservation::Complete
                    })
                },
            )
    }

    /// Default order of all members in a scope, including those hidden by a
    /// fold or search. This is the baseline from which the lift is prepared.
    pub(super) fn placement_members<'a>(roster: &'a OpsRoster, room: Option<&str>) -> Vec<&'a str> {
        let squad = room.and_then(|id| roster.squads.iter().find(|squad| squad.room_id == id));
        let mut members: Vec<_> = match squad {
            Some(squad) => roster.members(squad).collect(),
            None if room.is_none() => roster.pool().collect(),
            None => return Vec::new(),
        };
        sort_members(&mut members, squad.and_then(|squad| squad.lead.as_deref()));
        members.dedup_by(|a, b| a.id == b.id);
        members
            .into_iter()
            .map(|member| member.id.as_str())
            .collect()
    }

    pub(in crate::board) fn reveal_member_ancestors(&mut self, target: &OpsTarget) {
        let Some((room, member)) = placement::member_parts(target) else {
            return;
        };
        let Some(group) = self.placements.group(room) else {
            return;
        };
        let mut cursor = member;
        let mut seen = BTreeSet::new();
        while let Some(parent) = group.parent(cursor).filter(|parent| seen.insert(*parent)) {
            self.folded_members.remove(&OpsTarget::Member {
                room_id: room.map(str::to_owned),
                identity_id: parent.to_owned(),
            });
            cursor = parent;
        }
    }

    pub(in crate::board) fn member_folded(&self, target: &OpsTarget) -> bool {
        self.folded_members.contains(target)
    }

    pub(in crate::board) fn set_member_folded(&mut self, target: &OpsTarget, folded: bool) {
        if folded {
            self.folded_members.insert(target.clone());
        } else {
            self.folded_members.remove(target);
        }
    }

    pub(in crate::board) fn member_has_children(
        &self,
        target: &OpsTarget,
        roster: &OpsRoster,
    ) -> bool {
        let Some((room, member)) = placement::member_parts(target) else {
            return false;
        };
        self.placements.group(room).is_some_and(|group| {
            group.has_visible_child(member, |child| {
                roster.contains(&OpsTarget::Member {
                    room_id: room.map(str::to_owned),
                    identity_id: child.into(),
                })
            })
        })
    }

    fn project_members(
        &self,
        room: Option<&str>,
        rows: impl Iterator<Item = OpsTreeRow>,
        query: &str,
        expand: bool,
        draft: Option<&placement::MemberOrder>,
    ) -> Vec<OpsTreeRow> {
        let matches =
            |row: &OpsTreeRow| crate::board::search_field::matches_query(&row.title, query);
        let Some(group) = draft.or_else(|| self.placements.group(room)) else {
            return rows.filter(matches).collect();
        };
        let mut rows: Vec<_> = rows.map(Some).collect();
        let ids: Vec<_> = rows
            .iter()
            .filter_map(|row| placement::member_parts(&row.as_ref()?.target))
            .map(|(_, member)| member)
            .collect();
        let by_id: std::collections::HashMap<_, _> = ids.iter().copied().zip(0..).collect();
        let order: Vec<_> = group
            .walk(&ids)
            .map(|(id, depth)| (by_id[id], depth))
            .collect();
        let mut keep = vec![query.is_empty(); order.len()];
        if !query.is_empty() {
            // Expose matching children with their ancestor chain, without
            // changing the user's fold state.
            let mut parents = Vec::new();
            for (at, &(index, depth)) in order.iter().enumerate() {
                parents.truncate(depth);
                if matches(rows[index].as_ref().expect("member")) {
                    keep[at] = true;
                    for parent in parents.iter().rev().copied() {
                        if keep[parent] {
                            break;
                        }
                        keep[parent] = true;
                    }
                }
                parents.push(at);
            }
        }
        let mut folded_depth = None;
        let mut visible = Vec::new();
        for ((index, depth), keep) in order.into_iter().zip(keep) {
            if folded_depth.is_some_and(|parent| depth > parent) {
                continue;
            }
            folded_depth = None;
            let mut row = rows[index].take().expect("once per appearance");
            if !expand && draft.is_none() && self.member_folded(&row.target) {
                folded_depth = Some(depth);
            }
            if keep {
                row.depth += depth;
                visible.push(row);
            }
        }
        visible
    }

    fn project_rows(
        &self,
        roster: &OpsRoster,
        preferences: &OpsPreferences,
        query: &str,
        expand: bool,
        draft: Option<(Option<&str>, &placement::MemberOrder)>,
    ) -> Vec<OpsTreeRow> {
        let query = query.to_lowercase();
        let matches = |name: &str| crate::board::search_field::matches_query(name, &query);
        let pool: Vec<_> = roster.pool().collect();
        // Keep an unfiltered unknown/empty pool, but search only shows matching
        // identities and their containing group.
        let draft_for = |room: Option<&str>| {
            draft
                .filter(|(draft_room, _)| *draft_room == room)
                .map(|(_, group)| group)
        };
        let show_pool = self.visibility.scope.is_empty()
            && (query.is_empty()
                || matches("Common pool")
                || pool.iter().any(|member| matches(&member.name)));
        let mut rows = Vec::new();
        if show_pool {
            rows.push(OpsTreeRow {
                target: OpsTarget::Pool,
                title: "Common pool".into(),
                depth: 0,
                lead: false,
                state: None,
                presence: None,
                usage: None,
                activity: None,
                count: roster.complete().then_some(pool.len()),
                observation: if roster.complete() {
                    OpsObservation::Complete
                } else if roster.observation == OpsObservation::Complete {
                    OpsObservation::Partial
                } else {
                    roster.observation
                },
            });
        }
        if show_pool
            && (expand || draft_for(None).is_some() || self.pool_expanded || !query.is_empty())
        {
            let mut pool = pool;
            sort_members(&mut pool, None);
            rows.extend(
                self.project_members(
                    None,
                    pool.into_iter()
                        .map(|member| member_row(member, None, false, roster.observation, None)),
                    if draft_for(None).is_some() || matches("Common pool") {
                        ""
                    } else {
                        &query
                    },
                    expand || !query.is_empty(),
                    draft_for(None),
                ),
            );
        }
        // Outside a scope, hidden squads leave the list for the Hidden group at its end.
        let grouped = self.visibility.scope.is_empty();
        let mut squads: Vec<_> = roster
            .squads
            .iter()
            .filter(|squad| {
                if grouped {
                    !preferences.hidden.contains(&squad.room_id)
                } else {
                    self.visibility.shows_squad(&squad.room_id, preferences)
                }
            })
            .collect();
        let mut hidden: Vec<_> = roster
            .squads
            .iter()
            .filter(|squad| grouped && preferences.hidden.contains(&squad.room_id))
            .collect();
        let order = |a: &&OpsSquad, b: &&OpsSquad| {
            let order = match self
                .order
                .unwrap_or_else(|| crate::board::view_state::Order::from(preferences))
                .agents
            {
                OpsSort::Name => a.name.cmp(&b.name),
                OpsSort::Attention => roster.attention(b).cmp(&roster.attention(a)),
                OpsSort::Members => a.members.len().cmp(&b.members.len()),
            };
            let order = if self
                .order
                .unwrap_or_else(|| crate::board::view_state::Order::from(preferences))
                .reversed
            {
                order.reverse()
            } else {
                order
            };
            order.then_with(|| a.room_id.cmp(&b.room_id))
        };
        squads.sort_by(order);
        hidden.sort_by(order);
        // One squad row and its shown members, `depth` levels in.
        let squad_rows = |squad: &OpsSquad, depth: usize| -> Vec<OpsTreeRow> {
            let mut rows = Vec::new();
            let mut members: Vec<_> = roster.members(squad).collect();
            let mut seen = BTreeSet::new();
            members.retain(|member| seen.insert(&member.id));
            let squad_matches = matches(&squad.name);
            if !squad_matches && !members.iter().any(|member| matches(&member.name)) {
                return rows;
            }
            let attention = match roster.attention(squad) {
                2 => Some("waiting"),
                1 => Some("blocked"),
                _ => squad
                    .member_states
                    .values()
                    .filter(|member| member.state.is_some())
                    .min_by_key(|member| member.rank)
                    .and_then(|member| member.state.as_deref()),
            };
            rows.push(OpsTreeRow {
                target: OpsTarget::Squad(squad.room_id.clone()),
                title: squad.name.clone(),
                depth,
                lead: false,
                state: attention.map(str::to_owned),
                presence: None,
                usage: None,
                activity: None,
                count: (squad.observation == OpsObservation::Complete)
                    .then(|| squad.members.iter().collect::<BTreeSet<_>>().len()),
                observation: squad.observation,
            });
            if expand
                || draft_for(Some(&squad.room_id)).is_some()
                || self.expanded.contains(&squad.room_id)
                || !query.is_empty()
            {
                let unknown = OpsMembershipState::default();
                sort_members(&mut members, squad.lead.as_deref());
                rows.extend(self.project_members(
                    Some(&squad.room_id),
                    members.into_iter().map(|member| {
                        let mut row = member_row(
                            member,
                            Some(&squad.room_id),
                            squad.lead.as_deref() == Some(&member.id),
                            squad.observation,
                            Some(squad.member_states.get(&member.id).unwrap_or(&unknown)),
                        );
                        row.depth = depth + 1;
                        row
                    }),
                    if draft_for(Some(&squad.room_id)).is_some() || squad_matches {
                        ""
                    } else {
                        &query
                    },
                    expand || !query.is_empty(),
                    draft_for(Some(&squad.room_id)),
                ));
            }
            rows
        };
        for squad in squads {
            rows.extend(squad_rows(squad, 0));
        }
        // The Hidden group closes the list. Unfolded (`reveal_hidden`), its squads sit
        // one level in; search and the Pinned filter keep it only for what matches.
        if !hidden.is_empty() {
            let narrowed = !query.is_empty();
            // A folded group builds no rows for what it holds.
            let children: Vec<_> = if expand || self.visibility.reveal_hidden || narrowed {
                hidden
                    .iter()
                    .flat_map(|squad| squad_rows(squad, 1))
                    .collect()
            } else {
                Vec::new()
            };
            if !children.is_empty() || !narrowed {
                rows.push(OpsTreeRow {
                    target: OpsTarget::Hidden,
                    title: "Hidden".into(),
                    depth: 0,
                    lead: false,
                    state: None,
                    presence: None,
                    usage: None,
                    activity: None,
                    count: Some(hidden.len()),
                    observation: roster.observation,
                });
                rows.extend(children);
            }
        }
        rows
    }
}

/// Projects one held member without constructing or sorting the display tree.
/// A room target requires observed membership and keeps that room's task/attention.
pub(in crate::board) fn member_target_row(
    roster: &OpsRoster,
    target: &OpsTarget,
) -> Option<OpsTreeRow> {
    let OpsTarget::Member {
        room_id,
        identity_id,
    } = target
    else {
        return None;
    };
    let member = roster.members.get(identity_id)?;
    let Some(room) = room_id else {
        return Some(member_row(member, None, false, roster.observation, None));
    };
    let squad = roster
        .squads
        .iter()
        .find(|squad| &squad.room_id == room && squad.members.contains(identity_id))?;
    let unknown = OpsMembershipState::default();
    Some(member_row(
        member,
        Some(room),
        squad.lead.as_deref() == Some(identity_id),
        squad.observation,
        Some(squad.member_states.get(identity_id).unwrap_or(&unknown)),
    ))
}

fn sort_members(members: &mut [&OpsMember], lead: Option<&str>) {
    members.sort_by(|a, b| {
        (lead != Some(&a.id))
            .cmp(&(lead != Some(&b.id)))
            .then_with(|| a.name.cmp(&b.name))
            .then_with(|| a.id.cmp(&b.id))
    });
}

fn member_row(
    member: &OpsMember,
    room: Option<&str>,
    lead: bool,
    observation: OpsObservation,
    scope: Option<&OpsMembershipState>,
) -> OpsTreeRow {
    OpsTreeRow {
        target: OpsTarget::Member {
            room_id: room.map(str::to_owned),
            identity_id: member.id.clone(),
        },
        title: member.name.clone(),
        depth: 1,
        lead,
        state: if scope.map_or(member.waiting, |membership| membership.waiting) {
            Some("waiting".into())
        } else {
            scope.map_or_else(
                || member.state.clone(),
                |membership| membership.state.clone(),
            )
        },
        presence: member.presence,
        usage: member.usage,
        activity: Some(super::activity::Member {
            activity: member.activity,
            waiting: scope.map_or(member.waiting, |membership| membership.waiting),
            idle_over: scope.is_some_and(|membership| membership.idle_over),
            task: scope.map_or_else(
                || member.state.clone(),
                |membership| membership.state.clone(),
            ),
        }),
        count: None,
        observation,
    }
}

#[cfg(test)]
mod tests;
