//! Actual signed tombstones and neutral carrier boundaries, not backend proof.
use super::*;
use crate::{
    management::Storage,
    readers::test_support::{Fixture, OTHER, PAGE, decoder_config},
    transitions::OwnerAction,
};

fn source(state: &Fixture) -> crate::page::save::SourceOpener {
    let root = state.root.clone();
    let config = decoder_config(std::env::current_exe().unwrap());
    Arc::new(move || crate::page::save::open_source(&root, config.clone()))
}
fn owner(channel: ObjectChannel) -> Arc<ChannelOwner> {
    let owner = Arc::new(ChannelOwner::new(Arc::new(|| None)));
    *locked(&owner.current) = Some(channel);
    owner
}
fn removed(remote: &Bus, start: u64) {
    let request = receive(remote);
    assert!(matches!(request.call, Call::RemoveNamespace(_)));
    for (id, boundary, disclosure) in [
        (1, Checkpoint::Acquire, None),
        (2, Checkpoint::Effect, None),
        (3, Checkpoint::Disclose, Some(Disclosure::Removed)),
    ] {
        assert_eq!(
            admit(remote, &request, id + start, boundary, disclosure).decision,
            Decision::Allow
        );
    }
    finish(remote, request, Outcome::Success(Success::Removed));
}

fn version_one() -> (ObjectChannel, Bus) {
    use std::io::Read;
    let mut workers = Vec::new();
    let mut attempt = 0;
    let link = negotiate(limit(), || {
        attempt += 1;
        let legacy = attempt == 2;
        let (remote, mut extension) = UnixStream::pair().unwrap();
        workers.push(thread::spawn(move || {
            let interrupt = extension.try_clone().unwrap();
            if !legacy {
                extension
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut head = Vec::new();
                while !head.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    extension.read_exact(&mut byte).unwrap();
                    head.push(byte[0]);
                    assert!(head.len() <= 8192);
                }
                return None;
            }
            let link = accept(
                extension,
                &Expect {
                    host: HOST.into(),
                    mount: MOUNT.into(),
                },
                &Budgets::contract(),
                limit(),
            )
            .unwrap();
            Some(ObjectChannel::start(link, interrupt).unwrap())
        }));
        Ok((
            remote,
            Offer {
                host: HOST.into(),
                mount: MOUNT.into(),
                generation: Uuid4::parse(GENERATION).unwrap(),
            },
        ))
    })
    .unwrap();
    assert_eq!(attempt, 2);
    let mut channels = workers
        .into_iter()
        .filter_map(|worker| worker.join().unwrap());
    let channel = channels.next().unwrap();
    assert!(channels.next().is_none());
    (
        channel,
        Bus::start(link, Budgets::contract(), Caps::contract(), None).unwrap(),
    )
}

#[test]
fn version_one_refuses_both_calls_before_request_correlation_and_keeps_the_exact_hint() {
    let mut state = Fixture::new();
    let source = source(&state);
    state.apply(OwnerAction::Delete { page: PAGE });
    let (channel, remote) = version_one();
    let owner = owner(channel);
    assert_eq!(
        owner.remove_page_namespace(PAGE, &source, limit()),
        Storage::Unsupported
    );
    let client = owner.client().unwrap();
    assert!(
        matches!(client.usage_details(PAGE, &source, limit()), crate::attachments::UsageDetails::Unsupported { hint } if hint == tmt_extension_objects::unsupported_hint())
    );
    assert_eq!(
        Storage::Unsupported.message(),
        format!(
            "! File data not freed.\n{}",
            tmt_extension_objects::unsupported_hint()
        )
    );
    let backend = thread::spawn(move || {
        let request = receive(&remote);
        assert_eq!(
            request.request_id,
            Counter::new(1).unwrap(),
            "unsupported methods never entered Client::request"
        );
        assert!(matches!(request.call, Call::Config(_)));
        finish(
            &remote,
            request,
            Outcome::Failure(tmt_extension_objects::ErrorCode::Unavailable),
        );
    });
    let admission = Arc::new(Current(AtomicBool::new(true), AtomicUsize::new(0)));
    let _ = client.request(Origin::LocalExtension, config(), admission, limit());
    backend.join().unwrap();
}

