//! Pi caller-session coordinates and exact-ID header verification.
//! Environment coordinates never establish authority on their own.

use crate::{
    runtime::{
        caller_header,
        lifecycle::{CallerSession, CallerSessionRefusal},
        session_presence::PRESENCE_ENTRIES,
    },
    skill_installation::ProviderEnvironment,
};
use serde::Deserialize;
use std::{
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    time::Instant,
};
use tmt_core::binding::session::ProviderSessionId;

pub(super) fn coordinates(session: Option<&OsStr>) -> Option<CallerSession> {
    let session = session?.to_str()?;
    // Never allow path separators or dot components in session file suffix matching.
    if session.contains(['/', '\\']) || matches!(session, "." | "..") {
        return None;
    }
    Some(CallerSession {
        session: ProviderSessionId::new(session).ok()?,
        runtime_pid: None,
    })
}

enum SessionFile {
    None,
    Regular(PathBuf),
}

fn find_exact_session_file(
    root: &Path,
    session: &ProviderSessionId,
    deadline: Instant,
) -> Result<SessionFile, CallerSessionRefusal> {
    use CallerSessionRefusal::HeaderUnavailable;
    if Instant::now() >= deadline {
        return Err(HeaderUnavailable);
    }
    let listings = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SessionFile::None);
        }
        Err(_) => return Err(HeaderUnavailable),
    };
    let suffix = format!("_{}.jsonl", session.as_str());
    let mut visited = 0usize;
    let mut found: Option<PathBuf> = None;
    for dir_entry in listings {
        visited += 1;
        if visited > PRESENCE_ENTRIES || Instant::now() >= deadline {
            return Err(HeaderUnavailable);
        }
        let Ok(dir_entry) = dir_entry else {
            return Err(HeaderUnavailable);
        };
        let Ok(kind) = dir_entry.file_type() else {
            return Err(HeaderUnavailable);
        };
        if !kind.is_dir() {
            continue;
        }
        let files = fs::read_dir(dir_entry.path()).map_err(|_| HeaderUnavailable)?;
        for file_entry in files {
            visited += 1;
            if visited > PRESENCE_ENTRIES || Instant::now() >= deadline {
                return Err(HeaderUnavailable);
            }
            let Ok(file_entry) = file_entry else {
                return Err(HeaderUnavailable);
            };
            let Some(name) = file_entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            if !name.ends_with(&suffix) {
                continue;
            }
            let Ok(file_kind) = file_entry.file_type() else {
                return Err(HeaderUnavailable);
            };
            if !file_kind.is_file() || found.is_some() {
                return Err(HeaderUnavailable);
            }
            found = Some(file_entry.path());
        }
    }
    Ok(found.map_or(SessionFile::None, SessionFile::Regular))
}

#[derive(Deserialize)]
struct SessionHeader {
    #[serde(rename = "type")]
    kind: String,
    id: String,
}

