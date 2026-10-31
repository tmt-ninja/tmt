//! A page's work value (`meta.work`, contract: Work): its direct sub-pages in order and its
//! two-line summary. No Yjs, storage, target lookup or authority. The admitted writer supplies
//! attribution, and which page may be listed (one parent, no loop, an available page) is the write
//! owner's admission over the whole space (`work_admission`), never a rule of this value.
//!
//! Version 2 is the shape every write produces. Version 1 is the task-era value (#5825): it is
//! still accepted as stored input and readers project its linked tasks as sub-pages. Only the
//! serve's `work.migrate`, after it has copied the whole value, rewrites it as version 2; every
//! other action on a version 1 value is refused, so its plain tasks are never dropped without a
//! copy.
use crate::closed::{Invalid, canonical, id, integer, keys, object, require, text};
use crate::summary_lines;
use serde_json::{Value, json};
use std::collections::BTreeSet;

use crate::limits::WORK_TASKS;
pub use crate::limits::{SUBPAGES, WORK_BYTES as DOCUMENT_BYTES};

type Result<T> = crate::closed::Result<T>;

/// The closed list actions. `subpage.create` makes a page and attaches it in one operation
/// (`page::subpage_create`), so it is not a value action.
pub const SUBPAGE_ACTIONS: [&str; 3] = ["subpage.attach", "subpage.detach", "subpage.move"];
pub const CREATE: &str = "subpage.create";
/// Rewrites a version 1 value as version 2 and changes nothing else.
pub const MIGRATE: &str = "work.migrate";

/// A stored value of either version.
pub fn validate(value: &Value) -> Result<()> {
    match integer(&value["version"])? {
        1 => validate_v1(value),
        2 => validate_v2(value),
        _ => Err(Invalid),
    }
}
fn validate_v2(value: &Value) -> Result<()> {
    keys(value, &["version", "order"], &["summary"])?;
    let order = value["order"].as_array().ok_or(Invalid)?;
    require(order.len() <= SUBPAGES)?;
    let mut seen = BTreeSet::new();
    for entry in order {
        require(seen.insert(id(entry)?))?;
    }
    if let Some(summary) = value.get("summary") {
        summary_lines::validate(summary)?;
    }
    require(canonical(value)?.len() <= DOCUMENT_BYTES)
}
/// The task-era value, checked only as far as reading and migrating it needs: its tasks and order
/// agree, a linked task names a page ID, and its summary is valid. It was checked in full when it
/// was written.
fn validate_v1(value: &Value) -> Result<()> {
    keys(value, &["version", "next", "tasks", "order"], &["summary"])?;
    integer(&value["next"])?;
    let tasks = object(&value["tasks"])?;
    let order = value["order"].as_array().ok_or(Invalid)?;
    require(tasks.len() <= WORK_TASKS && order.len() == tasks.len())?;
    let mut seen = BTreeSet::new();
    for entry in order {
        let key = text(entry)?;
        let task = tasks.get(key).ok_or(Invalid)?;
        require(seen.insert(key) && task.is_object())?;
        if let Some(child) = task.get("child") {
            id(child)?;
        }
    }
    if let Some(summary) = value.get("summary") {
        summary_lines::validate(summary)?;
    }
    require(canonical(value)?.len() <= DOCUMENT_BYTES)
}

/// A page that has had no work yet carries no `meta.work`; its first action starts from this.
pub fn empty() -> Value {
    json!({"version":2,"order":[]})
}

/// The direct sub-pages, in the page's order. A version 1 value reads its linked tasks in task
/// order, each page once, and its plain tasks not at all.
pub fn children(value: &Value) -> Result<Vec<String>> {
    validate(value)?;
    let order = value["order"].as_array().ok_or(Invalid)?;
    let mut found: Vec<String> = Vec::new();
    for entry in order {
        let page = if value["version"] == 1 {
            match value["tasks"][text(entry)?]["child"].as_str() {
                Some(child) => child,
                None => continue,
            }
        } else {
            text(entry)?
        };
        if !found.iter().any(|listed| listed == page) {
            found.push(page.to_owned());
        }
    }
    Ok(found)
}

/// Whether a stored value is task-era work that only `work.migrate` may rewrite.
pub fn is_legacy(value: &Value) -> bool {
    value["version"] == 1
}
/// The version 2 value of a stored value of either version: the same sub-pages and summary.
pub fn migrated(value: &Value) -> Result<Value> {
    let mut next = json!({"version":2,"order":children(value)?});
    if let Some(summary) = value.get("summary") {
        next["summary"] = summary.clone();
    }
    validate_v2(&next)?;
    Ok(next)
}

