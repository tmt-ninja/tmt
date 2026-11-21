//! Lift and drop in the Agents list. Display placement and guarded squad
//! membership changes share the lifted-row UI and commit through separate owners.
use super::{
    OpsTarget, OpsTreeRow, OpsWorkspace,
    placement::{Group, Save, Shift},
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
    /// Enter sent the operation; the result line ends the move.
    pub applying: bool,
    order: Option<Order>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Order {
    initial: Group,
    draft: Group,
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
    pub(in crate::board) fn target_name(&self, rows: &[OpsTreeRow]) -> String {
        if let Some((room, draft)) = self.order()
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
    pub(in crate::board) fn order(&self) -> Option<(Option<&str>, &Group)> {
        self.order
            .as_ref()
            .map(|order| (self.source.as_deref(), &order.draft))
    }

    fn member_target(&self) -> OpsTarget {
        OpsTarget::Member {
            room_id: self.source.clone(),
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
    let moving = app.moving.as_ref().filter(|moving| !moving.applying)?;
    let source = rows
        .iter()
        .position(|row| row.target == moving.member_target())?;
    let group = moving
        .target
        .clone()
        .map_or(OpsTarget::Pool, OpsTarget::Squad);
    let after = (moving.target != moving.source)
        .then(|| group_end(rows, &group))
        .flatten();
    let depth = match after {
        Some(_) => rows
            .iter()
            .find(|row| row.target == group)
            .map_or(1, |row| row.depth + 1),
        None => rows[source].depth,
    };
    Some(Placement {
        source,
        after,
        depth,
    })
}

/// `⇅ worker → product`, the lifted membership, painted with the selection style.
pub(in crate::board) fn paint_lifted(
    buffer: &mut Buffer,
    area: Rect,
    app: &App,
    rows: &[OpsTreeRow],
    depth: usize,
) {
    let Some(moving) = app.moving.as_ref() else {
        return;
    };
    let look = app.look();
    let text = format!(
        " {}⇅ {}  → {}",
        "  ".repeat(depth.min(usize::from(area.width) / 2)),
        short(&moving.name),
        moving.target_name(rows)
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
    let Some(moving) = app.moving.as_ref() else {
        return;
    };
    let text = format!(
        " {}┆ {} · moving",
        "  ".repeat(depth.min(usize::from(area.width) / 2)),
        short(&moving.name)
    );
    strip::paint_left(buffer, area, Line::styled(text, app.look().role(Role::Dim)));
}

impl App {
    pub(in crate::board) fn begin_move(&mut self, display_only: bool) -> Effect {
        if self.workspace.saving_placement {
            return self.say("Saving member placement…");
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
            let Some(snapshot) = self.workspace_snapshot() else {
                return self.say("The member roster is not available.");
            };
            let roster = &snapshot.roster;
            if !OpsWorkspace::complete_for_placement(roster, room_id.as_deref()) {
                return self.say("Refresh for a complete member list before moving an agent.");
            }
            let mut members = OpsWorkspace::placement_members(roster, room_id.as_deref());
            if self
                .workspace
                .placements
                .group(room_id.as_deref())
                .is_none()
            {
                let unread = self.unread_identities();
                members.sort_by_key(|id| std::cmp::Reverse(unread.contains(*id)));
            }
            let initial = self
                .workspace
                .placements
                .group(room_id.as_deref())
                .cloned()
                .unwrap_or_default()
                .admitted(&members);
            Some(Order {
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
            applying: false,
            order,
        });
        self.invalidate_frame_geometry();
        Effect::None
    }

    /// While a membership is lifted, ↑↓ choose, Enter applies and Esc cancels; every other key
    /// is ignored so no other action runs on a half-chosen move.
    pub(in crate::board) fn moving_key(&mut self, key: KeyEvent) -> Option<Effect> {
        let moving = self.moving.as_ref().filter(|moving| !moving.applying)?;
        if moving.order.is_some() {
            return Some(self.order_key(key));
        }
        let rows = self.workspace_rows();
        let targets = targets(&rows);
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
            KeyCode::Enter => {
                let moving = self.moving.take().expect("lifted");
                let order = moving.order.expect("display placement");
                self.invalidate_frame_geometry();
                if order.initial == order.draft {
                    return Effect::None;
                }
                let room = moving.source.as_deref();
                let still_current = self.workspace_snapshot().is_some_and(|snapshot| {
                    OpsWorkspace::complete_for_placement(&snapshot.roster, room)
                        && order
                            .initial
                            .same_members(&OpsWorkspace::placement_members(&snapshot.roster, room))
                });
                if !still_current {
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
                    notice: Some(format!("Moved {} in the Agents list.", moving.name)),
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
                let moving = self.moving.as_mut().expect("lifted");
                moving
                    .order
                    .as_mut()
                    .expect("display placement")
                    .draft
                    .shift(&moving.member, direction);
                self.invalidate_frame_geometry();
                Effect::None
            }
            _ => Effect::None,
        }
    }

    pub(in crate::board) fn prune_member_placement(&mut self) -> Effect {
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
            notice: None,
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
        self.moving.as_mut().expect("lifted").applying = true;
        self.invalidate_frame_geometry();
        Effect::Act(Request::WorkspaceOperation(
            super::manage::Change::Membership(operation),
        ))
    }

    /// The move's one status line, from the same outcome the forms report; nothing is applied
    /// before it arrives, so a refused move leaves the list as it was.
    pub(in crate::board) fn finished_move(
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
