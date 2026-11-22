//! The Herdr back key (#6117): one TMT-marked `[[keys.command]]` block in the
//! user's Herdr configuration, written only with consent. Herdr has no include
//! directive, so the block lives in the user's own file; nothing outside the
//! markers is ever changed. A candidate is validated with `herdr config check`
//! before it replaces the original, and the original bytes are compared again
//! just before the atomic rename.
//!
//! Herdr moves every client attached to a server, so the key returns all of
//! them to the board, not only the one that pressed it.

use std::{
    ffi::OsString,
    fs, io,
    path::{Path, PathBuf},
};

pub const BEGIN: &str = "# BEGIN tmt herdr keys (managed by tmt install herdr)";
pub const END: &str = "# END tmt herdr keys";
pub const KEY: &str = "prefix+G";

/// Herdr's configuration file for this environment, as Herdr resolves it:
/// `HERDR_CONFIG_PATH`, else `$XDG_CONFIG_HOME/herdr/config.toml`, else
/// `~/.config/herdr/config.toml`. `None` when no absolute path follows.
pub fn config_path(var: impl Fn(&str) -> Option<OsString>) -> Option<PathBuf> {
    let absolute = |path: PathBuf| path.is_absolute().then_some(path);
    if let Some(path) = var("HERDR_CONFIG_PATH") {
        return absolute(PathBuf::from(path));
    }
    if let Some(directory) = var("XDG_CONFIG_HOME") {
        return absolute(PathBuf::from(directory).join("herdr/config.toml"));
    }
    absolute(PathBuf::from(var("HOME")?).join(".config/herdr/config.toml"))
}

/// The exact block, with the launcher shell-quoted inside a TOML string.
pub fn block(launcher: &Path) -> String {
    let quoted = format!("'{}'", launcher.to_string_lossy().replace('\'', r"'\''"));
    let command = toml_edit::Value::from(format!("{quoted} ops squad back")).to_string();
    format!(
        "{BEGIN}\n[[keys.command]]\nkey = \"{KEY}\"\ntype = \"shell\"\ncommand = {}\n{END}\n",
        command.trim()
    )
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum State {
    /// No managed block, and the key is free.
    Absent,
    /// The managed block is exactly this build's.
    Current,
    /// The managed block names another launcher.
    Stale,
    /// The markers are incomplete or repeated: the block was edited.
    Edited,
    /// The user binds `prefix+G` outside the block.
    Taken,
}

/// Where the managed block is, as a byte range including its line ends.
fn managed(text: &str) -> Result<Option<std::ops::Range<usize>>, ()> {
    let starts: Vec<usize> = line_starts(text, BEGIN);
    let ends: Vec<usize> = line_starts(text, END);
    match (starts.as_slice(), ends.as_slice()) {
        ([], []) => Ok(None),
        ([start], [end]) if start < end => {
            let after = text[*end..]
                .find('\n')
                .map_or(text.len(), |offset| end + offset + 1);
            Ok(Some(*start..after))
        }
        _ => Err(()),
    }
}

fn line_starts(text: &str, line: &str) -> Vec<usize> {
    let mut offset = 0;
    let mut found = Vec::new();
    for current in text.split_inclusive('\n') {
        if current.trim_end_matches(['\n', '\r']) == line {
            found.push(offset);
        }
        offset += current.len();
    }
    found
}

/// Whether the user's own configuration (outside the block) binds the key.
fn binds_key(text: &str) -> bool {
    text.lines().any(|line| {
        let line = line.split('#').next().unwrap_or_default();
        line.contains(&format!("\"{KEY}\"")) || line.contains(&format!("'{KEY}'"))
    })
}

pub fn state(text: &str, launcher: &Path) -> State {
    match managed(text) {
        Err(()) => State::Edited,
        Ok(Some(range)) if text[range.clone()] == block(launcher) => State::Current,
        Ok(Some(range)) => {
            let outside = format!("{}{}", &text[..range.start], &text[range.end..]);
            if binds_key(&outside) {
                State::Taken
            } else {
                State::Stale
            }
        }
        Ok(None) if binds_key(text) => State::Taken,
        Ok(None) => State::Absent,
    }
}

/// The file with this build's block in place of the managed one, or
/// appended after one line break (a blank line when the file ends in one).
pub fn with_block(text: &str, launcher: &Path) -> Option<String> {
    let block = block(launcher);
    match managed(text).ok()? {
        Some(range) => Some(format!(
            "{}{block}{}",
            &text[..range.start],
            &text[range.end..]
        )),
        None if text.is_empty() => Some(block),
        None => Some(format!("{text}\n{block}")),
    }
}

/// The file without the managed block and the one line break that
/// [`with_block`] put before it.
pub fn without_block(text: &str) -> Option<String> {
    let range = managed(text).ok()??;
    let start = range.start - usize::from(text[..range.start].ends_with('\n'));
    Some(format!("{}{}", &text[..start], &text[range.end..]))
}

#[derive(Debug)]
pub enum WriteError {
    Io(io::Error),
    /// `herdr config check` rejected the candidate; the original is unchanged.
    Invalid(String),
    /// The file changed while the candidate was checked; nothing was written.
    Changed,
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "{error}"),
            Self::Invalid(reason) => {
                write!(
                    formatter,
                    "herdr config check rejected the change: {reason}"
                )
            }
            Self::Changed => formatter.write_str("the Herdr configuration changed meanwhile"),
        }
    }
}

