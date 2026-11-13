//! Admitted room-owned checklist service; commands reuse this admission and persistence owner.

pub mod events;
pub mod model;
mod store;

use crate::{
    config::Config,
    core::{Core, SquadError},
    me,
    squad::{Member, Squad},
};
use model::{Assignee, Completion, Document, Id, Item, Request, Tombstone};
use serde_json::json;
use std::{fmt, path::PathBuf};
use store::Store;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Code {
    InputInvalid,
    Forbidden,
    RoomUnavailable,
    AssigneeUnavailable,
    MemberUnavailable,
    NotFound,
    Deleted,
    StateInvalid,
    Conflict,
    StorageError,
    OutcomeUnknown,
}
impl Code {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InputInvalid => "CHECKLIST_INPUT_INVALID",
            Self::Forbidden => "CHECKLIST_FORBIDDEN",
            Self::RoomUnavailable => "CHECKLIST_ROOM_UNAVAILABLE",
            Self::AssigneeUnavailable => "CHECKLIST_ASSIGNEE_UNAVAILABLE",
            Self::MemberUnavailable => "CHECKLIST_MEMBER_UNAVAILABLE",
            Self::NotFound => "CHECKLIST_NOT_FOUND",
            Self::Deleted => "CHECKLIST_DELETED",
            Self::StateInvalid => "CHECKLIST_STATE_INVALID",
            Self::Conflict => "CHECKLIST_CONFLICT",
            Self::StorageError => "CHECKLIST_STORAGE_ERROR",
            Self::OutcomeUnknown => "CHECKLIST_OUTCOME_UNKNOWN",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Error {
    pub code: Code,
    pub message: String,
    /// Present only after successful current access and operation admission.
    pub current: Option<Box<Current>>,
}
impl Error {
    fn new(code: Code, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
            current: None,
        }
    }
    fn storage(error: impl fmt::Display) -> Self {
        Self::new(Code::StorageError, error.to_string())
    }
}
impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.message, self.code.as_str())
    }
}
impl std::error::Error for Error {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoomView {
    pub id: Id,
    pub name: Option<String>,
    pub available: bool,
    pub manager: bool,
}
/// The member whose conversation a list belongs to. A retired member keeps the list,
/// readable; nothing is written to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberView {
    pub id: Id,
    pub name: Option<String>,
    pub retired: bool,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ItemView {
    pub item: Item,
    pub assignee_label: Option<String>,
    pub assignee_available: bool,
}
impl AsRef<Item> for ItemView {
    fn as_ref(&self) -> &Item {
        &self.item
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Current {
    pub room: RoomView,
    /// Present only on a conversation list.
    pub member: Option<MemberView>,
    pub checklist_id: Option<Id>,
    pub inventory_revision: Option<u64>,
    pub items: Vec<ItemView>,
    pub deletion: Option<Tombstone>,
}
#[derive(Debug, Clone, Default)]
pub struct Filter {
    pub include_archived: bool,
    pub completion: Option<Completion>,
    pub assignee: Option<Id>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct List {
    pub current: Current,
    /// All nondeleted items, before archive/completion/member filtering.
    pub total_count: usize,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Applied {
    pub current: Current,
    pub item_id: Option<Id>,
    pub item_revision: Option<u64>,
    pub changed: bool,
}

/// Read-only board context, admitted by the same service as command operations.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Preview {
    pub actor_id: Id,
    pub current: Current,
    pub members: Vec<(Id, String)>,
}

struct Admission {
    room: RoomView,
    member: Option<MemberView>,
    roster: Vec<Member>,
}

/// Open items and their overlapping reference attribute: the one count the board's Talk and
/// Measure views and `checklist counts` share.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Counts {
    pub links: usize,
    pub todo: usize,
}
impl Counts {
    /// References are an attribute of open items, never an additional todo.
    pub fn of<'a, T: AsRef<Item> + 'a>(items: impl IntoIterator<Item = &'a T>) -> Self {
        let mut counts = Self::default();
        for item in items
            .into_iter()
            .map(AsRef::as_ref)
            .filter(|item| open(item))
        {
            counts.links += usize::from(item.content.reference.is_some());
            counts.todo += 1;
        }
        counts
    }
    #[cfg(test)]
    pub fn is_empty(self) -> bool {
        self == Self::default()
    }
}
/// An item still to do: open and not archived.
pub fn open(item: &Item) -> bool {
    !item.archived && item.completion == Completion::Open
}
/// The most members one `counts` read covers: the squad roster cap.
pub const COUNTS_LIMIT: usize = 32;
/// A member's open items for a board read, or why they cannot be counted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemberCount {
    pub id: Id,
    pub open: Result<usize, &'static str>,
}

/// Only this local invocation constructor captures the public caller. A request
/// has no actor field; arbitrary client-supplied identity strings grant nothing.
pub struct Service {
    core: Core,
    config_path: PathBuf,
    actor_id: Id,
    store: Store,
    /// Admitted for reading only: the actor came from `user.person`, which creates nothing.
    reading: bool,
}
impl Service {
    /// The room's own list.
    pub fn new(core: &Core, config: &Config, room_id: Id) -> Result<Self, Error> {
        Self::build(core, config, room_id, None, false)?.ok_or_else(no_actor)
    }

