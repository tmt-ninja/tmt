use super::*;
use tmt_adapters::runtime::{RuntimeCommand, launch_preset::LaunchPreset};
use tmt_core::{
    binding::session::{
        DriverState, HarnessId, ObservedSessionKey, ProviderSessionId, RuntimeMode,
        SessionPreferences,
    },
    identity::{Lifetime, create_or_resolve},
};

struct TempDir(std::path::PathBuf);
impl TempDir {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!("tmt-run-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn setup_binding(db_path: &std::path::Path) -> (Storage, String, Binding) {
    let mut storage = Storage::open(db_path).unwrap();
    let identity = create_or_resolve(&mut storage, "Preset", Lifetime::Saved)
        .unwrap()
        .identity;
    storage.close().unwrap();
    let conn = rusqlite::Connection::open(db_path).unwrap();
    conn.execute(
        "INSERT INTO bindings (id,identity_id,transport,pane_id,server_id,socket_path,server_pid,server_start_time,pane_pid,bound_at,last_verified_at)
         VALUES ('00000000-0000-4000-8000-000000000001',?,'tmux','%1','srv-1','/tmp/tmt-test-sock',100,'srv-start',200,'1000','1000')",
        [&identity.id],
    )
    .unwrap();
    drop(conn);
    let mut storage = Storage::open(db_path).unwrap();
    let binding = storage
        .with_binding_transaction(|records| records.entry_by_id(&identity.id))
        .unwrap()
        .and_then(|entry| entry.binding)
        .expect("created binding");
    (storage, identity.id, binding)
}

fn seed_preset(
    dir: &std::path::Path,
    storage: &mut Storage,
    identity_id: &str,
    binding_id: &str,
    owner: &ProcessIncarnation,
) {
    use std::os::unix::fs::PermissionsExt;
    let wrapper = dir.join("claude_mini");
    std::fs::write(&wrapper, "#!/bin/sh\nexit 0\n").unwrap();
    std::fs::set_permissions(&wrapper, std::fs::Permissions::from_mode(0o700)).unwrap();
    let command = RuntimeCommand {
        executable: wrapper.into(),
        args: vec![
            "--model".into(),
            "opus".into(),
            "--effort".into(),
            "high".into(),
        ],
    };
    let preset = LaunchPreset::capture(
        &command,
        &RuntimeRegistry::first_party(),
        binding_id,
        owner,
        |_| None,
    )
    .expect("valid preset");
    assert!(tmt_adapters::runtime::launch_preset::remember(storage, identity_id, &preset).unwrap());
}

#[test]
fn session_start_before_remember_with_exited_child_associates_preset() {
    let dir = TempDir::new("assoc");
    let (mut storage, identity_id, mut binding) = setup_binding(&dir.0.join("tmt.db"));
    let owner = ProcessIncarnation::new(300, "owner-start").unwrap();
    let child = ProcessIncarnation::new(301, "child-start").unwrap();
    let session_id = ProviderSessionId::new("12345678-1234-4234-8234-123456789abc").unwrap();
    let harness = HarnessId::new("claude").unwrap();

    // SessionStart hook commits before `remember` writes `resume.launch`, and child exits
    // before `observe_runtime` so `admit_foreground` returns `None`.
    let mut next = binding.session.clone();
    next.launch_owner = Some(owner.clone());
    next.key = Some(ObservedSessionKey {
        incarnation: child,
        provider_session: Some(session_id.clone()),
    });
    let mut prefs = SessionPreferences::default();
    prefs.remember(
        harness,
        RuntimeMode::new("interactive").unwrap(),
        session_id.clone(),
    );
    if let Some(remembered) = prefs.remembered.as_mut() {
        remembered.state = Some(DriverState::new(1, r#"{"model":"sonnet"}"#).unwrap());
    }
    storage
        .with_binding_transaction(|records| {
            assert!(records.set_session_state(&binding.id, &binding.session, &next)?);
            records.set_session_preferences(&identity_id, &prefs)?;
            Ok::<_, tmt_adapters::storage::StorageError>(())
        })
        .unwrap();
    binding.session = next;

    seed_preset(&dir.0, &mut storage, &identity_id, &binding.id, &owner);
    associate_remembered_preset(
        &mut storage,
        &binding,
        Some(&owner),
        None,
        &RuntimeRegistry::first_party(),
    )
    .unwrap();

    let stored = tmt_adapters::runtime::launch_preset::read(&storage, &identity_id)
        .unwrap()
        .expect("preset exists");
    assert_eq!(stored.harness.as_deref(), Some("claude"));
    assert_eq!(stored.session.as_deref(), Some(session_id.as_str()));
    assert_eq!(stored.model.as_deref(), Some("sonnet"));
}

#[test]
fn stale_remembered_session_from_older_owner_stays_unassociated() {
    let dir = TempDir::new("stale");
    let (mut storage, identity_id, binding) = setup_binding(&dir.0.join("tmt.db"));
    let old_owner = ProcessIncarnation::new(300, "old-owner").unwrap();
    let new_owner = ProcessIncarnation::new(400, "new-owner").unwrap();
    let old_child = ProcessIncarnation::new(301, "old-child").unwrap();
    let old_session = ProviderSessionId::new("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").unwrap();
    let harness = HarnessId::new("claude").unwrap();

    // Older launch committed a remembered session; new launch has not had SessionStart yet.
    let mut prev = binding.session.clone();
    prev.launch_owner = Some(old_owner);
    prev.key = Some(ObservedSessionKey {
        incarnation: old_child,
        provider_session: Some(old_session.clone()),
    });
    let mut prefs = SessionPreferences::default();
    prefs.remember(
        harness,
        RuntimeMode::new("interactive").unwrap(),
        old_session,
    );
    if let Some(remembered) = prefs.remembered.as_mut() {
        remembered.state = Some(DriverState::new(1, r#"{"model":"sonnet"}"#).unwrap());
    }
    storage
        .with_binding_transaction(|records| {
            assert!(records.set_session_state(&binding.id, &binding.session, &prev)?);
            records.set_session_preferences(&identity_id, &prefs)?;
            Ok::<_, tmt_adapters::storage::StorageError>(())
        })
        .unwrap();

    seed_preset(&dir.0, &mut storage, &identity_id, &binding.id, &new_owner);
    associate_remembered_preset(
        &mut storage,
        &binding,
        Some(&new_owner),
        None,
        &RuntimeRegistry::first_party(),
    )
    .unwrap();

    let stored = tmt_adapters::runtime::launch_preset::read(&storage, &identity_id)
        .unwrap()
        .expect("preset exists");
    assert_eq!(stored.harness, None);
    assert_eq!(stored.session, None);
    assert_eq!(stored.model.as_deref(), Some("opus"));
}