#[test]
fn usage_rechecks_the_exact_namespace_and_retains_all_accounting_fields() {
    let state = Fixture::new();
    let source = source(&state);
    let (channel, remote) = pair();
    let owner = owner(channel);
    let backend = thread::spawn(move || {
        let request = receive(&remote);
        assert!(matches!(
            request.call,
            Call::Usage(tmt_extension_objects::UsageScope::Namespace(_))
        ));
        let usage = tmt_extension_objects::Usage {
            charged_bytes: 2048,
            entries: 1,
            active_uploads: 2,
            retained_identities: 3,
        };
        assert_eq!(
            admit(&remote, &request, 1, Checkpoint::Acquire, None).decision,
            Decision::Allow
        );
        assert_eq!(
            admit(
                &remote,
                &request,
                2,
                Checkpoint::Disclose,
                Some(Disclosure::Usage(usage))
            )
            .decision,
            Decision::Allow
        );
        finish(&remote, request, Outcome::Success(Success::Usage(usage)));
    });
    let details = owner.storage_usage(PAGE, &source, limit());
    let mut row = crate::storage::PageStorage {
        page_id: PAGE.into(),
        title: None,
        content_bytes: 10,
        history_bytes: 20,
        comments_bytes: 5,
        attachments_bytes: None,
        unused_attachment_bytes: None,
        unused_attachments_remove_at_ms: None,
        total_bytes: None,
        freeable: Default::default(),
        last_cleaned_automatically_at_ms: None,
        skipped: None,
    };
    row.apply_attachment_usage(details.clone());
    assert_eq!(row.attachments_bytes, Some(2048));
    assert_eq!(row.total_bytes, Some(2083));
    assert_eq!(row.unused_attachment_bytes, None);
    assert_eq!(
        serde_json::to_value(&details).unwrap(),
        serde_json::json!({"state":"known","chargedBytes":2048,"entries":1,"activeUploads":2,"retainedIdentities":3})
    );
    assert_eq!(
        details.to_string(),
        "Storage is full. Charged 2 KB (1 file, 2 uploading, small fixed records). This is a conservative allocation, not disk or billing bytes."
    );
    backend.join().unwrap();
}

#[test]
fn storage_usage_is_unknown_without_an_object_channel() {
    let state = Fixture::new();
    let source = source(&state);
    let owner = ChannelOwner::new(Arc::new(|| None));
    assert!(matches!(
        owner.storage_usage(PAGE, &source, limit()),
        crate::attachments::UsageDetails::Unknown
    ));
}

#[test]
fn storage_usage_times_out_without_waiting_for_a_stalled_object_backend() {
    let state = Fixture::new();
    let source = source(&state);
    let (channel, remote) = pair();
    let owner = owner(channel);
    let (release, wait) = std::sync::mpsc::channel();
    let backend = thread::spawn(move || {
        let request = receive(&remote);
        assert!(matches!(request.call, Call::Usage(_)));
        wait.recv_timeout(Duration::from_secs(3)).unwrap();
    });
    let started = Instant::now();
    let result = owner.storage_usage(PAGE, &source, started + Duration::from_millis(100));
    assert!(matches!(result, crate::attachments::UsageDetails::Unknown));
    assert!(started.elapsed() < Duration::from_secs(2));
    release.send(()).unwrap();
    backend.join().unwrap();
}

#[test]
fn an_absent_channel_delete_is_freed_by_the_next_bounded_sweep_and_repeat_is_idempotent() {
    let mut state = Fixture::new();
    let source = source(&state);
    let owner = Arc::new(ChannelOwner::new(Arc::new(|| None)));
    assert_eq!(
        owner.remove_page_namespace(PAGE, &source, limit()),
        Storage::Pending
    );
    state.apply(OwnerAction::Delete { page: PAGE });
    assert_eq!(
        owner.remove_page_namespace(PAGE, &source, limit()),
        Storage::Pending
    );
    let (channel, remote) = pair();
    *locked(&owner.current) = Some(channel);
    let backend = thread::spawn(move || {
        removed(&remote, 0);
        removed(&remote, 3);
    });
    let mut after = None;
    assert!(
        !owner
            .sweep_deletions(&source, &source().unwrap(), &mut after, limit())
            .unwrap()
    );
    assert_eq!(
        owner.remove_page_namespace(PAGE, &source, limit()),
        Storage::Freed
    );
    backend.join().unwrap();
}

