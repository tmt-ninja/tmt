//! One consistent read-only projection for rehydration; no reconciliation or GC.

use super::{CONTEXT_READ_WAIT, Storage, StorageError, bindings::BindingRows, errors::classify};
use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use std::{
    path::Path,
    time::{Duration, Instant},
};
use tmt_core::{
    binding::{Binding, BindingEntry, BindingRecords},
    host::HostKind,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ContextWait {
    /// Existing 100 ms read-only cap for normal commands.
    Default,
    /// Normal hook: small 100 ms cap bounded by `deadline` less the completion reserve.
    Hook(Instant),
    /// Digest worker: waits out other writers up to `deadline` less the completion reserve.
    Worker(Instant),
}

impl ContextWait {
    fn duration(self, now: Instant) -> Duration {
        match self {
            Self::Default => CONTEXT_READ_WAIT,
            Self::Hook(deadline) => super::worker_writer_wait(deadline, now).min(CONTEXT_READ_WAIT),
            Self::Worker(deadline) => super::worker_writer_wait(deadline, now),
        }
    }

    fn deadline(self) -> Option<Instant> {
        match self {
            Self::Default => None,
            Self::Hook(deadline) | Self::Worker(deadline) => Some(deadline),
        }
    }
}

const ROLE_LIMIT: usize = 500;

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ContextRequests {
    pub originated: u64,
    pub incoming: u64,
}

#[derive(Debug)]
pub struct IdentityContextSnapshot {
    /// Stored evidence, not a claim of current presence. The caller must apply
    /// the core's pure binding evaluator to a fresh driver observation.
    pub entry: BindingEntry,
    /// Internal correlation only; never included in the rendered context.
    pub preferences: tmt_core::binding::session::SessionPreferences,
    pub role: Option<String>,
    pub role_truncated: bool,
    pub requests: ContextRequests,
}

impl Storage {
    /// Suppression-only selection: env locators and stored rows grant no
    /// admission. Missing, retired or ambiguous pane mappings skip discovery.
    pub fn caller_session_binding(
        path: &Path,
        caller: &crate::host::CallerEnvironment,
    ) -> Result<Option<Binding>, StorageError> {
        let locators = caller.pane_locators();
        if locators.is_empty() {
            return Ok(None);
        }
        let mut connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| classify(error, "Open caller binding precheck read-only"))?;
        connection
            .busy_timeout(Duration::ZERO)
            .map_err(|error| classify(error, "Disable caller binding precheck wait"))?;
        let transaction = connection
            .transaction()
            .map_err(|error| classify(error, "Read caller binding precheck snapshot"))?;
        super::migrations::require_current(&transaction)?;
        let mut selected = None;
        for (host, pane, socket) in locators {
            let mut statement = transaction
                .prepare(
                    "SELECT b.identity_id FROM bindings b JOIN identities i ON i.id = b.identity_id
                 WHERE i.retired_at_ms IS NULL AND b.transport = ?1 AND b.pane_id = ?2
                 AND (?3 IS NULL OR b.socket_path = ?3) LIMIT 2",
                )
                .map_err(|error| classify(error, "Prepare caller binding precheck"))?;
            let rows = statement
                .query_map(params![host.as_str(), pane, socket], |row| {
                    row.get::<_, String>(0)
                })
                .map_err(|error| classify(error, "Select caller binding precheck"))?;
            for row in rows {
                let id = row.map_err(|error| classify(error, "Decode caller binding precheck"))?;
                if selected.as_ref().is_some_and(|previous| previous != &id) {
                    return Ok(None);
                }
                selected = Some(id);
            }
        }
        selected.map_or(Ok(None), |id| {
            BindingRows(&transaction)
                .entry_by_id(&id)
                .map(|entry| entry.and_then(|entry| entry.binding))
        })
    }

    /// Scheduling only, for an external caller that has no pane locator:
    /// the sorted IDs of `host`'s stored bindings whose identity is not
    /// retired, whatever their runtime state. Empty skips discovery.
    pub fn caller_session_host_bindings(
        path: &Path,
        host: HostKind,
    ) -> Result<Vec<String>, StorageError> {
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| classify(error, "Open caller host precheck read-only"))?;
        connection
            .busy_timeout(Duration::ZERO)
            .map_err(|error| classify(error, "Disable caller host precheck wait"))?;
        super::migrations::require_current(&connection)?;
        let mut statement = connection
            .prepare(
                "SELECT b.id FROM bindings b JOIN identities i ON i.id = b.identity_id
             WHERE i.retired_at_ms IS NULL AND b.transport = ?1 ORDER BY b.id",
            )
            .map_err(|error| classify(error, "Prepare caller host precheck"))?;
        let rows = statement
            .query_map(params![host.as_str()], |row| row.get::<_, String>(0))
            .map_err(|error| classify(error, "Select caller host precheck"))?;
        rows.map(|row| row.map_err(|error| classify(error, "Decode caller host precheck")))
            .collect()
    }

    /// A no-effect shortcut for optional caller discovery, never binding or
    /// delivery authority. Only agreeing current observations can skip rediscovery.
    pub fn observes_provider_session(
        path: &Path,
        harness: &str,
        session: &str,
    ) -> Result<bool, StorageError> {
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| classify(error, "Open remembered session read-only"))?;
        connection
            .busy_timeout(Duration::ZERO)
            .map_err(|error| classify(error, "Disable optional session wait"))?;
        super::migrations::require_current(&connection)?;
        connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM identity_session_preferences p
             JOIN identities i ON i.id = p.identity_id
             JOIN bindings b ON b.identity_id = p.identity_id
             WHERE i.retired_at_ms IS NULL AND p.remembered_harness = ?1
             AND p.provider_session_id = ?2 AND b.runtime_state = 'running'
             AND b.runtime_pid IS NOT NULL AND b.runtime_start_identity IS NOT NULL
             AND b.observed_provider_session_id = p.provider_session_id)",
                params![harness, session],
                |row| row.get(0),
            )
            .map_err(|error| classify(error, "Check remembered session"))
    }

    /// Foreground sampling selects its already captured durable identity, then
    /// independently verifies the exact binding, session, owner and process.
    pub fn context_by_identity(
        path: &Path,
        identity: &str,
        now_ms: u64,
    ) -> Result<Option<IdentityContextSnapshot>, StorageError> {
        read_context(path, now_ms, |connection| {
            BindingRows(connection).entry_by_id(identity)
        })
    }

    /// Read-only selection by a driver's private enrollment locator. This is
    /// stored evidence only; the hook caller must still prove host, process,
    /// session and binding authority before context or persistence is permitted.
    pub fn context_by_binding(
        path: &Path,
        binding: &str,
        now_ms: u64,
        wait: ContextWait,
    ) -> Result<Option<IdentityContextSnapshot>, StorageError> {
        read_context_with_wait(path, now_ms, wait, |connection| {
            let identity: Option<String> = connection
                .query_row(
                    "SELECT identity_id FROM bindings WHERE id = ?",
                    [binding],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| classify(error, "Find enrolled binding context"))?;
            identity.map_or(Ok(None), |id| BindingRows(connection).entry_by_id(&id))
        })
    }

    /// No create, migration, permission changes, acknowledgment or retention
    /// writes. Missing/incompatible storage is an error for the caller to map
    /// to a quiet unavailable context, never an invitation to initialize it.
    pub fn context_by_pane(
        path: &Path,
        host: HostKind,
        pane: &str,
        server: &str,
        now_ms: u64,
    ) -> Result<Option<IdentityContextSnapshot>, StorageError> {
        Self::context_by_pane_until(path, host, pane, server, now_ms, ContextWait::Default)
    }

    /// Pane context projection bounded by the caller's hook or Digest worker wait.
    pub fn context_by_pane_until(
        path: &Path,
        host: HostKind,
        pane: &str,
        server: &str,
        now_ms: u64,
        wait: ContextWait,
    ) -> Result<Option<IdentityContextSnapshot>, StorageError> {
        read_context_with_wait(path, now_ms, wait, |connection| {
            BindingRows(connection).entry_by_pane(host, pane, server)
        })
    }

    /// Only current bound observations paired with the same driver's remembered
    /// session qualify. A historical preference alone cannot select a binding.
    /// Ambiguity returns no context; callers must still verify the stored host.
    pub fn context_by_provider_session(
        path: &Path,
        harness: &str,
        session: &str,
        now_ms: u64,
    ) -> Result<Option<IdentityContextSnapshot>, StorageError> {
        Self::context_by_provider_session_until(
            path,
            harness,
            session,
            now_ms,
            ContextWait::Default,
        )
    }

    /// Shared provider-session projection bounded by the caller's hook or Digest worker wait.
    pub fn context_by_provider_session_until(
        path: &Path,
        harness: &str,
        session: &str,
        now_ms: u64,
        wait: ContextWait,
    ) -> Result<Option<IdentityContextSnapshot>, StorageError> {
        read_context_with_wait(path, now_ms, wait, |connection| {
            sole_entry(
                connection,
                "SELECT b.identity_id FROM bindings b JOIN identities i ON i.id = b.identity_id
                 JOIN identity_session_preferences p ON p.identity_id = b.identity_id
                 WHERE i.retired_at_ms IS NULL
                   AND b.observed_provider_session_id = ?1
                   AND p.provider_session_id = ?1 AND p.remembered_harness = ?2 LIMIT 2",
                (session, harness),
            )
        })
    }

    /// Reads the bounded pane context snapshot on an already-open connection
    /// (for example, immediately after a hook transaction commits on it).
    pub fn context_by_pane_on_open(
        &mut self,
        host: HostKind,
        pane: &str,
        server_id: &str,
        now_ms: u64,
    ) -> Result<Option<IdentityContextSnapshot>, StorageError> {
        let transaction = self
            .connection_mut()?
            .transaction()
            .map_err(|error| classify(error, "Begin context read snapshot"))?;
        read_context_in_transaction(&transaction, now_ms, |connection| {
            BindingRows(connection).entry_by_pane(host, pane, server_id)
        })
    }

    /// The one saved, unretired identity whose remembered session for `harness` is `session`,
    /// bound or not: a restart leaves an identity unbound while it still remembers its session.
    /// A temporary or retired identity, another harness, or more than one match returns no
    /// context. The remembered session only selects a candidate; binding it stays the
    /// caller's verified decision.
    pub fn context_by_remembered_session(
        path: &Path,
        harness: &str,
        session: &str,
        now_ms: u64,
    ) -> Result<Option<IdentityContextSnapshot>, StorageError> {
        read_context(path, now_ms, |connection| {
            sole_entry(
                connection,
                "SELECT p.identity_id FROM identity_session_preferences p
                 JOIN identities i ON i.id = p.identity_id
                 WHERE i.retired_at_ms IS NULL AND i.lifetime = 'saved'
                   AND p.provider_session_id = ?1 AND p.remembered_harness = ?2 LIMIT 2",
                (session, harness),
            )
        })
    }
}

