//! Private paths and an injected manager only; no host service manager runs.
use super::*;
use crate::{
    process::{CommandError, CommandFailure, CommandOutput},
    test_support::TestDirectory,
};
use std::cell::{Cell, RefCell};
#[derive(Default)]
struct Manager {
    calls: RefCell<Vec<Vec<String>>>,
    fail_at: Cell<Option<usize>>,
    edit: RefCell<Option<(PathBuf, Vec<u8>)>>,
}
impl CommandRunner for Manager {
    fn execute(&self, r: CommandRequest<'_>) -> Result<CommandOutput, CommandError> {
        assert!(r.input.is_empty());
        assert!(r.deadline > Instant::now());
        assert_eq!(r.max_output_bytes, 8192);
        let mut call = vec![r.program.to_str().unwrap().to_owned()];
        call.extend(r.args.iter().map(|a| a.to_str().unwrap().to_owned()));
        self.calls.borrow_mut().push(call);
        if let Some((path, bytes)) = self.edit.borrow_mut().take() {
            fs::write(path, bytes).unwrap();
        }
        if self.fail_at.get() == Some(self.calls.borrow().len()) {
            return Err(CommandError::new(CommandFailure::Exit {
                code: Some(1),
                signal: None,
            }));
        }
        Ok(CommandOutput {
            stdout: vec![],
            stderr: vec![],
        })
    }
}
fn plan(root: &Path, platform: &str) -> Plan {
    Plan::new(Manifest {
        version: 1,
        platform: platform.into(),
        uid: nix::unistd::geteuid().as_raw(),
        root: root.join("tmt data %$&"),
        home: root.join("user home"),
        directory: root.join("units"),
        executable: root.join("bin/tmt %$&\""),
        path: "/private/bin $x%:/usr/bin".into(),
    })
    .unwrap()
}
#[test]
fn plans_are_finite_literal_and_preview_has_no_file_or_manager_effect() {
    let temp = TestDirectory::new();
    for platform in ["launchd", "systemd"] {
        let p = plan(&temp.path, platform);
        let preview = p.preview();
        assert_eq!(
            preview["command"],
            json!([p.manifest.executable, "tick", "--json"])
        );
        assert_eq!(preview["scope"], "user");
        assert_eq!(preview["idleAlerts"], false);
        assert!(!p.manifest.root.exists());
        assert!(!p.manifest.directory.exists());
        let files = p.files();
        let body = String::from_utf8(files[0].1.clone()).unwrap();
        if platform == "launchd" {
            assert!(body.contains("<key>StartInterval</key><integer>60</integer>"));
            assert!(body.contains("%$&amp;&quot;"));
            assert!(!body.contains("KeepAlive"));
        } else {
            assert!(body.contains("ExecStart=:\""));
            assert!(body.contains("%%$&\\\""));
            assert!(body.contains("KillMode=mixed"));
            assert!(
                String::from_utf8(files[1].1.clone())
                    .unwrap()
                    .contains("Persistent=false")
            );
        }
    }
}
#[test]
fn install_remove_use_the_user_manager_and_stop_the_active_oneshot() {
    for platform in ["launchd", "systemd"] {
        let temp = TestDirectory::new();
        let p = plan(&temp.path, platform);
        let m = Manager::default();
        p.apply(Action::Install, &m).unwrap();
        for (path, bytes) in p.files() {
            assert_eq!(fs::read(&path).unwrap(), bytes);
            assert_eq!(
                fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        assert_eq!(p.status(&m).unwrap()["files"], "owned");
        p.for_removal().unwrap().apply(Action::Remove, &m).unwrap();
        assert!(p.files().iter().all(|(path, _)| !path.exists()));
        let calls = m.calls.borrow();
        if platform == "launchd" {
            assert!(
                calls
                    .iter()
                    .any(|a| a[1] == "bootout" && a[2].starts_with("gui/"))
            );
        } else {
            assert!(calls.iter().all(|a| a[1] == "--user"));
            let disabled = calls
                .iter()
                .position(|a| a[2] == "disable" && a[3] == "--now")
                .unwrap();
            let stopped = calls
                .iter()
                .position(|a| a[2] == "stop" && a[3].ends_with(".service"))
                .unwrap();
            assert!(disabled < stopped);
        }
    }
}
#[test]
fn edited_symlink_and_mixed_units_are_preserved_without_manager_calls() {
    let temp = TestDirectory::new();
    let p = plan(&temp.path, "systemd");
    let m = Manager::default();
    p.apply(Action::Install, &m).unwrap();
    m.calls.borrow_mut().clear();
    let files = p.files();
    fs::write(&files[0].0, b"user-owned replacement").unwrap();
    assert!(p.apply(Action::Remove, &m).is_err());
    assert!(p.apply(Action::Install, &m).is_err());
    assert!(m.calls.borrow().is_empty());
    assert_eq!(fs::read(&files[0].0).unwrap(), b"user-owned replacement");
    fs::remove_file(&files[0].0).unwrap();
    let outside = temp.path.join("preserve");
    fs::write(&outside, b"kept").unwrap();
    std::os::unix::fs::symlink(&outside, &files[0].0).unwrap();
    assert!(p.apply(Action::Remove, &m).is_err());
    assert_eq!(fs::read(&outside).unwrap(), b"kept");
    assert!(m.calls.borrow().is_empty());
    fs::remove_file(&files[0].0).unwrap();
    let mut other = p.clone();
    other.manifest.path.push_str(":/different");
    fs::write(&files[0].0, &other.files()[0].1).unwrap();
    assert!(p.apply(Action::Remove, &m).is_err());
    assert!(m.calls.borrow().is_empty());
}
#[test]
fn old_plans_remain_removable_but_changed_review_or_manager_failure_retains_files() {
    let temp = TestDirectory::new();
    let old = plan(&temp.path, "systemd");
    let m = Manager::default();
    old.apply(Action::Install, &m).unwrap();
    let mut next = old.clone();
    next.manifest.executable = temp.path.join("new/tmt");
    next.manifest.path.push_str(":/new");
    assert!(next.apply(Action::Install, &m).is_err());
    let reviewed = next.for_removal().unwrap();
    assert_eq!(reviewed.manifest, old.manifest);
    for (path, bytes) in next.files() {
        fs::write(path, bytes).unwrap();
    }
    m.calls.borrow_mut().clear();
    assert!(reviewed.apply(Action::Remove, &m).is_err());
    assert!(m.calls.borrow().is_empty());
    for (path, bytes) in old.files() {
        fs::write(path, bytes).unwrap();
    }
    m.fail_at.set(Some(1));
    assert!(reviewed.apply(Action::Remove, &m).is_err());
    assert_eq!(m.calls.borrow().len(), 1);
    assert!(
        old.files()
            .iter()
            .all(|(path, bytes)| fs::read(path).unwrap() == *bytes)
    );
    m.calls.borrow_mut().clear();
    m.fail_at.set(None);
    next.for_removal()
        .unwrap()
        .apply(Action::Remove, &m)
        .unwrap();
    assert!(old.files().iter().all(|(path, _)| !path.exists()));
}
#[test]
fn concurrent_mutation_and_post_manager_edits_never_unlink_unknown_files() {
    let temp = TestDirectory::new();
    let p = plan(&temp.path, "systemd");
    let m = Manager::default();
    p.apply(Action::Install, &m).unwrap();
    let guard = file_lock::exclusive(&p.manifest.root.join("tick/timer.lock")).unwrap();
    m.calls.borrow_mut().clear();
    assert!(p.apply(Action::Remove, &m).is_err());
    assert!(m.calls.borrow().is_empty());
    drop(guard);
    let path = p.files()[0].0.clone();
    *m.edit.borrow_mut() = Some((path.clone(), b"edited during stop".to_vec()));
    assert!(p.apply(Action::Remove, &m).is_err());
    assert_eq!(fs::read(path).unwrap(), b"edited during stop");
}
#[test]
fn failed_registration_is_uncertain_without_automatic_retry_or_file_rollback() {
    let temp = TestDirectory::new();
    let p = plan(&temp.path, "systemd");
    let m = Manager::default();
    m.fail_at.set(Some(2));
    assert!(p.apply(Action::Install, &m).is_err());
    assert_eq!(m.calls.borrow().len(), 2);
    assert!(
        p.files()
            .iter()
            .all(|(path, bytes)| fs::read(path).unwrap() == *bytes)
    );
    m.calls.borrow_mut().clear();
    m.fail_at.set(Some(1));
    assert_eq!(p.status(&m).unwrap()["managerState"], "unconfirmed");
    assert_eq!(m.calls.borrow().len(), 1);
}

#[test]
fn launchd_registration_is_one_gui_attempt_not_a_loaded_label_claim() {
    let temp = TestDirectory::new();
    let p = plan(&temp.path, "launchd");
    let manager = Manager::default();
    p.apply(Action::Install, &manager).unwrap();
    assert_eq!(
        *manager.calls.borrow(),
        vec![vec![
            "/bin/launchctl".to_owned(),
            "bootstrap".into(),
            format!("gui/{}", p.manifest.uid),
            p.files()[0].0.to_str().unwrap().into()
        ]]
    );
    manager.calls.borrow_mut().clear();
    manager.fail_at.set(Some(1));
    assert!(p.apply(Action::Install, &manager).is_err());
    assert_eq!(
        manager.calls.borrow().len(),
        1,
        "no query-based success or automatic reload/retry"
    );
    assert!(
        p.files()
            .iter()
            .all(|(path, bytes)| fs::read(path).unwrap() == *bytes)
    );
}

#[test]
fn an_unmanaged_deep_executable_is_not_mistaken_for_verified_installation() {
    let temp = TestDirectory::new();
    let executable = temp.path.join("a/b/c/d/e/f/tmt");
    let root = temp.path.join("data");
    let plan = Plan::discover(&root, &executable).unwrap();
    assert_eq!(plan.manifest.executable, executable);
    assert!(!root.exists());
    let candidate = managed::release_prefix(&executable).unwrap();
    fs::create_dir_all(candidate.join(managed::Product::Cli.namespace())).unwrap();
    assert!(
        Plan::discover(&root, &executable).is_err(),
        "a claimed managed namespace needs its existing owner's proof"
    );
}

#[test]
fn generation_never_admits_files_too_large_for_later_ownership_validation() {
    let long = PathBuf::from(format!("/{}", "x".repeat(16_000)));
    let result = Plan::new(Manifest {
        version: 1,
        platform: "launchd".into(),
        uid: nix::unistd::geteuid().as_raw(),
        root: long.clone(),
        home: long.clone(),
        directory: long.clone(),
        executable: long,
        path: "p".repeat(32_000),
    });
    assert_eq!(result.unwrap_err().kind(), io::ErrorKind::InvalidInput);
}
