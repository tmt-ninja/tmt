//! User-installed Pi extension at `<agent-dir>/extensions/tmt/index.js`
//! with a `.tmt-managed.json` ownership marker (Part of #6440).
//!
//! Pi auto-discovers `<agent-dir>/extensions/<name>/index.js` without editing
//! `settings.json`. Foreign directories (missing TMT's marker, or symlinks)
//! are never modified or removed.

use crate::{
    setup::provider_mod::{self, ModState},
    skill_installation::{ProviderEnvironment, files},
};
use std::{
    env,
    ffi::OsString,
    fs, io,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

const DIR_NAME: &str = "tmt";
const ENTRY_FILE: &str = "index.js";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Installed(PathBuf),
    Refreshed(PathBuf),
    Current(PathBuf),
    Blocked(PathBuf),
}

impl Outcome {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Installed(_) => "installed",
            Self::Refreshed(_) => "refreshed",
            Self::Current(_) => "current",
            Self::Blocked(_) => "blocked",
        }
    }

    pub fn entry_path(&self) -> PathBuf {
        match self {
            Self::Installed(dir)
            | Self::Refreshed(dir)
            | Self::Current(dir)
            | Self::Blocked(dir) => dir.join(ENTRY_FILE),
        }
    }

    pub fn changed(&self) -> bool {
        matches!(self, Self::Installed(_) | Self::Refreshed(_))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UninstallPlan {
    Absent,
    Managed(PathBuf),
    Foreign(PathBuf),
}

pub fn target_dir(environment: &ProviderEnvironment) -> PathBuf {
    super::agent_dir(environment)
        .join("extensions")
        .join(DIR_NAME)
}

pub fn target_entry(environment: &ProviderEnvironment) -> PathBuf {
    target_dir(environment).join(ENTRY_FILE)
}

pub fn targeted(provider: Option<&str>, report: &crate::skill_installation::InstallReport) -> bool {
    provider.is_some_and(|p| p.eq_ignore_ascii_case(super::NAME))
        || report
            .installed
            .iter()
            .any(|item| item.agent.is_some_and(|a| a.name() == super::NAME))
}

pub fn rejects_explicit_provider(provider: Option<&str>) -> bool {
    provider.is_some_and(|p| !p.eq_ignore_ascii_case(super::NAME) && !p.eq_ignore_ascii_case("all"))
}

/// Prefer the stable `tmt` launcher on `PATH` without resolving symlinks,
/// falling back to the current executable if `tmt` is not on `PATH`.
pub fn detect_launcher() -> io::Result<PathBuf> {
    if let Ok(cwd) = env::current_dir()
        && let Some(search) = env::var_os("PATH")
        && let Some(found) = env::split_paths(&search)
            .map(|directory| crate::config::normalize(&cwd.join(directory).join("tmt")))
            .find(|candidate| {
                fs::metadata(candidate).is_ok_and(|metadata| {
                    metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
                })
            })
    {
        return Ok(found);
    }
    env::current_exe()
}

pub fn detect_startup_ready() -> bool {
    super::check_version(&crate::process::UnixCommandRunner, &OsString::from("pi")).unwrap_or(false)
}

fn rendered_bytes(launcher: &Path, startup_ready: bool) -> io::Result<Vec<u8>> {
    let launcher_str = launcher
        .to_str()
        .filter(|path| Path::new(path).is_absolute() && !path.chars().any(char::is_control))
        .ok_or_else(|| io::Error::other("Invalid hook launcher path for Pi extension."))?;
    super::render_extension(launcher_str, startup_ready).map(String::into_bytes)
}

pub fn state(
    environment: &ProviderEnvironment,
    launcher: &Path,
    startup_ready: bool,
) -> io::Result<ModState> {
    let target = target_dir(environment);
    let bytes = rendered_bytes(launcher, startup_ready)?;
    provider_mod::state_for_files(&target, &[(ENTRY_FILE, &bytes)])
}

pub fn install_or_refresh(
    environment: &ProviderEnvironment,
    launcher: &Path,
    startup_ready: bool,
) -> io::Result<Outcome> {
    let target = target_dir(environment);
    let bytes = rendered_bytes(launcher, startup_ready)?;
    let files = [(ENTRY_FILE, bytes.as_slice())];
    match provider_mod::state_for_files(&target, &files)? {
        ModState::Foreign => Ok(Outcome::Blocked(target)),
        ModState::Current => Ok(Outcome::Current(target)),
        ModState::Absent => {
            provider_mod::publish_files(&target, &files, false)?;
            Ok(Outcome::Installed(target))
        }
        ModState::Stale => {
            provider_mod::publish_files(&target, &files, true)?;
            Ok(Outcome::Refreshed(target))
        }
    }
}

/// Refreshes an already-installed TMT-managed Pi extension; never creates one
/// when absent and never touches a foreign directory.
pub fn refresh_if_installed(
    environment: &ProviderEnvironment,
    launcher: &Path,
    startup_ready: bool,
) -> io::Result<Option<Outcome>> {
    let target = target_dir(environment);
    if !provider_mod::is_managed(&target)? {
        return Ok(None);
    }
    let bytes = rendered_bytes(launcher, startup_ready)?;
    let files = [(ENTRY_FILE, bytes.as_slice())];
    match provider_mod::state_for_files(&target, &files)? {
        ModState::Current => Ok(Some(Outcome::Current(target))),
        ModState::Stale => {
            provider_mod::publish_files(&target, &files, true)?;
            Ok(Some(Outcome::Refreshed(target)))
        }
        ModState::Absent | ModState::Foreign => Ok(None),
    }
}

pub fn plan_uninstall(environment: &ProviderEnvironment) -> io::Result<UninstallPlan> {
    let target = target_dir(environment);
    if provider_mod::is_managed(&target)? {
        return Ok(UninstallPlan::Managed(target));
    }
    if files::exists(&target)? {
        return Ok(UninstallPlan::Foreign(target));
    }
    Ok(UninstallPlan::Absent)
}

pub fn uninstall(environment: &ProviderEnvironment) -> io::Result<Option<PathBuf>> {
    let target = target_dir(environment);
    if !provider_mod::is_managed(&target)? {
        return Ok(None);
    }
    provider_mod::take(&target)?;
    Ok(Some(target))
}
