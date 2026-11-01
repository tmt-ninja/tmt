//! The person's two-party conversation read (#5807).
use super::digest::request;
use super::support::{Fixture, NOW_MS, service};
use tmt_core::{
    identity::{Lifetime, create_or_resolve},
    request::{
        PreparedRequest, RequestRoute, ResponseProof, SubmitResponse,
        digest::DeliveryPolicy,
        history::{
            ChangedSince, ConversationDirection, ConversationPage, ConversationQuery,
            ConversationSince, HistoryCursor,
        },
    },
};

struct World {
    f: Fixture,
    viewer: String,
    member: String,
    other: String,
}

fn world() -> World {
    let mut f = Fixture::new();
    let mut id = |name| {
        create_or_resolve(&mut f.storage, name, Lifetime::Saved)
            .unwrap()
            .identity
            .id
    };
    let (viewer, member, other) = (id("Person"), id("Member"), id("Other"));
    World {
        f,
        viewer,
        member,
        other,
    }
}

fn send(w: &mut World, from: &str, to: &str, id: &str, at: u64) -> PreparedRequest {
    w.f.set_now(at);
    service(&mut w.f)
        .prepare_delivery(
            request(to, Some(from), id),
            format!("attempt-{id}"),
            7,
            DeliveryPolicy::default(),
            None,
        )
        .unwrap()
}

fn reply(w: &mut World, prepared: &PreparedRequest, to: &str) {
    service(&mut w.f)
        .submit_response_with_hint(
            SubmitResponse {
                request_id: prepared.request_id.clone(),
                proof: ResponseProof::Compact(tmt_core::request::correlation::response_token(
                    &prepared.request_id,
                    &prepared.attempt_id,
                    &RequestRoute::Inbox {
                        recipient_identity_id: to.into(),
                    },
                )),
                body: format!("Final for {}", prepared.request_id),
            },
            None,
        )
        .unwrap();
}

fn read(
    w: &mut World,
    limit: u64,
    before: Option<HistoryCursor>,
    since: Option<ConversationSince>,
) -> ConversationPage {
    let query = ConversationQuery {
        viewer_id: w.viewer.clone(),
        member_id: w.member.clone(),
        limit,
        before,
        since,
    };
    service(&mut w.f).request_conversation(query).unwrap()
}

fn ids(page: &ConversationPage) -> Vec<&str> {
    page.items
        .iter()
        .map(|i| i.summary.item.request_id.as_str())
        .collect()
}

#[test]
fn only_the_two_party_scope_is_read_before_the_limit() {
    let mut w = world();
    let (viewer, member, other) = (w.viewer.clone(), w.member.clone(), w.other.clone());
    send(&mut w, &viewer, &member, "req_a", NOW_MS + 1);
    // Newer traffic outside the pair must not crowd the page out.
    send(&mut w, &viewer, &other, "req_x1", NOW_MS + 2);
    send(&mut w, &other, &member, "req_x2", NOW_MS + 3);
    send(&mut w, &other, &viewer, "req_x3", NOW_MS + 4);
    send(&mut w, &member, &viewer, "req_b", NOW_MS + 5);
    let page = read(&mut w, 2, None, None);
    assert_eq!(ids(&page), ["req_b", "req_a"]);
    assert_eq!(page.items[0].direction, ConversationDirection::FromMember);
    assert_eq!(page.items[1].direction, ConversationDirection::ToMember);
    assert!(page.next_before.is_none());
    assert_eq!(page.position.retained, 2);
}

#[test]
fn same_time_requests_page_by_request_id_without_gaps_under_arrival() {
    let mut w = world();
    let (viewer, member) = (w.viewer.clone(), w.member.clone());
    for id in ["req_1", "req_2", "req_3"] {
        send(&mut w, &viewer, &member, id, NOW_MS + 1);
    }
    let first = read(&mut w, 2, None, None);
    assert_eq!(ids(&first), ["req_3", "req_2"]);
    // A newer arrival does not shift the next page.
    send(&mut w, &member, &viewer, "req_9", NOW_MS + 2);
    let second = read(&mut w, 2, first.next_before.clone(), None);
    assert_eq!(ids(&second), ["req_1"]);
    assert!(second.next_before.is_none());
}

#[test]
fn a_late_final_on_an_old_request_moves_the_position_and_counts() {
    let mut w = world();
    let (viewer, member) = (w.viewer.clone(), w.member.clone());
    let old = send(&mut w, &member, &viewer, "req_old", NOW_MS + 1);
    for i in 0..3 {
        send(&mut w, &viewer, &member, &format!("req_n{i}"), NOW_MS + 2 + i);
    }
    let before = read(&mut w, 1, None, None).position;
    let unchanged = read(
        &mut w,
        1,
        None,
        Some(ConversationSince::Position(before)),
    );
    assert_eq!(
        unchanged.changed_since,
        Some(ChangedSince::Count {
            count: 0,
            more: false
        })
    );
    reply(&mut w, &old, &viewer);
    let after = read(&mut w, 1, None, Some(ConversationSince::Position(before)));
    assert_eq!(
        after.changed_since,
        Some(ChangedSince::Count {
            count: 1,
            more: false
        })
    );
    assert!(after.position.viewer > before.viewer || after.position.member > before.member);
    // A new request counts too.
    send(&mut w, &viewer, &member, "req_new", NOW_MS + 10);
    let newer = read(&mut w, 1, None, Some(ConversationSince::Position(before)));
    assert_eq!(
        newer.changed_since,
        Some(ChangedSince::Count {
            count: 2,
            more: false
        })
    );
}

#[test]
fn the_count_caps_and_stale_or_foreign_positions_are_unknown() {
    let mut w = world();
    let (viewer, member) = (w.viewer.clone(), w.member.clone());
    let start = read(&mut w, 1, None, None).position;
    for i in 0..52 {
        send(&mut w, &viewer, &member, &format!("req_{i:02}"), NOW_MS + 1 + i);
    }
    let capped = read(&mut w, 1, None, Some(ConversationSince::Position(start)));
    assert_eq!(
        capped.changed_since,
        Some(ChangedSince::Count {
            count: 50,
            more: true
        })
    );
    let foreign = read(&mut w, 1, None, Some(ConversationSince::Foreign));
    assert_eq!(foreign.changed_since, Some(ChangedSince::Unknown));
    let mut future = capped.position;
    future.viewer += 1;
    let ahead = read(&mut w, 1, None, Some(ConversationSince::Position(future)));
    assert_eq!(ahead.changed_since, Some(ChangedSince::Unknown));
    // Past retention the earlier position cannot be counted from: unknown, never 0.
    let now = capped.position;
    w.f.set_now(tmt_core::limits::MAX_JS_SAFE_INTEGER - 1);
    let pruned = read(&mut w, 1, None, Some(ConversationSince::Position(now)));
    assert!(pruned.items.is_empty());
    assert_eq!(pruned.changed_since, Some(ChangedSince::Unknown));
}