#[test]
fn removal_never_crosses_before_commit_or_for_another_page_and_unknown_is_not_success() {
    let mut state = Fixture::new();
    let source = source(&state);
    let (channel, remote) = pair();
    let owner = owner(channel);
    // No request is written by these refusals: the next wire request is PAGE's committed delete.
    assert_eq!(
        owner.remove_page_namespace(PAGE, &source, limit()),
        Storage::Pending
    );
    assert_eq!(
        owner.remove_page_namespace(OTHER, &source, limit()),
        Storage::Pending
    );
    state.apply(OwnerAction::Delete { page: PAGE });
    let backend = thread::spawn(move || {
        let request = receive(&remote);
        assert_eq!(
            request.call,
            Call::RemoveNamespace(tmt_extension_objects::NamespaceInput {
                namespace: Bytes32::from_bytes(
                    crate::attachments::namespace(&state.key.space_id, PAGE).unwrap()
                ),
            })
        );
        assert_eq!(
            admit(&remote, &request, 1, Checkpoint::Acquire, None).decision,
            Decision::Allow
        );
        finish(
            &remote,
            request,
            Outcome::Failure(tmt_extension_objects::ErrorCode::Unknown),
        );
    });
    assert_eq!(
        owner.remove_page_namespace(PAGE, &source, limit()),
        Storage::Unknown
    );
    backend.join().unwrap();
}

/// A source whose decoder is the built `tmt-colab`, for passes that materialize the page.
fn decoding_source(state: &Fixture) -> crate::page::save::SourceOpener {
    let root = state.root.clone();
    let program = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("tmt-colab");
    let config = decoder_config(program);
    Arc::new(move || crate::page::save::open_source(&root, config.clone()))
}
fn current_history(state: &mut Fixture) {
    state.apply(OwnerAction::History {
        page: PAGE,
        mode: crate::transitions::HistoryMode::Current,
    });
}
fn listed(byte: u8) -> tmt_extension_objects::Listed {
    super::listed_object([byte; 32], 10)
}

#[test]
fn a_listing_follows_next_and_is_admitted_only_for_the_page_namespace() {
    let mut state = Fixture::new();
    current_history(&mut state);
    let source = source(&state);
    let (channel, remote) = pair_version(true);
    let owner = owner(channel);
    let backend = thread::spawn(move || {
        let mut ids = 0;
        for (entries, next) in [(vec![listed(1), listed(2)], true), (vec![listed(3)], false)] {
            let request = receive(&remote);
            let Call::List(input) = &request.call else {
                panic!("expected a listing, got {:?}", request.call)
            };
            assert_eq!(input.limit, tmt_extension_objects::LIST_ENTRIES);
            assert_eq!(input.after.is_some(), ids > 0);
            let count = entries.len() as u32;
            for (boundary, disclosure) in [
                (Checkpoint::Acquire, None),
                (Checkpoint::Disclose, Some(Disclosure::Listed { count })),
            ] {
                ids += 1;
                assert_eq!(
                    admit(&remote, &request, ids, boundary, disclosure).decision,
                    Decision::Allow
                );
            }
            let next = next.then(|| entries.last().unwrap().opaque_key);
            finish(
                &remote,
                request,
                Outcome::Success(Success::Listed(tmt_extension_objects::Listing {
                    entries,
                    next,
                })),
            );
        }
    });
    let client = owner.client().unwrap();
    let all = client
        .list_objects(PAGE, &source, 4, limit())
        .unwrap()
        .unwrap();
    assert_eq!(all, vec![listed(1), listed(2), listed(3)]);
    backend.join().unwrap();
}

