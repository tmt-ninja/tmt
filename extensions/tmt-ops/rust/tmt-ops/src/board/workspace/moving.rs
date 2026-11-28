//! Lift and drop in the Agents list. Display placement and guarded squad
//! membership changes share the lifted-row UI and commit through separate owners.
use super::{
    OpsTarget, OpsTreeRow, OpsWorkspace,
    placement::{MemberOrder, Save, SaveNotice, Shift},
};
use crate::board::app::{App, Effect, Request};
use crate::membership::workspace::Operation;
use ratatui::crossterm::event::{KeyCode, KeyEvent};
use ratatui::{
    buffer::Buffer,
    layout::Rect,
    text::{Line, Span},
};
use tmt_cli_style::Role;
use tmt_tui::components::strip;

/// One lifted membership. `None` rooms are Common pool.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(in crate::board) struct Moving {
    pub member: String,
    pub name: String,
    pub source: Option<String>,
    pub target: Option<String>,
    phase: Phase,
    order: Option<Order>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Lifted,
    Applying,
    AwaitingRoster,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Order {
    source: MemberOrder,
    initial: MemberOrder,
    draft: MemberOrder,
}

/// Where the list paints a lifted membership: the source row becomes a placeholder, and the
/// lifted line follows the target group's last row unless the target is the source.
pub(in crate::board) struct Placement {
    pub source: usize,
    pub after: Option<usize>,
    /// The lifted line's tree depth: one level inside its target group.
    pub depth: usize,
}

impl Placement {
    /// The list line a row paints on: rows after the lifted line move down one.
    pub(in crate::board) fn line(&self, index: usize) -> usize {
        index + usize::from(self.after.is_some_and(|after| index > after))
    }
}

/// A name as painted on one tree line: whole up to 40 cells, else fitted.
fn short(name: &str) -> String {
    if unicode_width::UnicodeWidthStr::width(name) > 40 {
        crate::board::view::fit(name, 40)
    } else {
        name.to_owned()
    }
}

impl Moving {
    pub(in crate::board) fn lifted(&self) -> bool {
        self.phase == Phase::Lifted
    }

    pub(in crate::board) fn target_name(&self, rows: &[OpsTreeRow]) -> String {
        if self.target == self.source
            && let Some((room, draft)) = self.order()
            && let Some(parent) = draft.parent(&self.member)
        {
            let parent = OpsTarget::Member {
                room_id: room.map(str::to_owned),
                identity_id: parent.into(),
            };
            return rows
                .iter()
                .find(|row| row.target == parent)
                .map_or_else(|| "parent member".into(), |row| row.title.clone());
        }
        match &self.target {
            None => "Common pool".into(),
            Some(room) => rows
                .iter()
                .find(|row| row.target == OpsTarget::Squad(room.clone()))
                .map_or_else(|| room.clone(), |row| row.title.clone()),
        }
    }
    pub(in crate::board) fn order(&self) -> Option<(Option<&str>, &MemberOrder)> {
        let order = self.order.as_ref().filter(|_| self.lifted())?;
        Some((self.target.as_deref(), &order.draft))
    }

    fn member_target(&self) -> OpsTarget {
        OpsTarget::Member {
            room_id: self.source.clone(),
            identity_id: self.member.clone(),
        }
    }

    fn landing_target(&self) -> OpsTarget {
        OpsTarget::Member {
            room_id: self.target.clone(),
            identity_id: self.member.clone(),
        }
    }
}

/// The squads the list shows, in list order, then Common pool when the list shows it.
fn targets(rows: &[OpsTreeRow]) -> Vec<Option<String>> {
    let mut targets: Vec<_> = rows
        .iter()
        .filter_map(|row| match &row.target {
            OpsTarget::Squad(room) => Some(Some(room.clone())),
            _ => None,
        })
        .collect();
    if rows.iter().any(|row| row.target == OpsTarget::Pool) {
        targets.push(None);
    }
    targets
}

/// The last row of a group: the group row and every deeper row after it.
fn group_end(rows: &[OpsTreeRow], group: &OpsTarget) -> Option<usize> {
    let start = rows.iter().position(|row| &row.target == group)?;
    let depth = rows[start].depth;
    Some(
        rows[start + 1..]
            .iter()
            .take_while(|row| row.depth > depth)
            .count()
            + start,
    )
}

