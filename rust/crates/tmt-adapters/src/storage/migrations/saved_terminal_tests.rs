use super::{Connection, apply_through};
use crate::{storage::Storage, test_support::TestDirectory};

#[test]
fn saved_terminal_upgrade_preserves_prior_state_and_fences_retention_and_cursor() {
    let directory = TestDirectory::new();
    let path = directory.path.join("schema96.db");
    let mut connection = Connection::open(&path).unwrap();
    apply_through(&mut connection, 96).unwrap();
    let table_exists = |connection: &Connection| {
        connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'saved_terminals')",
            [],
            |row| row.get::<_, bool>(0),
        ).unwrap()
    };
    assert!(!table_exists(&connection));
    connection
        .execute("UPDATE change_cursor SET value = 41 WHERE id = 1", [])
        .unwrap();
    connection.close().unwrap();

    let storage = Storage::open(&path).unwrap();
    let connection = storage.connection().unwrap();
    assert!(
        table_exists(connection),
        "schema 96 must gain the saved-terminal table"
    );
    let start = storage.change_cursor().unwrap();
    assert_eq!(start, 41, "migration preserves existing cursor");
    let insert = |index: u32, output: Vec<u8>| {
        connection.execute(
            "INSERT INTO saved_terminals (
                terminal_id, last_run_id, command, cwd, started_ms, ended_ms, exit_code, stdout, stderr
            ) VALUES (?1, ?1, 'pwd', '/work', 5, 6, 0, ?2, X'00')",
            rusqlite::params![format!("00000000-0000-4000-8000-{index:012x}"), output],
        )
    };
    assert!(
        insert(0, vec![0; 65_536]).is_err(),
        "stdout and stderr share the same byte cap"
    );
    assert_eq!(storage.change_cursor().unwrap(), start);
    for index in 1..=64 {
        assert_eq!(insert(index, vec![0; 65_535]).unwrap(), 1);
    }
    assert!(
        insert(65, vec![]).is_err(),
        "the 65th result cannot evict a saved row"
    );
    assert_eq!(storage.change_cursor().unwrap(), start + 64);
    connection
        .execute(
            "UPDATE saved_terminals SET revision = revision WHERE ended_ms = 6",
            [],
        )
        .unwrap();
    assert_eq!(storage.change_cursor().unwrap(), start + 64);
    connection.execute("UPDATE saved_terminals SET revision = revision + 1 WHERE terminal_id = '00000000-0000-4000-8000-000000000001'", []).unwrap();
    assert_eq!(storage.change_cursor().unwrap(), start + 65);
    connection
        .execute("DELETE FROM saved_terminals WHERE revision = 2", [])
        .unwrap();
    assert_eq!(storage.change_cursor().unwrap(), start + 66);
    assert_eq!(insert(65, vec![]).unwrap(), 1);
}
