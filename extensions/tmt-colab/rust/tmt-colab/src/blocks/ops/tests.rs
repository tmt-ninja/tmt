use super::*;

fn bid(n: u32) -> String {
    format!("10000000-0000-4000-8000-{n:012}")
}
fn at() -> Value {
    json!({"timeMs": 1_700_000_000_000_u64})
}
fn run(base: &Value, ops: Value) -> Result<Applied> {
    apply(base, &json!({"ops": ops}), &at())
}
fn must(base: &Value, ops: Value) -> Applied {
    run(base, ops).unwrap()
}
fn insert(n: u32, kind: &str) -> Value {
    json!({"op": "insert", "id": bid(n), "type": kind})
}
fn empty() -> Value {
    schema::empty()
}
/// The ids of a parent's children in page order, tombstones included.
fn order(doc: &Value, parent: &str) -> Vec<String> {
    let mut kids: Vec<(&str, &str)> = doc
        .as_object()
        .unwrap()
        .iter()
        .filter(|(_, b)| b["parent"] == parent)
        .map(|(k, b)| (b["pos"].as_str().unwrap(), k.as_str()))
        .collect();
    kids.sort_unstable();
    kids.into_iter().map(|k| k.1.to_owned()).collect()
}

#[test]
fn a_page_is_built_by_inserts_and_keeps_its_order() {
    let a = must(
        &empty(),
        json!([
            {"op": "insert", "id": bid(1), "type": "heading", "props": {"level": 2}, "text": "Plan"},
            insert(2, "paragraph"),
            {"op": "insert", "id": bid(3), "type": "card", "props": {"title": "Notes"}},
            {"op": "insert", "id": bid(4), "type": "list", "parent": bid(3), "text": "one"},
            {"op": "insert", "id": bid(5), "type": "list", "parent": bid(3), "text": "two"},
            {"op": "insert", "id": bid(6), "type": "todo", "after": null},
        ]),
    );
    assert_eq!(order(&a.next, ROOT), [bid(6), bid(1), bid(2), bid(3)]);
    assert_eq!(order(&a.next, &bid(3)), [bid(4), bid(5)]);
    assert_eq!(a.next[bid(1)]["text"], json!({"s": "Plan", "marks": []}));
    assert_eq!(a.steps.len(), 6);
    assert_eq!(a.receipt["ops"][0], json!({"op": "insert", "id": bid(1)}));
    schema::validate(&a.next).unwrap();

    // After a named block, between two others.
    let b = must(
        &a.next,
        json!([{"op": "insert", "id": bid(7), "type": "paragraph", "after": bid(1)}]),
    );
    assert_eq!(
        order(&b.next, ROOT),
        [bid(6), bid(1), bid(7), bid(2), bid(3)]
    );
}

#[test]
fn inserts_are_refused_for_every_closed_rule() {
    let base = must(
        &empty(),
        json!([
            insert(1, "card"),
            insert(2, "paragraph"),
            insert(3, "table")
        ]),
    )
    .next;
    let refused = |op: Value, why: Refusal| assert_eq!(run(&base, json!([op])).unwrap_err(), why);
    refused(insert(1, "paragraph"), Refusal::Invalid); // id taken
    refused(insert(9, "row"), Refusal::Invalid); // rows come only from table add-row
    refused(insert(9, "banner"), Refusal::Invalid);
    refused(
        json!({"op": "insert", "id": bid(9), "type": "card", "parent": bid(1)}),
        Refusal::Invalid,
    );
    refused(
        json!({"op": "insert", "id": bid(9), "type": "paragraph", "parent": bid(2)}),
        Refusal::Invalid,
    );
    refused(
        json!({"op": "insert", "id": bid(9), "type": "paragraph", "parent": bid(77)}),
        Refusal::NotFound,
    );
    refused(
        json!({"op": "insert", "id": bid(9), "type": "paragraph", "after": bid(1), "parent": bid(1)}),
        Refusal::BadAfter,
    );
    refused(
        json!({"op": "insert", "id": bid(9), "type": "paragraph", "after": bid(77)}),
        Refusal::BadAfter,
    );
    refused(
        json!({"op": "insert", "id": bid(9), "type": "paragraph", "props": {"colour": "red"}}),
        Refusal::Invalid,
    );
    refused(
        json!({"op": "insert", "id": bid(9), "type": "heading", "props": {"level": 4}}),
        Refusal::Invalid,
    );
    refused(
        json!({"op": "insert", "id": bid(9), "type": "table", "text": "x"}),
        Refusal::Invalid,
    );
    refused(
        json!({"op": "insert", "id": bid(9), "type": "mockup"}),
        Refusal::Invalid,
    ); // no markup
    refused(
        json!({"op": "insert", "id": "not-an-id", "type": "paragraph"}),
        Refusal::Invalid,
    );
    refused(
        json!({"op": "insert", "id": bid(9), "type": "paragraph", "text": "bell\u{7}"}),
        Refusal::Invalid,
    );
    // One bad op refuses the batch, and the page is not touched.
    assert!(
        run(
            &base,
            json!([insert(8, "paragraph"), insert(1, "paragraph")])
        )
        .is_err()
    );
}