impl std::error::Error for WriteError {}

/// The file's bytes, or empty when it does not exist yet.
pub fn read(path: &Path) -> io::Result<Vec<u8>> {
    match fs::read(path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(Vec::new()),
        other => other,
    }
}

/// Publishes `next` in place of `original`: a private sibling candidate is
/// checked by `check` (Herdr's own validator), then the file is compared to
/// `original` again and the candidate renamed over it. A failed check or a
/// concurrent edit leaves the file untouched and removes the candidate.
pub fn publish(
    path: &Path,
    original: &[u8],
    next: &str,
    check: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), WriteError> {
    let directory = path.parent().ok_or_else(|| {
        WriteError::Io(io::Error::new(
            io::ErrorKind::InvalidInput,
            "the Herdr configuration has no directory",
        ))
    })?;
    fs::create_dir_all(directory).map_err(WriteError::Io)?;
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    let candidate = directory.join(format!(".{name}.tmt-{}", std::process::id()));
    let result = (|| {
        write_private(&candidate, next.as_bytes()).map_err(WriteError::Io)?;
        if let Ok(metadata) = fs::metadata(path) {
            fs::set_permissions(&candidate, metadata.permissions()).map_err(WriteError::Io)?;
        }
        check(&candidate).map_err(WriteError::Invalid)?;
        if read(path).map_err(WriteError::Io)? != original {
            return Err(WriteError::Changed);
        }
        fs::rename(&candidate, path).map_err(WriteError::Io)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&candidate);
    }
    result
}

/// Herdr's own validator on `candidate` (`HERDR_CONFIG_PATH=<candidate>
/// herdr config check`), bounded; anything but a clean pass rejects it.
pub fn herdr_check(candidate: &Path) -> Result<(), String> {
    use crate::process::{CommandFailure, CommandRequest, CommandRunner, UnixCommandRunner};
    let args = [OsString::from("config"), OsString::from("check")];
    let request = CommandRequest {
        program: std::ffi::OsStr::new("herdr"),
        args: &args,
        input: &[],
        deadline: std::time::Instant::now() + std::time::Duration::from_secs(5),
        max_output_bytes: 64 * 1024,
    };
    let environment = [(
        OsString::from("HERDR_CONFIG_PATH"),
        candidate.as_os_str().to_owned(),
    )];
    let error = match UnixCommandRunner.execute_with_environment(request, &environment) {
        Ok(_) => return Ok(()),
        Err(error) => error,
    };
    Err(match error.kind {
        CommandFailure::Spawn => "herdr could not be run".into(),
        CommandFailure::Timeout => "herdr config check did not finish".into(),
        CommandFailure::Exit { .. } => error
            .output
            .as_ref()
            .and_then(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .nth(1)
                    .map(|line| line.chars().filter(|c| !c.is_control()).take(200).collect())
            })
            .unwrap_or_else(|| "herdr config check found issues".into()),
        _ => "herdr config check failed".into(),
    })
}

/// The environment's Herdr configuration when it holds a managed block.
pub fn managed_config(var: impl Fn(&str) -> Option<OsString>) -> io::Result<Option<PathBuf>> {
    let Some(path) = config_path(var) else {
        return Ok(None);
    };
    let text = String::from_utf8_lossy(&read(&path)?).into_owned();
    Ok(matches!(managed(&text), Ok(Some(_))).then_some(path))
}

/// Removes the managed block, keeping every other byte; `false` when there
/// is none (or it was edited, which is left for the user).
pub fn remove(path: &Path) -> Result<bool, WriteError> {
    let original = read(path).map_err(WriteError::Io)?;
    let Some(next) = without_block(&String::from_utf8_lossy(&original)) else {
        return Ok(false);
    };
    // The result is the user's own configuration from before the install.
    publish(path, &original, &next, |_| Ok(())).map(|()| true)
}

