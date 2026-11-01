//! Optional finite user timers. Files prove ownership; the user manager owns scheduling.
use crate::{
    bounded_file, file_lock, native_install as managed, private_file,
    process::{CommandRequest, CommandRunner},
};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    fs::{self, File, OpenOptions},
    io::{self, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
const LIMIT: usize = 128 * 1024;
const TAG: &str = "tmt-user-tick-v1:";
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Preview,
    Status,
    Install,
    Remove,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Manifest {
    version: u8,
    platform: String,
    uid: u32,
    root: PathBuf,
    home: PathBuf,
    directory: PathBuf,
    executable: PathBuf,
    path: String,
}
#[derive(Debug, Clone)]
pub struct Plan {
    manifest: Manifest,
}
fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message)
}
fn text(path: &Path) -> io::Result<&str> {
    path.to_str()
        .filter(|s| path.is_absolute() && !s.chars().any(char::is_control) && s.len() <= 16_384)
        .ok_or_else(|| {
            invalid("Timer paths must be absolute UTF-8 paths without control characters.")
        })
}
fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
fn systemd(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('%', "%%")
    )
}
impl Plan {
    /// Inspection only: selecting a timer never creates a directory or contacts a manager.
    pub fn discover(root: &Path, current_executable: &Path) -> io::Result<Self> {
        // release_prefix supplies an ancestry candidate, not ownership proof.
        // Only a present managed namespace asks its existing owner to verify it.
        let namespace = managed::release_prefix(current_executable)
            .map(|prefix| prefix.join(managed::Product::Cli.namespace()));
        let managed_shape = namespace
            .as_ref()
            .map_or(Ok(false), |path| path.try_exists())?;
        let executable = if managed_shape {
            managed::inspect(current_executable)?.executable
        } else {
            current_executable.to_owned()
        };
        let home = std::env::home_dir()
            .ok_or_else(|| invalid("Cannot find the user home for the timer."))?;
        let platform = if cfg!(target_os = "macos") {
            "launchd"
        } else if cfg!(target_os = "linux") {
            "systemd"
        } else {
            return Err(invalid("User timers require macOS or Linux."));
        };
        let directory = if platform == "launchd" {
            home.join("Library/LaunchAgents")
        } else {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| home.join(".config"))
                .join("systemd/user")
        };
        let path =
            std::env::var("PATH").map_err(|_| invalid("Timer installation needs a UTF-8 PATH."))?;
        Self::new(Manifest {
            version: 1,
            platform: platform.into(),
            uid: nix::unistd::geteuid().as_raw(),
            root: root.into(),
            home,
            directory,
            executable,
            path,
        })
    }
    fn new(manifest: Manifest) -> io::Result<Self> {
        if manifest.version != 1
            || !matches!(manifest.platform.as_str(), "launchd" | "systemd")
            || manifest.path.len() > 32_768
            || manifest.path.chars().any(char::is_control)
        {
            return Err(invalid("Invalid retained timer manifest."));
        }
        for path in [
            &manifest.root,
            &manifest.home,
            &manifest.directory,
            &manifest.executable,
        ] {
            text(path)?;
        }
        let plan = Self { manifest };
        if plan.files().iter().any(|(_, bytes)| bytes.len() > LIMIT) {
            return Err(invalid(
                "Generated timer files exceed the 128 KiB ownership-read bound.",
            ));
        }
        Ok(plan)
    }
    fn label(&self) -> String {
        let digest = Sha256::digest(
            text(&self.manifest.root)
                .expect("validated path")
                .as_bytes(),
        );
        format!(
            "io.tmt.tick.{}",
            digest[..12]
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        )
    }
    fn files(&self) -> Vec<(PathBuf, Vec<u8>)> {
        let m = &self.manifest;
        let label = self.label();
        let encoded = STANDARD.encode(serde_json::to_vec(m).expect("manifest"));
        let root = text(&m.root).unwrap();
        let home = text(&m.home).unwrap();
        let exe = text(&m.executable).unwrap();
        if m.platform == "launchd" {
            let body = format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!-- {TAG}{encoded} -->\n<plist version=\"1.0\"><dict>\n<key>Label</key><string>{label}</string>\n<key>ProgramArguments</key><array><string>{}</string><string>tick</string><string>--json</string></array>\n<key>EnvironmentVariables</key><dict><key>TMT_HOME</key><string>{}</string><key>HOME</key><string>{}</string><key>PATH</key><string>{}</string></dict>\n<key>WorkingDirectory</key><string>{}</string>\n<key>StartCalendarInterval</key><dict/>\n<key>RunAtLoad</key><false/>\n<key>ExitTimeOut</key><integer>15</integer>\n</dict></plist>\n",
                xml(exe),
                xml(root),
                xml(home),
                xml(&m.path),
                xml(home)
            );
            vec![(
                m.directory.join(format!("{label}.plist")),
                body.into_bytes(),
            )]
        } else {
            let service = format!(
                "# {TAG}{encoded}\n[Unit]\nDescription=TMT finite minute tick\n[Service]\nType=oneshot\nExecStart=:{} tick --json\nEnvironment={} {} {}\nWorkingDirectory={}\nTimeoutStartSec=90\nTimeoutStopSec=15\nKillMode=mixed\n",
                systemd(exe),
                systemd(&format!("TMT_HOME={root}")),
                systemd(&format!("HOME={home}")),
                systemd(&format!("PATH={}", m.path)),
                systemd(home)
            );
            let timer = format!(
                "# {TAG}{encoded}\n[Unit]\nDescription=TMT minute opportunities\n[Timer]\nOnCalendar=*-*-* *:*:00\nAccuracySec=1s\nPersistent=false\nUnit={label}.service\n[Install]\nWantedBy=timers.target\n"
            );
            vec![
                (
                    m.directory.join(format!("{label}.service")),
                    service.into_bytes(),
                ),
                (
                    m.directory.join(format!("{label}.timer")),
                    timer.into_bytes(),
                ),
            ]
        }
    }
    pub fn preview(&self) -> Value {
        json!({"schemaVersion":1,"action":"timer.preview","label":self.label(),"manager":self.manifest.platform,"scope":"user","command":[self.manifest.executable,"tick","--json"],"dataRoot":self.manifest.root,"files":self.files().into_iter().map(|(path,bytes)|json!({"path":path,"contents":String::from_utf8(bytes).unwrap()})).collect::<Vec<_>>(),"requiresConsent":true,"idleAlerts":false})
    }
    fn read_file(&self, path: &Path) -> io::Result<Option<Vec<u8>>> {
        let file = match OpenOptions::new()
            .read(true)
            .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
            .open(path)
        {
            Ok(file) => file,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        let meta = file.metadata()?;
        if !meta.is_file()
            || meta.uid() != self.manifest.uid
            || meta.permissions().mode() & 0o022 != 0
        {
            return Err(invalid(
                "Timer files must be regular, user-owned and not writable by others.",
            ));
        }
        bounded_file::read_opened(file, LIMIT)
            .map(Some)
            .map_err(io::Error::other)
    }
    /// Regeneration recognizes earlier generated files after PATH/executable changes,
    /// while retaining any edited or unrecognized unit. No separate ownership ledger.
    fn retained(&self) -> io::Result<Option<Self>> {
        let mut retained: Option<Self> = None;
        for (path, _) in self.files() {
            let Some(bytes) = self.read_file(&path)? else {
                continue;
            };
            let body =
                std::str::from_utf8(&bytes).map_err(|_| invalid("Timer file is not UTF-8."))?;
            let encoded = body
                .lines()
                .find_map(|line| {
                    line.strip_prefix("# ")
                        .or_else(|| line.strip_prefix("<!-- "))
                        .and_then(|line| line.strip_prefix(TAG))
                        .map(|line| line.trim_end_matches(" -->"))
                })
                .ok_or_else(|| {
                    invalid("Timer file is not a recognized TMT unit; it was preserved.")
                })?;
            let parsed: Manifest = serde_json::from_slice(
                &STANDARD
                    .decode(encoded)
                    .map_err(|_| invalid("Invalid timer manifest encoding."))?,
            )
            .map_err(io::Error::other)?;
            let old = Self::new(parsed)?;
            if old.manifest.root != self.manifest.root
                || old.manifest.directory != self.manifest.directory
                || old.manifest.uid != self.manifest.uid
                || old.manifest.platform != self.manifest.platform
                || retained
                    .as_ref()
                    .is_some_and(|other| other.manifest != old.manifest)
                || !old.files().iter().any(|(p, b)| p == &path && b == &bytes)
            {
                return Err(invalid(
                    "Timer file differs from its owned plan; it was preserved.",
                ));
            }
            retained = Some(old);
        }
        Ok(retained)
    }
    /// Select the exact retained plan before consent, including its old executable.
    pub fn for_removal(&self) -> io::Result<Self> {
        self.retained()?.ok_or_else(|| {
            invalid(
                "No owned timer file proves removal authority; inspect the user manager manually.",
            )
        })
    }
    fn command(
        &self,
        runner: &dyn CommandRunner,
        args: &[String],
        deadline: Instant,
    ) -> io::Result<()> {
        let program = if self.manifest.platform == "launchd" {
            "/bin/launchctl"
        } else {
            "systemctl"
        };
        let args = args.iter().map(OsString::from).collect::<Vec<_>>();
        runner
            .execute(CommandRequest {
                program: std::ffi::OsStr::new(program),
                args: &args,
                input: b"",
                deadline,
                max_output_bytes: 8192,
            })
            .map(|_| ())
            .map_err(io::Error::other)
    }
    fn query(&self, runner: &dyn CommandRunner, deadline: Instant) -> bool {
        let args = if self.manifest.platform == "launchd" {
            vec![
                "print".into(),
                format!("gui/{}/{}", self.manifest.uid, self.label()),
            ]
        } else {
            vec![
                "--user".into(),
                "is-active".into(),
                format!("{}.timer", self.label()),
            ]
        };
        self.command(runner, &args, deadline).is_ok()
    }
    pub fn status(&self, runner: &dyn CommandRunner) -> io::Result<Value> {
        let retained = self.retained()?;
        let loaded = self.query(runner, Instant::now() + Duration::from_secs(15));
        Ok(
            json!({"schemaVersion":1,"action":"timer.status","label":self.label(),"files":if retained.is_some(){"owned"}else{"absent"},"managerState":if loaded{"registered"}else{"unconfirmed"},"installedPlan":retained.map(|plan|plan.preview())}),
        )
    }
    /// Call only after the CLI's explicit whole-plan consent. Tests inject a manager.
    pub fn apply(&self, action: Action, runner: &dyn CommandRunner) -> io::Result<Value> {
        if !matches!(action, Action::Install | Action::Remove) {
            return Err(invalid("Expected timer install or remove."));
        }
        private_file::ensure_private_directory(&self.manifest.root.join("tick"))?;
        let _guard = file_lock::exclusive(&self.manifest.root.join("tick/timer.lock"))?;
        let old = self.retained()?;
        let deadline = Instant::now() + Duration::from_secs(15);
        if action == Action::Install {
            if old
                .as_ref()
                .is_some_and(|old| old.manifest != self.manifest)
            {
                return Err(invalid(
                    "An earlier owned timer plan exists. Remove it explicitly before installing the new plan.",
                ));
            }
            fs::DirBuilder::new()
                .recursive(true)
                .mode(0o700)
                .create(&self.manifest.directory)?;
            self.check_directory()?;
            for (path, bytes) in self.files() {
                match OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .mode(0o600)
                    .custom_flags(nix::libc::O_NOFOLLOW)
                    .open(&path)
                {
                    Ok(mut file) => {
                        file.write_all(&bytes)?;
                        file.sync_all()?;
                    }
                    Err(e) if e.kind() == io::ErrorKind::AlreadyExists => {
                        if self.read_file(&path)?.as_deref() != Some(bytes.as_slice()) {
                            return Err(invalid(
                                "Timer file changed during installation; it was preserved.",
                            ));
                        }
                    }
                    Err(e) => return Err(e),
                }
            }
            File::open(&self.manifest.directory)?.sync_all()?;
            if self.manifest.platform == "launchd" {
                // A loaded label does not prove its in-memory configuration matches
                // these files. Make one explicit registration attempt; an already
                // loaded or uncertain outcome preserves the files for inspection.
                self.command(
                    runner,
                    &[
                        "bootstrap".into(),
                        format!("gui/{}", self.manifest.uid),
                        text(&self.files()[0].0)?.into(),
                    ],
                    deadline,
                )?;
            } else {
                self.command(runner, &["--user".into(), "daemon-reload".into()], deadline)?;
                self.command(
                    runner,
                    &[
                        "--user".into(),
                        "enable".into(),
                        "--now".into(),
                        format!("{}.timer", self.label()),
                    ],
                    deadline,
                )?;
            }
        } else {
            let old=old.ok_or_else(||invalid("No owned timer file proves removal authority; inspect the user manager manually."))?;
            if old.manifest != self.manifest {
                return Err(invalid(
                    "The retained timer plan changed after review; no removal was started.",
                ));
            }
            self.check_directory()?;
            if self.manifest.platform == "launchd" {
                self.command(
                    runner,
                    &[
                        "bootout".into(),
                        format!("gui/{}/{}", self.manifest.uid, self.label()),
                    ],
                    deadline,
                )?;
            } else {
                self.command(
                    runner,
                    &[
                        "--user".into(),
                        "disable".into(),
                        "--now".into(),
                        format!("{}.timer", self.label()),
                    ],
                    deadline,
                )?;
                self.command(
                    runner,
                    &[
                        "--user".into(),
                        "stop".into(),
                        format!("{}.service", self.label()),
                    ],
                    deadline,
                )?;
            }
            for (path, bytes) in old.files() {
                match self.read_file(&path)? {
                    None => {}
                    Some(current) if current == bytes => fs::remove_file(path)?,
                    Some(_) => {
                        return Err(invalid(
                            "Timer file changed during removal; it was preserved.",
                        ));
                    }
                }
            }
            File::open(&self.manifest.directory)?.sync_all()?;
            if self.manifest.platform == "systemd" {
                self.command(runner, &["--user".into(), "daemon-reload".into()], deadline)?;
            }
        }
        Ok(
            json!({"schemaVersion":1,"action":if action==Action::Install{"timer.install"}else{"timer.remove"},"label":self.label(),"complete":true}),
        )
    }
    fn check_directory(&self) -> io::Result<()> {
        let meta = fs::symlink_metadata(&self.manifest.directory)?;
        if !meta.is_dir()
            || meta.uid() != self.manifest.uid
            || meta.permissions().mode() & 0o022 != 0
        {
            return Err(invalid(
                "User timer directory must be a real user-owned directory not writable by others.",
            ));
        }
        Ok(())
    }
}
#[cfg(test)]
mod tests;
