//! The short form of an attachment reference (`colab-attachment:` and 8 lowercase hex digits)
//! names the one descriptor whose ID starts with them. Adding a descriptor can make a short
//! reference that already names one descriptor name two, and its image then draws the error
//! state (#6201). This is the one rule that finds such prefixes; a page of blocks applies it to
//! its live references and an HTML save to the references of the source it saves.
use std::collections::BTreeSet;
use tmt_colab_model::attachment::Descriptor;

/// The 8-hex prefixes that name exactly one descriptor of `before` and several of `after`: the
/// ones a change made ambiguous. A prefix two descriptors already shared is not new, and one that
/// no descriptor held before is not ambiguous by this change (nothing could have named it).
pub(crate) fn newly_shared(before: &[Descriptor], after: &[Descriptor]) -> BTreeSet<String> {
    let holders = |list: &[Descriptor], prefix: &str| {
        list.iter()
            .filter(|descriptor| descriptor.attachment_id.starts_with(prefix))
            .count()
    };
    after
        .iter()
        .filter_map(|descriptor| descriptor.attachment_id.get(..8))
        .filter(|prefix| holders(before, prefix) == 1 && holders(after, prefix) > 1)
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn descriptor(id: &str) -> Descriptor {
        serde_json::from_value(json!({
            "version": 1,
            "attachmentId": id,
            "space": "a".repeat(32),
            "page": "20000000-0000-4000-8000-000000000091",
            "epoch": "1",
            "namespace": "content",
            "objectId": "a".repeat(64),
            "authorDevice": "20000000-0000-4000-8000-000000000093",
            "membershipRevision": "1",
            "source": {"kind": "document", "sourceDigest": "b".repeat(64)},
            "envelopeHash": "c".repeat(64),
            "signature": tmt_colab_model::values::encode_binary(&[1u8; 64]),
            "payloadSha256": "d".repeat(64),
            "payloadBytes": "10",
            "plaintextBytes": "5",
            "filename": "a.png",
            "mediaType": "image/png",
        }))
        .unwrap()
    }
    const ONE: &str = "00000001-0000-4000-8000-000000000001";
    const TWIN: &str = "00000001-0000-4000-8000-0000000000ff";
    const OTHER: &str = "00000002-0000-4000-8000-000000000002";

    #[test]
    fn only_a_prefix_one_descriptor_held_and_several_now_hold_is_new() {
        let (one, twin, other) = (descriptor(ONE), descriptor(TWIN), descriptor(OTHER));
        let shared = |before: &[Descriptor], after: &[Descriptor]| -> Vec<String> {
            newly_shared(before, after).into_iter().collect()
        };
        // A twin joins the one holder: its prefix is newly shared.
        assert_eq!(
            shared(std::slice::from_ref(&one), &[one.clone(), twin.clone()]),
            ["00000001"]
        );
        // A prefix two descriptors already shared, one nobody held, and an unrelated set are not.
        assert!(
            shared(
                &[one.clone(), twin.clone()],
                &[one.clone(), twin.clone(), other.clone()]
            )
            .is_empty()
        );
        assert!(shared(&[], &[one.clone(), twin.clone()]).is_empty());
        assert!(shared(std::slice::from_ref(&one), &[one.clone(), other.clone()]).is_empty());
        // Swapping the holder for its twin keeps the prefix unambiguous.
        assert!(shared(&[one], &[twin]).is_empty());
    }
}
