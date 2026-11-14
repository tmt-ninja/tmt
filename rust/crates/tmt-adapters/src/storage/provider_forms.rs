//! The forms a bound provider session waits on (#6424), recorded from its hook. A form
//! belongs to its binding (`ON DELETE CASCADE`). Nothing clears a form when the session
//! leaves waiting: a read treats it as open only while the session's activity still waits
//! in the period the form was recorded in, and the next recorded form drops older periods.

use super::{
    Storage, StorageError,
    errors::{classify, incompatible},
};
use crate::runtime::provider_form::ProviderForm;
use rusqlite::{OptionalExtension, params};

/// One recorded form and whose it is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredForm {
    pub form_id: String,
    pub identity_id: String,
    pub opened_ms: u64,
    pub form: ProviderForm,
}

impl Storage {
    /// Records the form the binding's provider session now waits on, in the waiting period
    /// that began at `since_ms`; the binding's forms from earlier periods are dropped. A
    /// repeated report of the same tool call keeps its first record; the answer is its ID.
    pub fn record_provider_form(
        &mut self,
        binding_id: &str,
        identity_id: &str,
        provider_session: &str,
        form: &ProviderForm,
        since_ms: u64,
        now_ms: u64,
    ) -> Result<String, StorageError> {
        let document = serde_json::to_string(form).map_err(|e| incompatible(e.to_string()))?;
        let transaction = self
            .connection_mut()?
            .transaction()
            .map_err(|e| classify(e, "Record provider form"))?;
        transaction
            .execute(
                "DELETE FROM provider_forms WHERE binding_id=?1 AND (opened_ms<?2 OR provider_session<>?3)",
                params![binding_id, i64::try_from(since_ms).unwrap_or(i64::MAX), provider_session],
            )
            .map_err(|e| classify(e, "Drop earlier provider forms"))?;
        let existing = match form.tool_use_id.as_deref() {
            Some(tool_use) => transaction
                .query_row(
                    "SELECT form_id FROM provider_forms WHERE binding_id=?1
                     AND json_extract(document,'$.toolUseId')=?2",
                    params![binding_id, tool_use],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|e| classify(e, "Read provider form"))?,
            None => None,
        };
        let form_id = match existing {
            Some(form_id) => form_id,
            None => {
                let form_id = uuid::Uuid::new_v4().to_string();
                transaction
                    .execute(
                        "INSERT INTO provider_forms
                         (form_id,binding_id,identity_id,provider_session,kind,opened_ms,document)
                         VALUES (?1,?2,?3,?4,?5,?6,?7)",
                        params![
                            form_id,
                            binding_id,
                            identity_id,
                            provider_session,
                            form.kind.as_str(),
                            i64::try_from(now_ms).unwrap_or(i64::MAX),
                            document
                        ],
                    )
                    .map_err(|e| classify(e, "Record provider form"))?;
                form_id
            }
        };
        transaction
            .commit()
            .map_err(|e| classify(e, "Record provider form"))?;
        Ok(form_id)
    }

    /// Open forms, oldest first, of one identity or of all, on a binding that still exists.
    pub fn provider_forms(
        &self,
        identity_id: Option<&str>,
    ) -> Result<Vec<StoredForm>, StorageError> {
        let connection = self.connection()?;
        let mut statement = connection
            .prepare(
                "SELECT f.form_id,f.identity_id,f.opened_ms,f.document FROM provider_forms f
                 JOIN bindings b ON b.id=f.binding_id AND b.identity_id=f.identity_id
                 WHERE ?1 IS NULL OR f.identity_id=?1 ORDER BY f.opened_ms, f.form_id",
            )
            .map_err(|e| classify(e, "Read provider forms"))?;
        let rows = statement
            .query_map([identity_id], stored)
            .map_err(|e| classify(e, "Read provider forms"))?;
        rows.map(|row| row.map_err(|e| classify(e, "Read provider forms"))?)
            .collect()
    }

    /// One open form by its ID, as `provider_forms` lists it.
    pub fn provider_form(&self, form_id: &str) -> Result<Option<StoredForm>, StorageError> {
        self.connection()?
            .query_row(
                "SELECT f.form_id,f.identity_id,f.opened_ms,f.document FROM provider_forms f
                 JOIN bindings b ON b.id=f.binding_id AND b.identity_id=f.identity_id
                 WHERE f.form_id=?1",
                [form_id],
                stored,
            )
            .optional()
            .map_err(|e| classify(e, "Read provider form"))?
            .transpose()
    }
}

type Row = Result<StoredForm, StorageError>;

/// Reads the columns, then decodes the document outside the row callback.
fn stored(row: &rusqlite::Row<'_>) -> rusqlite::Result<Row> {
    let form_id: String = row.get(0)?;
    let identity_id: String = row.get(1)?;
    let opened: i64 = row.get(2)?;
    let document: String = row.get(3)?;
    Ok(serde_json::from_str(&document)
        .map_err(|e| incompatible(format!("A stored provider form is unreadable: {e}")))
        .map(|form| StoredForm {
            form_id,
            identity_id,
            opened_ms: u64::try_from(opened).unwrap_or(0),
            form,
        }))
}