    /// A service for reads only (list, show, events, preview, counts): the caller, else the
    /// configured person as Core's `user.person` reports it. Neither creates or marks anyone;
    /// `None` when there is neither.
    pub fn reading(
        core: &Core,
        config: &Config,
        room_id: Id,
        member_id: Option<Id>,
    ) -> Result<Option<Self>, Error> {
        Self::build(core, config, room_id, member_id, true)
    }

    /// The list of one member's conversation in a room, from the member's UUID alone; a name is
    /// resolved once, before this, by [`resolve_member`].
    pub fn for_conversation(
        core: &Core,
        config: &Config,
        room_id: Id,
        member_id: Id,
    ) -> Result<Self, Error> {
        Self::build(core, config, room_id, Some(member_id), false)?.ok_or_else(no_actor)
    }

    /// The only checklist id a conversation list can have, which the caller need not supply.
    pub fn conversation_checklist_id(&self) -> Option<Id> {
        self.store
            .member_id()
            .map(|member| Id::conversation_checklist(self.store.room_id(), member))
    }

    fn build(
        core: &Core,
        config: &Config,
        room_id: Id,
        member_id: Option<Id>,
        reading: bool,
    ) -> Result<Option<Self>, Error> {
        let actor = match me::caller(core).map_err(|e| port(Code::Forbidden, e))? {
            Some(caller) => caller.me,
            None => match if reading {
                person(core)?
            } else {
                recorded(core)?
            } {
                Some(user) => user,
                None => return Ok(None),
            },
        };
        let root = core
            .api("storage.root", json!({}))
            .map_err(Error::storage)?;
        let root = root["dataRoot"]
            .as_str()
            .map(PathBuf::from)
            .ok_or_else(|| Error::storage("storage.root returned no dataRoot."))?;
        Ok(Some(Self {
            core: core.clone(),
            config_path: config.path().into(),
            actor_id: Id::parse(&actor.id)?,
            store: Store::new(
                &root,
                room_id,
                member_id,
                crate::migration::paths(core, None)
                    .map_err(Error::storage)?
                    .subtree(),
            )?,
            reading,
        }))
    }

    fn admit(
        &self,
        write: bool,
        manager: bool,
        assignment: Option<&Id>,
    ) -> Result<(Admission, Option<Assignee>), Error> {
        active(&self.core, &self.actor_id, Code::Forbidden)?;
        if self.reading && write {
            return Err(Error::new(
                Code::Forbidden,
                "This checklist service was admitted for reading only.",
            ));
        }
        let user = if self.reading {
            person(&self.core)?
        } else {
            recorded(&self.core)?
        }
        .is_some_and(|user| user.id == self.actor_id.as_str());
        let refs = self
            .core
            .api(
                "references.resolve",
                json!({"roomIds":[self.store.room_id().as_str()]}),
            )
            .map_err(|e| port(Code::RoomUnavailable, e))?;
        let room = &refs["rooms"][0];
        if room["id"] != self.store.room_id().as_str()
            || !room["found"].is_boolean()
            || (room["found"] == true && !room["retired"].is_boolean())
        {
            return Err(Error::new(
                Code::RoomUnavailable,
                "Core returned an incomplete room reference.",
            ));
        }
        let conversation = self.member_view(write)?;
        let available = room["found"] == true && room["retired"] == false;
        if !available {
            if write {
                return Err(Error::new(
                    Code::RoomUnavailable,
                    "The exact room is absent or retired.",
                ));
            }
            if !user {
                return Err(Error::new(
                    Code::Forbidden,
                    "Only the recorded active user may inspect an unavailable room by UUID.",
                ));
            }
            return Ok((
                Admission {
                    room: RoomView {
                        id: self.store.room_id().clone(),
                        name: None,
                        available: false,
                        manager: true,
                    },
                    member: conversation,
                    roster: Vec::new(),
                },
                None,
            ));
        }
        let shown = self
            .core
            .json(&["room", "show", self.store.room_id().as_str()])
            .map_err(|e| port(Code::RoomUnavailable, e))?;
        let name = shown["room"]["name"]
            .as_str()
            .filter(|_| shown["room"]["id"] == self.store.room_id().as_str())
            .and_then(|name| name.strip_prefix("squad-"))
            .filter(|name| crate::squad::valid_name(name))
            .ok_or_else(|| {
                Error::new(
                    Code::RoomUnavailable,
                    "The exact room is not an active Squad room.",
                )
            })?;
        let squad = Squad {
            name: name.into(),
            room_id: self.store.room_id().as_str().into(),
        };
        let roster = squad
            .roster(&self.core)
            .map_err(|e| port(Code::RoomUnavailable, e))?;
        let member = roster
            .iter()
            .find(|member| member.id == self.actor_id.as_str());
        let is_manager = user || member.is_some_and(Member::is_lead);
        if (!user && member.is_none()) || (manager && !is_manager) {
            return Err(Error::new(
                Code::Forbidden,
                "The actor lacks current room or operation permission.",
            ));
        }
        let assignee = if let Some(id) = assignment {
            let label = active(&self.core, id, Code::AssigneeUnavailable)?;
            if !roster.iter().any(|member| member.id == id.as_str()) {
                return Err(Error::new(
                    Code::AssigneeUnavailable,
                    "The chosen assignee is not an active member of this room.",
                ));
            }
            Some(Assignee {
                id: id.clone(),
                label,
            })
        } else {
            None
        };
        Ok((
            Admission {
                room: RoomView {
                    id: self.store.room_id().clone(),
                    name: Some(name.into()),
                    available: true,
                    manager: is_manager,
                },
                member: conversation,
                roster,
            },
            assignee,
        ))
    }