/// The move's placement in `rows`, or none while nothing is lifted.
pub(in crate::board) fn placement(app: &App, rows: &[OpsTreeRow]) -> Option<Placement> {
    if let Some(placement) = app.standalone.moving_placement(rows) {
        return Some(placement);
    }
    let moving = app.moving.as_ref().filter(|moving| moving.lifted())?;
    let source = rows
        .iter()
        .position(|row| row.target == moving.member_target())?;
    let group = moving
        .target
        .clone()
        .map_or(OpsTarget::Pool, OpsTarget::Squad);
    if moving.target == moving.source {
        return Some(Placement {
            source,
            after: None,
            depth: rows[source].depth,
        });
    }
    let start = rows.iter().position(|row| row.target == group)?;
    let end = group_end(rows, &group)?;
    let mut after = Some(end);
    let mut depth = rows[start].depth + 1;
    if let Some((_, draft)) = moving.order() {
        if existing_landing(app, rows).is_some() {
            after = None;
        } else {
            let mut members = draft.ordered_members();
            if let Some((_, level)) = members.find(|(id, _)| *id == moving.member) {
                depth += level;
                if let Some(next) = members.find_map(|(id, _)| {
                    (start + 1..=end).find(|&index| {
                        matches!(&rows[index].target, OpsTarget::Member { identity_id, .. } if identity_id == id)
                    })
                }) {
                    after = Some(next - 1);
                }
            }
        }
    }
    Some(Placement {
        source,
        after,
        depth,
    })
}

/// A member already in the destination paints its lifted row in that existing slot.
pub(in crate::board) fn existing_landing(app: &App, rows: &[OpsTreeRow]) -> Option<usize> {
    let moving = app.moving.as_ref()?;
    moving.order().filter(|_| moving.source != moving.target)?;
    let target = moving.landing_target();
    rows.iter().position(|row| row.target == target)
}

/// `⇅ worker → product`, the lifted membership, painted with the selection style.
pub(in crate::board) fn paint_lifted(
    buffer: &mut Buffer,
    area: Rect,
    app: &App,
    rows: &[OpsTreeRow],
    depth: usize,
) {
    let title = app.standalone.moving_title(rows).or_else(|| {
        let moving = app.moving.as_ref()?;
        Some(format!(
            "{}  → {}",
            short(&moving.name),
            moving.target_name(rows)
        ))
    });
    let Some(title) = title else { return };
    let look = app.look();
    let text = format!(
        " {}⇅ {title}",
        "  ".repeat(depth.min(usize::from(area.width) / 2)),
    );
    let style = look
        .role(Role::Accent)
        .add_modifier(ratatui::style::Modifier::BOLD);
    let fill = usize::from(area.width)
        .saturating_sub(unicode_width::UnicodeWidthStr::width(text.as_str()));
    strip::paint_left(
        buffer,
        area,
        Line::from(vec![Span::styled(text, style), Span::raw(" ".repeat(fill))]),
    );
}

/// `┆ worker · moving`, the lifted membership's old place.
pub(in crate::board) fn paint_placeholder(
    buffer: &mut Buffer,
    area: Rect,
    app: &App,
    depth: usize,
) {
    let Some(name) = app
        .standalone
        .lifted_name()
        .or_else(|| app.moving.as_ref().map(|moving| moving.name.as_str()))
    else {
        return;
    };
    let text = format!(
        " {}┆ {} · moving",
        "  ".repeat(depth.min(usize::from(area.width) / 2)),
        short(name)
    );
    strip::paint_left(buffer, area, Line::styled(text, app.look().role(Role::Dim)));
}

impl App {
    fn admitted_member_order(&self, room: Option<&str>) -> Option<MemberOrder> {
        let roster = &self.workspace_snapshot()?.roster;
        if !OpsWorkspace::complete_for_placement(roster, room) {
            return None;
        }
        let mut members = OpsWorkspace::placement_members(roster, room);
        let placement = self.workspace.placements.group(room);
        if placement.is_none() {
            let unread = self.unread_identities();
            members.sort_by_key(|id| std::cmp::Reverse(unread.contains(*id)));
        }
        Some(placement.cloned().unwrap_or_default().admitted(&members))
    }

