//! Namespace management through the actual channel and ledger.
use super::observe::{seed, spec};
use super::*;
use crate::objects::BeginSpec;
use tmt_extension_objects::{NamespaceInput, UsageScope};

fn remove(tag: u8) -> Call {
    Call::RemoveNamespace(NamespaceInput {
        namespace: Bytes32::from_bytes([tag; 32]),
    })
}
fn allowed(peer: &Peer, id: u64, call: Call) -> Outcome {
    request(peer, id, Origin::LocalExtension, call.clone());
    let checkpoints: &[Checkpoint] = if matches!(call, Call::RemoveNamespace(_) | Call::Remove(_)) {
        &[
            Checkpoint::Acquire,
            Checkpoint::Effect,
            Checkpoint::Disclose,
        ]
    } else {
        &[Checkpoint::Acquire, Checkpoint::Disclose]
    };
    for boundary in checkpoints {
        let admit = callback(peer);
        assert_eq!(
            (admit.boundary, admit.context),
            (*boundary, Context::LocalExtension)
        );
        assert_eq!(
            admit.operation.disclosure.is_some(),
            *boundary == Checkpoint::Disclose
        );
        decide(peer, admit.callback_id.get(), id, Decision::Allow);
    }
    let answer = result(peer);
    assert_eq!(
        (answer.request_id, answer.method, answer.transfer_id),
        (counter(id), call.method(), None)
    );
    answer.outcome
}
fn usage(peer: &Peer, id: u64, scope: UsageScope) -> tmt_extension_objects::Usage {
    match allowed(peer, id, Call::Usage(scope)) {
        Outcome::Success(Success::Usage(value)) => value,
        other => panic!("expected usage, got {other:?}"),
    }
}
#[test]
fn namespace_removal_is_idempotent_and_retains_originals_in_usage() {
    let env = Env::new();
    let (service, peer) = running(&env, bounds());
    let original = spec(Context::LocalExtension, 7, b"hello");
    seed(&service, &original, b"hello", true);
    let before = usage(
        &peer,
        1,
        UsageScope::Namespace(Bytes32::from_bytes([7; 32])),
    );
    assert_eq!(
        (
            before.charged_bytes,
            before.entries,
            before.retained_identities
        ),
        (
            crate::objects::payload_charge(5)
                + crate::limits::OBJECT_RECORD_BYTES
                + crate::limits::OBJECT_FENCE_BYTES,
            1,
            1
        )
    );
    for (id, tag) in [(2, 7), (3, 7), (4, 8)] {
        assert_eq!(
            allowed(&peer, id, remove(tag)),
            Outcome::Success(Success::Removed)
        );
    }
    let after = usage(
        &peer,
        5,
        UsageScope::Namespace(Bytes32::from_bytes([7; 32])),
    );
    assert_eq!(
        (
            after.charged_bytes,
            after.entries,
            after.active_uploads,
            after.retained_identities
        ),
        (
            crate::limits::OBJECT_RECORD_BYTES + crate::limits::OBJECT_FENCE_BYTES,
            0,
            0,
            1
        )
    );
    assert_eq!(
        service.handle("alpha").unwrap().begin(&original, &io()),
        Ok(crate::objects::BeginResult::Terminal(
            crate::objects::TransferState::Unavailable
        )),
        "deleted original only returns its retained terminal state"
    );
    assert!(
        service
            .handle("alpha")
            .unwrap()
            .read(original.key, 0, 5, &io())
            .is_err()
    );
}
#[test]
fn extension_usage_keeps_the_existing_namespace_sum_and_tree_charge() {
    let env = Env::new();
    let (service, peer) = running(&env, bounds());
    assert_eq!(
        usage(&peer, 1, UsageScope::Extension).charged_bytes,
        0,
        "no namespace means no tree charge"
    );
    let first = spec(Context::LocalExtension, 7, b"hello");
    let mut second = spec(Context::LocalExtension, 8, b"world!");
    second.intent = crate::objects::IntentId([8; 32]);
    seed(&service, &first, b"hello", true);
    seed(&service, &second, b"world!", false);
    let a = usage(
        &peer,
        2,
        UsageScope::Namespace(Bytes32::from_bytes([7; 32])),
    );
    let b = usage(
        &peer,
        3,
        UsageScope::Namespace(Bytes32::from_bytes([8; 32])),
    );
    let total = usage(&peer, 4, UsageScope::Extension);
    assert_eq!(
        total,
        tmt_extension_objects::Usage {
            charged_bytes: a.charged_bytes
                + b.charged_bytes
                + crate::limits::OBJECT_TREE_BASE_BYTES,
            entries: a.entries + b.entries,
            active_uploads: a.active_uploads + b.active_uploads,
            retained_identities: a.retained_identities + b.retained_identities
        }
    );
}
#[test]
fn mounted_namespace_management_is_denied_without_callbacks_or_changes() {
    let env = Env::new();
    let (service, peer) = running(&env, bounds());
    let original = spec(Context::LocalExtension, 7, b"hello");
    seed(&service, &original, b"hello", true);
    let backend = service.handle("alpha").unwrap();
    let before = backend.usage(None, &io()).unwrap();
    for (id, call) in [(1, remove(7)), (2, Call::Usage(UsageScope::Extension))] {
        request(
            &peer,
            id,
            Origin::Mounted(Uuid4::parse("d9f6456b-2951-4c1e-a130-cbac198e3a50").unwrap()),
            call,
        );
        assert_eq!(result(&peer).outcome, Outcome::Failure(ErrorCode::Denied));
        assert_eq!(backend.usage(None, &io()).unwrap(), before);
        assert_eq!(
            backend.read(original.key, 0, 5, &io()).unwrap().bytes,
            b"hello"
        );
    }
}

