//! The tombstone purge rule. A deleted block stays in the document (so history, comments and
//! `restore` keep working) until the page is compacted; compaction then drops the tombstones that
//! are no longer worth keeping, so a long-lived page never fills its block limit with deleted
//! blocks. A purged id is gone for good: any op that names it, `restore` included, is refused as
//! not found, never applied to something else.
//!
//! - A tombstone older than [`limits::BLOCK_UNDO_WINDOW_MS`] is dropped with its subtree (a card's
//!   children, a table's rows).
//! - A page over [`limits::BLOCKS_PURGE_ABOVE`] blocks also drops the oldest remaining tombstones
//!   (with their subtrees) until it is at or under that count, or none are left.
use crate::limits;
use serde_json::{Map, Value};
use std::collections::BTreeSet;

fn deleted(block: &Value) -> Option<u64> {
    block.get("deleted").and_then(Value::as_u64)
}

/// `root` and everything under it.
fn subtree<'a>(all: &'a Map<String, Value>, root: &'a str, gone: &mut BTreeSet<&'a str>) {
    let mut stack = vec![root];
    while let Some(id) = stack.pop() {
        if gone.insert(id) {
            stack.extend(
                all.iter()
                    .filter(|(_, b)| b["parent"] == id)
                    .map(|(key, _)| key.as_str()),
            );
        }
    }
}

/// `blocks` without the blocks the rule drops, as of `now` (milliseconds).
pub fn purge(blocks: &Value, now: u64) -> Value {
    let Some(all) = blocks.as_object() else {
        return blocks.clone();
    };
    let mut gone: BTreeSet<&str> = BTreeSet::new();
    for (id, block) in all {
        if deleted(block).is_some_and(|at| now.saturating_sub(at) > limits::BLOCK_UNDO_WINDOW_MS) {
            subtree(all, id, &mut gone);
        }
    }
    if all.len() - gone.len() > limits::BLOCKS_PURGE_ABOVE {
        let mut tombstones: Vec<(u64, &str)> = all
            .iter()
            .filter(|(id, block)| deleted(block).is_some() && !gone.contains(id.as_str()))
            .map(|(id, block)| (deleted(block).unwrap_or_default(), id.as_str()))
            .collect();
        tombstones.sort_unstable();
        for (_, id) in tombstones {
            if all.len() - gone.len() <= limits::BLOCKS_PURGE_ABOVE {
                break;
            }
            subtree(all, id, &mut gone);
        }
    }
    Value::Object(
        all.iter()
            .filter(|(id, _)| !gone.contains(id.as_str()))
            .map(|(id, block)| (id.clone(), block.clone()))
            .collect::<Map<_, _>>(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn bid(n: u32) -> String {
        format!("10000000-0000-4000-8000-{n:012}")
    }
    fn block(parent: &str, kind: &str, deleted: Option<u64>) -> Value {
        let mut block = json!({"type": kind, "parent": parent, "pos": "V", "props": {}});
        if kind == "paragraph" {
            block["text"] = json!({"s": "", "marks": []});
        }
        if kind == "row" {
            block["cells"] = json!({});
        }
        if let Some(at) = deleted {
            block["deleted"] = json!(at);
        }
        block
    }
    const DAY: u64 = 24 * 60 * 60 * 1000;

    #[test]
    fn an_old_tombstone_goes_with_its_subtree_and_a_young_one_stays() {
        let now = 100 * DAY;
        let doc = json!({
            bid(1): block("root", "card", Some(now - 8 * DAY)),
            bid(2): block(&bid(1), "paragraph", None),
            bid(3): block("root", "table", Some(now - 8 * DAY)),
            bid(4): block(&bid(3), "row", None),
            bid(5): block("root", "paragraph", Some(now - DAY)),
            bid(6): block("root", "paragraph", None),
        });
        let kept = purge(&doc, now);
        let ids: Vec<&str> = kept
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        assert_eq!(ids, [bid(5), bid(6)]);
        crate::blocks::schema::validate(&kept).unwrap();
        // The same page, a week earlier, loses nothing.
        assert_eq!(purge(&doc, now - 8 * DAY + DAY), doc);
    }

    #[test]
    fn a_page_over_three_quarters_full_drops_its_oldest_tombstones_first() {
        let now = 100 * DAY;
        let mut doc = serde_json::Map::new();
        let live = limits::BLOCKS_PURGE_ABOVE - 10;
        for i in 0..live {
            doc.insert(bid(i as u32 + 1), block("root", "paragraph", None));
        }
        // 30 recent tombstones, the oldest first by id.
        for i in 0..30u32 {
            doc.insert(
                bid(5000 + i),
                block("root", "paragraph", Some(now - 5 * DAY + u64::from(i))),
            );
        }
        let kept = purge(&Value::Object(doc), now);
        let kept = kept.as_object().unwrap();
        assert_eq!(kept.len(), limits::BLOCKS_PURGE_ABOVE);
        // Twenty were dropped, the oldest twenty; the ten youngest remain.
        assert!(!kept.contains_key(&bid(5000)) && !kept.contains_key(&bid(5019)));
        assert!(kept.contains_key(&bid(5020)) && kept.contains_key(&bid(5029)));
        assert!(kept.contains_key(&bid(1)));
    }

    #[test]
    fn live_blocks_are_never_purged_and_a_small_page_is_untouched() {
        let now = 100 * DAY;
        let doc = json!({bid(1): block("root", "paragraph", None), bid(2): block("root", "paragraph", Some(now))});
        assert_eq!(purge(&doc, now + 6 * DAY), doc);
        let full: serde_json::Map<String, Value> = (0..limits::BLOCKS as u32)
            .map(|i| (bid(i + 1), block("root", "paragraph", None)))
            .collect();
        assert_eq!(
            purge(&Value::Object(full.clone()), now),
            Value::Object(full)
        );
    }
}
