//! Opaque Store tests, not a substitute for B3's carrier/crypto admission proof.
use super::*;
use crate::{keyring::Layout, store::Envelope};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
const PAGE: &str = "page";
const STREAM: &str = "writer";
fn scope() -> StreamScope<'static> {
    StreamScope {
        page: PAGE,
        epoch: 1,
        stream: STREAM,
    }
}
fn binding() -> CloudBinding<'static> {
    CloudBinding {
        project: "fixture",
        declaration_digest: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        space: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        uid: "owner",
    }
}
struct Fixture {
    root: PathBuf,
    layout: Layout,
    store: Store,
}
impl Fixture {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "tmt-2452-retention-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let layout = Layout::open(&root).unwrap();
        let store = Store::open(&layout).unwrap();
        store.create_page(PAGE).unwrap();
        Self {
            root,
            layout,
            store,
        }
    }
    fn append(&mut self, seq: u64) {
        let bytes = format!("update-{seq}");
        self.store
            .append(&Envelope {
                scope: scope(),
                namespace: if seq.is_multiple_of(2) {
                    Namespace::Own
                } else {
                    Namespace::Content
                },
                seq,
                hash: [seq as u8; 32],
                previous: if seq == 1 {
                    [0; 32]
                } else {
                    [(seq - 1) as u8; 32]
                },
                bytes: bytes.as_bytes(),
            })
            .unwrap();
    }
    fn pair(&mut self, seq: u64) -> ([u8; 32], [u8; 32]) {
        let mut digests = Vec::new();
        for (index, namespace) in [Namespace::Content, Namespace::Own].into_iter().enumerate() {
            let bytes = format!("checkpoint-{seq}-{}", namespace.name());
            self.store
                .checkpoint(&Envelope {
                    scope: scope(),
                    namespace,
                    seq,
                    hash: [100 + index as u8; 32],
                    previous: [seq as u8; 32],
                    bytes: bytes.as_bytes(),
                })
                .unwrap();
            digests.push(crypto::digest(bytes.as_bytes()));
        }
        (digests[0], digests[1])
    }
    fn payload(&self, seq: u64) -> Option<Vec<u8>> {
        self.store.payload(scope(), seq).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}