/// Replaces a managed block that names another launcher; `None` when the
/// file holds no managed block, `Some(changed)` otherwise. Never creates one.
pub fn refresh(
    path: &Path,
    launcher: &Path,
    check: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<Option<bool>, WriteError> {
    let original = read(path).map_err(WriteError::Io)?;
    let text = String::from_utf8_lossy(&original);
    match state(&text, launcher) {
        State::Current => Ok(Some(false)),
        State::Stale => {
            let next = with_block(&text, launcher).ok_or(WriteError::Changed)?;
            publish(path, &original, &next, check).map(|()| Some(true))
        }
        State::Absent | State::Edited | State::Taken => Ok(None),
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> io::Result<()> {
    use std::{io::Write, os::unix::fs::OpenOptionsExt};
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAUNCHER: &str = "/opt/tmt bin/tmt";

    fn launcher() -> &'static Path {
        Path::new(LAUNCHER)
    }

    fn scratch(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("tmt-herdr-keys-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn the_block_is_byte_exact_and_quotes_the_launcher_for_the_shell() {
        assert_eq!(
            block(launcher()),
            "# BEGIN tmt herdr keys (managed by tmt install herdr)\n[[keys.command]]\nkey = \"prefix+G\"\ntype = \"shell\"\ncommand = \"'/opt/tmt bin/tmt' ops squad back\"\n# END tmt herdr keys\n"
        );
        let parsed: toml_edit::DocumentMut = block(Path::new("/a'b/tmt")).parse().unwrap();
        assert_eq!(
            parsed["keys"]["command"][0]["command"].as_str(),
            Some(r"'/a'\''b/tmt' ops squad back")
        );
    }

    #[test]
    fn config_path_follows_herdr_resolution() {
        let env = |pairs: &'static [(&str, &str)]| {
            move |name: &str| {
                pairs
                    .iter()
                    .find(|(key, _)| *key == name)
                    .map(|(_, value)| OsString::from(value))
            }
        };
        static ALL: [(&str, &str); 3] = [
            ("HERDR_CONFIG_PATH", "/x/h.toml"),
            ("XDG_CONFIG_HOME", "/xdg"),
            ("HOME", "/home/u"),
        ];
        let all = &ALL;
        assert_eq!(config_path(env(all)), Some("/x/h.toml".into()));
        assert_eq!(
            config_path(env(&all[1..])),
            Some("/xdg/herdr/config.toml".into())
        );
        assert_eq!(
            config_path(env(&all[2..])),
            Some("/home/u/.config/herdr/config.toml".into())
        );
        assert_eq!(config_path(env(&[("HERDR_CONFIG_PATH", "rel.toml")])), None);
    }

    #[test]
    fn install_appends_once_refresh_replaces_and_removal_restores_the_bytes() {
        let user = "[ui]\ntheme = \"dark\"\n";
        let installed = with_block(user, launcher()).unwrap();
        assert_eq!(installed, format!("{user}\n{}", block(launcher())));
        assert_eq!(state(&installed, launcher()), State::Current);
        assert_eq!(state(&installed, Path::new("/new/tmt")), State::Stale);
        let refreshed = with_block(&installed, Path::new("/new/tmt")).unwrap();
        assert_eq!(
            refreshed,
            format!("{user}\n{}", block(Path::new("/new/tmt")))
        );
        assert_eq!(without_block(&refreshed).unwrap(), user);
        for original in ["", "[ui]\ntheme = \"dark\""] {
            let installed = with_block(original, launcher()).unwrap();
            assert_eq!(without_block(&installed).unwrap(), original, "{original:?}");
        }
        assert_eq!(state(user, launcher()), State::Absent);
        assert_eq!(without_block(user), None, "nothing to remove");
    }

    #[test]
    fn a_user_binding_or_an_edited_marker_is_never_overwritten() {
        let taken = "[[keys.command]]\nkey = \"prefix+G\"\ntype = \"shell\"\ncommand = \"x\"\n";
        assert_eq!(state(taken, launcher()), State::Taken);
        let commented = "# key = \"prefix+G\"\n";
        assert_eq!(state(commented, launcher()), State::Absent);
        let installed = with_block("", launcher()).unwrap();
        let begin_only = installed.replace(END, "# end");
        assert_eq!(state(&begin_only, launcher()), State::Edited);
        assert_eq!(with_block(&begin_only, launcher()), None);
        assert_eq!(without_block(&begin_only), None);
        let twice = format!("{installed}{installed}");
        assert_eq!(state(&twice, launcher()), State::Edited);
    }

    #[test]
    fn publish_checks_a_candidate_and_never_replaces_changed_or_rejected_bytes() {
        let root = scratch("publish");
        let path = root.join("herdr/config.toml");
        publish(&path, b"", "a = 1\n", |candidate| {
            assert_ne!(candidate, path);
            assert_eq!(fs::read_to_string(candidate).unwrap(), "a = 1\n");
            Ok(())
        })
        .unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "a = 1\n");

        let rejected = publish(&path, b"a = 1\n", "a = \n", |_| Err("bad".into()));
        assert!(matches!(rejected, Err(WriteError::Invalid(reason)) if reason == "bad"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "a = 1\n");

        let changed = publish(&path, b"a = 1\n", "a = 2\n", |_| {
            fs::write(&path, "a = 3\n").unwrap();
            Ok(())
        });
        assert!(matches!(changed, Err(WriteError::Changed)));
        assert_eq!(fs::read_to_string(&path).unwrap(), "a = 3\n");
        let left: Vec<_> = fs::read_dir(path.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(left, ["config.toml"], "no candidate is left behind");
        fs::remove_dir_all(root).unwrap();
    }
}