/// Produces a detached version 2 result or refuses the whole action; does not mutate the supplied
/// base. `attribution` comes from the write owner, never from the action body. `before` names a
/// listed page the moved or attached one goes in front of; without it the page goes last.
pub fn apply(base: &Value, action: &str, body: &Value, attribution: &Value) -> Result<Value> {
    require(action == MIGRATE || !is_legacy(base))?;
    let mut next = migrated(base)?;
    match action {
        "summary.set" => next["summary"] = summary_lines::set(body, attribution)?,
        "summary.clear" => {
            keys(body, &[], &[])?;
            next.as_object_mut().ok_or(Invalid)?.remove("summary");
        }
        MIGRATE => keys(body, &[], &[])?,
        "subpage.attach" | "subpage.move" | "subpage.detach" => {
            let mut order = children(&next)?;
            let page = id(&body["pageId"])?.to_owned();
            let listed = order.iter().position(|entry| *entry == page);
            if action == "subpage.detach" {
                keys(body, &["pageId"], &[])?;
                order.remove(listed.ok_or(Invalid)?);
            } else {
                keys(body, &["pageId"], &["before"])?;
                require(listed.is_some() == (action == "subpage.move"))?;
                if let Some(at) = listed {
                    order.remove(at);
                }
                let at = match body.get("before") {
                    Some(before) => {
                        let before = id(before)?;
                        require(before != page)?;
                        order
                            .iter()
                            .position(|entry| entry == before)
                            .ok_or(Invalid)?
                    }
                    None => order.len(),
                };
                order.insert(at, page);
            }
            next["order"] = json!(order);
        }
        _ => return Err(Invalid),
    }
    validate_v2(&next)?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_work_vectors() {
        let vectors: Value =
            serde_json::from_str(include_str!("../../../contracts/vectors/work-v2.json")).unwrap();
        for case in vectors["cases"].as_array().unwrap() {
            let base = case["document"].clone();
            let result = match case.get("action") {
                Some(action) => apply(
                    &base,
                    action.as_str().unwrap(),
                    &case["body"],
                    &case["attribution"],
                ),
                None => validate(&base).map(|()| base.clone()),
            };
            assert_eq!(
                result.is_ok(),
                case["valid"].as_bool().unwrap(),
                "{}: {result:?}",
                case["name"]
            );
            if let Some(expected) = case.get("expected") {
                assert_eq!(result.as_ref().unwrap(), expected, "{}", case["name"]);
            }
            if case["valid"] == true {
                let result = result.unwrap();
                assert_eq!(
                    String::from_utf8(canonical(&result).unwrap()).unwrap(),
                    case["canonical"].as_str().unwrap(),
                    "{}",
                    case["name"]
                );
                if let Some(expected) = case.get("children") {
                    assert_eq!(
                        &json!(children(&result).unwrap()),
                        expected,
                        "{}",
                        case["name"]
                    );
                }
            }
            assert_eq!(base, case["document"]);
        }
    }

    #[test]
    fn the_list_and_the_document_are_bounded() {
        let full: Vec<String> = (0..SUBPAGES)
            .map(|n| format!("20000000-0000-4000-8000-{n:012x}"))
            .collect();
        let value = json!({"version":2,"order":full});
        validate(&value).unwrap();
        let over = format!("20000000-0000-4000-8000-{SUBPAGES:012x}");
        assert!(
            apply(
                &value,
                "subpage.attach",
                &json!({"pageId":over}),
                &Value::Null
            )
            .is_err()
        );
        let mut tasks = serde_json::Map::new();
        let mut order = Vec::new();
        for n in 1..=WORK_TASKS + 1 {
            tasks.insert(format!("T-{n}"), json!({"title":"t","state":"todo"}));
            order.push(json!(format!("T-{n}")));
        }
        assert!(validate(&json!({"version":1,"next":1,"tasks":tasks,"order":order})).is_err());
    }

    /// Only the serve's migration rewrites task-era work: any other action would drop its plain
    /// tasks without the copy the migration takes first (#5825).
    #[test]
    fn a_task_era_value_takes_only_the_migration() {
        let child = "20000000-0000-4000-8000-00000000000a";
        let legacy = json!({
            "version":1,"next":3,"order":["T-1","T-2"],
            "tasks":{"T-1":{"title":"Plain","state":"todo"},"T-2":{"title":"Linked","state":"done","child":child}}
        });
        let attribution =
            json!({"writerId":"10000000-0000-4000-8000-000000000001","timeMs":1760000000000_u64});
        for (action, body) in [
            ("summary.set", json!({"line1":"Start","line2":"Next"})),
            ("summary.clear", json!({})),
            (
                "subpage.attach",
                json!({"pageId":"20000000-0000-4000-8000-00000000000b"}),
            ),
            ("subpage.move", json!({"pageId":child})),
            ("subpage.detach", json!({"pageId":child})),
        ] {
            assert!(is_legacy(&legacy));
            assert!(
                apply(&legacy, action, &body, &attribution).is_err(),
                "{action}"
            );
        }
        let migrated = apply(&legacy, MIGRATE, &json!({}), &Value::Null).unwrap();
        assert_eq!(migrated, json!({"version":2,"order":[child]}));
        // The same actions are admitted once the value is version 2.
        for (action, body) in [
            ("summary.set", json!({"line1":"Start","line2":"Next"})),
            (
                "subpage.attach",
                json!({"pageId":"20000000-0000-4000-8000-00000000000b"}),
            ),
            ("subpage.detach", json!({"pageId":child})),
        ] {
            apply(&migrated, action, &body, &attribution).unwrap();
        }
    }
}