#[test]
fn namespace_management_admission_refuses_before_effect_and_preserves_payload() {
    for checkpoint in [Checkpoint::Acquire, Checkpoint::Effect] {
        let env = Env::new();
        let (service, peer) = running(&env, bounds());
        let original = spec(Context::LocalExtension, 7, b"hello");
        seed(&service, &original, b"hello", true);
        let before = service.handle("alpha").unwrap().usage(None, &io()).unwrap();
        request(&peer, 1, Origin::LocalExtension, remove(7));
        if checkpoint == Checkpoint::Effect {
            let admit = callback(&peer);
            assert_eq!(admit.boundary, Checkpoint::Acquire);
            decide(&peer, admit.callback_id.get(), 1, Decision::Allow);
        }
        let admit = callback(&peer);
        assert_eq!(admit.boundary, checkpoint);
        decide(&peer, admit.callback_id.get(), 1, Decision::Deny);
        assert_eq!(result(&peer).outcome, Outcome::Failure(ErrorCode::Denied));
        let backend = service.handle("alpha").unwrap();
        assert_eq!(backend.usage(None, &io()).unwrap(), before);
        assert_eq!(
            backend.read(original.key, 0, 5, &io()).unwrap().bytes,
            b"hello"
        );
    }
}

#[test]
fn interrupted_removal_reports_unknown_and_keeps_cleanup_charge_until_confirmation() {
    let env = Env::new();
    let (service, peer) = running(&env, bounds());
    let original = spec(Context::LocalExtension, 7, b"hello");
    seed(&service, &original, b"hello", true);
    let before = service.handle("alpha").unwrap().usage(None, &io()).unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&hits);
    service.storage.observe(Arc::new(move |point| {
        if point == crate::objects::Milestone::RemovalMarked {
            seen.fetch_add(1, Ordering::SeqCst);
            false
        } else {
            true
        }
    }));
    request(&peer, 1, Origin::LocalExtension, remove(7));
    for boundary in [Checkpoint::Acquire, Checkpoint::Effect] {
        let admit = callback(&peer);
        assert_eq!(admit.boundary, boundary);
        decide(&peer, admit.callback_id.get(), 1, Decision::Allow);
    }
    assert_eq!(result(&peer).outcome, Outcome::Failure(ErrorCode::Unknown));
    assert_eq!(hits.load(Ordering::SeqCst), 1, "no automatic removal retry");
    let held = usage(&peer, 2, UsageScope::Extension);
    assert_eq!(held.charged_bytes, before.charged_bytes);
    assert_eq!(held.entries, before.entries);
    service.storage.observe(Arc::new(|_| true));
    assert_eq!(
        allowed(&peer, 3, remove(7)),
        Outcome::Success(Success::Removed)
    );
    let removed = usage(&peer, 4, UsageScope::Extension);
    assert_eq!(
        removed.charged_bytes,
        before.charged_bytes - crate::objects::payload_charge(5)
    );
    assert_eq!((removed.entries, removed.retained_identities), (0, 1));
    let mut fresh = original.clone();
    fresh.intent = crate::objects::IntentId([8; 32]);
    assert_eq!(
        service.handle("alpha").unwrap().begin(&fresh, &io()),
        Err(crate::objects::BackendError::Conflict)
    );
}

