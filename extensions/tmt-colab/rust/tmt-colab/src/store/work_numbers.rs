//! Owner-local work numbers: allocated pairs are permanent display labels, never authority.
use super::{Fault, StoreResult};
use rusqlite::{Connection, OptionalExtension, params};

/// The empty project name is the space-wide W counter, not a user project.
const SPACE: &str = "";

fn suffix(mut index: usize) -> String {
    let mut result = String::new();
    while index > 0 {
        index -= 1;
        result.insert(0, (b'A' + (index % 26) as u8) as char);
        index /= 26;
    }
    result
}

fn available(connection: &Connection, prefix: &str) -> StoreResult<bool> {
    Ok(!connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM project_meta WHERE prefix=?)",
        [prefix],
        |row| row.get::<_, bool>(0),
    )?)
}

/// A project's first prefix uses its name's ASCII letters; collision suffixes are reproducible.
fn derived_prefix(connection: &Connection, name: &str) -> StoreResult<String> {
    let mut base: String = name
        .chars()
        .filter(char::is_ascii_alphabetic)
        .map(|c| c.to_ascii_uppercase())
        .take(6)
        .collect();
    if base.is_empty() || base == "W" {
        base = "P".into();
    }
    if available(connection, &base)? {
        return Ok(base);
    }
    // Legacy spaces can have up to PAGES names even though new spaces admit fewer.
    for index in 1..=crate::limits::PAGES + 1 {
        let suffix = suffix(index);
        let keep = 6usize.checked_sub(suffix.len()).ok_or(Fault::Capacity)?;
        let candidate = format!("{}{}", &base[..base.len().min(keep)], suffix);
        if available(connection, &candidate)? {
            return Ok(candidate);
        }
    }
    Err(Fault::Capacity)
}

pub(super) fn ensure_project(connection: &Connection, name: &str) -> StoreResult<()> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM project_meta WHERE name=?)",
        [name],
        |row| row.get(0),
    )?;
    if !exists {
        let prefix = if name == SPACE {
            "W".into()
        } else {
            derived_prefix(connection, name)?
        };
        connection.execute(
            "INSERT INTO project_meta(name,prefix) VALUES(?,?)",
            params![name, prefix],
        )?;
        connection.execute(
            "INSERT OR IGNORE INTO work_counters(prefix,next) VALUES(?,1)",
            [&prefix],
        )?;
    }
    Ok(())
}

pub(super) fn set_prefix(connection: &Connection, name: &str, prefix: &str) -> StoreResult<()> {
    if name == SPACE
        || prefix.is_empty()
        || prefix.len() > 6
        || prefix == "W"
        || !prefix.bytes().all(|byte| byte.is_ascii_uppercase())
    {
        return Err(Fault::Invalid);
    }
    let owner: Option<String> = connection
        .query_row(
            "SELECT name FROM project_meta WHERE prefix=?",
            [prefix],
            |row| row.get(0),
        )
        .optional()?;
    if owner.as_deref().is_some_and(|owner| owner != name) {
        return Err(Fault::Conflict);
    }
    if connection.execute(
        "UPDATE project_meta SET prefix=? WHERE name=?",
        params![prefix, name],
    )? != 1
    {
        return Err(Fault::Invalid);
    }
    connection.execute(
        "INSERT OR IGNORE INTO work_counters(prefix,next) VALUES(?,1)",
        [prefix],
    )?;
    Ok(())
}

/// This runs only in the owner's write transaction, never on a reader's page open.
pub(super) fn allocate(
    connection: &Connection,
    item: &str,
    project: Option<&str>,
) -> StoreResult<String> {
    if let Some((prefix, n)) = connection
        .query_row(
            "SELECT prefix,n FROM work_numbers WHERE item=?",
            [item],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?
    {
        return Ok(format!("{prefix}-{n}"));
    }
    let name = project.unwrap_or(SPACE);
    ensure_project(connection, name)?;
    let (prefix, mut n): (String, i64) = connection.query_row(
        "SELECT p.prefix,c.next FROM project_meta p JOIN work_counters c ON c.prefix=p.prefix WHERE p.name=?",
        [name],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    loop {
        let held: bool = connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM work_numbers WHERE prefix=? AND n=?)",
            params![prefix, n],
            |row| row.get(0),
        )?;
        if !held {
            break;
        }
        n = n.checked_add(1).ok_or(Fault::Capacity)?;
    }
    let next = n.checked_add(1).ok_or(Fault::Capacity)?;
    connection.execute(
        "INSERT INTO work_numbers(item,prefix,n) VALUES(?,?,?)",
        params![item, prefix, n],
    )?;
    connection.execute(
        "UPDATE work_counters SET next=? WHERE prefix=?",
        params![next, prefix],
    )?;
    Ok(format!("{prefix}-{n}"))
}