#[test]
fn a_full_page_refuses_more_blocks_as_capacity() {
    let mut doc = empty();
    for chunk in 0..8 {
        let ops: Vec<Value> = (0..256)
            .map(|i| insert(chunk * 256 + i + 1, "paragraph"))
            .collect();
        doc = must(&doc, json!(ops)).next;
    }
    assert_eq!(doc.as_object().unwrap().len(), limits::BLOCKS);
    assert_eq!(
        run(&doc, json!([insert(9000, "paragraph")])).unwrap_err(),
        Refusal::Capacity
    );
}

#[test]
fn move_re_parents_orders_and_keeps_the_subtree() {
    let base = must(
        &empty(),
        json!([
            insert(1, "card"),
            insert(2, "paragraph"),
            insert(3, "paragraph"),
            {"op": "insert", "id": bid(4), "type": "paragraph", "parent": bid(1)},
        ]),
    )
    .next;
    let moved = must(
        &base,
        json!([{"op": "move", "id": bid(3), "parent": bid(1), "after": null}]),
    );
    assert_eq!(order(&moved.next, &bid(1)), [bid(3), bid(4)]);
    assert_eq!(order(&moved.next, ROOT), [bid(1), bid(2)]);
    // Back to the page, ahead of the card: a card carries its children with it.
    let back = must(
        &moved.next,
        json!([
            {"op": "move", "id": bid(3), "parent": "root", "after": null},
            {"op": "move", "id": bid(1), "after": null},
        ]),
    );
    assert_eq!(order(&back.next, ROOT), [bid(1), bid(3), bid(2)]);
    assert_eq!(order(&back.next, &bid(1)), [bid(4)]);
    let refused = |op: Value, why: Refusal| assert_eq!(run(&base, json!([op])).unwrap_err(), why);
    refused(
        json!({"op": "move", "id": bid(1), "parent": bid(1)}),
        Refusal::Invalid,
    );
    refused(
        json!({"op": "move", "id": bid(2), "parent": bid(3)}),
        Refusal::Invalid,
    );
    refused(
        json!({"op": "move", "id": bid(2), "after": bid(4)}),
        Refusal::BadAfter,
    );
    refused(
        json!({"op": "move", "id": bid(2), "after": bid(2)}),
        Refusal::BadAfter,
    );
    refused(json!({"op": "move", "id": bid(77)}), Refusal::NotFound);
}