#[test]
fn a_new_namespace_tombstone_keeps_typed_capacity_refusal_without_changes() {
    let env = Env::new();
    let service = ObjectService::open(
        &env.serving,
        &ALPHA,
        Quotas {
            namespace_bytes: 0,
            ..Quotas::contract()
        },
        system_clock(),
        bounds(),
        Origins::default(),
        &io(),
    )
    .unwrap()
    .unwrap();
    let peer = Peer::start(&env, "alpha", Answer::Expect);
    service.activate(&env.mounts(&ALPHA), "alpha").unwrap();
    request(&peer, 1, Origin::LocalExtension, remove(7));
    for boundary in [Checkpoint::Acquire, Checkpoint::Effect] {
        let admit = callback(&peer);
        assert_eq!(admit.boundary, boundary);
        decide(&peer, admit.callback_id.get(), 1, Decision::Allow);
    }
    assert_eq!(
        result(&peer).outcome,
        Outcome::Failure(ErrorCode::Capacity(
            tmt_extension_objects::Limit::NamespaceBytes
        ))
    );
    assert_eq!(
        usage(&peer, 2, UsageScope::Extension),
        tmt_extension_objects::Usage {
            charged_bytes: 0,
            entries: 0,
            active_uploads: 0,
            retained_identities: 0
        }
    );
}

#[test]
fn removal_disclose_refusal_reports_unknown_after_removal_without_replay() {
    for decision in [Decision::Deny, Decision::Unavailable] {
        let env = Env::new();
        let (service, peer) = running(&env, bounds());
        let original = spec(Context::LocalExtension, 7, b"hello");
        seed(&service, &original, b"hello", true);
        let removals = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&removals);
        service.storage.observe(Arc::new(move |point| {
            if point == crate::objects::Milestone::RemovalMarked {
                observed.fetch_add(1, Ordering::SeqCst);
            }
            true
        }));
        request(&peer, 1, Origin::LocalExtension, remove(7));
        for boundary in [Checkpoint::Acquire, Checkpoint::Effect] {
            let admit = callback(&peer);
            assert_eq!(admit.boundary, boundary);
            decide(&peer, admit.callback_id.get(), 1, Decision::Allow);
        }
        let admit = callback(&peer);
        assert_eq!(admit.boundary, Checkpoint::Disclose);
        assert_eq!(admit.operation.disclosure, Some(Disclosure::Removed));
        decide(&peer, admit.callback_id.get(), 1, decision);
        assert_eq!(result(&peer).outcome, Outcome::Failure(ErrorCode::Unknown));
        let after = usage(
            &peer,
            2,
            UsageScope::Namespace(Bytes32::from_bytes([7; 32])),
        );
        assert_eq!(
            after,
            tmt_extension_objects::Usage {
                charged_bytes: crate::limits::OBJECT_RECORD_BYTES
                    + crate::limits::OBJECT_FENCE_BYTES,
                entries: 0,
                active_uploads: 0,
                retained_identities: 1,
            }
        );
        assert_eq!(
            removals.load(Ordering::SeqCst),
            1,
            "removal was not replayed"
        );
        assert_eq!(
            service.handle("alpha").unwrap().begin(&original, &io()),
            Ok(crate::objects::BeginResult::Terminal(
                crate::objects::TransferState::Unavailable
            ))
        );
    }
}

