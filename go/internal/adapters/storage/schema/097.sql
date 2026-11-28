-- Standalone command results. Display placement can outlive a member or room.
CREATE TABLE saved_terminals (
    terminal_id TEXT PRIMARY KEY NOT NULL CHECK (length(terminal_id) = 36),
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 9007199254740991),
    last_run_id TEXT NOT NULL UNIQUE CHECK (length(last_run_id) = 36),
    command TEXT NOT NULL CHECK (length(CAST(command AS BLOB)) BETWEEN 1 AND 4096),
    cwd TEXT NOT NULL CHECK (length(CAST(cwd AS BLOB)) BETWEEN 1 AND 4096),
    started_ms INTEGER NOT NULL CHECK (started_ms BETWEEN 0 AND 9007199254740991),
    ended_ms INTEGER NOT NULL CHECK (ended_ms BETWEEN started_ms AND 9007199254740991),
    exit_code INTEGER CHECK (exit_code BETWEEN 0 AND 255),
    signal INTEGER CHECK (signal BETWEEN 1 AND 255),
    timed_out INTEGER NOT NULL DEFAULT 0 CHECK (timed_out IN (0, 1)),
    truncated INTEGER NOT NULL DEFAULT 0 CHECK (truncated IN (0, 1)),
    stdout BLOB NOT NULL,
    stderr BLOB NOT NULL,
    room_id TEXT CHECK (length(room_id) = 36),
    member_id TEXT CHECK (length(member_id) = 36),
    -- A reserved socket ID survives an unconfirmed start. Its incarnation is
    -- filled only after the independent supervisor proves it started.
    shell_id TEXT UNIQUE CHECK (length(shell_id) = 38),
    shell_pid INTEGER CHECK (shell_pid > 0),
    shell_start TEXT CHECK (length(shell_start) BETWEEN 1 AND 256),
    CHECK (exit_code IS NULL OR signal IS NULL),
    CHECK (exit_code IS NOT NULL OR signal IS NOT NULL OR timed_out = 1 OR truncated = 1),
    CHECK (length(stdout) + length(stderr) <= 65536),
    CHECK ((shell_pid IS NULL) = (shell_start IS NULL)),
    CHECK (shell_id IS NOT NULL OR shell_pid IS NULL)
) STRICT;

CREATE TRIGGER saved_terminals_retention_bound BEFORE INSERT ON saved_terminals
WHEN (SELECT count(*) FROM saved_terminals) >= 64
BEGIN SELECT RAISE(ABORT, 'saved terminal retention limit'); END;

CREATE TRIGGER saved_terminals_advances_change_cursor_on_insert AFTER INSERT ON saved_terminals
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
CREATE TRIGGER saved_terminals_advances_change_cursor_on_update AFTER UPDATE ON saved_terminals
WHEN OLD.terminal_id IS NOT NEW.terminal_id OR OLD.revision IS NOT NEW.revision
 OR OLD.last_run_id IS NOT NEW.last_run_id OR OLD.command IS NOT NEW.command
 OR OLD.cwd IS NOT NEW.cwd OR OLD.started_ms IS NOT NEW.started_ms
 OR OLD.ended_ms IS NOT NEW.ended_ms OR OLD.exit_code IS NOT NEW.exit_code
 OR OLD.signal IS NOT NEW.signal OR OLD.timed_out IS NOT NEW.timed_out
 OR OLD.truncated IS NOT NEW.truncated OR OLD.stdout IS NOT NEW.stdout OR OLD.stderr IS NOT NEW.stderr
 OR OLD.room_id IS NOT NEW.room_id OR OLD.member_id IS NOT NEW.member_id
 OR OLD.shell_id IS NOT NEW.shell_id OR OLD.shell_pid IS NOT NEW.shell_pid
 OR OLD.shell_start IS NOT NEW.shell_start
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
CREATE TRIGGER saved_terminals_advances_change_cursor_on_delete AFTER DELETE ON saved_terminals
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