#[test]
fn an_existing_compacted_page_starts_from_a_pending_pair_and_retained_tail() {
    let mut f = Fixture::new();
    for seq in 1..=3 {
        f.append(seq);
    }
    let original = f.pair(3);
    assert_eq!(f.payload(1), None);
    for seq in 4..=5 {
        f.append(seq);
    }
    assert_eq!(
        f.store.track_publication(scope(), &binding()).unwrap(),
        PublicationProgress {
            bootstrap_seq: 3,
            confirmed_seq: 0
        }
    );
    let next = f.pair(5);
    assert!(
        f.payload(4).is_some() && f.payload(5).is_some(),
        "unconfirmed checkpoint grants no pruning"
    );
    assert_eq!(
        f.store
            .publication_progress(scope(), &binding())
            .unwrap()
            .unwrap(),
        PublicationProgress {
            bootstrap_seq: 5,
            confirmed_seq: 0
        }
    );
    // A delayed older confirmation is safe but does not claim the newer cut.
    let p = f
        .store
        .confirm_checkpoint_publication(scope(), &binding(), 3, &original.0, &original.1)
        .unwrap();
    assert_eq!(p.confirmed_seq, 3);
    assert!(f.payload(4).is_some());
    let p = f
        .store
        .confirm_checkpoint_publication(scope(), &binding(), 5, &next.0, &next.1)
        .unwrap();
    assert_eq!(p.confirmed_seq, 5);
    assert_eq!(f.payload(4), None);
    assert_eq!(f.payload(5), None);
    f.append(6);
    f.store
        .confirm_publication(scope(), &binding(), 6, &[6; 32])
        .unwrap();
    assert!(
        f.payload(6).is_some(),
        "a later local checkpoint still owns compaction"
    );
    let read = Store::read(&f.layout).unwrap();
    assert_eq!(
        read.publication_progress(scope(), &binding())
            .unwrap()
            .unwrap()
            .confirmed_seq,
        6
    );
}
#[test]
fn wrong_hash_binding_uid_sequence_and_epoch_never_advance_progress() {
    let mut f = Fixture::new();
    f.store.track_publication(scope(), &binding()).unwrap();
    f.append(1);
    f.append(2);
    assert!(matches!(
        f.store
            .confirm_publication(scope(), &binding(), 1, &[9; 32]),
        Err(Fault::Conflict)
    ));
    assert!(matches!(
        f.store
            .confirm_publication(scope(), &binding(), 2, &[2; 32]),
        Err(Fault::Gap)
    ));
    let mut other = binding();
    other.uid = "other";
    assert!(matches!(
        f.store.track_publication(scope(), &other),
        Err(Fault::Conflict)
    ));
    other = binding();
    other.project = "different";
    assert!(matches!(
        f.store.confirm_publication(scope(), &other, 1, &[1; 32]),
        Err(Fault::Conflict)
    ));
    let old = StreamScope {
        epoch: 2,
        ..scope()
    };
    assert!(matches!(
        f.store.confirm_publication(old, &binding(), 1, &[1; 32]),
        Err(Fault::StaleEpoch)
    ));
    assert_eq!(
        f.store
            .publication_progress(scope(), &binding())
            .unwrap()
            .unwrap()
            .confirmed_seq,
        0
    );
    assert!(f.payload(1).is_some() && f.payload(2).is_some());
    assert_eq!(
        f.store
            .confirm_publication(scope(), &binding(), 1, &[1; 32])
            .unwrap()
            .confirmed_seq,
        1
    );
    assert_eq!(
        f.store
            .confirm_publication(scope(), &binding(), 1, &[1; 32])
            .unwrap()
            .confirmed_seq,
        1
    );
}
#[test]
fn a_wrong_checkpoint_digest_keeps_the_pair_and_tail_pending() {
    let mut f = Fixture::new();
    f.store.track_publication(scope(), &binding()).unwrap();
    for seq in 1..=3 {
        f.append(seq);
    }
    let digests = f.pair(3);
    assert!(matches!(
        f.store
            .confirm_checkpoint_publication(scope(), &binding(), 3, &digests.0, &[9; 32]),
        Err(Fault::Conflict)
    ));
    assert_eq!(
        f.store
            .publication_progress(scope(), &binding())
            .unwrap()
            .unwrap()
            .confirmed_seq,
        0
    );
    for seq in 1..=3 {
        assert!(f.payload(seq).is_some());
    }
    f.store
        .confirm_checkpoint_publication(scope(), &binding(), 3, &digests.0, &digests.1)
        .unwrap();
    for seq in 1..=3 {
        assert_eq!(f.payload(seq), None);
    }
}
#[test]
fn missing_or_corrupt_history_is_not_treated_as_published() {
    for corruption in [
        "DELETE FROM receipts WHERE seq='00000000000000000002'",
        "UPDATE receipts SET payload=NULL WHERE seq='00000000000000000002'",
    ] {
        let mut f = Fixture::new();
        for seq in 1..=3 {
            f.append(seq);
        }
        f.store.connection.execute_batch(corruption).unwrap();
        assert!(matches!(
            f.store.track_publication(scope(), &binding()),
            Err(Fault::ResyncRequired)
        ));
        let count: i64 = f
            .store
            .connection
            .query_row("SELECT count(*) FROM cloud_publications", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
#[test]
fn an_unpaired_checkpoint_does_not_drop_the_protected_bootstrap() {
    let mut f = Fixture::new();
    for seq in 1..=3 {
        f.append(seq);
    }
    let original = f.pair(3);
    f.store.track_publication(scope(), &binding()).unwrap();
    f.append(4);
    f.store
        .checkpoint(&Envelope {
            scope: scope(),
            namespace: Namespace::Content,
            seq: 4,
            hash: [99; 32],
            previous: [4; 32],
            bytes: b"one namespace only",
        })
        .unwrap();
    assert_eq!(
        f.store
            .publication_progress(scope(), &binding())
            .unwrap()
            .unwrap()
            .bootstrap_seq,
        3
    );
    f.store
        .confirm_checkpoint_publication(scope(), &binding(), 3, &original.0, &original.1)
        .unwrap();
    assert!(f.payload(4).is_some());
}
#[test]
fn tracking_metadata_is_bounded_and_capacity_failure_rolls_it_back() {
    let mut f = Fixture::new();
    for i in 0..crate::limits::SYNC_NAMESPACES {
        let stream = format!("writer-{i}");
        f.store
            .track_publication(
                StreamScope {
                    stream: &stream,
                    ..scope()
                },
                &binding(),
            )
            .unwrap();
    }
    assert!(matches!(
        f.store.track_publication(scope(), &binding()),
        Err(Fault::Capacity)
    ));
    let mut f = Fixture::new();
    f.append(1);
    f.store
        .connection
        .execute(
            "UPDATE receipts SET payload=zeroblob(?)",
            [crate::limits::PAGE_BYTES as i64],
        )
        .unwrap();
    assert!(matches!(
        f.store.track_publication(scope(), &binding()),
        Err(Fault::Capacity)
    ));
    assert_eq!(
        f.store
            .connection
            .query_row("SELECT count(*) FROM cloud_publications", [], |r| r
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

impl Fixture {
    /// A fold of the stream at `seq` in both namespaces, signed by another device.
    fn fold_pair(&mut self, seq: u64, signer: &str) {
        for (index, namespace) in [Namespace::Content, Namespace::Own].into_iter().enumerate() {
            self.store
                .fold(
                    &Envelope {
                        scope: scope(),
                        namespace,
                        seq,
                        hash: [150 + index as u8 + seq as u8; 32],
                        previous: [seq as u8; 32],
                        bytes: format!("fold-{seq}-{}", namespace.name()).as_bytes(),
                    },
                    signer,
                )
                .unwrap();
        }
    }
}

#[test]
fn a_fold_keeps_the_update_it_binds_until_a_later_checkpoint_supersedes_it() {
    let mut f = Fixture::new();
    for seq in 1..=3 {
        f.append(seq);
    }
    f.fold_pair(3, "signer");
    // The prefix is pruned, but the update at the fold's sequence stays: it is the anchor.
    assert_eq!((f.payload(1), f.payload(2)), (None, None));
    assert!(f.payload(3).is_some());
    let anchor = f.store.anchor(scope(), 3).unwrap().unwrap();
    assert_eq!(
        (anchor.namespace, anchor.hash),
        (Namespace::Content, [3; 32])
    );
    assert_eq!(anchor.bytes, b"update-3");
    assert!(f.store.anchor(scope(), 2).unwrap().is_none(), "pruned");
    assert!(
        f.store.anchor(scope(), 9).unwrap().is_none(),
        "never stored"
    );
    // A fold at 5 supersedes the one at 3 and takes the anchor with it.
    f.append(4);
    f.append(5);
    f.fold_pair(5, "signer");
    assert_eq!((f.payload(3), f.payload(4)), (None, None));
    assert!(f.payload(5).is_some());
    // A device's own checkpoint binds the same update but needs no anchor: its signer is the stream.
    f.append(6);
    f.append(7);
    f.pair(7);
    assert_eq!((f.payload(5), f.payload(7)), (None, None));
    assert!(f.store.anchor(scope(), 7).unwrap().is_none());
}

#[test]
fn a_fold_in_one_namespace_alone_prunes_nothing() {
    let mut f = Fixture::new();
    for seq in 1..=3 {
        f.append(seq);
    }
    f.store
        .fold(
            &Envelope {
                scope: scope(),
                namespace: Namespace::Content,
                seq: 3,
                hash: [150; 32],
                previous: [3; 32],
                bytes: b"fold-3-content",
            },
            "signer",
        )
        .unwrap();
    for seq in 1..=3 {
        assert!(
            f.payload(seq).is_some(),
            "update {seq} is kept until the pair is complete"
        );
    }
}

#[test]
fn a_fold_must_bind_an_update_the_stream_holds_and_never_replaces_another_checkpoint() {
    let mut f = Fixture::new();
    f.append(1);
    f.append(2);
    let fold = |f: &mut Fixture, seq, previous: [u8; 32], hash: [u8; 32]| {
        f.store.fold(
            &Envelope {
                scope: scope(),
                namespace: Namespace::Content,
                seq,
                hash,
                previous,
                bytes: b"fold",
            },
            "signer",
        )
    };
    // No update at 3, and an update whose hash is not the one the fold names.
    assert!(matches!(
        fold(&mut f, 3, [3; 32], [150; 32]),
        Err(Fault::Gap)
    ));
    assert!(matches!(
        fold(&mut f, 2, [9; 32], [150; 32]),
        Err(Fault::Gap)
    ));
    // A device's own checkpoint at 2 wins the sequence: the fold that differs is a conflict.
    f.pair(2);
    assert!(matches!(
        fold(&mut f, 2, [2; 32], [150; 32]),
        Err(Fault::Conflict)
    ));
    // Replaying a fold that is stored is not a second one.
    f.append(3);
    f.fold_pair(3, "signer");
    let replay = f.store.fold(
        &Envelope {
            scope: scope(),
            namespace: Namespace::Content,
            seq: 3,
            hash: [150 + 3; 32],
            previous: [3; 32],
            bytes: b"fold-3-content",
        },
        "signer",
    );
    assert!(matches!(replay, Ok(crate::store::Accepted::Replay)));
}

#[test]
fn the_retained_folds_a_device_signed_are_listed_sorted_and_without_the_superseded() {
    let mut f = Fixture::new();
    for seq in 1..=5 {
        f.append(seq);
    }
    f.fold_pair(2, "signer");
    f.fold_pair(4, "signer");
    let owner = ed25519_dalek::SigningKey::from_bytes(&[7; 32])
        .verifying_key()
        .to_bytes();
    let space = crypto::space_id(&owner).unwrap();
    let signed = |f: &Fixture, device: &str| {
        f.store
            .owner_read(&space, &owner, |tx| tx.committed_folds(device))
            .unwrap()
    };
    // Only the fold at 4 is retained (the one at 2 was superseded), in the byte order a revoke
    // lists them.
    let encode = |hash: [u8; 32]| values::encode_binary(&hash);
    assert_eq!(
        signed(&f, "signer"),
        [encode([154; 32]), encode([155; 32])],
        "the content and the own fold at 4"
    );
    assert!(signed(&f, "another").is_empty());
    // A later checkpoint of the device itself supersedes them; nothing is left to list.
    f.append(6);
    f.pair(6);
    assert!(signed(&f, "signer").is_empty());
}

#[test]
fn a_device_that_signed_more_folds_than_a_revoke_can_list_is_refused() {
    let mut f = Fixture::new();
    f.append(1);
    let owner = ed25519_dalek::SigningKey::from_bytes(&[7; 32])
        .verifying_key()
        .to_bytes();
    let space = crypto::space_id(&owner).unwrap();
    let count = |f: &Fixture, n: usize| {
        let rows: Vec<(String, Vec<u8>)> = (0..n)
            .map(|i| (format!("{}", 100 + i), (i as u32).to_be_bytes().repeat(8)))
            .collect();
        f.store.connection.execute_batch("BEGIN").unwrap();
        for (seq, hash) in rows {
            f.store
                .connection
                .execute(
                    "INSERT INTO checkpoints(page,epoch,stream,namespace,seq,hash,digest,head,payload,signer)
                     SELECT page,epoch,stream,'content',?1,?2,x'00',x'00',x'01','signer' FROM streams LIMIT 1",
                    rusqlite::params![seq, hash],
                )
                .unwrap();
        }
        f.store.connection.execute_batch("COMMIT").unwrap();
    };
    let list = |f: &Fixture| {
        f.store
            .owner_read(&space, &owner, |tx| tx.committed_folds("signer"))
    };
    count(&f, 512);
    assert_eq!(list(&f).unwrap().len(), 512, "exactly the limit is listed");
    f.store
        .connection
        .execute(
            "INSERT INTO checkpoints(page,epoch,stream,namespace,seq,hash,digest,head,payload,signer)
             SELECT page,epoch,stream,'content','999',x'ff',x'00',x'00',x'01','signer' FROM streams LIMIT 1",
            [],
        )
        .unwrap();
    assert!(
        list(&f).is_err(),
        "one more is refused rather than left out of the revoke"
    );
}
#[test]
fn a_snapshot_is_given_the_anchor_of_each_retained_fold_and_of_nothing_else() {
    let mut f = Fixture::new();
    for seq in 1..=3 {
        f.append(seq);
    }
    f.pair(1);
    f.append(4);
    f.fold_pair(4, "signer");
    let owner = ed25519_dalek::SigningKey::from_bytes(&[7; 32])
        .verifying_key()
        .to_bytes();
    let space = crypto::space_id(&owner).unwrap();
    let anchors = f
        .store
        .owner_read(&space, &owner, |tx| tx.fold_anchors(PAGE, 1))
        .unwrap();
    assert_eq!(anchors.len(), 1);
    assert_eq!(anchors[&(STREAM.to_owned(), 4)], b"update-4");
}

#[test]
fn local_storage_counts_retained_payloads_by_epoch_and_keeps_comments() {
    let mut f = Fixture::new();
    f.append(1);
    f.append(2);
    let current = f.store.page_storage_bytes(PAGE).unwrap();
    assert_eq!(
        (current.content, current.history, current.comments),
        (8, 0, 8)
    );
    assert_eq!(current.last_auto_cleaned_at_ms, None);
    f.store
        .connection
        .execute("UPDATE pages SET epoch='2' WHERE page=?1", [PAGE])
        .unwrap();
    let older = f.store.page_storage_bytes(PAGE).unwrap();
    assert_eq!((older.content, older.history, older.comments), (0, 8, 8));
    f.store.record_auto_cleaned(PAGE, 1234).unwrap();
    assert_eq!(
        f.store
            .page_storage_bytes(PAGE)
            .unwrap()
            .last_auto_cleaned_at_ms,
        Some(1234)
    );
    f.store
        .connection
        .execute(
            "UPDATE receipts SET payload=NULL WHERE page=?1 AND namespace='content'",
            [PAGE],
        )
        .unwrap();
    let pruned = f.store.page_storage_bytes(PAGE).unwrap();
    assert_eq!((pruned.content, pruned.history, pruned.comments), (0, 0, 8));
}

#[test]
fn preview_counts_exactly_the_content_candidates_prune_then_removes() {
    let mut f = Fixture::new();
    for seq in 1..=3 {
        f.append(seq);
    }
    f.pair(3);
    // Recreate a retained payload below an existing pair, as an interrupted/prior store can have.
    f.store
        .connection
        .execute(
            "UPDATE receipts SET payload=?1 WHERE page=?2 AND seq=?3",
            params![b"update-1".as_slice(), PAGE, sequence(1)],
        )
        .unwrap();
    assert_eq!(
        f.store.eligible_history_bytes(PAGE).unwrap(),
        0,
        "a paired stream without an active tail is not reclaimable"
    );
    f.append(4);
    assert_eq!(f.store.eligible_history_bytes(PAGE).unwrap(), 8);
    assert_eq!(f.payload(1).as_deref(), Some(b"update-1".as_slice()));
    prune(&f.store.connection, scope(), &sequence(3)).unwrap();
    assert_eq!(f.payload(1), None);
    assert_eq!(f.store.eligible_history_bytes(PAGE).unwrap(), 0);
    assert!(f.payload(3).is_none());
}

#[test]
fn current_page_and_superseded_history_are_counted_once_and_preview_fits_history() {
    let mut f = Fixture::new();
    for seq in 1..=3 {
        f.append(seq);
    }
    let before = f.store.page_storage_bytes(PAGE).unwrap();
    assert_eq!((before.content, before.history), (16, 0));
    f.pair(3);
    f.store
        .connection
        .execute(
            "UPDATE receipts SET payload=?1 WHERE page=?2 AND seq=?3",
            params![b"update-1".as_slice(), PAGE, sequence(1)],
        )
        .unwrap();
    let after = f.store.page_storage_bytes(PAGE).unwrap();
    assert_eq!(after.content, b"checkpoint-3-content".len() as u64);
    assert_eq!(after.history, 8);
    assert!(f.store.eligible_history_bytes(PAGE).unwrap() <= after.history);
}

#[test]
fn storage_attributes_padded_baseline_epoch_to_the_current_page() {
    let f = Fixture::new();
    let epoch = sequence(1);
    f.store
        .connection
        .execute(
            "INSERT INTO epoch_secrets(page,epoch,secret) VALUES(?1,?2,?3)",
            params![PAGE, epoch, [7u8; 32].as_slice()],
        )
        .unwrap();
    f.store
        .connection
        .execute(
            "INSERT INTO baselines(page,epoch,descriptor,envelope) VALUES(?1,?2,?3,?4)",
            params![
                PAGE,
                epoch,
                b"descriptor".as_slice(),
                b"baseline".as_slice()
            ],
        )
        .unwrap();
    let bytes = f.store.page_storage_bytes(PAGE).unwrap();
    assert_eq!((bytes.content, bytes.history), (8, 0));
    f.store
        .connection
        .execute("UPDATE pages SET epoch='2' WHERE page=?1", [PAGE])
        .unwrap();
    let older = f.store.page_storage_bytes(PAGE).unwrap();
    assert_eq!((older.content, older.history), (0, 8));
}

// #5366: the read-only inventory over synthetic stores only.
fn inventory_of(f: &Fixture) -> (super::ContentInventory, crate::store::PageStorageBytes) {
    // Each fixture opens its own private directory, never the owner's store.
    let root = f.root.canonicalize().unwrap();
    assert!(
        f.layout
            .directory
            .canonicalize()
            .unwrap()
            .starts_with(&root)
    );
    if let Some(home) = std::env::var_os("HOME") {
        assert!(!root.starts_with(PathBuf::from(home).join(".config/tmt")));
    }
    let inventory = f.store.content_inventory(PAGE).unwrap();
    let bytes = f.store.page_storage_bytes(PAGE).unwrap();
    // Every retained byte is counted once, and the estimate is exactly what prune removes.
    assert_eq!(
        inventory.content_and_history().unwrap(),
        bytes.content + bytes.history
    );
    assert_eq!(inventory.own.bytes, bytes.comments);
    assert_eq!(
        inventory.total(super::Reason::PruneableNow),
        f.store.eligible_history_bytes(PAGE).unwrap()
    );
    (inventory, bytes)
}
fn reasons_of(inventory: &super::ContentInventory) -> Vec<(super::Reason, u64)> {
    inventory
        .reasons
        .iter()
        .map(|(reason, tally)| (*reason, tally.bytes))
        .collect()
}
fn store_bytes(f: &Fixture) -> Vec<u8> {
    fs::read(f.layout.directory.join("space.db")).unwrap()
}

#[test]
fn inventory_of_a_stream_without_a_pair_is_its_bootstrap() {
    let mut f = Fixture::new();
    for seq in 1..=3 {
        f.append(seq);
    }
    let (inventory, _) = inventory_of(&f);
    use super::Reason::*;
    assert_eq!(reasons_of(&inventory), vec![(Bootstrap, 16)]);
    assert_eq!((inventory.own.rows, inventory.own.bytes), (1, 8));
    assert_eq!((inventory.streams, inventory.receipt_rows), (1, 2));
}

#[test]
fn inventory_finds_a_superseded_payload_prune_can_remove_now() {
    let mut f = Fixture::new();
    for seq in 1..=3 {
        f.append(seq);
    }
    f.pair(3);
    // A payload kept below the pair, as an interrupted or older store holds it.
    f.store
        .connection
        .execute(
            "UPDATE receipts SET payload=?1 WHERE page=?2 AND seq=?3",
            params![b"update-1".as_slice(), PAGE, sequence(1)],
        )
        .unwrap();
    f.append(4);
    f.append(5);
    let (inventory, _) = inventory_of(&f);
    use super::Reason::*;
    let checkpoint = b"checkpoint-3-content".len() as u64;
    assert_eq!(
        reasons_of(&inventory),
        vec![
            (LatestPaired, checkpoint),
            (Bootstrap, 8),
            (PruneableNow, 8)
        ]
    );
    assert_eq!(inventory.pruned_receipt_rows, 1);
}

#[test]
fn inventory_of_a_paired_stream_without_a_tail_shows_retention_keeps_it() {
    let mut f = Fixture::new();
    for seq in 1..=3 {
        f.append(seq);
    }
    f.pair(3);
    f.store
        .connection
        .execute(
            "UPDATE receipts SET payload=?1 WHERE page=?2 AND seq=?3",
            params![b"update-1".as_slice(), PAGE, sequence(1)],
        )
        .unwrap();
    let before = store_bytes(&f);
    let (inventory, _) = inventory_of(&f);
    use super::Reason::*;
    // No active tail: the current rules free nothing, and the superseded update is what a new
    // generation would have to free.
    assert_eq!(inventory.total(PruneableNow), 0);
    assert_eq!(inventory.total(Superseded), 8);
    assert_eq!(
        inventory.total(LatestPaired),
        b"checkpoint-3-content".len() as u64
    );
    // Reading changed nothing on disk.
    assert_eq!(store_bytes(&f), before);
}

#[test]
fn inventory_counts_overlapping_protections_once() {
    let mut f = Fixture::new();
    for seq in 1..=3 {
        f.append(seq);
    }
    f.pair(1);
    f.store
        .connection
        .execute(
            "UPDATE checkpoints SET pinned=1 WHERE page=?1 AND seq=?2",
            params![PAGE, sequence(1)],
        )
        .unwrap();
    // The cloud has confirmed only up to 1, so update 3 waits for it.
    f.store
        .connection
        .execute(
            "INSERT INTO cloud_publications(page,epoch,stream,binding,uid,bootstrap_seq,confirmed_seq)
             VALUES(?1,'1',?2,?3,'owner',?4,?4)",
            params![PAGE, STREAM, [9u8; 32].as_slice(), sequence(1)],
        )
        .unwrap();
    f.pair(3);
    f.append(4);
    f.append(5);
    let (inventory, _) = inventory_of(&f);
    use super::Reason::*;
    let pinned = b"checkpoint-1-content".len() as u64;
    assert_eq!(inventory.total(Pinned), pinned);
    assert_eq!(inventory.total(Unconfirmed), 8);
    // A later epoch makes the whole stream old: each payload keeps its first reason only.
    f.store
        .connection
        .execute("UPDATE pages SET epoch='2' WHERE page=?1", [PAGE])
        .unwrap();
    let (old, bytes) = inventory_of(&f);
    assert_eq!(old.total(OldEpoch), bytes.history);
    assert_eq!(old.overlaps["oldEpoch+pinned"].bytes, pinned);
    assert_eq!(
        old.overlaps["oldEpoch+latestPaired"].bytes,
        b"checkpoint-3-content".len() as u64
    );
}

#[test]
fn inventory_keeps_the_update_an_owner_fold_binds() {
    let mut f = Fixture::new();
    for seq in 1..=5 {
        f.append(seq);
    }
    f.fold_pair(5, "device");
    f.append(6);
    f.append(7);
    let (inventory, _) = inventory_of(&f);
    use super::Reason::*;
    assert_eq!(
        inventory.total(OwnerSigned),
        8 + b"fold-5-content".len() as u64
    );
    assert_eq!(
        inventory.overlaps["ownerSigned+latestPaired"].bytes,
        b"fold-5-content".len() as u64
    );
}

/// #5366 stage 3: the inventory of a supplied backup copy, never a live store. Run by hand only:
/// `TMT_COLAB_INVENTORY_COPY=<dir holding space.db> cargo test inventory_of_a_backup_copy -- --ignored --nocapture`.
/// The copy is opened read-only with `query_only`, a copy with a WAL or journal beside it is
/// refused, and its bytes must be identical before and after. Only totals are printed.
#[test]
#[ignore]
fn inventory_of_a_backup_copy() {
    use sha2::{Digest, Sha256};
    let dir = std::path::PathBuf::from(
        std::env::var("TMT_COLAB_INVENTORY_COPY").expect("TMT_COLAB_INVENTORY_COPY"),
    );
    let path = dir.join("space.db");
    for side in ["space.db-wal", "space.db-journal"] {
        assert!(
            !dir.join(side).exists(),
            "{side} beside the copy: not a settled backup"
        );
    }
    let digest = || Sha256::digest(fs::read(&path).unwrap());
    let before = digest();
    let connection = Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )
    .unwrap();
    connection.pragma_update(None, "query_only", true).unwrap();
    let store = Store {
        connection,
        clock: std::sync::Arc::new(crate::store::now_ms),
    };
    let pages: Vec<String> = {
        let mut query = store
            .connection
            .prepare("SELECT page FROM pages ORDER BY page")
            .unwrap();
        query
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    };
    let mut reasons = std::collections::BTreeMap::<String, (u64, u64)>::new();
    let (mut own, mut baselines, mut failed, mut top) = (0u64, 0u64, 0u64, Vec::new());
    for page in &pages {
        let Ok(inventory) = store.content_inventory(page) else {
            failed += 1;
            continue;
        };
        for (reason, tally) in &inventory.reasons {
            let entry = reasons.entry(format!("{reason:?}")).or_default();
            entry.0 += tally.rows;
            entry.1 += tally.bytes;
        }
        own += inventory.own.bytes;
        baselines += inventory.baseline_current.bytes + inventory.baseline_old.bytes;
        top.push((
            inventory.total(Reason::PruneableNow) + inventory.total(Reason::Superseded),
            inventory.content_and_history().unwrap(),
        ));
    }
    top.sort_unstable_by(|a, b| b.cmp(a));
    top.truncate(10);
    drop(store);
    assert_eq!(digest(), before, "the copy changed");
    println!(
        "{}",
        serde_json::json!({"pages":pages.len(),"failed":failed,"reasons":reasons,
            "ownBytes":own,"baselineBytes":baselines,
            "topPages(savableBytes,totalBytes)":top})
    );
}