    /// The conversation's member, resolved from Core on every admission. A retired member is
    /// readable and never written to; an unknown one is refused by its UUID.
    fn member_view(&self, write: bool) -> Result<Option<MemberView>, Error> {
        let Some(member) = self.store.member_id() else {
            return Ok(None);
        };
        let refs = self
            .core
            .api(
                "references.resolve",
                json!({"identityIds":[member.as_str()]}),
            )
            .map_err(|e| port(Code::MemberUnavailable, e))?;
        let identity = &refs["identities"][0];
        if identity["id"] != member.as_str() || !identity["found"].is_boolean() {
            return Err(Error::new(
                Code::MemberUnavailable,
                "Core returned an incomplete member reference.",
            ));
        }
        if identity["found"] != true {
            return Err(Error::new(
                Code::MemberUnavailable,
                format!("No identity has the UUID {}.", member.as_str()),
            ));
        }
        let retired = identity["retired"] == true;
        if retired && write {
            return Err(Error::new(
                Code::MemberUnavailable,
                format!(
                    "The member {} is retired: its conversation list stays readable and takes no writes.",
                    member.as_str()
                ),
            ));
        }
        Ok(Some(MemberView {
            id: member.clone(),
            name: identity["name"].as_str().map(str::to_owned),
            retired,
        }))
    }

    /// Full inventory and eligible identities for an explicit board preview.
    /// This does not initialize storage or turn a projection into write authority.
    pub fn preview(&self) -> Result<Preview, Error> {
        let _migration =
            crate::migration::config_write_guard(&self.config_path).map_err(Error::storage)?;
        let (admission, _) = self.admit(false, false, None)?;
        let document = self.store.read()?;
        Ok(Preview {
            actor_id: self.actor_id.clone(),
            current: project(&admission, document.as_ref(), None),
            members: admission
                .roster
                .iter()
                .map(|member| Ok((Id::parse(&member.id)?, member.name.clone())))
                .collect::<Result<_, Error>>()?,
        })
    }

    pub fn list(&self, filter: &Filter) -> Result<List, Error> {
        let _migration =
            crate::migration::config_write_guard(&self.config_path).map_err(Error::storage)?;
        let (admission, _) = self.admit(false, false, None)?;
        let document = self.store.read()?;
        let mut current = project(&admission, document.as_ref(), None);
        let total_count = current.items.len();
        current.items.retain(|view| {
            (filter.include_archived || !view.item.archived)
                && filter
                    .completion
                    .is_none_or(|completion| view.item.completion == completion)
                && filter
                    .assignee
                    .as_ref()
                    .is_none_or(|id| view.item.assignee.as_ref().is_some_and(|a| &a.id == id))
        });
        Ok(List {
            current,
            total_count,
        })
    }