    pub(in crate::board) fn begin_move(&mut self, display_only: bool) -> Effect {
        if self.workspace.saving_placement {
            return self.say("Saving member placement…");
        }
        if self.moving.is_some() {
            return Effect::None;
        }
        let Some(OpsTarget::Member {
            room_id,
            identity_id,
        }) = self.workspace.selected.clone()
        else {
            return self.say("Select an agent to move.");
        };
        let rows = self.workspace_rows();
        let Some(name) = rows
            .iter()
            .find(|row| {
                row.target
                    == OpsTarget::Member {
                        room_id: room_id.clone(),
                        identity_id: identity_id.clone(),
                    }
            })
            .map(|row| row.title.clone())
        else {
            return self.say("Select a visible agent to move.");
        };
        if !display_only && targets(&rows).len() < 2 {
            return self.say("There is no other squad to move it to.");
        }
        let order = if display_only {
            if self.workspace_snapshot().is_none() {
                return self.say("The member roster is not available.");
            }
            let Some(initial) = self.admitted_member_order(room_id.as_deref()) else {
                return self.say("Refresh for a complete member list before moving an agent.");
            };
            Some(Order {
                source: initial.clone(),
                draft: initial.clone(),
                initial,
            })
        } else {
            None
        };
        self.moving = Some(Moving {
            member: identity_id,
            name,
            source: room_id.clone(),
            target: room_id,
            phase: Phase::Lifted,
            order,
        });
        self.invalidate_frame_geometry();
        Effect::None
    }

    /// While a membership is lifted, ↑↓ choose, Enter applies and Esc cancels; every other key
    /// is ignored so no other action runs on a half-chosen move.
    pub(in crate::board) fn moving_key(&mut self, key: KeyEvent) -> Option<Effect> {
        let moving = self.moving.as_ref()?;
        if !moving.lifted() {
            if moving.phase == Phase::AwaitingRoster
                && key.code == KeyCode::Esc
                && self.shell.tab == crate::board::shell::OpsTab::Agents
                && self.workspace_input_owner() == crate::board::shell::OpsInputOwner::List
            {
                let moving = self.moving.take().expect("awaiting the roster");
                return Some(self.say(format!("Moved {}. Placement not saved.", moving.name)));
            }
            return None;
        }
        if moving.order.is_some() {
            return Some(self.order_key(key));
        }
        let rows = self.workspace_rows();
        let targets = targets(&rows);
        if targets.is_empty() {
            self.moving = None;
            self.invalidate_frame_geometry();
            return Some(self.say("The member list changed. Lift the agent again."));
        }
        let at = targets
            .iter()
            .position(|target| *target == moving.target)
            .unwrap_or(0);
        let step = |by: isize| {
            let len = targets.len() as isize;
            targets[(at as isize + by).rem_euclid(len) as usize].clone()
        };
        Some(match key.code {
            KeyCode::Up => {
                let target = step(-1);
                self.moving.as_mut().expect("lifted").target = target;
                self.invalidate_frame_geometry();
                Effect::None
            }
            KeyCode::Down => {
                let target = step(1);
                self.moving.as_mut().expect("lifted").target = target;
                self.invalidate_frame_geometry();
                Effect::None
            }
            KeyCode::Esc => {
                self.moving = None;
                self.invalidate_frame_geometry();
                Effect::None
            }
            KeyCode::Enter => self.apply_move(&rows),
            _ => Effect::None,
        })
    }

    fn order_key(&mut self, key: KeyEvent) -> Effect {
        match key.code {
            KeyCode::Enter if self.moving.as_ref().is_some_and(|m| m.source != m.target) => {
                let rows = self.workspace_rows();
                self.apply_move(&rows)
            }
            KeyCode::Enter => {
                let moving = self.moving.take().expect("lifted");
                let order = moving.order.expect("display placement");
                self.invalidate_frame_geometry();
                if order.initial == order.draft {
                    return Effect::None;
                }
                let room = moving.source.as_deref();
                if !self.observed_member_order(room, &order.source) {
                    return self.say("The member list changed. Lift the agent again.");
                }
                let mut next = self.workspace.placements.clone();
                let parent = order
                    .draft
                    .parent(&moving.member)
                    .map(|id| OpsTarget::Member {
                        room_id: moving.source.clone(),
                        identity_id: id.into(),
                    });
                next.replace(moving.source.as_deref(), order.draft);
                // Restore a folded destination only after the change is saved.
                self.workspace.saving_placement = true;
                Effect::Act(Request::MemberPlacement(Box::new(Save {
                    expected: self.workspace.placements.clone(),
                    next,
                    reveal: parent,
                    notice: SaveNotice::Reordered(moving.name),
                })))
            }
            KeyCode::Esc => {
                self.moving = None;
                self.invalidate_frame_geometry();
                Effect::None
            }
            KeyCode::Up | KeyCode::Down | KeyCode::Left | KeyCode::Right => {
                let direction = match key.code {
                    KeyCode::Up => Shift::Earlier,
                    KeyCode::Down => Shift::Later,
                    KeyCode::Right => Shift::Nest,
                    _ => Shift::Outdent,
                };
                self.shift_move(direction)
            }
            _ => Effect::None,
        }
    }

