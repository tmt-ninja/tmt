//! Core records for standalone command results and their independent shells.

use super::{Storage, StorageError, errors::classify, identities::commit_immediate_transaction};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

pub(crate) const SAVED_TERMINAL_LIMIT: u32 = 64;
pub(crate) const SAVED_OUTPUT_LIMIT: usize = 65_536;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub(crate) enum SavedPlacement {
    Local,
    Room {
        room_id: String,
    },
    Member {
        identity_id: String,
        room_id: Option<String>,
    },
}

impl SavedPlacement {
    fn ids(&self) -> (Option<&str>, Option<&str>) {
        match self {
            Self::Local => (None, None),
            Self::Room { room_id } => (Some(room_id), None),
            Self::Member {
                identity_id,
                room_id,
            } => (room_id.as_deref(), Some(identity_id)),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedCommandSummary {
    pub command: String,
    pub cwd: String,
    pub started_ms: u64,
    pub ended_ms: u64,
    pub exit_code: Option<i32>,
    pub signal: Option<i32>,
    pub timed_out: bool,
    pub truncated: bool,
}

#[derive(Debug)]
pub(crate) struct SavedCommandOutput {
    pub summary: SavedCommandSummary,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

#[derive(Debug, Clone, Eq, PartialEq)]
pub(crate) enum SavedShell {
    Reserved { id: String },
    Verified { id: String, pid: u64, start: String },
}

impl SavedShell {
    pub(crate) fn id(&self) -> &str {
        match self {
            Self::Reserved { id } | Self::Verified { id, .. } => id,
        }
    }
}

/// The result and shell have their own lifetimes. A placement is just the board parent.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedTerminalRecord {
    pub terminal_id: String,
    pub revision: u64,
    #[serde(flatten)]
    pub summary: SavedCommandSummary,
    pub placement: SavedPlacement,
    #[serde(skip)]
    pub shell: Option<SavedShell>,
}

#[derive(Debug)]
pub(crate) enum SavedTerminalError {
    Missing,
    Stale,
    PlacementMissing,
    Full,
    ShellOccupied,
    Storage(StorageError),
}

impl From<StorageError> for SavedTerminalError {
    fn from(error: StorageError) -> Self {
        Self::Storage(error)
    }
}

const METADATA: &str = "
 terminal_id, revision, command, cwd, started_ms, ended_ms, exit_code, signal, timed_out, truncated,
 CASE WHEN EXISTS (SELECT 1 FROM office_meeting_rooms r
                   WHERE r.room_id = s.room_id AND r.retired = 0)
      THEN room_id END,
 CASE WHEN EXISTS (SELECT 1 FROM identities i
                   WHERE i.id = s.member_id AND i.retired_at_ms IS NULL)
      AND CASE WHEN s.room_id IS NULL
               THEN NOT EXISTS (
                   SELECT 1 FROM office_meeting_members m
                   JOIN office_meeting_rooms r ON r.room_id = m.room_id AND r.retired = 0
                   WHERE m.identity_id = s.member_id)
               ELSE EXISTS (
                   SELECT 1 FROM office_meeting_members m
                   JOIN office_meeting_rooms r ON r.room_id = m.room_id AND r.retired = 0
                   WHERE m.room_id = s.room_id AND m.identity_id = s.member_id)
          END
      THEN member_id END,
 shell_id, shell_pid, shell_start";

fn metadata(row: &Row<'_>) -> rusqlite::Result<SavedTerminalRecord> {
    let room_id: Option<String> = row.get(10)?;
    let identity_id: Option<String> = row.get(11)?;
    let shell = match row.get::<_, Option<String>>(12)? {
        Some(id) => match row.get::<_, Option<i64>>(13)? {
            Some(pid) => Some(SavedShell::Verified {
                id,
                pid: pid.unsigned_abs(),
                start: row.get(14)?,
            }),
            None => Some(SavedShell::Reserved { id }),
        },
        None => None,
    };
    Ok(SavedTerminalRecord {
        terminal_id: row.get(0)?,
        revision: row.get::<_, i64>(1)?.unsigned_abs(),
        summary: SavedCommandSummary {
            command: row.get(2)?,
            cwd: row.get(3)?,
            started_ms: row.get::<_, i64>(4)?.unsigned_abs(),
            ended_ms: row.get::<_, i64>(5)?.unsigned_abs(),
            exit_code: row.get(6)?,
            signal: row.get(7)?,
            timed_out: row.get(8)?,
            truncated: row.get(9)?,
        },
        placement: match (room_id, identity_id) {
            (room_id, Some(identity_id)) => SavedPlacement::Member {
                identity_id,
                room_id,
            },
            (Some(room_id), None) => SavedPlacement::Room { room_id },
            (None, None) => SavedPlacement::Local,
        },
        shell,
    })
}

fn read(connection: &Connection, id: &str) -> Result<SavedTerminalRecord, SavedTerminalError> {
    connection
        .query_row(
            &format!("SELECT {METADATA} FROM saved_terminals s WHERE terminal_id = ?"),
            [id],
            metadata,
        )
        .optional()
        .map_err(|error| classify(error, "Read saved terminal"))?
        .ok_or(SavedTerminalError::Missing)
}

fn revision(terminal: &SavedTerminalRecord, expected: u64) -> Result<(), SavedTerminalError> {
    if terminal.revision == expected {
        Ok(())
    } else {
        Err(SavedTerminalError::Stale)
    }
}

fn placement_available(
    connection: &Connection,
    placement: &SavedPlacement,
) -> Result<bool, StorageError> {
    let (room, member) = placement.ids();
    connection
        .query_row(
            "SELECT
            (?1 IS NULL OR EXISTS (
                SELECT 1 FROM office_meeting_rooms WHERE room_id = ?1 AND retired = 0))
            AND (?2 IS NULL OR EXISTS (
                SELECT 1 FROM identities WHERE id = ?2 AND retired_at_ms IS NULL))
            AND (?2 IS NULL OR CASE WHEN ?1 IS NULL THEN NOT EXISTS (
                SELECT 1 FROM office_meeting_members m
                JOIN office_meeting_rooms r ON r.room_id = m.room_id AND r.retired = 0
                WHERE m.identity_id = ?2)
            ELSE EXISTS (
                SELECT 1 FROM office_meeting_members WHERE room_id = ?1 AND identity_id = ?2)
            END)",
            params![room, member],
            |row| row.get(0),
        )
        .map_err(|error| classify(error, "Check saved terminal placement"))
}

impl Storage {
    pub(crate) fn list_saved_terminals(&self) -> Result<Vec<SavedTerminalRecord>, StorageError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            &format!("SELECT {METADATA} FROM saved_terminals s ORDER BY ended_ms DESC, terminal_id LIMIT ?"),
        ).map_err(|error| classify(error, "List saved terminals"))?;
        statement
            .query_map([SAVED_TERMINAL_LIMIT], metadata)
            .and_then(Iterator::collect)
            .map_err(|error| classify(error, "List saved terminals"))
    }

    pub(crate) fn saved_terminal(
        &self,
        id: &str,
    ) -> Result<SavedTerminalRecord, SavedTerminalError> {
        read(self.connection()?, id)
    }

    pub(crate) fn saved_terminal_output(
        &self,
        id: &str,
    ) -> Result<(SavedTerminalRecord, Vec<u8>, Vec<u8>), SavedTerminalError> {
        self.connection()?
            .query_row(
                &format!(
                    "SELECT {METADATA}, stdout, stderr FROM saved_terminals s WHERE terminal_id = ?"
                ),
                [id],
                |row| Ok((metadata(row)?, row.get(15)?, row.get(16)?)),
            )
            .optional()
            .map_err(|error| classify(error, "Read saved terminal output"))?
            .ok_or(SavedTerminalError::Missing)
    }

    pub(crate) fn keep_saved_command(
        &mut self,
        id: &str,
        run_id: &str,
        expected: Option<u64>,
        placement: &SavedPlacement,
        output: &SavedCommandOutput,
    ) -> Result<SavedTerminalRecord, SavedTerminalError> {
        commit_immediate_transaction(self, "save terminal command result", |transaction| {
            let summary = &output.summary;
            let kept: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM saved_terminals WHERE terminal_id = ?1 AND last_run_id = ?2)",
                params![id, run_id],
                |row| row.get(0),
            ).map_err(|error| classify(error, "Check kept command"))?;
            if kept {
                return read(transaction, id);
            }

            if let Some(expected) = expected {
                revision(&read(transaction, id)?, expected)?;
                transaction
                    .execute(
                        "UPDATE saved_terminals SET revision = revision + 1, last_run_id = ?2,
                        started_ms = ?3, ended_ms = ?4, exit_code = ?5, signal = ?6,
                        timed_out = ?7, truncated = ?8, stdout = ?9, stderr = ?10
                     WHERE terminal_id = ?1",
                        params![
                            id,
                            run_id,
                            summary.started_ms as i64,
                            summary.ended_ms as i64,
                            summary.exit_code,
                            summary.signal,
                            summary.timed_out,
                            summary.truncated,
                            output.stdout,
                            output.stderr
                        ],
                    )
                    .map_err(|error| classify(error, "Update saved terminal result"))?;
            } else {
                let count: u32 = transaction
                    .query_row("SELECT count(*) FROM saved_terminals", [], |row| row.get(0))
                    .map_err(|error| classify(error, "Count saved terminals"))?;
                if count >= SAVED_TERMINAL_LIMIT {
                    return Err(SavedTerminalError::Full);
                }
                let initial = if placement_available(transaction, placement)? {
                    placement.clone()
                } else if let Some(room) = placement.ids().0 {
                    let room = SavedPlacement::Room {
                        room_id: room.into(),
                    };
                    if placement_available(transaction, &room)? {
                        room
                    } else {
                        SavedPlacement::Local
                    }
                } else {
                    SavedPlacement::Local
                };
                let (room, member) = initial.ids();
                transaction.execute(
                    "INSERT INTO saved_terminals (terminal_id, last_run_id, command, cwd, started_ms,
                        ended_ms, exit_code, signal, timed_out, truncated, stdout, stderr, room_id, member_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                    params![id, run_id, summary.command, summary.cwd, summary.started_ms as i64,
                        summary.ended_ms as i64, summary.exit_code, summary.signal, summary.timed_out,
                        summary.truncated, output.stdout, output.stderr, room, member],
                ).map_err(|error| classify(error, "Keep saved terminal result"))?;
            }
            read(transaction, id)
        })
    }

    pub(crate) fn move_saved_terminal(
        &mut self,
        id: &str,
        expected: u64,
        placement: &SavedPlacement,
    ) -> Result<SavedTerminalRecord, SavedTerminalError> {
        commit_immediate_transaction(self, "move saved terminal", |transaction| {
            revision(&read(transaction, id)?, expected)?;
            if !placement_available(transaction, placement)? {
                return Err(SavedTerminalError::PlacementMissing);
            }
            let (room, member) = placement.ids();
            transaction.execute(
                "UPDATE saved_terminals SET revision = revision + 1, room_id = ?2, member_id = ?3
                 WHERE terminal_id = ?1 AND (room_id IS NOT ?2 OR member_id IS NOT ?3)",
                params![id, room, member],
            ).map_err(|error| classify(error, "Move saved terminal"))?;
            read(transaction, id)
        })
    }

    /// Reserve the exact supervisor ID before spawning. Any uncertainty keeps the reservation.
    pub(crate) fn reserve_saved_shell(
        &mut self,
        id: &str,
        expected: u64,
        shell_id: &str,
    ) -> Result<SavedTerminalRecord, SavedTerminalError> {
        commit_immediate_transaction(self, "reserve saved terminal shell", |transaction| {
            let saved = read(transaction, id)?;
            revision(&saved, expected)?;
            if saved.shell.is_some() {
                return Err(SavedTerminalError::ShellOccupied);
            }
            transaction.execute(
                "UPDATE saved_terminals SET shell_id = ?2, revision = revision + 1 WHERE terminal_id = ?1",
                params![id, shell_id],
            ).map_err(|error| classify(error, "Reserve saved terminal shell"))?;
            read(transaction, id)
        })
    }

    /// Publish or clear a verified/reserved shell only if its exact lease is still held.
    pub(crate) fn finish_saved_shell(
        &mut self,
        id: &str,
        expected: &SavedShell,
        incarnation: Option<(u64, &str)>,
    ) -> Result<SavedTerminalRecord, SavedTerminalError> {
        commit_immediate_transaction(self, "finish saved terminal shell", |transaction| {
            let saved = read(transaction, id)?;
            if saved.shell.as_ref() != Some(expected) {
                return Err(SavedTerminalError::Stale);
            }
            let (pid, start) = incarnation.unzip();
            let shell_id = pid.map(|_| expected.id());
            transaction
                .execute(
                    "UPDATE saved_terminals SET shell_id = ?2, shell_pid = ?3, shell_start = ?4,
                    revision = revision + 1 WHERE terminal_id = ?1",
                    params![id, shell_id, pid.map(|pid| pid as i64), start],
                )
                .map_err(|error| classify(error, "Finish saved terminal shell"))?;
            read(transaction, id)
        })
    }

    pub(crate) fn remove_saved_terminal(
        &mut self,
        id: &str,
        expected: u64,
        closed: Option<&SavedShell>,
    ) -> Result<(), SavedTerminalError> {
        commit_immediate_transaction(self, "remove saved terminal", |transaction| {
            let saved = read(transaction, id)?;
            revision(&saved, expected)?;
            if saved.shell.as_ref() != closed {
                return Err(SavedTerminalError::ShellOccupied);
            }
            transaction
                .execute("DELETE FROM saved_terminals WHERE terminal_id = ?", [id])
                .map_err(|error| classify(error, "Remove saved terminal"))?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_saved_result_falls_back_when_its_display_parent_disappears() {
        let directory = crate::test_support::TestDirectory::new();
        let mut storage = Storage::open(directory.path.join("saved.db")).unwrap();
        let id = "11111111-1111-4111-8111-111111111111";
        let room = "22222222-2222-4222-8222-222222222222";
        let member = "33333333-3333-4333-8333-333333333333";
        storage
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO identities (id,name,canonical_name,created_at,updated_at,lifetime)
             VALUES (?1,'worker','worker','t','t','saved')",
                [member],
            )
            .unwrap();
        storage
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO office_meeting_rooms (room_id,name,revision) VALUES (?1,'product',1)",
                [room],
            )
            .unwrap();
        storage
            .connection()
            .unwrap()
            .execute(
                "INSERT INTO office_meeting_members (room_id,identity_id) VALUES (?1,?2)",
                [room, member],
            )
            .unwrap();
        let placement = SavedPlacement::Member {
            identity_id: member.into(),
            room_id: Some(room.into()),
        };
        let output = SavedCommandOutput {
            summary: SavedCommandSummary {
                command: "pwd".into(),
                cwd: "/work".into(),
                started_ms: 1,
                ended_ms: 2,
                exit_code: Some(0),
                signal: None,
                timed_out: false,
                truncated: false,
            },
            stdout: b"/work\n".to_vec(),
            stderr: vec![],
        };
        let saved = storage
            .keep_saved_command(id, id, None, &placement, &output)
            .unwrap();
        assert_eq!(saved.placement, placement);
        assert!(matches!(
            storage.move_saved_terminal(id, saved.revision + 1, &SavedPlacement::Local),
            Err(SavedTerminalError::Stale)
        ));
        storage
            .connection()
            .unwrap()
            .execute(
                "DELETE FROM office_meeting_members WHERE identity_id = ?1",
                [member],
            )
            .unwrap();
        assert_eq!(
            storage.saved_terminal(id).unwrap().placement,
            SavedPlacement::Room {
                room_id: room.into()
            },
        );
        storage
            .connection()
            .unwrap()
            .execute(
                "UPDATE office_meeting_rooms SET retired = 1 WHERE room_id = ?1",
                [room],
            )
            .unwrap();
        let (saved, stdout, stderr) = storage.saved_terminal_output(id).unwrap();
        assert_eq!(saved.placement, SavedPlacement::Local);
        assert_eq!(saved.summary.cwd, "/work");
        assert_eq!(stdout, output.stdout);
        assert_eq!(stderr, output.stderr);
    }
}
