use super::{
    ProviderEnvironment, ensure_publication_roots, files, install, install_with_publisher,
};
use crate::test_support::TestDirectory;
use std::{fs, io};

#[test]
fn failed_publication_reports_prior_success_then_releases_lock() {
    let root = TestDirectory::new();
    let home = root.path.join("home");
    let global = root.path.join("global");
    fs::create_dir(&home).unwrap();
    let env = ProviderEnvironment::from_parts(home.clone(), root.path.clone(), Vec::new(), []);
    let first = home.join(".claude/skills/tmt");
    let second = home.join(".agents/skills/tmt");
    fs::create_dir_all(&second).unwrap();
    fs::write(second.join("user.md"), b"irreplaceable user content").unwrap();
    let mut publications = 0;
    let failure =
        install_with_publisher(&env, &global, Some("all"), None, true, |target, source| {
            publications += 1;
            if target == second {
                // Fail before the replacement boundary.
                assert!(target.is_dir());
                return Err(io::Error::other("injected publication failure"));
            }
            files::link(target, source)
        })
        .unwrap_err();
    assert_eq!(publications, 3);
    assert_eq!(failure.report.installed.len(), 2);
    assert_eq!(failure.report.installed[0].target, first);
    assert!(fs::symlink_metadata(&first).unwrap().is_symlink());
    assert!(failure.pending_backup.is_none());
    assert_eq!(
        fs::read(second.join("user.md")).unwrap(),
        b"irreplaceable user content"
    );
    let message = failure.to_string();
    assert!(message.contains("injected publication failure"));
    assert!(message.contains(first.to_str().unwrap()));
    // Intent remains discoverable, but failed targets are not reported installed.
    assert!(super::registry::read(&global).unwrap().contains(&second));
    let retry = install(&env, &global, Some("all"), None, false).unwrap();
    assert!(!retry.installed[0].changed);
    assert!(!retry.installed[1].changed);
    assert!(retry.installed[2].changed);
    assert!(fs::symlink_metadata(&second).unwrap().is_symlink());
}

#[test]
fn abandoned_stage_is_preserved_without_blocking_a_new_install() {
    let root = TestDirectory::new();
    let global = root.path.join("global");
    let stage = global.join("skill-assets/.stage-abandoned");
    fs::create_dir_all(&stage).unwrap();
    fs::write(stage.join("partial"), b"preserve for inspection").unwrap();
    let env =
        ProviderEnvironment::from_parts(root.path.join("home"), root.path.clone(), Vec::new(), []);
    let result = install(&env, &global, None, None, false).unwrap();
    assert!(result.installed[0].changed);
    assert_eq!(
        fs::read(stage.join("partial")).unwrap(),
        b"preserve for inspection"
    );
}

#[test]
fn publication_needs_the_store_and_home_to_agree() {
    let root = TestDirectory::new();
    let home = root.path.join("home");
    fs::create_dir(&home).unwrap();
    let env = ProviderEnvironment::from_parts(home.clone(), root.path.clone(), Vec::new(), []);
    ensure_publication_roots(&env, &home.join(".config/tmt")).unwrap();

    // The `..` is resolved first: this is outside HOME, whatever its prefix says.
    for store in [root.path.join("isolated/tmt"), home.join("../isolated/tmt")] {
        let refusal = ensure_publication_roots(&env, &store)
            .unwrap_err()
            .to_string();
        assert!(refusal.contains(&root.path.join("isolated/tmt").display().to_string()));
        assert!(refusal.contains(&home.display().to_string()));
        assert!(refusal.contains("TMT_HOME") && refusal.contains("XDG_CONFIG_HOME"));
    }
}

#[test]
fn a_store_reached_through_a_symlink_on_either_side_agrees() {
    let root = TestDirectory::new();
    let home = root.path.join("home");
    let dotfiles = root.path.join("dotfiles");
    fs::create_dir(&home).unwrap();
    fs::create_dir(&dotfiles).unwrap();
    // A dotfile manager's `~/.config` link keeps the store inside HOME by its own path.
    std::os::unix::fs::symlink(&dotfiles, home.join(".config")).unwrap();
    let env = ProviderEnvironment::from_parts(home.clone(), root.path.clone(), Vec::new(), []);
    ensure_publication_roots(&env, &home.join(".config/tmt")).unwrap();

    // A HOME spelled through an alias still contains its real store.
    let alias = root.path.join("alias");
    std::os::unix::fs::symlink(&home, &alias).unwrap();
    let env = ProviderEnvironment::from_parts(alias, root.path.clone(), Vec::new(), []);
    ensure_publication_roots(&env, &home.join("store/tmt")).unwrap();
}