/// The entry of the single identity `select` (`?1` session, `?2` harness) names; none or
/// several return no entry.
fn sole_entry(
    connection: &Connection,
    select: &str,
    (session, harness): (&str, &str),
) -> Result<Option<BindingEntry>, StorageError> {
    let mut statement = connection
        .prepare(select)
        .map_err(|error| classify(error, "Find exact runtime mapping"))?;
    let ids = statement
        .query_map(params![session, harness], |row| row.get::<_, String>(0))
        .map_err(|error| classify(error, "Read exact runtime mappings"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| classify(error, "Decode exact runtime mapping"))?;
    match ids.as_slice() {
        [id] => BindingRows(connection).entry_by_id(id),
        _ => Ok(None),
    }
}

fn read_context(
    path: &Path,
    now_ms: u64,
    select: impl FnOnce(&Connection) -> Result<Option<BindingEntry>, StorageError>,
) -> Result<Option<IdentityContextSnapshot>, StorageError> {
    read_context_with_wait(path, now_ms, ContextWait::Default, select)
}

fn read_context_with_wait(
    path: &Path,
    now_ms: u64,
    wait_mode: ContextWait,
    select: impl FnOnce(&Connection) -> Result<Option<BindingEntry>, StorageError>,
) -> Result<Option<IdentityContextSnapshot>, StorageError> {
    let now = Instant::now();
    if wait_mode.deadline().is_some_and(|deadline| now >= deadline) {
        return Err(super::StorageError::new(
            super::StorageErrorCode::Busy,
            "Hook context budget is exhausted",
        )
        .hook_allowance_spent());
    }
    let wait = wait_mode.duration(now);
    let allowance = now + wait;
    let mut connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| classify(error, "Open context storage read-only"))?;
    connection
        .busy_timeout(wait)
        .map_err(|error| classify(error, "Bound context storage wait"))?;
    #[cfg(test)]
    super::hook_queue::first_busy::install(&connection);
    let result = (|| {
        let transaction = connection
            .transaction()
            .map_err(|error| classify(error, "Begin context read snapshot"))?;
        read_context_in_transaction(&transaction, now_ms, select)
    })();
    result.map_err(|error| super::spent_allowance(error, allowance))
}

