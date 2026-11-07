//! Question blocks register as an HTML page's `<tmt-question>` does: the batch that adds a question
//! block also adds its entry to the page's question registry (`meta.questions`), keyed by the block
//! ID, open, without an `agent` of its own (it follows the page's creator) and attributed to the
//! writer. Editing the block never touches the entry and deleting the block leaves it, as removing
//! a `<tmt-question>` from HTML does. The parent's preflight, the decoder's expected projection and
//! the child's replay all call this one function.
use super::ops::Refusal;
use crate::{limits, question_registry};
use serde_json::{Value, json};

/// The registry after `next` blocks are added to `before`, or `None` when no question block is new.
/// A page holds at most [`limits::QUESTION_PAGE`] registered questions.
pub fn register(
    meta: &Value,
    before: &Value,
    next: &Value,
    attribution: &Value,
) -> Result<Option<Value>, Refusal> {
    let (Some(before), Some(next)) = (before.as_object(), next.as_object()) else {
        return Ok(None);
    };
    let mut meta = meta.clone();
    let mut changed = false;
    for (id, block) in next {
        if block["type"] != "question" || before.contains_key(id) {
            continue;
        }
        let entries = meta["questions"].as_array();
        let known = entries.is_some_and(|entries| entries.iter().any(|entry| entry["id"] == *id));
        if !known && entries.map_or(0, Vec::len) >= limits::QUESTION_PAGE {
            return Err(Refusal::Capacity);
        }
        meta["questions"] = question_registry::apply_to_page(
            &meta,
            "question.add",
            &json!({ "id": id }),
            attribution,
        )
        .map_err(|_| Refusal::Invalid)?;
        changed = true;
    }
    Ok(changed.then(|| meta["questions"].clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "10000000-0000-4000-8000-000000000001";
    const B: &str = "10000000-0000-4000-8000-000000000002";

    fn attribution() -> Value {
        json!({"writerId": "30000000-0000-4000-8000-000000000001", "timeMs": 1_700_000_000_000u64})
    }
    fn blocks(items: &[(&str, &str)]) -> Value {
        let map: serde_json::Map<String, Value> = items
            .iter()
            .map(|(id, kind)| {
                (
                    (*id).to_owned(),
                    json!({"type": kind, "parent": "root", "pos": "V", "props": {}}),
                )
            })
            .collect();
        Value::Object(map)
    }

    #[test]
    fn a_new_question_block_is_registered_open_without_an_agent() {
        let next = blocks(&[(A, "question"), (B, "paragraph")]);
        let got = register(&json!({}), &blocks(&[]), &next, &attribution())
            .unwrap()
            .unwrap();
        assert_eq!(got.as_array().unwrap().len(), 1);
        assert_eq!(got[0]["id"], A);
        assert_eq!(got[0]["state"], "open");
        assert!(got[0].get("agent").is_none());
    }

    #[test]
    fn nothing_changes_for_other_blocks_or_a_question_already_there() {
        let both = blocks(&[(A, "question"), (B, "paragraph")]);
        assert_eq!(register(&json!({}), &both, &both, &attribution()), Ok(None));
        let only_text = blocks(&[(B, "paragraph")]);
        assert_eq!(
            register(&json!({}), &blocks(&[]), &only_text, &attribution()),
            Ok(None)
        );
    }

    #[test]
    fn a_registered_id_is_kept_and_a_full_registry_refuses() {
        let next = blocks(&[(A, "question")]);
        let mut meta = json!({"questions": []});
        let first = register(&meta, &blocks(&[]), &next, &attribution())
            .unwrap()
            .unwrap();
        meta["questions"] = first.clone();
        // The same id again (a purged block inserted anew) keeps its one entry.
        assert_eq!(
            register(&meta, &blocks(&[]), &next, &attribution())
                .unwrap()
                .unwrap(),
            first
        );
        let full: Vec<Value> = (0..limits::QUESTION_PAGE)
            .map(|n| {
                json!({"id": format!("20000000-0000-4000-8000-{n:012}"), "state": "open",
                       "attribution": attribution()})
            })
            .collect();
        let meta = json!({"questions": full});
        assert_eq!(
            register(&meta, &blocks(&[]), &next, &attribution()),
            Err(Refusal::Capacity)
        );
    }
}