#[test]
fn usage_disclose_refusal_preserves_denied_and_unavailable() {
    for (decision, code) in [
        (Decision::Deny, ErrorCode::Denied),
        (Decision::Unavailable, ErrorCode::Unavailable),
    ] {
        let env = Env::new();
        let (_service, peer) = running(&env, bounds());
        request(
            &peer,
            1,
            Origin::LocalExtension,
            Call::Usage(UsageScope::Extension),
        );
        let admit = callback(&peer);
        assert_eq!(admit.boundary, Checkpoint::Acquire);
        decide(&peer, admit.callback_id.get(), 1, Decision::Allow);
        let admit = callback(&peer);
        assert_eq!(admit.boundary, Checkpoint::Disclose);
        assert!(matches!(
            admit.operation.disclosure,
            Some(Disclosure::Usage(_))
        ));
        decide(&peer, admit.callback_id.get(), 1, decision);
        assert_eq!(result(&peer).outcome, Outcome::Failure(code));
    }
}

/// A native (version 4) channel to the `notes` fixture with one committed object.
fn running_native(env: &Env) -> (ObjectService<'_>, Peer, BeginSpec, Vec<u8>) {
    use super::native::{NOTES, registration};
    let service = env.service(&NOTES, bounds()).unwrap();
    let peer = Peer::start(env, "notes", Answer::Expect);
    service
        .register_native(
            "notes",
            registration(
                Arc::new(super::super::sync::tests::Fake::new()),
                Arc::new(AtomicUsize::new(0)),
            ),
        )
        .unwrap();
    service
        .activate_native_until(
            &env.mounts(&NOTES),
            "notes",
            Instant::now() + Duration::from_secs(5),
        )
        .unwrap();
    peer.ready.recv_timeout(Duration::from_secs(5)).unwrap();
    let payload = b"attachment".to_vec();
    let original = spec(Context::LocalExtension, 7, &payload);
    let backend = service.handle("notes").unwrap();
    backend.begin(&original, &io()).unwrap();
    backend.append(original.intent, 0, &payload, &io()).unwrap();
    backend.commit(original.intent, &io()).unwrap();
    (service, peer, original, payload)
}
fn remove_object(original: &BeginSpec) -> Call {
    Call::Remove(tmt_extension_objects::RemoveInput {
        namespace: Bytes32::from_bytes(original.key.namespace.0),
        opaque_key: Bytes32::from_bytes(original.key.object.0),
        payload_sha256: tmt_extension_objects::Sha256Hex::from_bytes(original.payload_sha256),
        payload_bytes: original.payload_bytes,
    })
}
fn list_page(tag: u8) -> Call {
    Call::List(tmt_extension_objects::ListInput {
        namespace: Bytes32::from_bytes([tag; 32]),
        after: None,
        limit: 8,
    })
}