fn read_context_in_transaction(
    transaction: &Connection,
    now_ms: u64,
    select: impl FnOnce(&Connection) -> Result<Option<BindingEntry>, StorageError>,
) -> Result<Option<IdentityContextSnapshot>, StorageError> {
    super::migrations::require_current(transaction)?;
    let Some(entry) = select(transaction)? else {
        return Ok(None);
    };
    let role = transaction
        .query_row(
            "SELECT content FROM role_profiles WHERE identity_id = ?",
            [&entry.identity.id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| classify(error, "Read context role"))?;
    let role_truncated = role
        .as_ref()
        .is_some_and(|text| text.chars().count() > ROLE_LIMIT);
    let role = role.map(|text| text.chars().take(ROLE_LIMIT).collect());
    let requests = requests(transaction, &entry.identity.id, now_ms)?;
    let preferences = BindingRows(transaction).session_preferences(&entry.identity.id)?;
    Ok(Some(IdentityContextSnapshot {
        entry,
        preferences,
        role,
        role_truncated,
        requests,
    }))
}

fn requests(
    connection: &Connection,
    identity: &str,
    now_ms: u64,
) -> Result<ContextRequests, StorageError> {
    let now = i64::try_from(now_ms).map_err(|_| {
        classify(
            rusqlite::Error::InvalidQuery,
            "Context retention cutoff out of range",
        )
    })?;
    // Match the two X list scopes, including both per-item and bulk acknowledgments.
    let originated = count(
        connection,
        identity,
        now,
        "a.originator_identity_id = ?1
         AND a.attention_acknowledged_revision < a.attention_revision
         AND COALESCE((SELECT acknowledged_through FROM request_attention_identities
                       WHERE identity_id = ?1), 0) < a.attention_revision",
    )?;
    let incoming = count(
        connection,
        identity,
        now,
        "a.recipient_identity_id = ?1 AND a.route_kind = 'inbox' AND a.status = 'queued'
         AND a.recipient_attention_acknowledged_revision < a.recipient_attention_revision
         AND COALESCE((SELECT acknowledged_through FROM request_recipient_attention_identities
                       WHERE identity_id = ?1), 0) < a.recipient_attention_revision",
    )?;
    Ok(ContextRequests {
        originated,
        incoming,
    })
}

fn count(
    connection: &Connection,
    identity: &str,
    now: i64,
    condition: &str,
) -> Result<u64, StorageError> {
    // Only counts enter context: no bodies, receipts or request IDs are loaded.
    let query = format!(
        "SELECT COUNT(*) FROM request_attempts AS a
         WHERE a.retention_expires_at_ms > ?2 AND ({condition})"
    );
    connection
        .query_row(&query, params![identity, now], |row| {
            u64::try_from(row.get::<_, i64>(0)?).map_err(|_| rusqlite::Error::InvalidQuery)
        })
        .map_err(|error| classify(error, "Read context request count"))
}

#[cfg(test)]
mod tests;
