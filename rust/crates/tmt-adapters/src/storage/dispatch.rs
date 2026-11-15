//! One operation receipt and canonical inbox writes share the caller transaction.

use rusqlite::{Connection, OptionalExtension, params};
use tmt_core::{
    dispatch::{
        Acceptance, DispatchInput, DispatchItem, DispatchReceipt, DispatchRoom, canonical_id,
    },
    request::{PrepareRequest, RequestError, RequestRoute, RequestService, digest::DeliveryPolicy},
    retention::{REQUEST_MIN_EXPIRY_MS, checked_deadline, valid_retention_days},
};

use super::{
    Storage, StorageError, StorageErrorCode, errors::classify,
    identities::with_immediate_transaction, requests::TransactionRequests,
};
use crate::{
    dispatch::{decode_receipt, encode_receipt, intent_digest},
    request_runtime::request_ids,
};

#[derive(Debug)]
pub enum DispatchError {
    Invalid,
    IdempotencyConflict,
    RoomRosterChanged,
    RoomRecipientNotMember,
    /// The named parent is not an available request in this post's scope (#6407).
    ParentInvalid,
    Request(RequestError<StorageError>),
    Storage(StorageError),
}

impl DispatchError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Invalid => "DISPATCH_INVALID",
            Self::IdempotencyConflict => "DISPATCH_IDEMPOTENCY_CONFLICT",
            Self::RoomRosterChanged => "ROOM_ROSTER_CHANGED",
            Self::RoomRecipientNotMember => "ROOM_RECIPIENT_NOT_MEMBER",
            Self::ParentInvalid => "DISPATCH_PARENT_INVALID",
            Self::Request(_) | Self::Storage(_) => "STORAGE_UNAVAILABLE",
        }
    }
}
impl std::fmt::Display for DispatchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}
impl std::error::Error for DispatchError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Request(e) => Some(e),
            Self::Storage(e) => Some(e),
            _ => None,
        }
    }
}
impl From<StorageError> for DispatchError {
    fn from(value: StorageError) -> Self {
        Self::Storage(value)
    }
}
impl From<RequestError<StorageError>> for DispatchError {
    fn from(value: RequestError<StorageError>) -> Self {
        match value {
            RequestError::RoomRecipientNotMember => Self::RoomRecipientNotMember,
            other => Self::Request(other),
        }
    }
}

impl Storage {
    /// Recover an accepted operation without resubmitting or consulting a changed roster.
    pub fn dispatch_receipt(
        &self,
        operation_id: &str,
    ) -> Result<Option<DispatchReceipt>, DispatchError> {
        if !canonical_id(operation_id) {
            return Err(DispatchError::Invalid);
        }
        Ok(read_dispatch_operation(self.connection()?, operation_id)?.map(|(_, receipt)| receipt))
    }

    pub fn dispatch_request(
        &mut self,
        input: DispatchInput,
        retention_days: u64,
        clock: impl Fn() -> u64,
    ) -> Result<DispatchReceipt, DispatchError> {
        self.dispatch_request_with_creation(input, retention_days, clock)
            .map(|(receipt, _)| receipt)
    }

    /// Whether this call made the immutable receipt. Replays must not create a
    /// new side effect after a prior response or an expired inbox attempt.
    pub fn dispatch_request_with_creation(
        &mut self,
        input: DispatchInput,
        retention_days: u64,
        clock: impl Fn() -> u64,
    ) -> Result<(DispatchReceipt, bool), DispatchError> {
        let input = input.normalize().ok_or(DispatchError::Invalid)?;
        if !valid_retention_days(retention_days) {
            return Err(DispatchError::Invalid);
        }
        let calendar = super::orchestration::ReceivingCalendar::load(self.connection()?)?;
        with_immediate_transaction(self, "Request dispatch", |transaction| {
            dispatch_in_transaction(transaction, input, retention_days, clock, &calendar)
        })
    }
}

