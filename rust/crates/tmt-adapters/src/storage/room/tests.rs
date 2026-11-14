use super::*;
use crate::test_support::TestDirectory;
use tmt_core::{
    dispatch::{DispatchInput, DispatchRoom},
    identity::{Lifetime, create_or_resolve},
};

const ROOM: &str = "11111111-1111-4111-8111-111111111111";
const OPERATION: &str = "22222222-2222-4222-8222-222222222222";

#[test]
fn room_retirement_preserves_rosters_and_history_but_fences_new_work_and_recreation() {
    use tmt_core::{request::RequestService, room};
    let directory = TestDirectory::new();
    let path = directory.path.join("retired.db");
    let mut storage = Storage::open(&path).unwrap();
    let alice = identity(&mut storage, "Alice");
    let original = storage
        .save_meeting_room(ROOM, write(0, vec![alice.clone()]))
        .unwrap();
    let input = dispatch(&original);
    let receipt = storage
        .dispatch_request(input.clone(), 90, || 1000)
        .unwrap();
    assert!(matches!(
        storage.retire_meeting_room(ROOM, 2),
        Err(RoomStoreError::RevisionConflict)
    ));
    assert_eq!(
        storage.find_meeting_room(ROOM).unwrap(),
        Some(original.clone())
    );
    let retired = storage.retire_meeting_room(ROOM, 1).unwrap();
    assert!(retired.retired);
    assert_eq!(retired.revision, 2);
    assert_eq!(retired.member_ids, original.member_ids);
    assert_eq!(storage.retire_meeting_room(ROOM, 1).unwrap(), retired);
    assert_eq!(storage.retire_meeting_room(ROOM, 2).unwrap(), retired);
    assert!(storage.list_meeting_rooms().unwrap().is_empty());
    assert!(storage.find_meeting_room(ROOM).unwrap().is_none());
    assert_eq!(
        room::resolve_historical_room(&mut storage, ROOM).unwrap(),
        retired
    );
    assert!(room::resolve_room(&mut storage, ROOM).is_err());
    assert!(room::resolve_historical_room(&mut storage, "Design room").is_err());
    assert!(
        storage
            .change_meeting_membership(ROOM, &alice, MembershipChange::Leave)
            .is_err()
    );
    assert!(matches!(
        storage.save_meeting_room(ROOM, write(0, vec![])),
        Err(RoomStoreError::Retired)
    ));
    assert_eq!(
        storage
            .dispatch_request(input.clone(), 90, || panic!("replay must not enqueue"))
            .unwrap(),
        receipt
    );
    let mut new_input = input;
    new_input.operation_id = uuid::Uuid::new_v4().to_string();
    assert_eq!(
        storage
            .dispatch_request(new_input, 90, || panic!("retired room must not enqueue"))
            .unwrap_err()
            .code(),
        "ROOM_ROSTER_CHANGED"
    );
    let incoming = RequestService::new(&mut storage, || 2000)
        .list_incoming(&alice, Some(ROOM), None, None)
        .unwrap();
    assert_eq!(incoming.items.len(), 1);
    assert_eq!(
        incoming.items[0].exchange.request_id,
        receipt.items[0].request_id
    );
    let replacement = room::create(&mut storage, "Design room".into()).unwrap();
    assert_ne!(replacement.id, ROOM);
    assert!(replacement.member_ids.is_empty());
    assert_eq!(
        room::resolve_room(&mut storage, "Design room").unwrap(),
        replacement
    );
    storage.close().unwrap();
    let mut reopened = Storage::open(&path).unwrap();
    assert_eq!(
        reopened.find_historical_meeting_room(ROOM).unwrap(),
        Some(retired)
    );
    assert_eq!(
        reopened
            .connection()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM office_meeting_members WHERE room_id=?",
                [ROOM],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}

#[test]
fn failed_retirement_does_not_change_revision_or_membership() {
    let directory = TestDirectory::new();
    let mut storage = Storage::open(directory.path.join("retire-failure.db")).unwrap();
    let original = storage.save_meeting_room(ROOM, write(0, vec![])).unwrap();
    storage.connection().unwrap().execute_batch("CREATE TRIGGER reject_retire BEFORE UPDATE OF retired ON office_meeting_rooms BEGIN SELECT RAISE(ABORT,'fixture failure'); END;").unwrap();
    assert!(matches!(
        storage.retire_meeting_room(ROOM, 1),
        Err(RoomStoreError::Storage(_))
    ));
    assert_eq!(storage.find_meeting_room(ROOM).unwrap(), Some(original));
}

#[test]
fn final_room_revision_can_retire_once_and_replay_without_overflow() {
    let directory = TestDirectory::new();
    let mut storage = Storage::open(directory.path.join("retire-final.db")).unwrap();
    storage.save_meeting_room(ROOM, write(0, vec![])).unwrap();
    let last = tmt_core::limits::MAX_JS_SAFE_INTEGER;
    storage
        .connection()
        .unwrap()
        .execute(
            "UPDATE office_meeting_rooms SET revision=? WHERE room_id=?",
            params![(last - 1) as i64, ROOM],
        )
        .unwrap();
    let retired = storage.retire_meeting_room(ROOM, last - 1).unwrap();
    assert_eq!(retired.revision, last);
    assert_eq!(
        storage.retire_meeting_room(ROOM, last - 1).unwrap(),
        retired
    );
    assert_eq!(storage.retire_meeting_room(ROOM, last).unwrap(), retired);
    assert!(matches!(
        storage.retire_meeting_room(ROOM, last + 1),
        Err(RoomStoreError::Invalid)
    ));
}

#[test]
fn shared_resolution_rejects_ambiguous_names_and_preserves_uuid_authority() {
    use tmt_core::room::{self, ResolveError};
    let directory = TestDirectory::new();
    let mut storage = Storage::open(directory.path.join("rooms.db")).unwrap();
    let first = storage.save_meeting_room(ROOM, write(0, vec![])).unwrap();
    assert_eq!(
        room::resolve_room(&mut storage, "Design room").unwrap(),
        first
    );
    assert!(matches!(
        room::resolve_room(&mut storage, "design room"),
        Err(ResolveError::NotFound)
    ));
    let second = storage
        .save_meeting_room(OPERATION, write(0, vec![]))
        .unwrap();
    match room::resolve_room(&mut storage, "Design room") {
        Err(ResolveError::Ambiguous(rooms)) => {
            assert_eq!(rooms, vec![first.clone(), second.clone()])
        }
        other => panic!("expected both candidates, got {other:?}"),
    }
    assert_eq!(room::resolve_room(&mut storage, ROOM).unwrap(), first);
    // A label resembling another room UUID must never shadow UUID routing.
    storage
        .save_meeting_room(
            OPERATION,
            RoomWrite {
                name: ROOM.into(),
                expected_revision: second.revision,
                member_ids: vec![],
            },
        )
        .unwrap();
    assert_eq!(room::resolve_room(&mut storage, ROOM).unwrap(), first);
    assert!(matches!(
        room::resolve_room(&mut storage, "33333333-3333-4333-8333-333333333333"),
        Err(ResolveError::NotFound)
    ));
    storage.close().unwrap();
}

#[test]
fn dispatch_records_the_fenced_room_on_each_canonical_request_after_leave() {
    use tmt_core::request::RequestService;
    let directory = TestDirectory::new();
    let path = directory.path.join("rooms.db");
    let mut storage = Storage::open(&path).unwrap();
    let alice = identity(&mut storage, "Alice");
    let room = storage
        .save_meeting_room(ROOM, write(0, vec![alice.clone()]))
        .unwrap();
    let receipt = storage
        .dispatch_request(dispatch(&room), 90, || 1000)
        .unwrap();
    storage
        .change_meeting_membership(ROOM, &alice, MembershipChange::Leave)
        .unwrap();
    storage.close().unwrap();
    let mut storage = Storage::open(&path).unwrap();
    let incoming = RequestService::new(&mut storage, || 2000)
        .list_incoming(&alice, Some(ROOM), None, None)
        .unwrap();
    assert_eq!(incoming.items.len(), 1);
    assert_eq!(
        incoming.items[0].exchange.request_id,
        receipt.items[0].request_id
    );
    assert_eq!(incoming.items[0].exchange.room_id.as_deref(), Some(ROOM));
    let context = RequestService::new(&mut storage, || 2000)
        .get_context(&receipt.items[0].request_id)
        .unwrap()
        .unwrap();
    assert_eq!(context.attempt.room_id.as_deref(), Some(ROOM));
    storage.close().unwrap();
}

#[test]
fn a_roster_post_reaches_only_the_addressed_members() {
    // A channel post to the lead or to mentioned members (#5704): a subset of the roster.
    let directory = TestDirectory::new();
    let mut storage = Storage::open(directory.path.join("rooms.db")).unwrap();
    let alice = identity(&mut storage, "Alice");
    let bob = identity(&mut storage, "Bob");
    let carol = identity(&mut storage, "Carol");
    let room = storage
        .save_meeting_room(ROOM, write(0, vec![alice.clone(), bob.clone()]))
        .unwrap();
    let mut input = dispatch(&room);
    input.recipient_ids = vec![bob.clone()];
    let receipt = storage
        .dispatch_request(input.clone(), 90, || 1000)
        .unwrap();
    assert_eq!(receipt.items.len(), 1);
    assert_eq!(receipt.items[0].recipient_id, bob);
    let mut outsider = input;
    outsider.operation_id = uuid::Uuid::new_v4().to_string();
    outsider.recipient_ids = vec![bob.clone(), carol.clone()];
    assert_eq!(
        storage
            .dispatch_request(outsider, 90, || panic!("a non-member must not create work"))
            .unwrap_err()
            .code(),
        "ROOM_ROSTER_CHANGED"
    );

    // Thread replies (#6407): each reply stores the thread root, a reply to a reply stores
    // the same root, and a parent outside the post's scope stores nothing.
    use tmt_core::request::{
        Originator, RequestService,
        history::{ChangedSince, HistoryQuery, HistoryScope, RoomSince},
    };
    let op = || uuid::Uuid::new_v4().to_string();
    let post =
        |storage: &mut Storage, input: DispatchInput| storage.dispatch_request(input, 90, || 2000);
    let reply_in_room = |parent: &str, to: &str, operation: String| {
        let mut input = dispatch(&room);
        input.operation_id = operation;
        input.recipient_ids = vec![to.to_owned()];
        input.message = "On it.".into();
        input.parent_request_id = Some(parent.to_owned());
        input
    };
    let root = receipt.items[0].request_id.clone();
    let first = post(&mut storage, reply_in_room(&root, &alice, op())).unwrap();
    let first_id = first.items[0].request_id.clone();
    let nested_op = op();
    let nested = post(
        &mut storage,
        reply_in_room(&first_id, &bob, nested_op.clone()),
    )
    .unwrap();
    let nested_id = nested.items[0].request_id.clone();
    assert_eq!(
        post(&mut storage, reply_in_room(&root, &bob, nested_op))
            .unwrap_err()
            .code(),
        "DISPATCH_IDEMPOTENCY_CONFLICT",
        "the parent is part of the intent"
    );
    const OTHER_ROOM: &str = "33333333-3333-4333-8333-333333333333";
    let other = storage
        .save_meeting_room(OTHER_ROOM, write(0, vec![alice.clone()]))
        .unwrap();
    let mut elsewhere = dispatch(&other);
    elsewhere.operation_id = op();
    let elsewhere = post(&mut storage, elsewhere).unwrap().items[0]
        .request_id
        .clone();
    // A direct exchange between Alice and Bob: talk outside the room.
    let direct = |from: &str, to: &str, parent: Option<&str>| DispatchInput {
        originator: Originator::Explicit(from.to_owned()),
        recipient_ids: vec![to.to_owned()],
        room: None,
        operation_id: op(),
        parent_request_id: parent.map(str::to_owned),
        ..dispatch(&room)
    };
    let direct_root = post(&mut storage, direct(&alice, &bob, None))
        .unwrap()
        .items[0]
        .request_id
        .clone();
    let direct_reply = post(&mut storage, direct(&bob, &alice, Some(&direct_root))).unwrap();
    let count = |storage: &Storage| -> i64 {
        storage
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM request_attempts", [], |r| r.get(0))
            .unwrap()
    };
    let before = count(&storage);
    for refused in [
        reply_in_room(&elsewhere, &alice, op()),
        reply_in_room(&direct_root, &alice, op()),
        direct(&alice, &carol, Some(&direct_root)),
        reply_in_room("req_00000000-0000-4000-8000-000000000009", &alice, op()),
    ] {
        assert_eq!(
            post(&mut storage, refused).unwrap_err().code(),
            "DISPATCH_PARENT_INVALID"
        );
    }
    assert_eq!(count(&storage), before, "a refused parent stores nothing");

    // After reopen the room stream groups by root: replies name it, the root counts them,
    // and the direct exchange never appears in the room.
    let path = directory.path.join("rooms.db");
    storage.close().unwrap();
    let mut storage = Storage::open(&path).unwrap();
    let room_query = || HistoryQuery {
        scope: HistoryScope::Room(ROOM.into()),
        limit: 50,
        before: None,
    };
    let (page, changes) = RequestService::new(&mut storage, || 3000)
        .request_room_history(room_query(), None)
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(
        &crate::request_history::encode_room_page(&page, &changes, ROOM),
    )
    .unwrap();
    let item = |id: &str| {
        value["items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["requestId"] == id)
            .cloned()
            .unwrap()
    };
    assert_eq!(value["items"].as_array().unwrap().len(), 3);
    assert_eq!(item(&root)["replyCount"], 2);
    assert!(item(&root)["parentRequestId"].is_null());
    assert_eq!(item(&first_id)["parentRequestId"], root.as_str());
    assert_eq!(item(&nested_id)["parentRequestId"], root.as_str());
    // The reply is delivered with one bounded line naming its root.
    let shown = RequestService::new(&mut storage, || 3000)
        .show_incoming_request(&alice, &first_id)
        .unwrap();
    let line = format!("Thread: {root} · \"Review the saved sketch.\"");
    assert_eq!(
        shown
            .thread_root
            .as_ref()
            .map(crate::request_frame::thread_reply_line),
        Some(line.clone())
    );
    // The live and Digest delivery frames the line with the message as one untrusted body:
    // the same frame, one reply block, the exact message after the line.
    let delivered = crate::digest::live_request_text_at(&mut storage, &first_id, || 3000)
        .unwrap()
        .unwrap();
    assert!(delivered.starts_with(&format!("{line}\nOn it.\n\n<tmt-reply from=")));
    assert_eq!(delivered.matches("<tmt-reply").count(), 1);
    assert_eq!(
        shown.exchange.thread_root_request_id.as_deref(),
        Some(root.as_str())
    );
    let direct_shown = RequestService::new(&mut storage, || 3000)
        .show_incoming_request(&alice, &direct_reply.items[0].request_id)
        .unwrap();
    assert_eq!(
        direct_shown.exchange.thread_root_request_id.as_deref(),
        Some(direct_root.as_str())
    );

    // Room changes (#6375): an unchanged room counts 0, a final after the position counts
    // and carries its preview, and another room's position is unknown.
    let since = |text: &str| crate::request_history::decode_room_position(text, ROOM);
    let position = value["changePosition"].as_str().unwrap().to_owned();
    let (_, unchanged) = RequestService::new(&mut storage, || 3000)
        .request_room_history(room_query(), Some(since(&position)))
        .unwrap();
    assert_eq!(
        unchanged.changed_since,
        Some(ChangedSince::Count {
            count: 0,
            more: false
        })
    );
    let attempt: String = storage
        .connection()
        .unwrap()
        .query_row(
            "SELECT attempt_id FROM request_attempts WHERE request_id=?",
            [&first_id],
            |r| r.get(0),
        )
        .unwrap();
    let route = tmt_core::request::RequestRoute::Inbox {
        recipient_identity_id: alice.clone(),
    };
    RequestService::new(&mut storage, || 3000)
        .submit_response(tmt_core::request::SubmitResponse {
            request_id: first_id.clone(),
            proof: tmt_core::request::ResponseProof::Compact(
                tmt_core::request::correlation::response_token(&first_id, &attempt, &route),
            ),
            body: "Done.\nDetails follow.".into(),
        })
        .unwrap();
    let (page, changed) = RequestService::new(&mut storage, || 4000)
        .request_room_history(room_query(), Some(since(&position)))
        .unwrap();
    assert_eq!(
        changed.changed_since,
        Some(ChangedSince::Count {
            count: 1,
            more: false
        })
    );
    let value: serde_json::Value = serde_json::from_slice(
        &crate::request_history::encode_room_page(&page, &changed, ROOM),
    )
    .unwrap();
    let replied = value["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["requestId"] == first_id.as_str())
        .unwrap();
    assert_eq!(replied["responsePreview"], "Done.");
    let foreign = crate::request_history::encode_room_position(OTHER_ROOM, changed.position);
    assert_eq!(since(&foreign), RoomSince::Foreign);
    let (_, unknown) = RequestService::new(&mut storage, || 4000)
        .request_room_history(room_query(), Some(since(&foreign)))
        .unwrap();
    assert_eq!(unknown.changed_since, Some(ChangedSince::Unknown));
    // Room change rows go with their requests when retention purges them.
    let stamps = |storage: &Storage| -> i64 {
        storage
            .connection()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM room_request_changes", [], |r| {
                r.get(0)
            })
            .unwrap()
    };
    assert!(stamps(&storage) > 0);
    let past_retention = 4000 + 200 * 86_400_000;
    for _ in 0..3 {
        RequestService::new(&mut storage, || past_retention)
            .cleanup()
            .unwrap();
    }
    assert_eq!(stamps(&storage), 0);
    storage.close().unwrap();
}

fn write(revision: u64, member_ids: Vec<String>) -> RoomWrite {
    RoomWrite {
        expected_revision: revision,
        name: "Design room".into(),
        member_ids,
    }
}
fn identity(storage: &mut Storage, name: &str) -> String {
    create_or_resolve(storage, name, Lifetime::Saved)
        .unwrap()
        .identity
        .id
}
fn dispatch(room: &MeetingRoom) -> DispatchInput {
    DispatchInput {
        parent_request_id: None,
        origin: tmt_core::request::RequestOrigin::Person,
        originator: tmt_core::request::Originator::Unknown,
        kind: tmt_core::request::RequestKind::Request,
        operation_id: OPERATION.into(),
        recipient_ids: room.member_ids.clone(),
        message: "Review the saved sketch.".into(),
        room: Some(DispatchRoom::Roster {
            room_id: room.id.clone(),
            revision: room.revision,
        }),
        mode: tmt_core::request::digest::DeliveryMode::Request,
    }
}

#[test]
fn direct_room_context_targets_one_member_and_replay_survives_membership_changes() {
    use crate::storage::DispatchError;
    use tmt_core::request::RequestService;
    let directory = TestDirectory::new();
    let mut storage = Storage::open(directory.path.join("direct-room.db")).unwrap();
    let alice = identity(&mut storage, "Alice");
    let bob = identity(&mut storage, "Bob");
    let room = storage
        .save_meeting_room(ROOM, write(0, vec![alice.clone(), bob.clone()]))
        .unwrap();
    let mut input = dispatch(&room);
    input.recipient_ids = vec![alice.clone()];
    input.room = Some(DispatchRoom::Direct {
        room_id: ROOM.into(),
    });
    let receipt = storage
        .dispatch_request(input.clone(), 90, || 1000)
        .unwrap();
    assert_eq!(receipt.items.len(), 1);
    assert_eq!(receipt.items[0].recipient_id, alice);
    let mut service = RequestService::new(&mut storage, || 1001);
    let context = service
        .get_context(&receipt.items[0].request_id)
        .unwrap()
        .unwrap();
    assert_eq!(context.attempt.room_id.as_deref(), Some(ROOM));
    assert!(
        service
            .list_incoming(&bob, None, None, None)
            .unwrap()
            .items
            .is_empty()
    );
    assert_eq!(
        service
            .list_incoming(&alice, Some(ROOM), None, None)
            .unwrap()
            .items
            .len(),
        1
    );

    // Unrelated roster revisions do not turn a direct message into a fan-out fence.
    storage
        .save_meeting_room(ROOM, write(1, vec![alice.clone()]))
        .unwrap();
    let mut next = input.clone();
    next.operation_id = "33333333-3333-4333-8333-333333333333".into();
    storage.dispatch_request(next, 90, || 1002).unwrap();
    storage.save_meeting_room(ROOM, write(2, vec![])).unwrap();
    assert_eq!(
        storage
            .dispatch_request(input.clone(), 90, || 1003)
            .unwrap(),
        receipt
    );
    assert_eq!(storage.dispatch_receipt(OPERATION).unwrap(), Some(receipt));

    let rejected_id = "44444444-4444-4444-8444-444444444444";
    let mut rejected = input.clone();
    rejected.operation_id = rejected_id.into();
    assert!(matches!(
        storage.dispatch_request(rejected, 90, || 1004),
        Err(DispatchError::RoomRecipientNotMember)
    ));
    assert_eq!(storage.dispatch_receipt(rejected_id).unwrap(), None);
    let connection = storage.connection().unwrap();
    let attempts: i64 = connection
        .query_row("SELECT count(*) FROM request_attempts", [], |row| {
            row.get(0)
        })
        .unwrap();
    let operations: i64 = connection
        .query_row(
            "SELECT count(*) FROM office_dispatch_operations",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!((attempts, operations), (2, 2));

    for room in [
        Some(DispatchRoom::Roster {
            room_id: ROOM.into(),
            revision: 1,
        }),
        Some(DispatchRoom::Direct {
            room_id: rejected_id.into(),
        }),
        None,
    ] {
        let mut changed = input.clone();
        changed.room = room;
        assert!(matches!(
            storage.dispatch_request(changed, 90, || 1005),
            Err(DispatchError::IdempotencyConflict)
        ));
    }
    storage.close().unwrap();
}

#[test]
fn explicit_rosters_round_trip_offline_members_and_enforce_cas() {
    let directory = TestDirectory::new();
    let path = directory.path.join("rooms.db");
    let mut storage = Storage::open(&path).unwrap();
    assert!(storage.list_meeting_rooms().unwrap().is_empty());
    let alice = identity(&mut storage, "Alice");
    let bob = identity(&mut storage, "Bob");
    let room = storage
        .save_meeting_room(
            ROOM,
            write(0, vec![bob.clone(), alice.clone(), bob.clone()]),
        )
        .unwrap();
    assert_eq!(room.revision, 1);
    let mut expected = vec![alice, bob];
    expected.sort();
    assert_eq!(room.member_ids, expected);
    assert!(matches!(
        storage.save_meeting_room(ROOM, write(0, vec![])),
        Err(RoomStoreError::RevisionConflict)
    ));
    assert_eq!(
        storage.save_meeting_room(ROOM, write(1, expected)).unwrap(),
        room
    );
    storage.close().unwrap();
    let mut storage = Storage::open(&path).unwrap();
    assert_eq!(storage.list_meeting_rooms().unwrap(), vec![room]);
    let empty = storage.save_meeting_room(ROOM, write(1, vec![])).unwrap();
    assert_eq!(empty.revision, 2);
    assert!(empty.member_ids.is_empty());
    storage.close().unwrap();
}

#[test]
fn membership_edits_are_idempotent_and_independent_across_rooms() {
    let directory = TestDirectory::new();
    let mut storage = Storage::open(directory.path.join("rooms.db")).unwrap();
    let alice = identity(&mut storage, "Alice");
    let bob = identity(&mut storage, "Bob");
    storage
        .save_meeting_room(ROOM, write(0, vec![bob.clone()]))
        .unwrap();
    storage
        .save_meeting_room(OPERATION, write(0, vec![]))
        .unwrap();
    let joined = storage
        .change_meeting_membership(ROOM, &alice, MembershipChange::Join)
        .unwrap();
    assert_eq!(joined.revision, 2);
    assert_eq!(joined.member_ids.len(), 2);
    assert_eq!(
        storage
            .change_meeting_membership(ROOM, &alice, MembershipChange::Join)
            .unwrap(),
        joined
    );
    let other = storage
        .change_meeting_membership(OPERATION, &alice, MembershipChange::Join)
        .unwrap();
    assert_eq!(other.member_ids, vec![alice.clone()]);
    let left = storage
        .change_meeting_membership(ROOM, &alice, MembershipChange::Leave)
        .unwrap();
    assert_eq!(left.revision, 3);
    assert_eq!(left.member_ids, vec![bob]);
    assert_eq!(
        storage
            .change_meeting_membership(ROOM, &alice, MembershipChange::Leave)
            .unwrap(),
        left
    );
    assert!(storage.list_meeting_rooms().unwrap().contains(&other));
    let before = storage.list_meeting_rooms().unwrap();
    assert!(matches!(
        storage.change_meeting_membership(ROOM, OPERATION, MembershipChange::Join),
        Err(RoomStoreError::IdentityInactive)
    ));
    assert_eq!(storage.list_meeting_rooms().unwrap(), before);
}

#[test]
fn simultaneous_joins_preserve_both_members_and_existing_roster() {
    let directory = TestDirectory::new();
    let path = directory.path.join("rooms.db");
    let mut storage = Storage::open(&path).unwrap();
    let alice = identity(&mut storage, "Alice");
    let bob = identity(&mut storage, "Bob");
    let casey = identity(&mut storage, "Casey");
    storage
        .save_meeting_room(ROOM, write(0, vec![casey.clone()]))
        .unwrap();
    let mut expected = vec![alice.clone(), bob.clone(), casey];
    expected.sort();
    let results = crate::storage::test_support::concurrent_pair(
        &path,
        [
            Box::new(move |storage| {
                storage
                    .change_meeting_membership(ROOM, &alice, MembershipChange::Join)
                    .map(|room| room.revision)
                    .map_err(|error| error.code().to_string())
            }),
            Box::new(move |storage| {
                storage
                    .change_meeting_membership(ROOM, &bob, MembershipChange::Join)
                    .map(|room| room.revision)
                    .map_err(|error| error.code().to_string())
            }),
        ],
    );
    assert!(results.iter().all(Result::is_ok));
    let final_room = storage.list_meeting_rooms().unwrap().remove(0);
    assert_eq!(final_room.member_ids, expected);
    assert_eq!(final_room.revision, 3);
}

#[test]
fn late_membership_failure_rolls_back_the_existing_roster_and_revision() {
    let directory = TestDirectory::new();
    let mut storage = Storage::open(directory.path.join("rooms.db")).unwrap();
    let alice = identity(&mut storage, "Alice");
    let bob = identity(&mut storage, "Bob");
    let original = storage
        .save_meeting_room(ROOM, write(0, vec![alice]))
        .unwrap();
    storage.connection().unwrap().execute_batch("CREATE TRIGGER reject_members BEFORE INSERT ON office_meeting_members BEGIN SELECT RAISE(ABORT, 'injected membership failure'); END;").unwrap();
    assert!(matches!(
        storage.change_meeting_membership(ROOM, &bob, MembershipChange::Join),
        Err(RoomStoreError::Storage(_))
    ));
    assert_eq!(storage.list_meeting_rooms().unwrap(), vec![original]);
}

#[test]
fn invalid_members_and_late_write_failures_leave_the_entire_roster_unchanged() {
    let directory = TestDirectory::new();
    let mut storage = Storage::open(directory.path.join("rooms.db")).unwrap();
    let alice = identity(&mut storage, "Alice");
    let bob = identity(&mut storage, "Bob");
    let original = storage
        .save_meeting_room(ROOM, write(0, vec![alice]))
        .unwrap();
    assert!(matches!(
        storage.save_meeting_room(ROOM, write(1, vec![OPERATION.into()])),
        Err(RoomStoreError::IdentityInactive)
    ));
    storage.connection().unwrap().execute_batch("CREATE TRIGGER reject_members BEFORE INSERT ON office_meeting_members BEGIN SELECT RAISE(ABORT, 'injected late write failure'); END;").unwrap();
    assert!(matches!(
        storage.save_meeting_room(ROOM, write(1, vec![bob])),
        Err(RoomStoreError::Storage(_))
    ));
    assert_eq!(storage.list_meeting_rooms().unwrap(), vec![original]);
    storage.close().unwrap();
}

#[test]
fn changed_room_requires_new_preview_but_committed_dispatch_replays_after_later_changes() {
    let directory = TestDirectory::new();
    let mut storage = Storage::open(directory.path.join("rooms.db")).unwrap();
    let alice = identity(&mut storage, "Alice");
    let bob = identity(&mut storage, "Bob");
    let preview = storage
        .save_meeting_room(ROOM, write(0, vec![alice.clone()]))
        .unwrap();
    let updated = storage
        .save_meeting_room(ROOM, write(1, vec![alice, bob]))
        .unwrap();
    let stale = storage
        .dispatch_request(dispatch(&preview), 90, || 1_700_000_000_000)
        .unwrap_err();
    assert_eq!(stale.code(), "ROOM_ROSTER_CHANGED");
    for table in ["request_attempts", "office_dispatch_operations"] {
        assert_eq!(
            storage
                .connection()
                .unwrap()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    let input = dispatch(&updated);
    let accepted = storage
        .dispatch_request(input.clone(), 90, || 1_700_000_000_000)
        .unwrap();
    assert_eq!(accepted.items.len(), 2);
    storage.save_meeting_room(ROOM, write(2, vec![])).unwrap();
    assert_eq!(
        storage
            .dispatch_request(input, 90, || panic!("replay must not create work"))
            .unwrap(),
        accepted
    );
    storage.close().unwrap();
}

#[test]
fn effective_membership_fences_retirement_even_when_definition_revision_did_not_change() {
    let directory = TestDirectory::new();
    let mut storage = Storage::open(directory.path.join("rooms.db")).unwrap();
    let alice = identity(&mut storage, "Alice");
    let preview = storage
        .save_meeting_room(ROOM, write(0, vec![alice.clone()]))
        .unwrap();
    // Model the committed retirement state without invoking tmux or extension delivery.
    storage
        .connection()
        .unwrap()
        .execute("UPDATE identities SET retired_at_ms=1 WHERE id=?", [alice])
        .unwrap();
    let replacement = identity(&mut storage, "Alice");
    assert_ne!(replacement, preview.member_ids[0]);
    let current = storage.list_meeting_rooms().unwrap().remove(0);
    assert_eq!(current.revision, preview.revision);
    assert!(current.member_ids.is_empty());
    assert_eq!(
        storage
            .dispatch_request(dispatch(&preview), 90, || panic!(
                "stale roster must not create work"
            ))
            .unwrap_err()
            .code(),
        "ROOM_ROSTER_CHANGED"
    );
    storage.close().unwrap();
}

#[test]
fn concurrent_membership_change_cannot_expand_a_frozen_room_audience() {
    let directory = TestDirectory::new();
    let path = directory.path.join("rooms.db");
    let mut storage = Storage::open(&path).unwrap();
    let alice = identity(&mut storage, "Alice");
    let bob = identity(&mut storage, "Bob");
    let preview = storage
        .save_meeting_room(ROOM, write(0, vec![alice.clone()]))
        .unwrap();
    let input = dispatch(&preview);
    let outcomes = crate::storage::test_support::concurrent_pair(
        &path,
        [
            Box::new(move |storage| {
                storage
                    .dispatch_request(input, 90, || 1_700_000_000_000)
                    .map(|receipt| receipt.items.len())
                    .map_err(|error| error.code().to_string())
            }),
            Box::new(move |storage| {
                storage
                    .save_meeting_room(ROOM, write(1, vec![alice, bob]))
                    .map(|room| room.member_ids.len())
                    .map_err(|error| error.code().to_string())
            }),
        ],
    );
    assert_eq!(outcomes[1], Ok(2));
    assert!(matches!(&outcomes[0], Ok(1)) || outcomes[0] == Err("ROOM_ROSTER_CHANGED".into()));
    let count = storage
        .connection()
        .unwrap()
        .query_row("SELECT count(*) FROM request_attempts", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap();
    assert_eq!(count, if outcomes[0].is_ok() { 1 } else { 0 });
    assert_eq!(storage.list_meeting_rooms().unwrap()[0].member_ids.len(), 2);
    storage.close().unwrap();
}