#[test]
fn a_native_channel_lists_and_removes_one_object_and_the_charge_drops_before_removed() {
    let env = Env::new();
    let (service, peer, original, payload) = running_native(&env);
    assert!(peer.buses.lock().unwrap()[0].supports(Method::Remove));
    let listing = match allowed(&peer, 1, list_page(7)) {
        Outcome::Success(Success::Listed(listing)) => listing,
        other => panic!("expected a listing, got {other:?}"),
    };
    assert_eq!(listing.next, None);
    assert_eq!(listing.entries.len(), 1);
    assert_eq!(
        listing.entries[0].opaque_key,
        Bytes32::from_bytes(original.key.object.0)
    );
    assert_eq!(listing.entries[0].payload_bytes, payload.len() as u64);
    let namespace = UsageScope::Namespace(Bytes32::from_bytes([7; 32]));
    let before = usage(&peer, 2, namespace);
    // The disclose callback runs after the release committed: the backend already
    // reports the lower charge when `removed` is about to leave.
    let backend = service.handle("notes").unwrap();
    request(&peer, 3, Origin::LocalExtension, remove_object(&original));
    for boundary in [
        Checkpoint::Acquire,
        Checkpoint::Effect,
        Checkpoint::Disclose,
    ] {
        let admit = callback(&peer);
        assert_eq!(admit.boundary, boundary);
        assert!(matches!(admit.operation.input, AdmitInput::Remove(_)));
        if boundary == Checkpoint::Disclose {
            assert_eq!(admit.operation.disclosure, Some(Disclosure::Removed));
            assert_eq!(
                backend
                    .usage(Some(original.key.namespace), &io())
                    .unwrap()
                    .charged_bytes,
                before.charged_bytes - crate::objects::payload_charge(payload.len() as u64)
            );
        }
        decide(&peer, admit.callback_id.get(), 3, Decision::Allow);
    }
    assert_eq!(result(&peer).outcome, Outcome::Success(Success::Removed));
    let after = usage(&peer, 4, namespace);
    assert_eq!((after.entries, after.retained_identities), (0, 1));
    match allowed(&peer, 5, list_page(7)) {
        Outcome::Success(Success::Listed(listing)) => assert!(listing.entries.is_empty()),
        other => panic!("expected a listing, got {other:?}"),
    }
    assert_eq!(
        allowed(&peer, 6, remove_object(&original)),
        Outcome::Success(Success::Removed),
        "a repeat is idempotent"
    );
}

#[test]
fn mounted_listing_and_object_removal_are_denied_without_callbacks() {
    let env = Env::new();
    let (service, peer, original, payload) = running_native(&env);
    let backend = service.handle("notes").unwrap();
    let before = backend.usage(None, &io()).unwrap();
    for (id, call) in [(1, remove_object(&original)), (2, list_page(7))] {
        request(
            &peer,
            id,
            Origin::Mounted(Uuid4::parse("d9f6456b-2951-4c1e-a130-cbac198e3a50").unwrap()),
            call,
        );
        assert_eq!(result(&peer).outcome, Outcome::Failure(ErrorCode::Denied));
    }
    assert_eq!(backend.usage(None, &io()).unwrap(), before);
    assert_eq!(
        backend.read(original.key, 0, 4, &io()).unwrap().bytes,
        payload[..4]
    );
}

#[test]
fn an_effect_refusal_keeps_the_object_and_a_changed_body_conflicts() {
    let env = Env::new();
    let (service, peer, original, payload) = running_native(&env);
    request(&peer, 1, Origin::LocalExtension, remove_object(&original));
    let admit = callback(&peer);
    decide(&peer, admit.callback_id.get(), 1, Decision::Allow);
    let admit = callback(&peer);
    assert_eq!(admit.boundary, Checkpoint::Effect);
    decide(&peer, admit.callback_id.get(), 1, Decision::Deny);
    assert_eq!(result(&peer).outcome, Outcome::Failure(ErrorCode::Denied));
    let backend = service.handle("notes").unwrap();
    assert_eq!(
        backend.read(original.key, 0, 4, &io()).unwrap().bytes,
        payload[..4]
    );
    let mut changed = original.clone();
    changed.payload_bytes += 1;
    request(&peer, 2, Origin::LocalExtension, remove_object(&changed));
    for boundary in [Checkpoint::Acquire, Checkpoint::Effect] {
        let admit = callback(&peer);
        assert_eq!(admit.boundary, boundary);
        decide(&peer, admit.callback_id.get(), 2, Decision::Allow);
    }
    assert_eq!(result(&peer).outcome, Outcome::Failure(ErrorCode::Conflict));
    assert_eq!(
        backend.read(original.key, 0, 4, &io()).unwrap().bytes,
        payload[..4]
    );
}
