-- The interactive forms a bound provider session waits on (#6424), as its consented hook
-- reported them: observation for clients to show, never an answer or a decision. A form
-- belongs to its binding and goes with it. A read decides whether it is still open, from the
-- session's waiting period; the next recorded form drops the binding's earlier periods.
CREATE TABLE provider_forms (
  form_id TEXT PRIMARY KEY CHECK (length(form_id)=36),
  binding_id TEXT NOT NULL REFERENCES bindings(id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL CHECK (length(identity_id)=36),
  provider_session TEXT NOT NULL CHECK (length(CAST(provider_session AS BLOB)) BETWEEN 1 AND 256),
  kind TEXT NOT NULL CHECK (kind IN ('question','permission','planApproval')),
  opened_ms INTEGER NOT NULL CHECK (typeof(opened_ms)='integer' AND opened_ms BETWEEN 0 AND 9007199254740991),
  document TEXT NOT NULL CHECK (json_valid(document) AND length(CAST(document AS BLOB)) <= 131072)
);
CREATE INDEX provider_forms_by_identity ON provider_forms(identity_id, opened_ms);
CREATE INDEX provider_forms_by_binding ON provider_forms(binding_id);
-- Clients follow forms through `changes.cursor`; a form closes through the session state
-- write that ends waiting, which advances it as well.
CREATE TRIGGER provider_forms_advances_change_cursor_on_insert AFTER INSERT ON provider_forms
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
CREATE TRIGGER provider_forms_advances_change_cursor_on_update AFTER UPDATE ON provider_forms
WHEN OLD.form_id IS NOT NEW.form_id OR OLD.binding_id IS NOT NEW.binding_id
 OR OLD.identity_id IS NOT NEW.identity_id OR OLD.provider_session IS NOT NEW.provider_session
 OR OLD.kind IS NOT NEW.kind OR OLD.opened_ms IS NOT NEW.opened_ms OR OLD.document IS NOT NEW.document
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
CREATE TRIGGER provider_forms_advances_change_cursor_on_delete AFTER DELETE ON provider_forms
BEGIN UPDATE change_cursor SET value = value + 1 WHERE id = 1; END;
