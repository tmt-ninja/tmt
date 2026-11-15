-- Answering a provider form from a client (#6424). `provider_version` is the version the
-- verified provider process's own executable reported when its hook recorded the form;
-- keys are sent only to versions whose answer keys were captured. `sent_ms` is set once,
-- before the first key is sent, so a second answer is refused and nothing is typed twice.
ALTER TABLE provider_forms ADD COLUMN provider_version TEXT
  CHECK (provider_version IS NULL OR length(CAST(provider_version AS BLOB)) BETWEEN 1 AND 64);
ALTER TABLE provider_forms ADD COLUMN sent_ms INTEGER
  CHECK (sent_ms IS NULL OR (typeof(sent_ms)='integer' AND sent_ms BETWEEN 0 AND 9007199254740991));
-- A form sent from a client stops being answerable, so clients follow that change too.
DROP TRIGGER provider_forms_advances_change_cursor_on_update;
CREATE TRIGGER provider_forms_advances_change_cursor_on_update AFTER UPDATE ON provider_forms
WHEN OLD.form_id IS NOT NEW.form_id OR OLD.binding_id IS NOT NEW.binding_id
 OR OLD.identity_id IS NOT NEW.identity_id OR OLD.provider_session IS NOT NEW.provider_session
 OR OLD.kind IS NOT NEW.kind OR OLD.opened_ms IS NOT NEW.opened_ms OR OLD.document IS NOT NEW.document
 OR OLD.provider_version IS NOT NEW.provider_version OR OLD.sent_ms IS NOT NEW.sent_ms
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