#[test]
fn props_set_and_unset_by_key_under_the_type_schema() {
    let base = must(&empty(), json!([insert(1, "todo")])).next;
    let a = must(
        &base,
        json!([{"op": "props", "id": bid(1), "set": {"checked": true, "due": "2026-11-30"}}]),
    );
    assert_eq!(
        a.next[bid(1)]["props"],
        json!({"checked": true, "due": "2026-11-30"})
    );
    let b = must(
        &a.next,
        json!([{"op": "props", "id": bid(1), "unset": ["due"], "set": {"indent": 2}}]),
    );
    assert_eq!(
        b.next[bid(1)]["props"],
        json!({"checked": true, "indent": 2})
    );
    for bad in [
        json!({"set": {"checked": "yes"}}),
        json!({"set": {"due": "30/11/2026"}}),
        json!({"set": {"indent": 3}}),
        json!({"set": {"nope": 1}}),
        json!({"set": {"indent": 1}, "unset": ["indent"]}),
        json!({}),
    ] {
        let mut op = json!({"op": "props", "id": bid(1)});
        op.as_object_mut()
            .unwrap()
            .extend(bad.as_object().unwrap().clone());
        assert_eq!(
            run(&base, json!([op])).unwrap_err(),
            Refusal::Invalid,
            "{bad}"
        );
    }
    assert_eq!(
        run(
            &base,
            json!([{"op": "props", "id": bid(2), "set": {"checked": true}}])
        )
        .unwrap_err(),
        Refusal::NotFound
    );
}

fn page_with_text(text: &str) -> Value {
    must(
        &empty(),
        json!([{"op": "insert", "id": bid(1), "type": "paragraph", "text": text}]),
    )
    .next
}
fn text_of(doc: &Value) -> String {
    doc[bid(1)]["text"]["s"].as_str().unwrap().to_owned()
}

#[test]
fn find_replace_needs_exactly_one_match() {
    let base = page_with_text("one two three");
    let a = must(
        &base,
        json!([{"op": "text", "id": bid(1), "replace": {"find": "two", "with": "2"}}]),
    );
    assert_eq!(text_of(&a.next), "one 2 three");
    assert_eq!(
        a.steps,
        [Step::Splice {
            id: bid(1),
            column: None,
            from: 4,
            to: 7,
            text: "2".into()
        }]
    );
    let run_find = |find: &str| {
        run(
            &base,
            json!([{"op": "text", "id": bid(1), "replace": {"find": find, "with": "x"}}]),
        )
    };
    assert_eq!(run_find("four").unwrap_err(), Refusal::TextNotFound);
    assert_eq!(run_find("e").unwrap_err(), Refusal::TextAmbiguous);
    assert_eq!(run_find("").unwrap_err(), Refusal::Invalid);
}

#[test]
fn whole_text_set_merges_with_what_the_page_holds_now() {
    let base = page_with_text("The quick brown fox jumps");
    // Someone else changed "brown" while the agent read the old text.
    let theirs = must(
        &base,
        json!([{"op": "text", "id": bid(1), "replace": {"find": "brown", "with": "red"}}]),
    )
    .next;
    let ops = json!([{"op": "text", "id": bid(1), "base": "The quick brown fox jumps", "set": "The quick brown fox leaps"}]);
    let merged = must(&theirs, ops);
    assert_eq!(text_of(&merged.next), "The quick red fox leaps");
    assert_eq!(merged.receipt["droppedHunks"], json!([]));
    // An overlap keeps the page's text and reports the agent's hunk.
    let ops = json!([{"op": "text", "id": bid(1), "base": "The quick brown fox jumps", "set": "The quick BROWN fox jumps"}]);
    let overlap = must(&theirs, ops);
    assert_eq!(text_of(&overlap.next), "The quick red fox jumps");
    assert_eq!(overlap.receipt["droppedHunks"][0]["id"], bid(1));
    assert!(overlap.steps.is_empty());
    assert_eq!(
        run(&base, json!([{"op": "text", "id": bid(1), "set": "x"}])).unwrap_err(),
        Refusal::Invalid
    ); // no base
}