    /// Every given member's open conversation-list items in this room, from one admission and
    /// one reference read: the board's count, for at most [`COUNTS_LIMIT`] members. With no
    /// members given, the room's current roster.
    pub fn counts(&self, members: Option<Vec<Id>>) -> Result<Vec<MemberCount>, Error> {
        let _migration =
            crate::migration::config_write_guard(&self.config_path).map_err(Error::storage)?;
        let (admission, _) = self.admit(false, false, None)?;
        let members = match members {
            Some(members) => members,
            None => admission
                .roster
                .iter()
                .map(|member| Id::parse(&member.id))
                .collect::<Result<_, _>>()?,
        };
        if members.len() > COUNTS_LIMIT {
            return Err(Error::new(
                Code::InputInvalid,
                format!("At most {COUNTS_LIMIT} members per read."),
            ));
        }
        if !admission.room.available {
            return Ok(members
                .into_iter()
                .map(|id| MemberCount {
                    id,
                    open: Err("room-unavailable"),
                })
                .collect());
        }
        let ids: Vec<&str> = members.iter().map(Id::as_str).collect();
        let refs = self
            .core
            .api("references.resolve", json!({ "identityIds": ids }))
            .map_err(|e| port(Code::MemberUnavailable, e))?;
        members
            .into_iter()
            .map(|id| {
                let found = refs["identities"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|identity| identity["id"] == id.as_str() && identity["found"] == true);
                if !found {
                    return Ok(MemberCount {
                        id,
                        open: Err("member-unavailable"),
                    });
                }
                let document = self.store.for_member(id.clone()).read()?;
                let open = Counts::of(document.iter().flat_map(|d| &d.items)).todo;
                Ok(MemberCount { id, open: Ok(open) })
            })
            .collect()
    }

    pub fn show(&self, checklist_id: &Id, item_id: &Id) -> Result<Current, Error> {
        let _migration =
            crate::migration::config_write_guard(&self.config_path).map_err(Error::storage)?;
        let (admission, _) = self.admit(false, false, None)?;
        let document = self.store.read()?;
        let current = project(&admission, document.as_ref(), Some(item_id));
        let document = document
            .as_ref()
            .filter(|d| &d.checklist_id == checklist_id)
            .ok_or_else(|| Error::new(Code::NotFound, "The exact checklist was not found."))?;
        if document.deleted.iter().any(|d| &d.item_id == item_id) {
            return Err(Error {
                current: Some(Box::new(current)),
                ..Error::new(Code::Deleted, "The exact item is deleted.")
            });
        }
        if !document.items.iter().any(|i| &i.id == item_id) {
            return Err(Error::new(Code::NotFound, "The exact item was not found."));
        }
        Ok(Current {
            items: current
                .items
                .into_iter()
                .filter(|i| &i.item.id == item_id)
                .collect(),
            ..current
        })
    }

    /// The list's mutation log after `after` (0 reads from the beginning), under the same read
    /// admission as [`Service::list`]. It creates and rewrites nothing.
    pub fn events(&self, after: u64, limit: u64) -> Result<events::Page, Error> {
        let _migration =
            crate::migration::config_write_guard(&self.config_path).map_err(Error::storage)?;
        self.admit(false, false, None)?;
        self.store.events(after, limit)
    }

    /// The room this service was admitted for.
    pub fn room_id(&self) -> &Id {
        self.store.room_id()
    }