/// Verifies an on-disk session header when present under `$PI_CODING_AGENT_DIR/sessions`.
/// Ephemeral `--no-session` runs emit no JSONL file and are allowed when no matching file
/// exists on disk; symlinks, ambiguous duplicates, or corrupt headers fail closed.
pub(super) fn verify_header(
    coordinates: &CallerSession,
    environment: &ProviderEnvironment,
    deadline: Instant,
) -> Result<(), CallerSessionRefusal> {
    let root = super::sessions_root(environment);
    let SessionFile::Regular(path) =
        find_exact_session_file(&root, &coordinates.session, deadline)?
    else {
        return Ok(());
    };
    let line = caller_header::read(&root, &path, deadline)
        .ok_or(CallerSessionRefusal::HeaderUnavailable)?;
    let header: SessionHeader =
        serde_json::from_slice(&line).map_err(|_| CallerSessionRefusal::HeaderShape)?;
    if header.kind != "session" || header.id != coordinates.session.as_str() {
        return Err(CallerSessionRefusal::HeaderShape);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        runtime::lifecycle::RuntimeLifecycle, skill_installation::ProviderEnvironment,
        test_support::TestDirectory,
    };
    use serde_json::json;
    use std::time::Duration;
    use tmt_core::binding::session::{BindingSessionState, RuntimeLiveness, RuntimeState};
    use tmt_core::endpoint::ProcessIncarnation;

    const SESSION: &str = "11111111-1111-4111-8111-111111111111";

    #[test]
    fn coordinates_reject_empty_dot_and_path_separators() {
        for bad in [
            None,
            Some(OsStr::new("")),
            Some(OsStr::new("   ")),
            Some(OsStr::new(".")),
            Some(OsStr::new("..")),
            Some(OsStr::new("a/b")),
            Some(OsStr::new(r"a\b")),
        ] {
            assert!(coordinates(bad).is_none(), "{bad:?}");
        }
        let coords = coordinates(Some(OsStr::new(SESSION))).unwrap();
        assert_eq!(coords.session.as_str(), SESSION);
        assert_eq!(coords.runtime_pid, None);

        let custom = coordinates(Some(OsStr::new("custom-session-1"))).unwrap();
        assert_eq!(custom.session.as_str(), "custom-session-1");
    }

    #[test]
    fn caller_session_observation_validates_headers_and_allows_ephemeral_absent_files() {
        let dir = TestDirectory::new();
        let agent_dir = dir.path.join("pi-agent");
        let environment = ProviderEnvironment::from_parts(
            &dir.path,
            &dir.path,
            Vec::new(),
            [("PI_CODING_AGENT_DIR", agent_dir.clone())],
        );
        let coords = coordinates(Some(OsStr::new(SESSION))).unwrap();
        let lifecycle = super::super::PiLifecycle;
        let deadline = Instant::now() + Duration::from_secs(2);

        // Ephemeral (--no-session) has no file on disk and passes.
        let obs = lifecycle
            .caller_session_observation(&coords, &environment, deadline)
            .expect("ephemeral absence is allowed");
        assert_eq!(obs.session(), &coords.session);
        let process = ProcessIncarnation::new(42, "pi").unwrap();
        let next = obs
            .propose(
                &BindingSessionState::default(),
                &process,
                RuntimeLiveness::Alive,
                crate::runtime::lifecycle::HostEvidence::Independent { runtime_pid: None },
                false,
            )
            .unwrap();
        assert_eq!(next.state, RuntimeState::Running);

        // Matching regular JSONL header succeeds.
        let project = agent_dir.join("sessions/--repo--");
        fs::create_dir_all(&project).unwrap();
        let file = project.join(format!("2026-11-17T00-00-00_{SESSION}.jsonl"));
        fs::write(
            &file,
            format!(
                "{}\n",
                json!({
                    "type": "session",
                    "version": 3,
                    "id": SESSION,
                    "timestamp": "2026-11-17T00:00:00.000Z",
                    "cwd": "/tmp"
                })
            ),
        )
        .unwrap();
        assert!(
            lifecycle
                .caller_session_observation(&coords, &environment, deadline)
                .is_ok()
        );

        // Mismatched session ID or malformed header refuses with HeaderShape.
        fs::write(
            &file,
            format!(
                "{}\n",
                json!({"type": "session", "version": 3, "id": "other"})
            ),
        )
        .unwrap();
        assert!(matches!(
            lifecycle.caller_session_observation(&coords, &environment, deadline),
            Err(CallerSessionRefusal::HeaderShape)
        ));

        // Symlinked session file refuses fail-closed with HeaderUnavailable.
        fs::remove_file(&file).unwrap();
        let outside = dir.path.join("outside.jsonl");
        fs::write(
            &outside,
            format!("{}\n", json!({"type": "session", "id": SESSION})),
        )
        .unwrap();
        std::os::unix::fs::symlink(&outside, &file).unwrap();
        assert!(matches!(
            lifecycle.caller_session_observation(&coords, &environment, deadline),
            Err(CallerSessionRefusal::HeaderUnavailable)
        ));
    }
}
