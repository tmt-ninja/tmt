//! Which identities' usage changed since a usage cursor (#6364). Each usage trigger stamps
//! `usage_changes` with the cursor value its write moved to (schema 092), so this read costs
//! the changed identities, not the roster.

use super::{Storage, StorageError, errors::classify};

/// At most this many changed identities are answered; more is a reset.
pub const MAX_CHANGED: usize = 32;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsageChanges {
    /// The usage cursor the list is consistent with.
    pub usage: u64,
    /// The caller must do its full read: `since` is not a cursor this store can answer
    /// from, or more than `MAX_CHANGED` identities changed.
    pub reset: bool,
    /// Non-retired identities whose usage rows changed after `since`, in change order.
    pub identities: Vec<String>,
}

impl Storage {
    pub fn usage_changes(&mut self, since: u64) -> Result<UsageChanges, StorageError> {
        let transaction = self
            .connection_mut()?
            .transaction()
            .map_err(|e| classify(e, "Read usage changes"))?;
        let value = |sql: &str| {
            transaction
                .query_row(sql, [], |row| row.get::<_, i64>(0))
                .map(|value| u64::try_from(value).unwrap_or(0))
                .map_err(|e| classify(e, "Read usage cursor"))
        };
        let usage = value("SELECT value FROM usage_cursor WHERE id=1")?;
        let floor = value("SELECT value FROM usage_floor WHERE id=1")?;
        let reset = |usage| UsageChanges {
            usage,
            reset: true,
            identities: Vec::new(),
        };
        // A cursor ahead of this store, or from before its stamps began, cannot be answered.
        if since > usage || since < floor {
            return Ok(reset(usage));
        }
        let mut statement = transaction
            .prepare(
                "SELECT c.identity_id FROM usage_changes c JOIN identities i ON i.id=c.identity_id
                 WHERE i.retired_at_ms IS NULL AND c.usage_seq>?1
                 ORDER BY c.usage_seq, c.identity_id LIMIT ?2",
            )
            .map_err(|e| classify(e, "Read usage changes"))?;
        let identities = statement
            .query_map(
                rusqlite::params![
                    i64::try_from(since).unwrap_or(i64::MAX),
                    i64::try_from(MAX_CHANGED + 1).unwrap_or(i64::MAX)
                ],
                |row| row.get::<_, String>(0),
            )
            .map_err(|e| classify(e, "Read usage changes"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| classify(e, "Read usage changes"))?;
        if identities.len() > MAX_CHANGED {
            return Ok(reset(usage));
        }
        Ok(UsageChanges {
            usage,
            reset: false,
            identities,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Storage;

    struct World {
        _directory: crate::test_support::TestDirectory,
        _template: crate::storage::template_fixture::TemplateLease,
        storage: Storage,
    }

    fn world() -> World {
        let directory = crate::test_support::TestDirectory::new();
        let path = directory.path.join("usage.db");
        let template = crate::storage::template_fixture::place_migrated_database(&path);
        World {
            storage: Storage::open(&path).unwrap(),
            _directory: directory,
            _template: template,
        }
    }

    fn identity(storage: &mut Storage, name: &str) -> String {
        let id = tmt_core::identity::create_or_resolve(
            storage,
            name,
            tmt_core::identity::Lifetime::Saved,
        )
        .unwrap()
        .identity
        .id;
        storage.connection().unwrap().execute("INSERT INTO bindings(id,identity_id,transport,pane_id,server_id,socket_path,server_pid,server_start_time,pane_pid,bound_at,last_verified_at) VALUES(?1,?1,'tmux','%'||(SELECT count(*)+1 FROM bindings),'s','/tmp/s',10,'start',11,'t','t')",[&id]).unwrap();
        id
    }

    /// One sampler-owned write for `id`, as the sampler's source row write makes it.
    fn sample(storage: &Storage, id: &str) {
        storage.connection().unwrap().execute("INSERT INTO consumption_sources(identity_id,binding_id,driver,session) VALUES(?1,?1,'claude','s') ON CONFLICT(identity_id) DO UPDATE SET session=session||'x'",[id]).unwrap();
    }

    fn cursor(storage: &mut Storage) -> u64 {
        storage.usage_changes(0).unwrap().usage
    }

    #[test]
    fn one_sampler_write_answers_exactly_that_identity_and_nothing_after() {
        let mut world = world();
        let (a, b) = (
            identity(&mut world.storage, "A"),
            identity(&mut world.storage, "B"),
        );
        sample(&world.storage, &a);
        sample(&world.storage, &b);
        let since = cursor(&mut world.storage);
        sample(&world.storage, &a);
        let changed = world.storage.usage_changes(since).unwrap();
        assert_eq!(
            (changed.reset, changed.identities.clone()),
            (false, vec![a])
        );
        assert!(changed.usage > since);
        let unchanged = world.storage.usage_changes(changed.usage).unwrap();
        assert_eq!(
            (unchanged.reset, unchanged.identities, unchanged.usage),
            (false, vec![], changed.usage)
        );
    }

    #[test]
    fn a_cursor_ahead_of_the_store_or_before_its_stamps_resets() {
        let mut world = world();
        let a = identity(&mut world.storage, "A");
        sample(&world.storage, &a);
        let now = cursor(&mut world.storage);
        let ahead = world.storage.usage_changes(now + 1).unwrap();
        assert_eq!(
            (ahead.reset, ahead.identities.len(), ahead.usage),
            (true, 0, now)
        );
        world
            .storage
            .connection()
            .unwrap()
            .execute(
                "UPDATE usage_floor SET value=?1",
                [i64::try_from(now).unwrap()],
            )
            .unwrap();
        assert!(world.storage.usage_changes(now - 1).unwrap().reset);
        assert!(!world.storage.usage_changes(now).unwrap().reset);
    }

    #[test]
    fn more_changed_identities_than_one_answer_holds_resets() {
        let mut world = world();
        let ids: Vec<_> = (0..=MAX_CHANGED)
            .map(|n| identity(&mut world.storage, &format!("M{n}")))
            .collect();
        for id in &ids[..MAX_CHANGED] {
            sample(&world.storage, id);
        }
        assert_eq!(
            world.storage.usage_changes(0).unwrap().identities.len(),
            MAX_CHANGED
        );
        sample(&world.storage, &ids[MAX_CHANGED]);
        let over = world.storage.usage_changes(0).unwrap();
        assert!(over.reset && over.identities.is_empty());
    }

    #[test]
    fn a_retired_identity_is_not_answered() {
        let mut world = world();
        let (a, b) = (
            identity(&mut world.storage, "A"),
            identity(&mut world.storage, "B"),
        );
        sample(&world.storage, &a);
        sample(&world.storage, &b);
        world
            .storage
            .connection()
            .unwrap()
            .execute("UPDATE identities SET retired_at_ms=1 WHERE id=?1", [&a])
            .unwrap();
        assert_eq!(world.storage.usage_changes(0).unwrap().identities, vec![b]);
    }
}
