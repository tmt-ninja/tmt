//! Resolve a saved identity before initializing its owner-local Markdown file.

use crate::{
    identity_context,
    output::{Failure, after_cleanup},
};
use serde_json::json;
use std::io::{self, Write};
use tmt_adapters::{
    config::ConfigPaths,
    notes::{self, NotesPath},
    storage::Storage,
};
use tmt_core::identity::{NotesIdentityError, NotesIdentityId};

pub struct Report {
    identity_id: String,
    notes: NotesPath,
}

fn notes_failure(error: impl std::error::Error + 'static) -> Failure {
    Failure::new(
        "NOTES_IO_ERROR",
        "Could not initialize the saved identity notes file.",
        1,
    )
    .caused_by(error)
}

pub fn run(explicit: Option<String>) -> Result<Report, Failure> {
    // Reject an absent or unverifiable implicit caller before filesystem or
    // database discovery. Explicit selectors still resolve through storage.
    let selector = identity_context::required(explicit.as_deref())?;
    let paths = ConfigPaths::discover().map_err(notes_failure)?;
    let mut storage = Storage::open(&paths.database).map_err(|error| {
        Failure::storage_access(
            error,
            &paths.global_dir,
            "No notes file was initialized.",
            "NOTES_IO_ERROR",
            "Could not initialize the saved identity notes file.",
        )
    })?;
    let pending = (|| {
        let identity = identity_context::resolve(&mut storage, selector)?;
        let identity_id = NotesIdentityId::try_from(&identity).map_err(|error| match error {
            NotesIdentityError::SavedIdentityRequired => Failure::new(
                "NOTES_SAVED_IDENTITY_REQUIRED",
                "Notes require a saved identity; save this identity or select one with --identity.",
                1,
            ),
            NotesIdentityError::InvalidIdentityId => notes_failure(error),
        })?;
        let notes = notes::initialize(&paths, &identity_id).map_err(notes_failure)?;
        Ok(Report {
            identity_id: identity.id,
            notes,
        })
    })();
    after_cleanup(pending, || storage.close())
}

impl tmt_cli_style::Render for Report {
    fn human(
        &self,
        stdout: &mut dyn Write,
        _: &mut dyn Write,
        _: tmt_cli_style::Terminal,
        _: tmt_cli_style::Terminal,
    ) -> io::Result<()> {
        // The full path, never `~/`: scripts read it (see the command's Details).
        writeln!(stdout, "{}", self.notes.path.display())
    }
    fn json(&self, stdout: &mut dyn Write) -> io::Result<()> {
        writeln!(
            stdout,
            "{}",
            json!({
                "identityId": self.identity_id,
                "path": self.notes.path,
                "created": self.notes.created,
            })
        )
    }
}
