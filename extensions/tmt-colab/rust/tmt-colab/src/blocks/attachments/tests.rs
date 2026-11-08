use serde_json::{Value, json};
use tmt_colab_model::{
    attachment::{Descriptor, DocumentChange},
    crypto, values,
};

use super::{Refusal, admit};

const SOURCE: &[u8] = b"";
fn id(n: u32) -> String {
    format!("{n:08x}-0000-4000-8000-000000000000")
}
fn digest(source: &[u8]) -> [u8; 32] {
    crypto::digest(source)
}
fn hex(bytes: &[u8; 32]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn descriptor(n: u32, source: &[u8]) -> Descriptor {
    serde_json::from_value(json!({
        "version": 1,
        "attachmentId": id(n),
        "space": "a".repeat(32),
        "page": "20000000-0000-4000-8000-000000000091",
        "epoch": "1",
        "namespace": "content",
        "objectId": "a".repeat(64),
        "authorDevice": "20000000-0000-4000-8000-000000000093",
        "membershipRevision": "1",
        "source": {"kind": "document", "sourceDigest": hex(&digest(source))},
        "envelopeHash": "c".repeat(64),
        "signature": values::encode_binary(&[1u8; 64]),
        "payloadSha256": "d".repeat(64),
        "payloadBytes": "10",
        "plaintextBytes": "5",
        "filename": "a.png",
        "mediaType": "image/png",
    }))
    .unwrap()
}
fn change(set: &[Descriptor], remove: &[String]) -> DocumentChange {
    serde_json::from_value(json!({"set": set, "remove": remove})).unwrap()
}
fn image(src: &str) -> Value {
    json!({"type": "image", "parent": "root", "pos": "V", "props": {"images": [{"src": src}]}})
}
fn blocks(entries: &[(&str, Value)]) -> Value {
    Value::Object(
        entries
            .iter()
            .map(|(key, value)| ((*key).to_owned(), value.clone()))
            .collect(),
    )
}
fn reference(n: u32) -> String {
    format!("colab-attachment:{}", id(n))
}
const A: &str = "30000000-0000-4000-8000-00000000000a";
const B: &str = "30000000-0000-4000-8000-00000000000b";

#[test]
fn a_reference_a_batch_adds_must_name_a_descriptor_of_the_page_afterwards() {
    let (empty, held) = (blocks(&[]), blocks(&[(A, image(&reference(1)))]));
    let source = digest(SOURCE);
    // Dangling: nothing on the page names it.
    assert_eq!(
        admit(&empty, &held, &[], None, &source),
        Err(Refusal::Attachment)
    );
    // The same batch may add the descriptor, by full ID or by the 8 hex digits of its ID.
    let set = change(&[descriptor(1, SOURCE)], &[]);
    let list = admit(&empty, &held, &[], Some(&set), &source)
        .unwrap()
        .unwrap();
    assert_eq!(list.len(), 1);
    let short = blocks(&[(A, image("colab-attachment:00000001"))]);
    assert!(admit(&empty, &short, &[], Some(&set), &source).is_ok());
    // A descriptor already on the page serves a later batch with no change at all.
    let current = vec![descriptor(1, SOURCE)];
    assert_eq!(admit(&empty, &held, &current, None, &source), Ok(None));
    // A file's href is a reference too.
    let file = json!({"type": "image", "parent": "root", "pos": "V",
        "props": {"files": [{"name": "a", "href": reference(1)}]}});
    assert_eq!(
        admit(&empty, &blocks(&[(A, file.clone())]), &[], None, &source),
        Err(Refusal::Attachment)
    );
    assert!(admit(&empty, &blocks(&[(A, file)]), &current, None, &source).is_ok());
}

#[test]
fn only_a_well_formed_reference_that_names_exactly_one_descriptor_resolves() {
    let (empty, source) = (blocks(&[]), digest(SOURCE));
    let current = vec![descriptor(1, SOURCE), descriptor(2, SOURCE)];
    for bad in [
        "colab-attachment:",
        "colab-attachment:zz",
        "colab-attachment:0000001",
        "colab-attachment:00000001A",
        "colab-attachment:00000003",
        "colab-attachment:00000001-0000-4000-8000-000000000009",
    ] {
        let next = blocks(&[(A, image(bad))]);
        assert_eq!(
            admit(&empty, &next, &current, None, &source),
            Err(Refusal::Attachment),
            "{bad}"
        );
    }
    // Two descriptors share a prefix: the short form names neither, the full ID names one.
    let twins = vec![
        descriptor(1, SOURCE),
        serde_json::from_value::<Descriptor>({
            let mut other = serde_json::to_value(descriptor(1, SOURCE)).unwrap();
            other["attachmentId"] = json!("00000001-0000-4000-8000-0000000000ff");
            other
        })
        .unwrap(),
    ];
    let short = blocks(&[(A, image("colab-attachment:00000001"))]);
    assert_eq!(
        admit(&empty, &short, &twins, None, &source),
        Err(Refusal::Attachment)
    );
    let full = blocks(&[(A, image(&reference(1)))]);
    assert!(admit(&empty, &full, &twins, None, &source).is_ok());
    // Anything that is not a colab-attachment reference is not judged here; the block schema's URL
    // rule decides what else a source may be.
    let others = blocks(&[
        (A, image("https://example.com/a.png")),
        (B, image("data:image/png;base64,AAAA")),
    ]);
    assert_eq!(admit(&empty, &others, &[], None, &source), Ok(None));
}

#[test]
fn a_reference_already_dangling_in_the_base_does_not_block_a_later_batch() {
    let source = digest(SOURCE);
    // A concurrent remove and insert can leave this on a merged page.
    let before = blocks(&[(A, image(&reference(7)))]);
    let next = blocks(&[
        (A, image(&reference(7))),
        (B, image("https://example.com/b.png")),
    ]);
    assert_eq!(admit(&before, &next, &[], None, &source), Ok(None));
    // Bringing it back from a tombstone shows it again, so it is judged like a new one.
    let mut tombstone = image(&reference(7));
    tombstone["deleted"] = json!(5);
    let hidden = blocks(&[(A, tombstone)]);
    assert_eq!(
        admit(&hidden, &before, &[], None, &source),
        Err(Refusal::Attachment)
    );
}

#[test]
fn a_change_may_not_remove_a_descriptor_a_live_block_still_shows() {
    let source = digest(SOURCE);
    let current = vec![descriptor(1, SOURCE), descriptor(2, SOURCE)];
    let showing = blocks(&[(A, image(&reference(1)))]);
    let detach = change(&[], &[id(1)]);
    assert_eq!(
        admit(&showing, &showing, &current, Some(&detach), &source),
        Err(Refusal::Attachment)
    );
    // By its short form too.
    let short = blocks(&[(A, image("colab-attachment:00000001"))]);
    assert_eq!(
        admit(&short, &short, &current, Some(&detach), &source),
        Err(Refusal::Attachment)
    );
    // An attachment no block shows detaches, and so does one whose block is deleted in the batch
    // or was deleted before it.
    let other = change(&[], &[id(2)]);
    let list = admit(&showing, &showing, &current, Some(&other), &source)
        .unwrap()
        .unwrap();
    assert_eq!(list.len(), 1);
    let mut gone = image(&reference(1));
    gone["deleted"] = json!(9);
    let deleted = blocks(&[(A, gone)]);
    assert!(admit(&showing, &deleted, &current, Some(&detach), &source).is_ok());
    assert!(admit(&deleted, &deleted, &current, Some(&detach), &source).is_ok());
    // Swapping a re-sealed descriptor in is fine when the batch also points the block at it.
    let swap = change(&[descriptor(3, SOURCE)], &[id(1)]);
    let moved = blocks(&[(A, image(&reference(3)))]);
    assert!(admit(&showing, &moved, &current, Some(&swap), &source).is_ok());
    assert_eq!(
        admit(&showing, &showing, &current, Some(&swap), &source),
        Err(Refusal::Attachment)
    );
}

#[test]
fn a_change_is_bound_to_the_source_and_each_id_is_judged_by_the_shared_rules() {
    let empty = blocks(&[]);
    let legacy = b"<p>old page</p>";
    // A descriptor sealed against another source is another page's.
    let stranger = change(&[descriptor(1, legacy)], &[]);
    assert_eq!(
        admit(&empty, &empty, &[], Some(&stranger), &digest(SOURCE)),
        Err(Refusal::Invalid)
    );
    // On a converted page the binding is the frozen legacy source.
    assert!(admit(&empty, &empty, &[], Some(&stranger), &digest(legacy)).is_ok());
    // Removing what the page does not hold is refused, not ignored.
    let absent = change(&[], &[id(9)]);
    assert_eq!(
        admit(&empty, &empty, &[], Some(&absent), &digest(SOURCE)),
        Err(Refusal::Invalid)
    );
    // An empty change is no change.
    assert_eq!(
        admit(
            &empty,
            &empty,
            &[],
            Some(&change(&[], &[])),
            &digest(SOURCE)
        ),
        Ok(None)
    );
}

/// The vectors the browser's `admitAttachments` runs too: a descriptor is the file's template with
/// the case's ID and the digest of the source it was sealed against.
#[test]
fn the_shared_vectors_agree() {
    let file: Value = serde_json::from_str(include_str!(
        "../../../../../contracts/vectors/block-attachments-v1.json"
    ))
    .unwrap();
    let make = |attachment: &str, source: &str| -> Descriptor {
        let mut value = file["descriptor"].clone();
        value["attachmentId"] = json!(attachment);
        value["source"]["sourceDigest"] = json!(hex(&digest(source.as_bytes())));
        value["signature"] = json!(values::encode_binary(&[1u8; 64]));
        serde_json::from_value(value).unwrap()
    };
    let strings = |value: &Value| -> Vec<String> {
        value
            .as_array()
            .into_iter()
            .flatten()
            .map(|id| id.as_str().unwrap().to_owned())
            .collect()
    };
    for case in file["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let source = case["source"].as_str().unwrap();
        let set_source = case
            .get("setSource")
            .and_then(Value::as_str)
            .unwrap_or(source);
        let current: Vec<Descriptor> = strings(&case["current"])
            .iter()
            .map(|id| make(id, source))
            .collect();
        let set: Vec<Descriptor> = strings(&case["set"])
            .iter()
            .map(|id| make(id, set_source))
            .collect();
        let remove = strings(&case["remove"]);
        let change = (!set.is_empty() || !remove.is_empty()).then(|| change(&set, &remove));
        let got = admit(
            &case["before"],
            &case["next"],
            &current,
            change.as_ref(),
            &digest(source.as_bytes()),
        );
        let expected = &case["expect"];
        match (&got, expected.get("refused").and_then(Value::as_str)) {
            (Err(Refusal::Attachment), Some("attachment")) => {}
            (Err(Refusal::Invalid), Some("invalid")) => {}
            (Ok(list), None) => {
                let ids = list.as_ref().map(|list| {
                    list.iter()
                        .map(|d| d.attachment_id.clone())
                        .collect::<Vec<_>>()
                });
                let want = (!expected["list"].is_null()).then(|| strings(&expected["list"]));
                assert_eq!(ids, want, "{name}");
            }
            _ => panic!("{name}: got {got:?}, wanted {expected}"),
        }
    }
}

/// What the sweep keeps: the descriptors a block that is on the page still references.
#[test]
fn the_sweep_keeps_what_a_block_on_the_page_references() {
    let file: Value = serde_json::from_str(include_str!(
        "../../../../../contracts/vectors/block-attachments-v1.json"
    ))
    .unwrap();
    for case in file["kept"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let ids = |value: &Value| -> Vec<String> {
            value
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap().to_owned())
                .collect()
        };
        let list: Vec<Descriptor> = ids(&case["current"])
            .iter()
            .map(|id| {
                let mut value = file["descriptor"].clone();
                value["attachmentId"] = json!(id);
                value["source"]["sourceDigest"] = json!(hex(&digest(SOURCE)));
                value["signature"] = json!(values::encode_binary(&[1u8; 64]));
                serde_json::from_value(value).unwrap()
            })
            .collect();
        let source = case["source"].as_str().unwrap();
        let got: Vec<String> = super::referenced(&case["blocks"], source, &list)
            .iter()
            .map(|d| d.attachment_id.clone())
            .collect();
        assert_eq!(got, ids(&case["expect"]), "{name}");
    }
}