impl super::Store {
    /// Fill missing legacy to-do labels on the owner lifecycle, never on a reader request.
    pub fn backfill_todo_numbers(
        &mut self,
        key: &crate::keyring::Keyring,
        page: &str,
        blocks: &[String],
    ) -> crate::Result<()> {
        tmt_colab_model::values::generated_id(page)?;
        if blocks.len() > crate::limits::BLOCKS {
            return Err(Fault::Capacity.into());
        }
        for id in blocks {
            tmt_colab_model::values::generated_id(id)?;
        }
        self.project_transaction(&key.space_id, &key.owner_public(), |tx| {
            if tx.page_epoch(page)?.is_none() {
                return Err(super::owner::OwnerFault::Invalid.into());
            }
            tx.allocate_todo_numbers(page, blocks)
        })
    }
    /// An issued number, if this owner has allocated one for the item.
    pub fn work_number(&self, item: &str) -> StoreResult<Option<String>> {
        Ok(self
            .connection
            .query_row(
                "SELECT prefix,n FROM work_numbers WHERE item=?",
                [item],
                |row| {
                    Ok(format!(
                        "{}-{}",
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?
                    ))
                },
            )
            .optional()?)
    }
    /// The first canonical project that has an explicit release tag filter.
    pub fn release_tag_prefix_for_page(&self, page: &str) -> StoreResult<Option<String>> {
        Ok(self.connection.query_row(
            "SELECT m.release_tag_prefix FROM page_projects p JOIN project_meta m ON m.name=p.project WHERE p.page=? AND m.release_tag_prefix IS NOT NULL ORDER BY p.project LIMIT 1",
            [page],
            |row| row.get(0),
        ).optional()?)
    }
    pub fn release_tag_prefixes(&self) -> StoreResult<std::collections::BTreeMap<String, String>> {
        let mut query = self.connection.prepare(
            "SELECT name,release_tag_prefix FROM project_meta WHERE release_tag_prefix IS NOT NULL ORDER BY name",
        )?;
        let rows = query.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
    /// Immutable positive release ancestry evidence, retained across serve restarts.
    pub fn work_release_facts(&self, pr: &str) -> StoreResult<Vec<(String, String, u64)>> {
        let mut query = self.connection.prepare(
            "SELECT merge_sha,tag,observed_ms FROM work_release_facts WHERE pr=? ORDER BY tag,merge_sha",
        )?;
        let rows = query.query_map([pr], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })?;
        Ok(rows
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into_iter()
            .filter_map(|(sha, tag, at)| u64::try_from(at).ok().map(|at| (sha, tag, at)))
            .collect())
    }
    pub fn remember_work_release(
        &self,
        pr: &str,
        merge: &str,
        tag: &str,
        observed_ms: u64,
    ) -> StoreResult<()> {
        self.connection.execute(
            "INSERT OR IGNORE INTO work_release_facts(pr,merge_sha,tag,observed_ms) VALUES(?,?,?,?)",
            rusqlite::params![pr, merge, tag, i64::try_from(observed_ms).map_err(|_| super::Fault::Capacity)?],
        )?;
        Ok(())
    }
    pub fn work_release_comparison(
        &self,
        pr: &str,
        merge: &str,
        tag: &str,
    ) -> StoreResult<Option<bool>> {
        Ok(self
            .connection
            .query_row(
                "SELECT contains FROM work_release_checks WHERE pr=? AND merge_sha=? AND tag=?",
                rusqlite::params![pr, merge, tag],
                |row| row.get(0),
            )
            .optional()?)
    }
    pub fn remember_work_release_comparison(
        &self,
        pr: &str,
        merge: &str,
        tag: &str,
        contains: bool,
    ) -> StoreResult<()> {
        let inserted = self.connection.execute(
            "INSERT OR IGNORE INTO work_release_checks(pr,merge_sha,tag,contains) SELECT ?,?,?,? WHERE (SELECT COUNT(*) FROM work_release_checks) < 100000",
            rusqlite::params![pr, merge, tag, contains],
        )?;
        if inserted == 0 && self.work_release_comparison(pr, merge, tag)?.is_none() {
            return Err(super::Fault::Capacity);
        }
        Ok(())
    }
    /// Store only bounded owner-local display facts; a fingerprint prevents stale page data
    /// being attached to a newer admitted page.
    pub fn remember_work_status(
        &self,
        page: &str,
        fingerprint: &str,
        value: &serde_json::Value,
    ) -> StoreResult<()> {
        let value = serde_json::to_string(value).map_err(|_| super::Fault::Capacity)?;
        if value.len() > 32 * 1024 {
            return Err(super::Fault::Capacity);
        }
        self.connection.execute(
            "INSERT INTO work_status_cache(page,fingerprint,value) VALUES(?,?,?) ON CONFLICT(page) DO UPDATE SET fingerprint=excluded.fingerprint,value=excluded.value",
            rusqlite::params![page, fingerprint, value],
        )?;
        Ok(())
    }
    /// Share one verified fingerprint snapshot across a catalog read.
    pub fn work_status_fingerprints(
        &self,
        key: &crate::keyring::Keyring,
    ) -> crate::Result<std::collections::BTreeMap<String, String>> {
        let any: bool = self.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM work_status_cache)",
            [],
            |row| row.get(0),
        )?;
        if !any {
            return Ok(std::collections::BTreeMap::new());
        }
        self.owner_read(&key.space_id, &key.owner_public(), |tx| {
            tx.page_fingerprints()
        })
    }

    /// Current cached work display for CLI consumers; stale or malformed data is unknown.
    pub fn cached_work_status_with_fingerprints(
        &self,
        key: &crate::keyring::Keyring,
        page: &str,
        now: u64,
        fingerprints: Option<&std::collections::BTreeMap<String, String>>,
    ) -> crate::Result<Option<serde_json::Value>> {
        let cached: Option<(String, String)> = self
            .connection
            .query_row(
                "SELECT fingerprint,value FROM work_status_cache WHERE page=?",
                rusqlite::params![page],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        let Some((cached_fingerprint, raw)) = cached.filter(|(_, raw)| raw.len() <= 32 * 1024)
        else {
            return Ok(None);
        };
        let fingerprint = match fingerprints {
            Some(fingerprints) => fingerprints.get(page).cloned(),
            None => self.owner_read(&key.space_id, &key.owner_public(), |tx| {
                tx.page_fingerprint(page)
            })?,
        };
        if fingerprint.as_deref() != Some(cached_fingerprint.as_str()) {
            return Ok(None);
        }
        let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&raw) else {
            return Ok(None);
        };
        if value["pageId"] != page
            || !matches!(
                value["state"].as_str(),
                Some(
                    "done"
                        | "blocked"
                        | "needs-you"
                        | "waiting-ci"
                        | "waiting-release"
                        | "working"
                        | "possibly-stalled"
                        | "discussing"
                        | "unknown"
                )
            )
        {
            return Ok(None);
        }
        if matches!(
            value["state"].as_str(),
            Some("working" | "possibly-stalled")
        ) {
            let observed = value
                .pointer("/activity/observedAtMs")
                .and_then(serde_json::Value::as_u64);
            let last = value
                .pointer("/activity/lastActivityMs")
                .and_then(serde_json::Value::as_u64);
            value["state"] = if observed
                .is_none_or(|at| now < at || now - at >= crate::work_index::STALL_THRESHOLD_MS)
            {
                "unknown"
            } else if last
                .is_some_and(|at| now >= at && now - at >= crate::work_index::STALL_THRESHOLD_MS)
            {
                "possibly-stalled"
            } else {
                "working"
            }
            .into();
        }
        value["asOfMs"] = now.into();
        Ok(Some(value))
    }
}