#[test]
fn a_removal_is_allowed_for_its_exact_object_and_fence_and_a_moved_fence_refuses_it() {
    let mut state = Fixture::new();
    current_history(&mut state);
    let source = source(&state);
    let (channel, remote) = pair_version(true);
    let owner = owner(channel);
    let client = owner.client().unwrap();
    let fence = source().unwrap().store.page_fence(PAGE).unwrap();
    let (asked, answered) = std::sync::mpsc::channel();
    let backend = thread::spawn(move || {
        // The first removal is allowed through effect and disclose.
        let request = receive(&remote);
        let Call::Remove(input) = &request.call else {
            panic!("expected a removal")
        };
        assert_eq!(input.opaque_key, listed(7).opaque_key);
        assert_eq!(input.payload_bytes, 10);
        for (id, boundary, disclosure) in [
            (1, Checkpoint::Acquire, None),
            (2, Checkpoint::Effect, None),
            (3, Checkpoint::Disclose, Some(Disclosure::Removed)),
        ] {
            assert_eq!(
                admit(&remote, &request, id, boundary, disclosure).decision,
                Decision::Allow
            );
        }
        finish(&remote, request, Outcome::Success(Success::Removed));
        // The second one arrives after a write moved the fence: refused before its effect.
        asked.send(()).unwrap();
        let request = receive(&remote);
        assert_eq!(
            admit(&remote, &request, 4, Checkpoint::Acquire, None).decision,
            Decision::Deny
        );
        finish(
            &remote,
            request,
            Outcome::Failure(tmt_extension_objects::ErrorCode::Denied),
        );
    });
    assert_eq!(
        client.remove_object(PAGE, &source, &listed(7), fence, limit()),
        crate::object_channel::namespace::ObjectRemoval::Removed
    );
    answered.recv().unwrap();
    state.apply(OwnerAction::Retention {
        page: PAGE,
        days: Some(7),
    });
    assert_ne!(source().unwrap().store.page_fence(PAGE).unwrap(), fence);
    assert_eq!(
        client.remove_object(PAGE, &source, &listed(7), fence, limit()),
        crate::object_channel::namespace::ObjectRemoval::Refused
    );
    backend.join().unwrap();
}

#[test]
fn only_current_history_writable_private_or_link_pages_are_eligible() {
    use crate::object_channel::namespace::removal_eligible;
    use crate::transitions::ShareMode;
    let mut state = Fixture::new();
    let source = source(&state);
    assert!(
        !removal_eligible(&source().unwrap(), PAGE).unwrap(),
        "a page in the default shared history mode keeps every object"
    );
    current_history(&mut state);
    assert!(removal_eligible(&source().unwrap(), PAGE).unwrap());
    state.share(ShareMode::Public);
    assert!(
        !removal_eligible(&source().unwrap(), PAGE).unwrap(),
        "public"
    );
    state.share(ShareMode::Private);
    assert!(removal_eligible(&source().unwrap(), PAGE).unwrap());
    state.apply(OwnerAction::Archive { page: PAGE });
    assert!(
        !removal_eligible(&source().unwrap(), PAGE).unwrap(),
        "archived"
    );
    let mut deleted = Fixture::new();
    current_history(&mut deleted);
    deleted.apply(OwnerAction::Delete { page: PAGE });
    assert!(
        !removal_eligible(&self::source(&deleted)().unwrap(), PAGE).unwrap(),
        "deleted"
    );
}

#[test]
fn a_version_three_link_neither_lists_nor_removes_and_writes_nothing() {
    let mut state = Fixture::new();
    current_history(&mut state);
    let source = source(&state);
    let (channel, remote) = pair();
    let owner = owner(channel);
    let client = owner.client().unwrap();
    assert!(!owner.lists_objects());
    assert_eq!(
        client.list_objects(PAGE, &source, 4, limit()).unwrap(),
        None
    );
    assert_eq!(
        client.remove_object(PAGE, &source, &listed(1), [0; 32], limit()),
        crate::object_channel::namespace::ObjectRemoval::Unavailable
    );
    let backend = thread::spawn(move || {
        let request = receive(&remote);
        assert_eq!(
            request.request_id,
            Counter::new(1).unwrap(),
            "nothing was sent before"
        );
        finish(
            &remote,
            request,
            Outcome::Failure(tmt_extension_objects::ErrorCode::Unavailable),
        );
    });
    let admission = Arc::new(Current(AtomicBool::new(true), AtomicUsize::new(0)));
    let _ = client.request(Origin::LocalExtension, config(), admission, limit());
    backend.join().unwrap();
}