    fn shift_move(&mut self, direction: Shift) -> Effect {
        let moving = self.moving.as_ref().expect("lifted");
        let order = moving.order.as_ref().expect("display placement");
        if order.draft.at_group_edge(&moving.member, direction) {
            let groups = targets(&self.workspace_rows());
            let Some(at) = groups.iter().position(|group| *group == moving.target) else {
                self.moving = None;
                self.invalidate_frame_geometry();
                return self.say("The member list changed. Lift the agent again.");
            };
            let step = if matches!(direction, Shift::Later) {
                1
            } else {
                -1
            };
            let Some(target) = at.checked_add_signed(step).and_then(|at| groups.get(at)) else {
                return Effect::None;
            };
            let Some(initial) = self.admitted_member_order(target.as_deref()) else {
                return self.say("Refresh for a complete member list before moving an agent.");
            };
            let moving = self.moving.as_mut().expect("lifted");
            let order = moving.order.as_mut().expect("display placement");
            order.initial = initial;
            order.draft = order.initial.clone();
            order.draft.land(&moving.member, direction);
            moving.target.clone_from(target);
        } else {
            let moving = self.moving.as_mut().expect("lifted");
            moving
                .order
                .as_mut()
                .expect("display placement")
                .draft
                .shift(&moving.member, direction);
        }
        self.invalidate_frame_geometry();
        Effect::None
    }

    pub(in crate::board) fn prune_member_placement(&mut self) -> Effect {
        if self
            .moving
            .as_ref()
            .is_some_and(|moving| moving.phase == Phase::AwaitingRoster)
        {
            return self.save_landing();
        }
        if self.workspace.saving_placement
            || self.workspace.placement_prune_failed
            || self.moving.is_some()
        {
            return Effect::None;
        }
        let Some(next) = self
            .workspace_snapshot()
            .and_then(|snapshot| self.workspace.placements.pruned(&snapshot.roster))
        else {
            return Effect::None;
        };
        self.workspace.saving_placement = true;
        Effect::Act(Request::MemberPlacement(Box::new(Save {
            expected: self.workspace.placements.clone(),
            next,
            reveal: None,
            notice: SaveNotice::Prune,
        })))
    }

    fn apply_move(&mut self, rows: &[OpsTreeRow]) -> Effect {
        let Some(moving) = self.moving.clone() else {
            return Effect::None;
        };
        let name = moving.target_name(rows);
        if moving.target == moving.source {
            self.moving = None;
            self.invalidate_frame_geometry();
            return self.say(format!("{} stays in {name}.", moving.name));
        }
        if let Some(order) = &moving.order
            && (!self.observed_member_order(moving.source.as_deref(), &order.source)
                || !self.observed_member_order(moving.target.as_deref(), &order.initial)
                || !targets(rows).contains(&moving.target))
        {
            self.moving = None;
            self.invalidate_frame_geometry();
            return self.say("The member list changed. Lift the agent again.");
        }
        let room = |id: &str| super::manage::room(self, id);
        let operation = match (&moving.source, &moving.target) {
            (source, Some(destination)) => {
                let Some(destination) = room(destination) else {
                    return self.say(format!("{name} is no longer observed; refresh first."));
                };
                let source = match source {
                    Some(id) => match room(id) {
                        Some(source) => Some(source),
                        None => {
                            return self
                                .say("The source squad is no longer observed; refresh first.");
                        }
                    },
                    None => None,
                };
                Operation::Assign {
                    move_member: source.is_some(),
                    source,
                    destination,
                    member: moving.member.clone(),
                }
            }
            (Some(source), None) => {
                let Some(source) = room(source) else {
                    return self.say("The source squad is no longer observed; refresh first.");
                };
                Operation::Remove {
                    room: source,
                    member: moving.member.clone(),
                }
            }
            (None, None) => unreachable!("a pool member's pool target is its source"),
        };
        self.moving.as_mut().expect("lifted").phase = Phase::Applying;
        self.invalidate_frame_geometry();
        Effect::Act(Request::WorkspaceOperation(
            super::manage::Change::Membership(operation),
        ))
    }

