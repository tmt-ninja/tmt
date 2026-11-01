//! Forward from the actual 088 predecessor; never edit a frozen archive.
use super::*;
use crate::{storage::Storage, test_support::TestDirectory};
#[test]
fn canonical_jobs_migrate_after_sending_without_rewriting_existing_records() {
    let d = TestDirectory::new();
    // The real predecessor includes migration 084's owner-only queue admission.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&d.path, std::fs::Permissions::from_mode(0o700)).unwrap();
    }
    let path = d.path.join("predecessor.db");
    let mut old = Connection::open(&path).unwrap();
    apply_through(&mut old, 88).unwrap();
    old.execute_batch("INSERT INTO identities(id,name,canonical_name,created_at,updated_at,lifetime) VALUES('11111111-1111-4111-8111-111111111111','Member','member','t','t','saved');
        INSERT INTO orchestration_settings VALUES(1,3,'UTC');
        INSERT INTO orchestration_decisions(recorded_ms,expires_ms,subject_kind,subject_id,actor_id,recipient_id,action,outcome,reason,configuration_revision,time_zone,sources)
        VALUES(1000,10000,'identity','11111111-1111-4111-8111-111111111111',NULL,'11111111-1111-4111-8111-111111111111','send','allowed','existing decision',3,'UTC','[]');").unwrap();
    old.execute_batch("INSERT INTO identities(id,name,canonical_name,created_at,updated_at,lifetime) VALUES('22222222-2222-4222-8222-222222222222','Other','other','t','t','saved');
        INSERT INTO orchestration_leads VALUES('11111111-1111-4111-8111-111111111111');
        INSERT INTO orchestration_route_grants VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',9000,'existing grant');
        INSERT INTO orchestration_talk_resumes VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',8000);
        INSERT INTO request_attempts(attempt_id,request_id,route_kind,identity_id,recipient_identity_id,wait_active,status,inject_preamble,cadence_reserved,prepared_at_ms,expires_at_ms)
        VALUES('attempt-existing','request-existing','inbox','22222222-2222-4222-8222-222222222222','22222222-2222-4222-8222-222222222222',0,'queued',0,0,1000,9007199254740991);
        INSERT INTO orchestration_talk_holds VALUES('request-existing','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222',7000);").unwrap();
    assert_eq!(
        old.query_row(
            "SELECT COUNT(*) FROM sqlite_schema WHERE name='request_history_pair'",
            [],
            |row| row.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    let sending = sending_records(&old);
    let bindings: String = old
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name='bindings'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(bindings.contains("plain_program"));
    let cursor: i64 = old
        .query_row("SELECT value FROM change_cursor WHERE id=1", [], |row| {
            row.get(0)
        })
        .unwrap();
    old.close().unwrap();
    let mut migrated = Storage::open(&path).unwrap();
    assert_eq!(migrated.health().unwrap().schema_version, 89);
    migrated.close().unwrap();
    let db = Connection::open(&path).unwrap();
    assert_eq!(
        sending_records(&db),
        sending,
        "jobs preserve sending records, indexes and triggers"
    );
    assert_eq!(
        db.query_row(
            "SELECT sql FROM sqlite_schema WHERE name='bindings'",
            [],
            |row| row.get::<_, String>(0)
        )
        .unwrap(),
        bindings
    );
    assert_eq!(
        db.query_row(
            "SELECT revision,time_zone FROM orchestration_settings",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        )
        .unwrap(),
        (3, "UTC".into())
    );
    assert_eq!(
        db.query_row(
            "SELECT reason,recorded_ms,expires_ms FROM orchestration_decisions",
            [],
            |row| Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?
            ))
        )
        .unwrap(),
        ("existing decision".into(), 1000, 10000)
    );
    assert_eq!(
        db.query_row("SELECT value FROM change_cursor WHERE id=1", [], |row| row
            .get::<_, i64>(
            0
        ))
        .unwrap(),
        cursor,
        "empty job tables do not invent a data change"
    );
    for table in [
        "orchestration_jobs",
        "orchestration_job_legacy",
        "orchestration_job_legacy_counters",
        "orchestration_job_imports",
        "orchestration_job_runs",
    ] {
        assert_eq!(
            db.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row
                .get::<_, i64>(0))
                .unwrap(),
            0,
            "{table}"
        );
    }
    assert_eq!(
        db.query_row("SELECT name FROM _migrations WHERE version=89", [], |row| {
            row.get::<_, String>(0)
        })
        .unwrap(),
        "create canonical agent jobs and legacy import receipts"
    );
    assert_eq!(
        db.query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))
            .unwrap(),
        "ok"
    );
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |row| {
            row.get::<_, i64>(0)
        })
        .unwrap(),
        0
    );
}

fn sending_records(db: &Connection) -> Vec<Vec<rusqlite::types::Value>> {
    let mut records = Vec::new();
    for sql in [
        "SELECT name,sql FROM sqlite_schema WHERE name='request_history_pair'",
        "SELECT * FROM orchestration_leads ORDER BY identity_id",
        "SELECT * FROM orchestration_route_grants ORDER BY from_id,to_id",
        "SELECT * FROM orchestration_talk_resumes ORDER BY first_id,second_id",
        "SELECT * FROM orchestration_talk_holds ORDER BY request_id",
        "SELECT name,sql FROM sqlite_schema WHERE tbl_name IN ('orchestration_leads','orchestration_route_grants','orchestration_talk_resumes','orchestration_talk_holds') ORDER BY name",
    ] {
        let mut query = db.prepare(sql).unwrap();
        let columns = query.column_count();
        records.extend(
            query
                .query_map([], |row| {
                    (0..columns)
                        .map(|column| row.get(column))
                        .collect::<rusqlite::Result<Vec<rusqlite::types::Value>>>()
                })
                .unwrap()
                .collect::<rusqlite::Result<Vec<_>>>()
                .unwrap(),
        );
    }
    records
}
