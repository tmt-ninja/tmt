-- An interrupted receipt wait keeps its conservative terminal outcome on disk.
ALTER TABLE request_attempts ADD COLUMN receipt_deadline_ms INTEGER
    CHECK (receipt_deadline_ms IS NULL OR (receipt_deadline_ms > 0 AND wake_state='uncertain'));

CREATE TRIGGER request_receipt_deadline_advances_change_cursor AFTER UPDATE OF receipt_deadline_ms ON request_attempts
WHEN OLD.receipt_deadline_ms IS NOT NEW.receipt_deadline_ms AND OLD.wake_state IS NEW.wake_state
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