#[test]
fn marks_are_set_cleared_and_split_by_an_edit() {
    let base = page_with_text("hello world");
    let a = must(
        &base,
        json!([
            {"op": "text", "id": bid(1), "format": {"from": 0, "to": 5, "mark": "bold", "value": true}},
            {"op": "text", "id": bid(1), "format": {"from": 6, "to": 11, "mark": "link", "value": "https://example.com/a"}},
        ]),
    );
    assert_eq!(
        a.next[bid(1)]["text"]["marks"],
        json!([
            {"from": 0, "to": 5, "mark": "bold"},
            {"from": 6, "to": 11, "mark": "link", "value": "https://example.com/a"}
        ])
    );
    // Typing inside a marked run splits it: the new text carries no mark.
    let b = must(
        &a.next,
        json!([{"op": "text", "id": bid(1), "replace": {"find": "ell", "with": "ELL"}}]),
    );
    assert_eq!(
        b.next[bid(1)]["text"]["marks"],
        json!([
            {"from": 0, "to": 1, "mark": "bold"},
            {"from": 4, "to": 5, "mark": "bold"},
            {"from": 6, "to": 11, "mark": "link", "value": "https://example.com/a"}
        ])
    );
    let c = must(
        &b.next,
        json!([{"op": "text", "id": bid(1), "format": {"from": 0, "to": 11, "mark": "link", "value": null}}]),
    );
    assert_eq!(c.next[bid(1)]["text"]["marks"].as_array().unwrap().len(), 2);
    for bad in [
        json!({"from": 0, "to": 12, "mark": "bold", "value": true}),
        json!({"from": 3, "to": 3, "mark": "bold", "value": true}),
        json!({"from": 0, "to": 4, "mark": "underline", "value": true}),
        json!({"from": 0, "to": 4, "mark": "link", "value": "javascript:alert(1)"}),
        json!({"from": 0, "to": 4, "mark": "bold", "value": "yes"}),
        json!({"from": 0, "to": 4, "mark": "agent", "value": true}),
    ] {
        assert_eq!(
            run(&base, json!([{"op": "text", "id": bid(1), "format": bad}])).unwrap_err(),
            Refusal::Invalid,
            "{bad}"
        );
    }
    // Code and question text carry no marks.
    let code = must(
        &empty(),
        json!([{"op": "insert", "id": bid(2), "type": "code", "text": "let x"}]),
    )
    .next;
    let marked = json!([{"op": "text", "id": bid(2), "format": {"from": 0, "to": 3, "mark": "bold", "value": true}}]);
    assert_eq!(run(&code, marked).unwrap_err(), Refusal::Invalid);
}

#[test]
fn delete_is_a_tombstone_and_restore_brings_it_back() {
    let base = must(
        &empty(),
        json!([insert(1, "paragraph"), insert(2, "paragraph")]),
    )
    .next;
    let gone = must(&base, json!([{"op": "delete", "id": bid(1)}]));
    assert_eq!(gone.next[bid(1)]["deleted"], 1_700_000_000_000_u64);
    assert_eq!(
        gone.steps,
        [Step::Delete {
            id: bid(1),
            at: 1_700_000_000_000
        }]
    );
    // Idempotent: nothing to replay the second time, and an edit of a deleted block still merges.
    assert!(
        must(&gone.next, json!([{"op": "delete", "id": bid(1)}]))
            .steps
            .is_empty()
    );
    must(
        &gone.next,
        json!([{"op": "props", "id": bid(1), "set": {"tone": "muted"}}]),
    );
    let back = must(&gone.next, json!([{"op": "restore", "id": bid(1)}]));
    assert!(back.next[bid(1)].get("deleted").is_none());
    assert!(
        must(&back.next, json!([{"op": "restore", "id": bid(1)}]))
            .steps
            .is_empty()
    );
    // A block that compaction purged is not found, restore included.
    assert_eq!(
        run(&base, json!([{"op": "restore", "id": bid(9)}])).unwrap_err(),
        Refusal::NotFound
    );
}