/// The purge is what ends a deleted image's wait: after the epoch baseline drops the tombstone,
/// nothing references the descriptor, and the sweep's clock for its object can start.
#[test]
fn a_purged_tombstone_stops_keeping_its_descriptor() {
    const DAY: u64 = 86_400_000;
    let (deleted_at, now) = (1_700_000_000_000u64, 1_700_000_000_000u64 + 8 * DAY);
    let list = vec![descriptor(1, SOURCE)];
    let mut shown = image(&reference(1));
    shown["deleted"] = json!(deleted_at);
    let blocks = blocks(&[(A, shown)]);
    assert_eq!(
        super::referenced(&blocks, "", &list).len(),
        1,
        "before the purge"
    );
    let purged = crate::blocks::purge::purge(&blocks, now);
    assert!(
        super::referenced(&purged, "", &list).is_empty(),
        "after the purge"
    );
    // A tombstone younger than seven days survives it and keeps the descriptor.
    let recent = crate::blocks::purge::purge(&blocks, deleted_at + DAY);
    assert_eq!(super::referenced(&recent, "", &list).len(), 1);
}

/// The sweep's reference set for a converted page: while the `html` root holds the frozen legacy
/// source, every listed descriptor is kept (a revert needs its files, wherever its markup names
/// them), and a page whose root is empty narrows to its blocks (#6190).
#[test]
fn the_sweep_keeps_every_descriptor_of_a_converted_page() {
    use crate::attachments::unreferenced::kept_objects;
    let list = json!([descriptor(1, SOURCE), descriptor(2, SOURCE)]);
    let legacy = "<h1>Old</h1><button data-download=\"colab-attachment:x\">Get</button>";
    let kept = |source: &str, blocks: Option<&Value>| {
        let mut into = std::collections::BTreeSet::new();
        kept_objects(source, Some(&list), blocks, &mut into);
        into
    };
    let object = |n: u32| {
        list[(n - 1) as usize]["objectId"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let both = std::collections::BTreeSet::from([object(1), object(2)]);
    let none = blocks(&[]);
    assert_eq!(kept(legacy, Some(&none)), both, "no block references one");
    let shown = blocks(&[(A, image(&reference(2)))]);
    assert_eq!(kept(legacy, Some(&shown)), both, "beside a block's own");
    assert!(kept("", Some(&none)).is_empty(), "a page never converted");
    assert_eq!(
        kept("", Some(&shown)),
        [object(2)].into(),
        "narrows to blocks"
    );
    // An HTML page (no blocks value) keeps every listed descriptor.
    assert_eq!(kept(legacy, None), both);
}
