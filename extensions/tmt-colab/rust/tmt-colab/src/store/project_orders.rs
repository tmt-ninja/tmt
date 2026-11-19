//! Owner-local project ranking. Work keys use the same page or page:block form as work numbers.
use super::{Fault, StoreResult};
use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectOrder {
    pub revision: i64,
    pub items: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Position {
    Before(String),
    Last,
    Unrank,
}

/// Missing observations are different from known deleted, completed or moved items. Never
/// permanently discard a rank because a page is waiting for a fold.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Membership {
    Open,
    Gone,
    Unknown,
}

#[derive(Debug, PartialEq, Eq)]
pub enum MoveOutcome {
    Saved(ProjectOrder),
    Conflict(ProjectOrder),
}

fn load(connection: &Connection, project: &str) -> StoreResult<ProjectOrder> {
    let (revision, json): (i64, String) = connection
        .query_row(
            "SELECT order_revision,order_items FROM project_meta WHERE name=? AND name<>''",
            [project],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or(Fault::Invalid)?;
    let items = serde_json::from_str(&json).map_err(|_| Fault::Invalid)?;
    Ok(ProjectOrder { revision, items })
}

/// One owner-list snapshot supplies both project membership and the status displayed by Work home.
pub struct WorkMembership<'a>(BTreeMap<&'a str, &'a serde_json::Value>);

impl<'a> WorkMembership<'a> {
    pub fn from_catalog(catalog: &'a serde_json::Value) -> Self {
        Self(
            catalog["pages"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|row| Some((row["pageId"].as_str()?, row)))
                .collect(),
        )
    }

    pub fn label(&self, item: &str) -> serde_json::Value {
        let (page, block) = item
            .split_once(':')
            .map_or((item, None), |(p, b)| (p, Some(b)));
        let Some(row) = self.0.get(page) else {
            return serde_json::json!({"id":item,"number":null,"title":null});
        };
        if let Some(id) = block {
            let todo = row["summary"]["todos"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|todo| todo["id"] == id);
            return serde_json::json!({"id":item, "number":todo.map(|t| &t["number"]), "title":todo.map(|t| &t["text"])});
        }
        serde_json::json!({"id":item,"number":row["workNumber"],"title":row["title"]})
    }

    pub fn classify(&self, project: &str, item: &str) -> Membership {
        let (page, block) = item
            .split_once(':')
            .map_or((item, None), |(p, b)| (p, Some(b)));
        let Some(row) = self.0.get(page) else {
            return Membership::Gone;
        };
        if row["archived"] == true
            || !row["projects"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|p| p.as_str() == Some(project))
        {
            return Membership::Gone;
        }
        let summary = &row["summary"];
        if !summary.is_object() {
            return Membership::Unknown;
        }
        let Some(block) = block else {
            return if summary["status"] == "done" {
                Membership::Gone
            } else {
                Membership::Open
            };
        };
        let todos = summary["todos"].as_array();
        if let Some(todo) = todos
            .into_iter()
            .flatten()
            .find(|todo| todo["id"].as_str() == Some(block))
        {
            return if todo["checked"] == true || todo["number"].as_str().is_none() {
                Membership::Gone
            } else {
                Membership::Open
            };
        }
        if summary["todosOmitted"] == true
            || todos.is_some_and(|rows| rows.len() >= crate::limits::WORK_TODOS)
        {
            Membership::Unknown
        } else {
            Membership::Gone
        }
    }
}

impl ProjectOrder {
    pub fn visible(&self, membership: &impl Fn(&str) -> Membership) -> Self {
        Self {
            revision: self.revision,
            items: self
                .items
                .iter()
                .filter(|key| membership(key) == Membership::Open)
                .cloned()
                .collect(),
        }
    }
}

pub(super) fn move_item(
    tx: &Transaction<'_>,
    project: &str,
    revision: i64,
    item: &str,
    position: &Position,
    membership: impl Fn(&str) -> Membership,
) -> StoreResult<MoveOutcome> {
    let previous = load(tx, project)?;
    if previous.revision != revision {
        return Ok(MoveOutcome::Conflict(previous.visible(&membership)));
    }
    if membership(item) != Membership::Open {
        return Err(Fault::Invalid);
    }
    if matches!(position, Position::Before(anchor) if anchor == item && previous.items.iter().any(|key| key == item))
    {
        return Ok(MoveOutcome::Saved(previous.visible(&membership)));
    }
    let mut items: Vec<_> = previous
        .items
        .iter()
        .filter(|key| key.as_str() != item && membership(key) != Membership::Gone)
        .cloned()
        .collect();
    match position {
        Position::Unrank => {}
        Position::Last => items.push(item.to_owned()),
        Position::Before(anchor) => {
            if membership(anchor) != Membership::Open {
                return Err(Fault::Invalid);
            }
            let index = items
                .iter()
                .position(|key| key == anchor)
                .ok_or(Fault::Invalid)?;
            items.insert(index, item.to_owned());
        }
    }
    if items.len() > crate::limits::PROJECT_ORDER_ITEMS {
        return Err(Fault::Capacity);
    }
    if items == previous.items {
        return Ok(MoveOutcome::Saved(previous.visible(&membership)));
    }
    let revision = revision
        .checked_add(1)
        .filter(|n| *n <= 9_007_199_254_740_991)
        .ok_or(Fault::Capacity)?;
    let json = serde_json::to_string(&items).map_err(|_| Fault::Invalid)?;
    tx.execute(
        "UPDATE project_meta SET order_revision=?,order_items=? WHERE name=?",
        params![revision, json, project],
    )?;
    Ok(MoveOutcome::Saved(
        ProjectOrder { revision, items }.visible(&membership),
    ))
}

impl super::Store {
    pub fn has_project(&self, name: &str) -> StoreResult<bool> {
        Ok(self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM project_meta WHERE name=? AND name<>'')",
            [name],
            |row| row.get(0),
        )?)
    }

    pub fn project_order(&self, name: &str) -> StoreResult<ProjectOrder> {
        load(&self.connection, name)
    }

    pub fn project_orders(&self) -> StoreResult<BTreeMap<String, ProjectOrder>> {
        let mut query = self.connection.prepare(
            "SELECT name,order_revision,order_items FROM project_meta WHERE name<>'' ORDER BY name",
        )?;
        let mut orders = BTreeMap::new();
        let mut rows = query.query([])?;
        while let Some(row) = rows.next()? {
            let json: String = row.get(2)?;
            orders.insert(
                row.get(0)?,
                ProjectOrder {
                    revision: row.get(1)?,
                    items: serde_json::from_str(&json).map_err(|_| Fault::Invalid)?,
                },
            );
        }
        Ok(orders)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_catalog_row_keeps_the_item_id_without_labels() {
        let catalog = serde_json::json!({"pages":[]});
        let membership = WorkMembership::from_catalog(&catalog);
        for id in ["missing", "missing:block"] {
            assert_eq!(
                membership.label(id),
                serde_json::json!({"id":id,"number":null,"title":null})
            );
        }
    }

    #[test]
    fn moves_refuse_stale_revisions_and_prune_done_items_on_write() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE project_meta(name TEXT PRIMARY KEY,order_revision INTEGER,order_items TEXT); INSERT INTO project_meta VALUES('p',1,'[\"a\",\"done\",\"cold\"]');").unwrap();
        let tx = db.transaction().unwrap();
        let membership = |key: &str| match key {
            "done" => Membership::Gone,
            "cold" => Membership::Unknown,
            _ => Membership::Open,
        };
        assert_eq!(
            move_item(&tx, "p", 0, "b", &Position::Last, membership).unwrap(),
            MoveOutcome::Conflict(ProjectOrder {
                revision: 1,
                items: vec!["a".into()]
            })
        );
        assert_eq!(load(&tx, "p").unwrap().items, ["a", "done", "cold"]);
        assert_eq!(
            move_item(&tx, "p", 1, "b", &Position::Before("a".into()), membership).unwrap(),
            MoveOutcome::Saved(ProjectOrder {
                revision: 2,
                items: vec!["b".into(), "a".into()]
            })
        );
        assert_eq!(load(&tx, "p").unwrap().items, ["b", "a", "cold"]);
    }
}