    pub fn apply(&self, request: &Request) -> Result<Applied, Error> {
        request.validate()?;
        if &request.room_id != self.store.room_id() {
            return Err(Error::new(
                Code::InputInvalid,
                "Request room differs from the admitted service room.",
            ));
        }
        if let Some(derived) = self.conversation_checklist_id()
            && request.checklist_id != derived
        {
            return Err(Error::new(
                Code::InputInvalid,
                "A conversation list has exactly one checklist UUID, derived from its room and member.",
            ));
        }
        // Refuse unauthorized operations before creating any storage infrastructure.
        let _migration =
            crate::migration::config_write_guard(&self.config_path).map_err(Error::storage)?;
        self.admit(true, request.action.manager(), request.action.assignment())?;
        self.store.update(
            |document| {
                let (admission, assignee) =
                    self.admit(true, request.action.manager(), request.action.assignment())?;
                let before = document.clone();
                let stamp = model::Stamp {
                    by: self.actor_id.clone(),
                    at_ms: crate::status::now_ms(),
                };
                let mutation = model::apply(document, request, assignee, &stamp);
                // The list a create just made belongs to this conversation; an existing one
                // was decoded as exactly this conversation's.
                if let (Some(created), Some(member)) = (document.as_mut(), self.store.member_id()) {
                    created.member_id = Some(member.clone());
                }
                let outcome = match mutation {
                    Ok(outcome) => outcome,
                    Err(mut error) => {
                        if matches!(error.code, Code::Conflict | Code::Deleted) {
                            error.current = Some(Box::new(project(
                                &admission,
                                before.as_ref(),
                                request.action.item_id(),
                            )));
                        }
                        return Err(error);
                    }
                };
                // These checks are repeated after the candidate is complete, immediately
                // before store staging/publication. Core and files are not one transaction.
                let (admission, assignee) =
                    self.admit(true, request.action.manager(), request.action.assignment())?;
                if let Some(assignee) = assignee.filter(|_| outcome.changed) {
                    let item = document
                        .as_mut()
                        .and_then(|d| {
                            d.items
                                .iter_mut()
                                .find(|i| Some(&i.id) == request.action.item_id())
                        })
                        .expect("admitted assignment has a live target");
                    item.assignee = Some(assignee);
                }
                Ok((
                    Applied {
                        current: project(&admission, document.as_ref(), request.action.item_id()),
                        item_id: request.action.item_id().cloned(),
                        item_revision: outcome.item_revision,
                        changed: outcome.changed,
                    },
                    outcome.event,
                ))
            },
            || {
                self.admit(true, request.action.manager(), request.action.assignment())
                    .map(|_| ())
            },
        )
    }
}

/// A member given as a UUID or a name, resolved once through Core's public identity reads;
/// only the UUID goes on. A UUID may name a retired identity (its list stays readable); a
/// name resolves to the active identity only, so a replacement of the same name is another
/// UUID with another, empty list.
pub fn resolve_member(core: &Core, selector: &str) -> Result<Id, Error> {
    if let Ok(id) = Id::parse(selector) {
        let refs = core
            .api("references.resolve", json!({"identityIds":[id.as_str()]}))
            .map_err(|e| port(Code::MemberUnavailable, e))?;
        let identity = &refs["identities"][0];
        return if identity["id"] == id.as_str() && identity["found"] == true {
            Ok(id)
        } else {
            Err(Error::new(
                Code::MemberUnavailable,
                format!("No identity has the UUID {}.", id.as_str()),
            ))
        };
    }
    match me::lookup(core, selector).map_err(|e| port(Code::MemberUnavailable, e))? {
        Some(found) => Id::parse(&found.id),
        None => Err(Error::new(
            Code::MemberUnavailable,
            format!("No active identity is named {selector:?}."),
        )),
    }
}
fn port(code: Code, error: SquadError) -> Error {
    Error::new(code, error.to_string())
}
fn recorded(core: &Core) -> Result<Option<me::Me>, Error> {
    me::current(core).map_err(|e| port(Code::Forbidden, e))
}
/// The configured person, read-only: never creates or marks it.
fn person(core: &Core) -> Result<Option<me::Me>, Error> {
    me::person(core).map_err(|e| port(Code::Forbidden, e))
}
/// A read with neither an admitted caller nor a configured person: nothing to admit, nothing created.
pub fn no_person() -> Error {
    Error::new(Code::Forbidden, "No admitted caller or configured person.")
}
fn no_actor() -> Error {
    Error::new(
        Code::Forbidden,
        "No admitted caller or recorded active user.",
    )
}
fn active(core: &Core, id: &Id, code: Code) -> Result<String, Error> {
    let refs = core
        .api("references.resolve", json!({"identityIds":[id.as_str()]}))
        .map_err(|e| port(code, e))?;
    let identity = &refs["identities"][0];
    if identity["id"] != id.as_str() || identity["found"] != true || identity["retired"] != false {
        return Err(Error::new(code, "The exact identity is unavailable."));
    }
    identity["name"]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| Error::new(code, "Core returned no identity name."))
}
fn project(admission: &Admission, document: Option<&Document>, item_id: Option<&Id>) -> Current {
    Current {
        room: admission.room.clone(),
        member: admission.member.clone(),
        checklist_id: document.map(|d| d.checklist_id.clone()),
        inventory_revision: document.map(|d| d.inventory_revision),
        items: document
            .into_iter()
            .flat_map(|d| &d.items)
            .map(|item| {
                let member = item
                    .assignee
                    .as_ref()
                    .and_then(|a| admission.roster.iter().find(|m| m.id == a.id.as_str()));
                ItemView {
                    item: item.clone(),
                    assignee_label: member
                        .map(|m| m.name.clone())
                        .or_else(|| item.assignee.as_ref().map(|a| a.label.clone())),
                    assignee_available: member.is_some(),
                }
            })
            .collect(),
        deletion: document
            .and_then(|d| d.deleted.iter().find(|d| Some(&d.item_id) == item_id))
            .cloned(),
    }
}

#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;