/// A scripted Remote that lists what it still holds and removes what it is asked to.
fn scripted_store(
    remote: Bus,
    held: Vec<tmt_extension_objects::Listed>,
) -> (thread::JoinHandle<()>, Arc<Mutex<Vec<Bytes32>>>) {
    let removed = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&removed);
    let worker = thread::spawn(move || {
        let mut held = held;
        let mut callback = 0;
        while let Ok(Frame::Request(request)) = remote.recv(Some(limit())) {
            let mut allow = |boundary, disclosure| {
                callback += 1;
                admit(&remote, &request, callback, boundary, disclosure).decision == Decision::Allow
            };
            let outcome = match &request.call {
                Call::List(_) => {
                    let count = held.len() as u32;
                    if allow(Checkpoint::Acquire, None)
                        && allow(Checkpoint::Disclose, Some(Disclosure::Listed { count }))
                    {
                        Outcome::Success(Success::Listed(tmt_extension_objects::Listing {
                            entries: held.clone(),
                            next: None,
                        }))
                    } else {
                        Outcome::Failure(tmt_extension_objects::ErrorCode::Denied)
                    }
                }
                Call::Remove(input) => {
                    if allow(Checkpoint::Acquire, None) && allow(Checkpoint::Effect, None) {
                        held.retain(|entry| entry.opaque_key != input.opaque_key);
                        seen.lock().unwrap().push(input.opaque_key);
                        allow(Checkpoint::Disclose, Some(Disclosure::Removed));
                        Outcome::Success(Success::Removed)
                    } else {
                        Outcome::Failure(tmt_extension_objects::ErrorCode::Denied)
                    }
                }
                other => panic!("unexpected {other:?}"),
            };
            finish(&remote, request, outcome);
        }
    });
    (worker, removed)
}

#[test]
fn a_visit_starts_clocks_removes_after_thirty_days_and_a_skipped_page_forgets_them() {
    use crate::attachments::unreferenced::{Visit, visit};
    const DAY: u64 = 24 * 60 * 60 * 1000;
    let mut state = Fixture::new();
    current_history(&mut state);
    let source = decoding_source(&state);
    let layout = crate::keyring::Layout::existing(&state.root)
        .unwrap()
        .unwrap();
    let slots = crate::attachments::slots::StagingSlots::open(&layout).unwrap();
    let (channel, remote) = pair_version(true);
    let owner = owner(channel);
    let (worker, removed) = scripted_store(remote, vec![listed(1), listed(2)]);
    let clocks = || {
        crate::store::Store::read(&layout)
            .unwrap()
            .unreferenced(PAGE)
            .unwrap()
    };
    let at = 1_000_000;
    let run = |now| visit(&owner, &slots, &source, &state.server, PAGE, now, limit()).unwrap();
    // Nothing references either listed object: both clocks start, nothing is removed yet.
    assert_eq!(run(at), Visit::default());
    assert_eq!(
        clocks(),
        vec![("01".repeat(32), 10, at), ("02".repeat(32), 10, at)]
    );
    // A later pass inside the grace changes nothing, and keeps the first time seen.
    assert_eq!(run(at + 29 * DAY), Visit::default());
    assert_eq!(clocks()[0].2, at);
    assert!(removed.lock().unwrap().is_empty());
    // Day thirty: both are removed and their clocks forgotten.
    assert_eq!(
        run(at + 30 * DAY),
        Visit {
            removed: 2,
            unfinished: false
        }
    );
    assert_eq!(
        *removed.lock().unwrap(),
        vec![listed(1).opaque_key, listed(2).opaque_key]
    );
    assert!(clocks().is_empty());
    drop(owner);
    worker.join().unwrap();
}

#[test]
fn a_page_in_shared_history_mode_records_nothing_and_loses_any_clock() {
    use crate::attachments::unreferenced::{Visit, visit};
    let mut state = Fixture::new();
    current_history(&mut state);
    let source = decoding_source(&state);
    let layout = crate::keyring::Layout::existing(&state.root)
        .unwrap()
        .unwrap();
    let slots = crate::attachments::slots::StagingSlots::open(&layout).unwrap();
    let (channel, remote) = pair_version(true);
    let owner = owner(channel);
    let (worker, removed) = scripted_store(remote, vec![listed(1)]);
    let read = || {
        crate::store::Store::read(&layout)
            .unwrap()
            .unreferenced(PAGE)
            .unwrap()
    };
    assert_eq!(
        visit(&owner, &slots, &source, &state.server, PAGE, 5, limit()).unwrap(),
        Visit::default()
    );
    assert_eq!(read().len(), 1);
    state.apply(OwnerAction::History {
        page: PAGE,
        mode: crate::transitions::HistoryMode::Shared,
    });
    // Even long past the grace, a shared-history page keeps its object and its clock is gone.
    assert_eq!(
        visit(
            &owner,
            &slots,
            &source,
            &state.server,
            PAGE,
            u64::MAX / 2,
            limit()
        )
        .unwrap(),
        Visit::default()
    );
    assert!(read().is_empty());
    assert!(removed.lock().unwrap().is_empty());
    drop(owner);
    worker.join().unwrap();
}