/// Backfill from admitted log rows in revision order; unreadable rows do not block migration.
pub(super) fn backfill(connection: &Connection) -> StoreResult<()> {
    ensure_project(connection, SPACE)?;
    let projects: Vec<String> = {
        let mut query = connection.prepare("SELECT name FROM projects ORDER BY name")?;
        query
            .query_map([], |row| row.get(0))?
            .collect::<Result<_, _>>()?
    };
    for project in projects {
        ensure_project(connection, &project)?;
    }
    let owner: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM owner_state WHERE singleton=1)",
        [],
        |row| row.get(0),
    )?;
    if owner {
        let mut seen = std::collections::BTreeSet::new();
        let mut query =
            connection.prepare("SELECT envelope FROM membership_log ORDER BY revision")?;
        let mut rows = query.query([])?;
        while let Some(row) = rows.next()? {
            let Ok(bytes) = row.get::<_, Vec<u8>>(0) else {
                continue;
            };
            let Ok(payload) = super::owner::epoch::decoded_payload(&bytes) else {
                continue;
            };
            if let Some(page) = payload.page()
                && seen.insert(page.to_owned())
            {
                let exists: bool = connection.query_row(
                    "SELECT EXISTS(SELECT 1 FROM epoch_secrets WHERE page=?)",
                    [page],
                    |row| row.get(0),
                )?;
                if exists {
                    let project: Option<String> = connection.query_row("SELECT project FROM page_projects WHERE page=? ORDER BY project LIMIT 1", [page], |row| row.get(0)).optional()?;
                    allocate(connection, page, project.as_deref())?;
                }
            }
        }
        // Older imported pages can lack a page-scoped creation statement. Their relative creation
        // order is not retained; give them deterministic numbers after the readable history.
        let mut query = connection.prepare("SELECT p.page,(SELECT project FROM page_projects WHERE page=p.page ORDER BY project LIMIT 1) FROM pages p WHERE EXISTS(SELECT 1 FROM epoch_secrets e WHERE e.page=p.page) AND NOT EXISTS(SELECT 1 FROM work_numbers n WHERE n.item=p.page) ORDER BY p.page")?;
        let rows: Vec<(String, Option<String>)> = query
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
            .collect::<Result<_, _>>()?;
        for (page, project) in rows {
            allocate(connection, &page, project.as_deref())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_prefixes_resolve_collisions_and_names_without_letters() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(
            "CREATE TABLE project_meta(name TEXT PRIMARY KEY, prefix TEXT NOT NULL UNIQUE); CREATE TABLE work_counters(prefix TEXT PRIMARY KEY,next INTEGER NOT NULL)",
        ).unwrap();
        ensure_project(&connection, SPACE).unwrap();
        for name in ["Alpha team", "Alpha test", "東京"] {
            ensure_project(&connection, name).unwrap();
        }
        let prefix = |name| {
            connection
                .query_row(
                    "SELECT prefix FROM project_meta WHERE name=?",
                    [name],
                    |row| row.get::<_, String>(0),
                )
                .unwrap()
        };
        assert_eq!(prefix("Alpha team"), "ALPHAT");
        assert_eq!(prefix("Alpha test"), "ALPHAA");
        assert_eq!(prefix("東京"), "P");
    }

    #[test]
    fn issued_numbers_survive_prefix_changes_and_are_never_reused() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE project_meta(name TEXT PRIMARY KEY,prefix TEXT NOT NULL UNIQUE); CREATE TABLE work_counters(prefix TEXT PRIMARY KEY,next INTEGER NOT NULL); CREATE TABLE work_numbers(item TEXT PRIMARY KEY,prefix TEXT NOT NULL,n INTEGER NOT NULL,UNIQUE(prefix,n));").unwrap();
        ensure_project(&connection, SPACE).unwrap();
        ensure_project(&connection, "Alpha").unwrap();
        assert_eq!(
            allocate(&connection, "first", Some("Alpha")).unwrap(),
            "ALPHA-1"
        );
        set_prefix(&connection, "Alpha", "OTHER").unwrap();
        assert_eq!(
            allocate(&connection, "first", Some("Alpha")).unwrap(),
            "ALPHA-1"
        );
        assert_eq!(
            allocate(&connection, "second", Some("Alpha")).unwrap(),
            "OTHER-1"
        );
        set_prefix(&connection, "Alpha", "ALPHA").unwrap();
        assert_eq!(
            allocate(&connection, "third", Some("Alpha")).unwrap(),
            "ALPHA-2"
        );
        assert_eq!(allocate(&connection, "unassigned", None).unwrap(), "W-1");
        assert_eq!(
            allocate(&connection, "unassigned", Some("Alpha")).unwrap(),
            "W-1"
        );
    }
}
