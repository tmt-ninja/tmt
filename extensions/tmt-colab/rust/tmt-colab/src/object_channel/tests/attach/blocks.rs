//! A file attached to a page of blocks (#6190), against a real owner store with the object channel
//! replaced by an in-memory backend: the native attach publishes its proof and then the list change
//! through the blocks batch, an image block shows the attachment, and the 30-day sweep follows the
//! blocks: kept while a block references it (live, then deleted), released once compaction purges
//! the deleted block, so nobody has to detach it by hand.
use super::*;
use crate::{attachments::unreferenced, transitions::OwnerAction};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::time::Duration;

const PICTURES: &str = "10000000-0000-4000-8000-0000000000b1";
const IMAGE: &str = "20000000-0000-4000-8000-0000000000c1";
const DAY: u64 = 24 * 60 * 60 * 1000;

impl Flow {
    /// A page of blocks made by the real create transition, beside the fixture's HTML page.
    fn with_pictures() -> Self {
        let mut flow = Flow::new();
        flow.world.state.apply(OwnerAction::CreateBlocks {
            page: PICTURES,
            title: "Pictures",
            publisher_agent: None,
            creation_recipient: None,
        });
        flow
    }
    /// One block batch, prepared and published like the serve does it.
    fn batch(&self, ops: Value) {
        let (prepared, _) = page::blocks::prepare(
            &self.world.source,
            &page::blocks::BlockBatch {
                page: PICTURES.into(),
                operation_id: page::fresh_id().unwrap(),
                ops,
                attachments: None,
            },
            &|| Ok(crate::registration::now_ms().unwrap()),
        )
        .unwrap();
        let page::save::Prepared::Write(frozen) = prepared else {
            panic!("a batch changes the page")
        };
        let view = (self.world.source)().unwrap();
        self.writer.publish(&view.keyring, &frozen).unwrap();
    }
    fn page(&self) -> crate::fold::View {
        let view = (self.world.source)().unwrap();
        let snapshot = Snapshot::capture_read(&view.store, &view.keyring, PICTURES, None).unwrap();
        snapshot
            .materialize_until(
                &view.keyring,
                PICTURES,
                &mut { view.decoder },
                Instant::now() + Duration::from_secs(20),
            )
            .unwrap()
    }
    /// The objects the sweep keeps on the page.
    fn kept(&self) -> BTreeSet<String> {
        let mut view = (self.world.source)().unwrap();
        unreferenced::references(
            &mut view,
            &self.slots,
            PICTURES,
            Instant::now() + Duration::from_secs(20),
        )
        .unwrap()
    }
}

#[test]
fn an_attached_file_is_kept_while_a_block_references_it_and_released_when_the_purge_drops_the_block()
 {
    let flow = Flow::with_pictures();
    let mut slot = flow.slots.create(PICTURES, "a.txt", 1000).unwrap();
    std::fs::write(slot.source_path(), Flow::FILE).unwrap();
    let attached = flow
        .run(&mut slot, Some(crypto::digest(Flow::FILE)))
        .unwrap();
    slot.finish(2000).unwrap();
    let descriptor = attached.descriptor;
    assert_eq!(descriptor.page, PICTURES);
    // The list change went through the blocks batch: the descriptor is on the page, sealed against
    // its empty html root, and the page is still a page of blocks with nothing to show yet.
    let listed = flow.page();
    assert_eq!(listed.meta["pageType"], "blocks");
    assert_eq!(listed.meta["attachments"].as_array().unwrap().len(), 1);
    assert_eq!(listed.source, "");
    assert_eq!(
        (flow.begins(), flow.published()),
        (1, 2),
        "one upload; the proof, then the list"
    );
    // Listed but shown by no block, the object is not kept: its 30 days can start.
    let object = descriptor.object_id.to_ascii_lowercase();
    assert!(!flow.kept().contains(&object));

    // An image block that names it keeps it.
    let reference = format!("colab-attachment:{}", descriptor.attachment_id);
    let now = crate::registration::now_ms().unwrap();
    flow.batch(
        json!([{"op": "insert", "id": IMAGE, "type": "image", "parent": "root", "after": null,
            "props": {"images": [{"src": reference}]}}]),
    );
    assert_eq!(flow.page().blocks.unwrap()[IMAGE]["type"], "image");
    assert!(flow.kept().contains(&object), "a live block references it");

    // Deleted, it still keeps the file: an undo or a restore keeps its image.
    flow.batch(json!([{"op": "delete", "id": IMAGE}]));
    assert!(flow.page().blocks.unwrap()[IMAGE].get("deleted").is_some());
    assert!(
        flow.kept().contains(&object),
        "a tombstone still references it"
    );

    // The page fills up with live blocks. Compaction, building the next epoch's baseline, purges the
    // oldest tombstones of a page over 1536 blocks (a tombstone of seven days goes the same way,
    // which a test cannot wait for): this is the only tombstone, so it goes.
    for chunk in 0..6u32 {
        let ops: Vec<Value> = (0..256u32)
            .map(|n| {
                json!({"op": "insert", "id": format!("30000000-0000-4000-8000-{:012}", chunk * 256 + n),
                    "type": "paragraph", "text": "filler"})
            })
            .collect();
        flow.batch(Value::Array(ops));
    }
    assert_eq!(flow.page().blocks.unwrap().as_object().unwrap().len(), 1537);
    assert!(
        flow.kept().contains(&object),
        "not purged before the epoch moves"
    );
    let mut flow = flow;
    flow.world
        .state
        .apply(OwnerAction::EpochAdvance { page: PICTURES });
    let purged = flow.page();
    assert!(
        purged.blocks.unwrap().get(IMAGE).is_none(),
        "the purge dropped it"
    );
    assert_eq!(
        purged.meta["attachments"].as_array().unwrap().len(),
        1,
        "the list keeps the descriptor until a detach"
    );
    let kept = flow.kept();
    assert!(!kept.contains(&object), "nothing references it any more");

    // So the sweep starts the object's clock, and removes it once the grace has passed.
    let mut key = [0u8; 32];
    for (index, byte) in key.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&object[index * 2..index * 2 + 2], 16).unwrap();
    }
    let listing = [crate::object_channel::tests::listed_object(key, 10)];
    let plan = unreferenced::plan(&listing, &kept, &[], now);
    assert_eq!(plan.start, vec![(object.clone(), 10)]);
    let waiting = [(object.clone(), 10, now)];
    let early = unreferenced::plan(&listing, &kept, &waiting, now + 29 * DAY);
    assert!(early.due.is_empty());
    let due = unreferenced::plan(
        &listing,
        &kept,
        &waiting,
        now + crate::limits::ATTACHMENT_UNREFERENCED_GRACE_MS,
    );
    assert_eq!(due.due.len(), 1);
}
