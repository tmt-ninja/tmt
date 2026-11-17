//! Discovery refuses a fake host world before touching application state.
#![cfg(unix)]
mod support;
use std::{
    fs,
    path::PathBuf,
    process::{Child, Command, Output, Stdio},
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture {
    root: PathBuf,
    child: Option<Child>,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "tmt-isolation-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self { root, child: None }
    }
    fn run(&mut self, mut command: Command) -> Output {
        let stdout = self.root.join("stdout");
        let stderr = self.root.join("stderr");
        self.child = Some(
            command
                .stdin(Stdio::null())
                .stdout(fs::File::create(&stdout).unwrap())
                .stderr(fs::File::create(&stderr).unwrap())
                .spawn()
                .unwrap(),
        );
        let status = support::wait(&mut self.child, Duration::from_secs(15))
            .wait()
            .unwrap();
        Output {
            status,
            stdout: fs::read(stdout).unwrap(),
            stderr: fs::read(stderr).unwrap(),
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        support::stop(&mut self.child);
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn dependency_compiled_cli_refuses_unadmitted_existing_fake_host_state() {
    let mut f = Fixture::new();
    let host = f.root.join("fake-host");
    let state = support::state_dir(&host);
    fs::create_dir_all(&state).unwrap();
    let sentinel = state.join("config.json");
    fs::write(&sentinel, b"{\"theme\":{\"base\":\"mono\"}}\n").unwrap();
    let mut command = support::command(&host, &["config", "show", "--json"]);
    command.env_remove("TMT_TEST_ROOT");
    let output = f.run(command);
    assert!(
        !output.status.success(),
        "a missing admission must refuse, even when the destination exists"
    );
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("built with test isolation"), "{text}");
    assert!(text.contains("private test root"), "{text}");
    assert_eq!(
        fs::read(sentinel).unwrap(),
        b"{\"theme\":{\"base\":\"mono\"}}\n"
    );
    assert_eq!(fs::read_dir(state).unwrap().count(), 1);
}

#[test]
fn private_discovery_accepts_missing_paths_but_refuses_symlink_and_environment_escape() {
    use std::os::unix::fs::symlink;
    let mut f = Fixture::new();
    let private = f.root.join("private");
    let mut command = support::command(&private, &["config", "show", "--json"]);
    command.env("TMT_TEST_ROOT", &private);
    assert!(f.run(command).status.success());
    assert!(!support::state_dir(&private).exists());
    let host = f.root.join("fake-host");
    fs::create_dir(&host).unwrap();
    fs::write(host.join("sentinel"), b"unchanged").unwrap();
    symlink(&host, private.join("escape")).unwrap();
    for selected in [host.clone(), private.join("escape/missing")] {
        let mut command = support::command(&private, &["config", "show", "--json"]);
        command
            .env("TMT_TEST_ROOT", &private)
            .env("TMT_HOME", selected);
        let output = f.run(command);
        assert!(
            !output.status.success(),
            "escaped selected root must refuse"
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("test isolation"));
    }
    let mut command = support::command(&private, &["config", "show", "--json"]);
    command.env("TMT_TEST_ROOT", &private).env("HOME", &host);
    assert!(!f.run(command).status.success());
    symlink(host.join("absent"), private.join("dangling")).unwrap();
    let mut command = support::command(&private, &["config", "show", "--json"]);
    command
        .env("TMT_TEST_ROOT", &private)
        .env("TMT_HOME", private.join("dangling/child"));
    assert!(!f.run(command).status.success());
    fs::create_dir_all(private.join("deep/a/b")).unwrap();
    symlink(private.join("deep/a/b"), private.join("deep-alias")).unwrap();
    let mut command = support::command(&private, &["config", "show", "--json"]);
    command
        .env("TMT_TEST_ROOT", &private)
        .env("TMT_HOME", private.join("deep-alias/../../outside"));
    assert!(
        !f.run(command).status.success(),
        "derived lexical paths must stay private too"
    );
    let mut command = support::command(
        &private,
        &["config", "set", "theme.base", "mono", "--global", "--json"],
    );
    command.env("TMT_TEST_ROOT", &private);
    assert!(f.run(command).status.success());
    let value: serde_json::Value = serde_json::from_slice(
        &fs::read(support::state_dir(&private).join("config.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(value["theme"]["base"], "mono");
    assert_eq!(fs::read(host.join("sentinel")).unwrap(), b"unchanged");
    assert_eq!(fs::read_dir(host).unwrap().count(), 1);
}

#[test]
fn private_discovery_never_reads_local_config_above_the_admitted_root() {
    let mut f = Fixture::new();
    fs::write(f.root.join("tmt.json"), b"not JSON").unwrap();
    let private = f.root.join("private");
    let mut command = support::command(&private, &["config", "show", "--json"]);
    command.env("TMT_TEST_ROOT", &private);
    let output = f.run(command);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert_eq!(fs::read(f.root.join("tmt.json")).unwrap(), b"not JSON");
}

#[test]
fn migrated_commands_keep_human_json_and_failure_streams() {
    let mut f = Fixture::new();
    let human_root = f.root.join("human");
    let json_root = f.root.join("json");
    for (root, json) in [(&human_root, false), (&json_root, true)] {
        let args: &[&str] = if json { &["init", "--json"] } else { &["init"] };
        let result = f.run(support::command(root, args));
        assert_eq!(result.status.code(), Some(0));
        assert!(result.stderr.is_empty());
        let created = fs::canonicalize(root).unwrap().join("tmt.json");
        let expected = if json {
            format!("{}\n", serde_json::json!({"created": created}))
        } else {
            format!("✓ Created {}\n", created.display())
        };
        assert_eq!(result.stdout, expected.as_bytes());

        let args: &[&str] = if json {
            &["config", "set", "preambleEvery", "7", "--json"]
        } else {
            &["config", "set", "preambleEvery", "7"]
        };
        let result = f.run(support::command(root, args));
        assert_eq!(result.status.code(), Some(0));
        assert!(result.stderr.is_empty());
        assert_eq!(
            result.stdout,
            if json {
                b"{\"ok\":true}\n".as_slice()
            } else {
                "✓ Set preambleEvery=7 in local config (repo override)\n".as_bytes()
            }
        );

        let bad: &[&str] = if json {
            &["config", "set", "--global", "theme.base", "bad", "--json"]
        } else {
            &["config", "set", "--global", "theme.base", "bad"]
        };
        let result = f.run(support::command(root, bad));
        assert_eq!(result.status.code(), Some(1));
        if json {
            assert_eq!(result.stdout, b"{\"error\":{\"code\":\"ERROR\",\"message\":\"Invalid value for theme.base: bad.\",\"suggestion\":\"Valid bases: tmt, tmt-light, terminal, mono\"}}\n");
            assert!(result.stderr.is_empty());
        } else {
            assert!(result.stdout.is_empty());
            assert_eq!(result.stderr, b"error: Invalid value for theme.base: bad\nhint: Valid bases: tmt, tmt-light, terminal, mono\n");
        }
        let created_identity = f.run(support::command(
            root,
            &["identity", "create", "worker", "--json"],
        ));
        assert_eq!(created_identity.status.code(), Some(0));
        let identity: serde_json::Value = serde_json::from_slice(&created_identity.stdout).unwrap();
        let id = identity["identity"]["id"].as_str().unwrap();
        let notes = support::state_dir(root)
            .join("notes")
            .join(id)
            .join("notes.md");
        let args: &[&str] = if json {
            &["notes", "path", "--identity", "worker", "--json"]
        } else {
            &["notes", "path", "--identity", "worker"]
        };
        let result = f.run(support::command(root, args));
        assert_eq!(result.status.code(), Some(0));
        assert!(result.stderr.is_empty());
        let expected = if json {
            format!(
                "{}\n",
                serde_json::json!({"identityId":id,"path":notes,"created":true})
            )
        } else {
            format!("{}\n", notes.display())
        };
        assert_eq!(result.stdout, expected.as_bytes());
    }
}