    fn observed_member_order(&self, room: Option<&str>, order: &MemberOrder) -> bool {
        self.error.is_none()
            && self.workspace_snapshot().is_some_and(|snapshot| {
                OpsWorkspace::complete_for_placement(&snapshot.roster, room)
                    && order.same_members(&OpsWorkspace::placement_members(&snapshot.roster, room))
            })
    }

    pub(in crate::board) fn finish_membership_move(
        &mut self,
        outcome: &Result<crate::membership::Outcome, crate::core::SquadError>,
    ) -> bool {
        let Some(mut moving) = self
            .moving
            .take_if(|moving| moving.phase == Phase::Applying)
        else {
            return false;
        };
        if moving.order.is_some() && outcome.as_ref().is_ok_and(|outcome| outcome.complete) {
            moving.phase = Phase::AwaitingRoster;
            self.set_notice(
                Some(format!(
                    "Moved {}. Checking the landing position…",
                    moving.name
                )),
                false,
            );
            self.moving = Some(moving);
        } else {
            let message = self.finished_move(moving, outcome);
            self.set_notice(Some(message), false);
        }
        true
    }

    fn save_landing(&mut self) -> Effect {
        let moving = self.moving.as_ref().expect("confirmed membership move");
        let order = moving.order.as_ref().expect("display placement");
        let Some(snapshot) = self.workspace_snapshot().filter(|_| self.error.is_none()) else {
            return Effect::None;
        };
        let roster = &snapshot.roster;
        let source = moving.source.as_deref();
        let target = moving.target.as_deref();
        let complete = [source, target]
            .into_iter()
            .all(|room| OpsWorkspace::complete_for_placement(roster, room));
        if !complete && !roster.complete() {
            return Effect::None;
        }
        let source_members = OpsWorkspace::placement_members(roster, source);
        let target_members = OpsWorkspace::placement_members(roster, target);
        // A refresh sent before the write can finish after the membership reply.
        if complete
            && order.source.same_members(&source_members)
            && order.initial.same_members(&target_members)
        {
            return Effect::None;
        }
        let mut source_after = order.source.clone();
        source_after.remove(&moving.member);
        let landed = complete
            && source_after.same_members(&source_members)
            && order.draft.same_members(&target_members);

        let moving = self.moving.take().expect("confirmed membership move");
        if !landed || self.workspace.saving_placement {
            return self.say("Membership moved. Placement not saved: The member list changed. Lift the agent again.");
        }
        let order = moving.order.expect("display placement");
        let mut next = self.workspace.placements.clone();
        let reveal = order
            .draft
            .parent(&moving.member)
            .map(|member| OpsTarget::Member {
                room_id: moving.target.clone(),
                identity_id: member.into(),
            });
        next.replace(moving.target.as_deref(), order.draft);
        self.workspace.saving_placement = true;
        Effect::Act(Request::MemberPlacement(Box::new(Save {
            expected: self.workspace.placements.clone(),
            next,
            reveal,
            notice: SaveNotice::Landed(moving.name),
        })))
    }

    /// The move's one status line, from the same outcome the forms report; nothing is applied
    /// before it arrives, so a refused move leaves the list as it was.
    fn finished_move(
        &self,
        moving: Moving,
        outcome: &Result<crate::membership::Outcome, crate::core::SquadError>,
    ) -> String {
        let name = match &moving.target {
            None => "Common pool".to_owned(),
            Some(room) => {
                super::manage::room(self, room).map_or_else(|| room.clone(), |room| room.name)
            }
        };
        match outcome {
            Ok(outcome) if outcome.complete => format!("Moved {} to {name}.", moving.name),
            Ok(outcome) => format!(
                "Partially applied or unknown: {}. Nothing is retried automatically.",
                outcome.document["failed"]["error"]["message"]
                    .as_str()
                    .unwrap_or("some steps were not confirmed; inspect the refreshed membership")
            ),
            Err(error) => format!(
                "{}: {}",
                if crate::board::app::workspace::not_applied(&error.code) {
                    "Not applied"
                } else {
                    "Unknown"
                },
                error.message
            ),
        }
    }
}

#[cfg(test)]
pub(in crate::board) mod tests;