// The job admission owner joins this same transaction; there is no second
// inbox or transport owner. Input normalization and retention checks are retained
// here as well, so an internal caller cannot bypass ordinary dispatch admission.
pub(super) fn dispatch_in_transaction(
    transaction: &rusqlite::Transaction<'_>,
    input: DispatchInput,
    retention_days: u64,
    clock: impl Fn() -> u64,
    calendar: &super::orchestration::ReceivingCalendar,
) -> Result<(DispatchReceipt, bool), DispatchError> {
    let input = input.normalize().ok_or(DispatchError::Invalid)?;
    if !valid_retention_days(retention_days) {
        return Err(DispatchError::Invalid);
    }
    let digest = intent_digest(&input);
    if let Some((stored_digest, receipt)) =
        read_dispatch_operation(transaction, &input.operation_id)?
    {
        if stored_digest != digest {
            return Err(DispatchError::IdempotencyConflict);
        }
        if !receipt
            .items
            .iter()
            .map(|item| &item.recipient_id)
            .eq(input.recipient_ids.iter())
        {
            return Err(StorageError::new(
                StorageErrorCode::Corrupt,
                "Invalid dispatch receipt audience",
            )
            .into());
        }
        return Ok((receipt, false));
    }
    if let Some(DispatchRoom::Roster { room_id, revision }) = &input.room {
        // The revision fences the roster the sender saw; the audience is any non-empty
        // subset of it (a channel post to the lead or to mentioned members, #5704).
        // A recipient missing from the current roster means the sender's view is stale
        // (a retirement leaves the revision unchanged), so both cases refuse alike.
        if !super::room::read_room(transaction, room_id)?.is_some_and(|room| {
            room.revision == *revision
                && input
                    .recipient_ids
                    .iter()
                    .all(|id| room.member_ids.contains(id))
        }) {
            return Err(DispatchError::RoomRosterChanged);
        }
    }
    let now = clock();
    let thread_root = input
        .parent_request_id
        .as_deref()
        .map(|parent| thread_root(transaction, parent, &input, now))
        .transpose()?;
    let expires_at_ms =
        checked_deadline(now, REQUEST_MIN_EXPIRY_MS).ok_or(DispatchError::Invalid)?;
    let mut repository = TransactionRequests(transaction, calendar);
    let mut service = RequestService::new(&mut repository, || now);
    let mut items = Vec::with_capacity(input.recipient_ids.len());
    for recipient_id in &input.recipient_ids {
        let (request_id, attempt_id) = request_ids();
        let result = service.enqueue_delivery(
            PrepareRequest {
                room_id: input.room.as_ref().map(|room| room.room_id().to_owned()),
                kind: input.kind,
                origin: input.origin,
                request_id: request_id.clone(),
                message: input.message.clone(),
                route: RequestRoute::Inbox {
                    recipient_identity_id: recipient_id.clone(),
                },
                wait: false,
                expires_at_ms,
                originator: input.originator.clone(),
                recipient_identity_id: Some(recipient_id.clone()),
                preamble: None,
            },
            attempt_id,
            retention_days,
            DeliveryPolicy {
                mode: input.mode,
                ..DeliveryPolicy::default()
            },
        );
        if let (Ok(_), Some(root)) = (&result, &thread_root) {
            transaction
                .execute(
                    "UPDATE request_attempts SET thread_root_request_id=?1 WHERE request_id=?2",
                    params![root, request_id],
                )
                .map_err(|error| classify(error, "Record thread root"))?;
        }
        let acceptance = match result {
            Ok(prepared) if prepared.held_for_person => Acceptance::HeldForPerson,
            Ok(_) => Acceptance::Queued,
            Err(RequestError::NotFound) => Acceptance::RecipientUnavailable,
            // Nothing was stored for this recipient; the operation goes on and the
            // refusal is journaled in the same transaction (#4892).
            Err(RequestError::RouteRestricted(refusal)) => {
                super::orchestration::append_route_refusal(transaction, &refusal, now)?;
                Acceptance::RouteRestricted
            }
            Err(error) => return Err(error.into()),
        };
        items.push(DispatchItem {
            recipient_id: recipient_id.clone(),
            request_id,
            acceptance,
        });
    }
    let receipt = DispatchReceipt {
        operation_id: input.operation_id,
        created_at_ms: now,
        items,
    };
    let encoded = String::from_utf8(encode_receipt(&receipt)).expect("JSON is UTF-8");
    transaction.execute(
        "INSERT INTO office_dispatch_operations (operation_id,intent_digest,receipt) VALUES (?,?,?)",
        params![receipt.operation_id,digest,encoded],
    ).map_err(|error| classify(error, "Store dispatch receipt"))?;
    Ok((receipt, true))
}

/// The thread root a reply to `parent` belongs to: the parent's own root, or the parent.
/// The parent must be an available request in the post's scope: the same room for a room
/// post; for a direct post, no room and the same sender and recipient pair, either way.
fn thread_root(
    connection: &Connection,
    parent: &str,
    input: &DispatchInput,
    now: u64,
) -> Result<String, DispatchError> {
    let row = connection
        .query_row(
            "SELECT thread_root_request_id, room_id, originator_identity_id, recipient_identity_id
             FROM request_attempts WHERE request_id=?1 AND retention_expires_at_ms>?2",
            params![parent, i64::try_from(now).unwrap_or(i64::MAX)],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| classify(error, "Read thread parent"))?;
    let Some((root, room, from, to)) = row else {
        return Err(DispatchError::ParentInvalid);
    };
    let in_scope = match &input.room {
        Some(post) => room.as_deref() == Some(post.room_id()),
        None => {
            let sender = input.originator.identity_id();
            room.is_none()
                && sender.is_some()
                && input.recipient_ids.iter().all(|recipient| {
                    let pair = (from.as_deref(), to.as_deref());
                    pair == (sender, Some(recipient.as_str()))
                        || pair == (Some(recipient.as_str()), sender)
                })
        }
    };
    if !in_scope {
        return Err(DispatchError::ParentInvalid);
    }
    Ok(root.unwrap_or_else(|| parent.to_owned()))
}

pub(super) fn read_dispatch_operation(
    connection: &Connection,
    operation_id: &str,
) -> Result<Option<(String, DispatchReceipt)>, StorageError> {
    let stored = connection
        .query_row(
            "SELECT intent_digest, receipt FROM office_dispatch_operations WHERE operation_id=?",
            [operation_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|error| classify(error, "Read dispatch operation receipt"))?;
    stored
        .map(|(digest, encoded)| {
            let receipt = decode_receipt(encoded.as_bytes())
                .filter(|receipt| receipt.operation_id == operation_id)
                .ok_or_else(|| {
                    StorageError::new(
                        StorageErrorCode::Corrupt,
                        "Invalid dispatch operation receipt",
                    )
                })?;
            Ok((digest, receipt))
        })
        .transpose()
}

#[cfg(test)]
mod tests;