#[test]
fn tables_have_columns_rows_and_cells() {
    let col = |id: &str, name: &str| json!({"id": id, "name": name});
    let base = must(&empty(), json!([
        {"op": "insert", "id": bid(1), "type": "table", "props": {"columns": [col("a", "Name"), col("b", "State")]}},
    ])).next;
    let a = must(
        &base,
        json!([
            {"op": "table", "id": bid(1), "action": "add-row", "row": bid(10), "cells": {"a": "alpha"}},
            {"op": "table", "id": bid(1), "action": "add-row", "row": bid(11), "after": null, "cells": {"a": "zero", "b": "open"}},
            {"op": "table", "id": bid(1), "action": "set-cell", "row": bid(10), "column": "b", "text": "done"},
        ]),
    );
    assert_eq!(order(&a.next, &bid(1)), [bid(11), bid(10)]);
    assert_eq!(
        a.next[bid(10)]["cells"]["b"],
        json!({"s": "done", "marks": []})
    );
    assert_eq!(a.next[bid(10)]["type"], "row");
    assert!(a.steps.contains(&Step::Cell {
        id: bid(10),
        column: "b".into()
    }));
    // A cell edit merges like any text.
    let b = must(
        &a.next,
        json!([{"op": "table", "id": bid(1), "action": "set-cell", "row": bid(11), "column": "b", "base": "open", "text": "opened"}]),
    );
    assert_eq!(b.next[bid(11)]["cells"]["b"]["s"], "opened");
    let c = must(
        &b.next,
        json!([
            {"op": "table", "id": bid(1), "action": "add-column", "column": col("c", "Owner"), "after": "a"},
            {"op": "table", "id": bid(1), "action": "rename-column", "column": "b", "name": "Status"},
            {"op": "table", "id": bid(1), "action": "move-column", "column": "c", "after": null},
            {"op": "table", "id": bid(1), "action": "remove-row", "row": bid(10)},
        ]),
    );
    let names: Vec<&str> = c.next[bid(1)]["props"]["columns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| c["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["Owner", "Name", "Status"]);
    assert!(c.next[bid(10)].get("deleted").is_some());
    // Removing a column leaves cell text behind; it is still a valid page.
    let d = must(
        &c.next,
        json!([{"op": "table", "id": bid(1), "action": "remove-column", "column": "b"}]),
    );
    assert!(d.next[bid(11)]["cells"].get("b").is_some());
    let refused = |op: Value, why: Refusal| assert_eq!(run(&a.next, json!([op])).unwrap_err(), why);
    refused(
        json!({"op": "table", "id": bid(1), "action": "add-row", "row": bid(12), "cells": {"zzz": "x"}}),
        Refusal::Invalid,
    );
    refused(
        json!({"op": "table", "id": bid(1), "action": "add-row", "row": bid(12), "after": bid(99)}),
        Refusal::BadAfter,
    );
    refused(
        json!({"op": "table", "id": bid(1), "action": "add-column", "column": col("a", "Dup")}),
        Refusal::Invalid,
    );
    refused(
        json!({"op": "table", "id": bid(1), "action": "rename-column", "column": "q", "name": "x"}),
        Refusal::NotFound,
    );
    refused(
        json!({"op": "table", "id": bid(1), "action": "remove-row", "row": bid(1)}),
        Refusal::Invalid,
    );
    refused(
        json!({"op": "table", "id": bid(1), "action": "explode"}),
        Refusal::Invalid,
    );
    refused(
        json!({"op": "table", "id": bid(2), "action": "add-row", "row": bid(12)}),
        Refusal::NotFound,
    );
    // Rows can be deleted and restored like any block, and are never inserted as blocks.
    refused(
        json!({"op": "insert", "id": bid(12), "type": "row", "parent": bid(1)}),
        Refusal::Invalid,
    );
}

#[test]
fn a_batch_is_closed() {
    let base = empty();
    let attribution = at();
    for body in [
        json!({"ops": []}),
        json!({"ops": [{"op": "frobnicate"}]}),
        json!({"ops": [insert(1, "paragraph")], "extra": 1}),
        json!({"nops": []}),
    ] {
        assert!(apply(&base, &body, &attribution).is_err(), "{body}");
    }
    let many: Vec<Value> = (0..=limits::BLOCK_BATCH_OPS as u32)
        .map(|i| insert(i + 1, "paragraph"))
        .collect();
    assert_eq!(run(&base, json!(many)).unwrap_err(), Refusal::Capacity);
    assert!(apply(&base, &json!({"ops": [insert(1, "paragraph")]}), &json!({})).is_err()); // no time from the owner
    // Steps cross the decoder boundary as JSON and come back unchanged.
    let applied = must(&base, json!([insert(1, "paragraph"), {"op": "text", "id": bid(1), "replace": {"find": "", "with": ""}}]).as_array().unwrap()[..1].to_vec().into());
    for step in &applied.steps {
        assert_eq!(
            &serde_json::from_value::<Step>(serde_json::to_value(step).unwrap()).unwrap(),
            step
        );
    }
}
