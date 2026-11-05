use super::*;
use std::{
    fs,
    os::unix::fs::symlink,
    sync::atomic::{AtomicU64, Ordering},
};
static NEXT: AtomicU64 = AtomicU64::new(0);
struct World(PathBuf);
impl World {
    fn new() -> Self {
        let root = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "tmt-hosting-files-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
    fn installed(&self) -> (HostingRoot, PathBuf) {
        let release = self.0.join("release");
        fs::create_dir_all(release.join("dist-hosted/assets")).unwrap();
        let exe = release.join("tmt-colab");
        fs::write(&exe, "fixture executable").unwrap();
        let root = HostingRoot::from_executable(&exe, "colab").unwrap();
        let file = root.path().join("assets/app.js");
        fs::write(&file, b"hello").unwrap();
        (root, file)
    }
}
impl Drop for World {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}
fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
#[test]
fn installed_root_is_derived_only_from_the_resolved_executable() {
    let world = World::new();
    let (root, path) = world.installed();
    let launcher = world.0.join("tmt-colab");
    symlink(world.0.join("release/tmt-colab"), &launcher).unwrap();
    assert_eq!(
        HostingRoot::from_executable(&launcher, "colab")
            .unwrap()
            .path(),
        root.path()
    );
    let mut file = root.open_verified(&path, 5, &digest(b"hello")).unwrap();
    let mut read = Vec::new();
    file.read_to_end(&mut read).unwrap();
    assert_eq!(
        read, b"hello",
        "the verified handle is rewound, not reopened by path"
    );
    let outside = world.0.join("outside.js");
    fs::write(&outside, b"hello").unwrap();
    assert_eq!(
        root.open_verified(&outside, 5, &digest(b"hello"))
            .unwrap_err(),
        FileRefusal::Path
    );
}
#[test]
fn checkout_root_is_derived_from_the_selected_cargo_executable() {
    let world = World::new();
    fs::create_dir_all(world.0.join("rust/target/debug")).unwrap();
    let executable = world.0.join("rust/target/debug/tmt-colab");
    fs::write(&executable, "fixture").unwrap();
    let hosted = world
        .0
        .join("extensions/tmt-colab/typescript/app/dist-hosted");
    fs::create_dir_all(&hosted).unwrap();
    assert_eq!(
        HostingRoot::from_executable(&executable, "colab")
            .unwrap()
            .path(),
        hosted
    );
}
#[test]
fn manifest_paths_cannot_select_symlinks_traversal_or_non_regular_files() {
    let world = World::new();
    let (root, file) = world.installed();
    for path in [
        root.path().join("assets/../assets/app.js"),
        root.path().join("assets/./app.js"),
    ] {
        assert!(root.open_verified(&path, 5, &digest(b"hello")).is_err());
    }
    let link = root.path().join("linked.js");
    symlink(&file, &link).unwrap();
    assert!(root.open_verified(&link, 5, &digest(b"hello")).is_err());
    let directory_link = root.path().join("linked");
    symlink(root.path().join("assets"), &directory_link).unwrap();
    assert!(
        root.open_verified(&directory_link.join("app.js"), 5, &digest(b"hello"))
            .is_err()
    );
    assert_eq!(
        root.open_verified(&root.path().join("assets"), 0, &digest(b""))
            .unwrap_err(),
        FileRefusal::Type
    );
    let fifo = root.path().join("fifo");
    nix::unistd::mkfifo(&fifo, Mode::S_IRUSR | Mode::S_IWUSR).unwrap();
    assert_eq!(
        root.open_verified(&fifo, 0, &digest(b"")).unwrap_err(),
        FileRefusal::Type
    );
    fs::rename(root.path(), world.0.join("moved-hosted")).unwrap();
    symlink(world.0.join("moved-hosted"), root.path()).unwrap();
    assert!(root.open_verified(&file, 5, &digest(b"hello")).is_err());
    assert!(HostingRoot::from_executable(&world.0.join("release/tmt-colab"), "colab").is_err());
}
#[test]
fn changed_length_or_digest_refuses_and_no_product_size_cap_is_applied() {
    let world = World::new();
    let (root, path) = world.installed();
    for length in [4, 6, u64::MAX] {
        assert_eq!(
            root.open_verified(&path, length, &digest(b"hello"))
                .unwrap_err(),
            FileRefusal::Length
        );
    }
    fs::write(&path, b"other").unwrap();
    assert_eq!(
        root.open_verified(&path, 5, &digest(b"hello")).unwrap_err(),
        FileRefusal::Digest
    );
    let bytes = vec![b'x'; 4 * 1024 * 1024 + 1];
    fs::write(&path, &bytes).unwrap();
    assert!(
        root.open_verified(&path, bytes.len() as u64, &digest(&bytes))
            .is_ok()
    );
}
