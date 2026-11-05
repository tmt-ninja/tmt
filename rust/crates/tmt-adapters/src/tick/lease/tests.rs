use super::*;
use crate::test_support::TestDirectory;
#[test]
fn status_creates_nothing_and_competing_lifetimes_share_one_stable_lock() {
    let d = TestDirectory::new();
    assert_eq!(status(&d.path, 1000).unwrap()["state"], "stopped");
    assert!(!d.path.join("tick").exists());
    let mut a = Lease::acquire(&d.path, "run", 1000).unwrap();
    let token = a.token().to_owned();
    assert_eq!(status(&d.path, 1000).unwrap()["state"], "running");
    assert!(matches!(
        Lease::acquire(&d.path, "once", 1001),
        Err(TickError::Busy(_))
    ));
    a.renew(2000).unwrap();
    assert_eq!(status(&d.path, 2000).unwrap()["holder"]["token"], token);
    a.release().unwrap();
    drop(a);
    let b = Lease::acquire(&d.path, "once", 3000).unwrap();
    assert_ne!(b.token(), token);
    drop(b);
    assert!(d.path.join("tick/clock.lock").exists());
    assert!(!d.path.join("tick/clock.json").exists());
}
#[test]
fn expired_metadata_never_preempts_a_live_kernel_owner_and_release_never_erases_foreign_metadata() {
    let d = TestDirectory::new();
    let a = Lease::acquire(&d.path, "once", 1000).unwrap();
    assert_eq!(status(&d.path, 40_000).unwrap()["state"], "unconfirmed");
    assert!(matches!(
        Lease::acquire(&d.path, "run", 40_000),
        Err(TickError::Busy(_))
    ));
    let path = d.path.join("tick/clock.json");
    let mut other = read(&path).unwrap().unwrap();
    other.token = uuid::Uuid::new_v4().to_string();
    let bytes = serde_json::to_vec(&other).unwrap();
    private_file::replace(&path, &bytes).unwrap();
    assert!(matches!(a.verify(), Err(TickError::LeaseLost)));
    drop(a);
    assert_eq!(fs::read(&path).unwrap(), bytes);
    let b = Lease::acquire(&d.path, "run", 40_000).unwrap();
    drop(b);
}
#[test]
fn malformed_or_linked_lease_records_are_refused_without_rewriting_them() {
    let d = TestDirectory::new();
    let dir = d.path.join("tick");
    private_file::ensure_private_directory(&dir).unwrap();
    let guard = crate::file_lock::exclusive(&dir.join("clock.lock")).unwrap();
    drop(guard);
    let path = dir.join("clock.json");
    fs::write(&path, br#"{"schemaVersion":999}"#).unwrap();
    assert!(Lease::acquire(&d.path, "once", 1000).is_err());
    assert_eq!(fs::read(&path).unwrap(), br#"{"schemaVersion":999}"#);
    fs::remove_file(&path).unwrap();
    let foreign = d.path.join("foreign");
    fs::write(&foreign, b"retained").unwrap();
    std::os::unix::fs::symlink(&foreign, &path).unwrap();
    assert!(Lease::acquire(&d.path, "once", 1000).is_err());
    assert_eq!(fs::read(&foreign).unwrap(), b"retained");
}
