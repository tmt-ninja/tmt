//! A stable kernel lock owns the lifetime; JSON is bounded advisory evidence.
use super::TickError;
use crate::{
    bounded_file::{self, FileReadError},
    private_file,
};
use nix::fcntl::{Flock, FlockArg};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    fs::{self, File, OpenOptions},
    os::unix::fs::OpenOptionsExt,
    path::{Path, PathBuf},
};
use tmt_core::{dispatch::canonical_id, limits::MAX_JS_SAFE_INTEGER};
const LIMIT: usize = 8192;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Holder {
    schema_version: u8,
    token: String,
    pid: u32,
    started_at_ms: u64,
    heartbeat_at_ms: u64,
    expires_at_ms: u64,
    mode: String,
    build: String,
    pane: Option<String>,
}
fn read(path: &Path) -> Result<Option<Holder>, TickError> {
    let bytes = match bounded_file::read_no_follow(path, LIMIT) {
        Ok(b) => b,
        Err(FileReadError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(FileReadError::Io(e)) => return Err(e.into()),
        Err(FileReadError::TooLarge) => return Err(TickError::Invalid),
    };
    let h: Holder = serde_json::from_slice(&bytes).map_err(|_| TickError::Invalid)?;
    if h.schema_version != 1
        || !canonical_id(&h.token)
        || h.pid == 0
        || h.started_at_ms == 0
        || h.started_at_ms > MAX_JS_SAFE_INTEGER
        || h.heartbeat_at_ms == 0
        || h.expires_at_ms <= h.heartbeat_at_ms
        || h.expires_at_ms > MAX_JS_SAFE_INTEGER
        || !matches!(h.mode.as_str(), "once" | "run")
        || h.build.len() > 64
        || h.build.chars().any(char::is_control)
        || h.pane
            .as_ref()
            .is_some_and(|p| p.is_empty() || p.len() > 128 || p.chars().any(char::is_control))
    {
        return Err(TickError::Invalid);
    }
    Ok(Some(h))
}
fn expiry(now: u64) -> Result<u64, TickError> {
    now.checked_add(30_000)
        .filter(|n| now > 0 && *n <= MAX_JS_SAFE_INTEGER)
        .ok_or(TickError::Invalid)
}
fn directory(root: &Path) -> Result<PathBuf, TickError> {
    if !root.is_absolute() {
        return Err(TickError::Invalid);
    }
    Ok(root.join("tick"))
}
pub fn status(root: &Path, now: u64) -> Result<Value, TickError> {
    let dir = directory(root)?;
    if !dir.try_exists()? {
        return Ok(json!({"schemaVersion":1,"state":"stopped","holder":null}));
    }
    if !private_file::directory_is_private(&dir) {
        return Err(TickError::Invalid);
    }
    let holder = read(&dir.join("clock.json"))?;
    let file = match OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(dir.join("clock.lock"))
    {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound && holder.is_none() => {
            return Ok(json!({"schemaVersion":1,"state":"stopped","holder":null}));
        }
        Err(e) => return Err(e.into()),
    };
    if !file.metadata()?.is_file() {
        return Err(TickError::Invalid);
    }
    let locked = match Flock::lock(file, FlockArg::LockSharedNonblock) {
        Ok(_) => false,
        Err((_, e)) if e == nix::errno::Errno::EWOULDBLOCK => true,
        Err((_, e)) => return Err(std::io::Error::from_raw_os_error(e as i32).into()),
    };
    let state = if locked {
        if holder
            .as_ref()
            .is_some_and(|h| h.heartbeat_at_ms <= now && now < h.expires_at_ms)
        {
            "running"
        } else {
            "unconfirmed"
        }
    } else if holder.is_some() {
        "stale"
    } else {
        "stopped"
    };
    Ok(json!({"schemaVersion":1,"state":state,"holder":holder}))
}
pub struct Lease {
    directory: PathBuf,
    holder: Holder,
    _guard: Flock<File>,
    released: bool,
}
impl Lease {
    pub fn acquire(root: &Path, mode: &str, now: u64) -> Result<Self, TickError> {
        if !matches!(mode, "once" | "run") {
            return Err(TickError::Invalid);
        }
        let dir = directory(root)?;
        private_file::ensure_private_directory(&dir)?;
        if dir.join("clock.json").try_exists()? && !dir.join("clock.lock").try_exists()? {
            return Err(TickError::Invalid);
        }
        let guard = match crate::file_lock::exclusive(&dir.join("clock.lock")) {
            Ok(g) => g,
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                return Err(TickError::Busy(status(root, now)?));
            }
            Err(e) => return Err(e.into()),
        };
        // An unknown/newer record is retained even when its kernel owner is gone.
        read(&dir.join("clock.json"))?;
        let pane = std::env::var("TMUX_PANE")
            .ok()
            .filter(|p| !p.is_empty() && p.len() <= 128 && !p.chars().any(char::is_control));
        let holder = Holder {
            schema_version: 1,
            token: uuid::Uuid::new_v4().to_string(),
            pid: std::process::id(),
            started_at_ms: now,
            heartbeat_at_ms: now,
            expires_at_ms: expiry(now)?,
            mode: mode.into(),
            build: env!("CARGO_PKG_VERSION").into(),
            pane,
        };
        private_file::replace(
            &dir.join("clock.json"),
            &serde_json::to_vec(&holder).map_err(|_| TickError::Invalid)?,
        )?;
        Ok(Self {
            directory: dir,
            holder,
            _guard: guard,
            released: false,
        })
    }
    pub fn token(&self) -> &str {
        &self.holder.token
    }
    pub fn verify(&self) -> Result<(), TickError> {
        if read(&self.directory.join("clock.json"))?.is_none_or(|h| h.token != self.holder.token) {
            return Err(TickError::LeaseLost);
        }
        Ok(())
    }
    pub fn renew(&mut self, now: u64) -> Result<(), TickError> {
        self.verify()?;
        self.holder.heartbeat_at_ms = now;
        self.holder.expires_at_ms = expiry(now)?;
        private_file::replace(
            &self.directory.join("clock.json"),
            &serde_json::to_vec(&self.holder).map_err(|_| TickError::Invalid)?,
        )?;
        Ok(())
    }
    pub fn release(&mut self) -> Result<(), TickError> {
        if self.released {
            return Ok(());
        }
        self.released = true;
        self.verify()?;
        fs::remove_file(self.directory.join("clock.json"))?;
        Ok(())
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if !self.released
            && let Err(error) = self.release()
        {
            eprintln!("Tick lease cleanup unconfirmed: {}", error.code());
        }
    }
}
#[cfg(test)]
mod tests;
