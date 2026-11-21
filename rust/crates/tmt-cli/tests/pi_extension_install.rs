//! Private-world lifecycle tests for installing, refreshing, protecting, and
//! uninstalling the Pi user extension (`<agent-dir>/extensions/tmt/index.js`).
#![cfg(unix)]
#[allow(dead_code)]
mod support;

use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static NEXT: AtomicU64 = AtomicU64::new(0);

struct World {
    root: PathBuf,
    pi_agent_dir: PathBuf,
    tmt_home: PathBuf,
}

impl World {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "tmt-pi-ext-install-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        let pi_agent_dir = root.join("pi-agent");
        let tmt_home = root.join("tmt-home");
        fs::create_dir_all(&pi_agent_dir).unwrap();
        fs::create_dir_all(&tmt_home).unwrap();
        Self {
            root,
            pi_agent_dir,
            tmt_home,
        }
    }

    fn run(&self, args: &[&str]) -> (bool, Value, String) {
        let output = support::command(&self.root, args)
            .env("PI_CODING_AGENT_DIR", &self.pi_agent_dir)
            .env("TMT_HOME", &self.tmt_home)
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
        let json: Value = serde_json::from_str(stdout.trim()).unwrap_or_else(|error| {
            panic!("invalid JSON from {args:?}: {error}\nstdout: {stdout}\nstderr: {stderr}")
        });
        (output.status.success(), json, stderr)
    }

    fn ext_dir(&self) -> PathBuf {
        self.pi_agent_dir.join("extensions").join("tmt")
    }

    fn settings_path(&self) -> PathBuf {
        self.pi_agent_dir.join("settings.json")
    }
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn pi_extension_consent_refresh_uninstall_and_foreign_protection_in_private_world() {
    let world = World::new();
    let ext_dir = world.ext_dir();
    let index_js = ext_dir.join("index.js");
    let marker_json = ext_dir.join(".tmt-managed.json");

    // 1. `--yes` alone never authorizes a new provider extension scope.
    let (ok, doc, stderr) = world.run(&["install", "pi", "--yes", "--json"]);
    assert!(ok, "install pi --yes failed: {stderr}");
    assert_eq!(doc["piExtension"]["status"], "skipped");
    assert!(
        !ext_dir.exists(),
        "--yes alone must not create extension dir"
    );
    assert!(
        !world.settings_path().exists(),
        "settings.json must not be created"
    );

    // 2. Refresh while absent never creates the Pi extension.
    let (ok, doc, stderr) = world.run(&["__native-refresh-skills", "--json"]);
    assert!(ok, "refresh while absent failed: doc={doc} stderr={stderr}");
    assert!(
        !ext_dir.exists(),
        "refresh must not install absent extension"
    );
    assert!(
        !doc["refreshed"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| Path::new(item["target"].as_str().unwrap()) == index_js),
        "refresh while absent must not report index.js: {doc}"
    );

    // 3. Explicit `--extension --yes` installs `<agent-dir>/extensions/tmt/index.js` + marker.
    let (ok, doc, stderr) = world.run(&["install", "pi", "--extension", "--yes", "--json"]);
    assert!(ok, "install pi --extension --yes failed: {stderr}");
    assert_eq!(doc["piExtension"]["status"], "installed");
    assert_eq!(
        Path::new(doc["piExtension"]["path"].as_str().unwrap()),
        index_js
    );
    assert!(index_js.is_file());
    let marker: Value = serde_json::from_slice(&fs::read(&marker_json).unwrap()).unwrap();
    assert_eq!(marker["owner"], "tmt");
    assert!(
        !world.settings_path().exists(),
        "settings.json must remain untouched"
    );

    // 4. Refresh when already installed updates stale `index.js` back to current.
    let original_bytes = fs::read(&index_js).unwrap();
    fs::write(&index_js, b"// stale extension\n").unwrap();
    let (ok, doc, stderr) = world.run(&["__native-refresh-skills", "--json"]);
    assert!(ok, "refresh when installed failed: {stderr}");
    let refreshed = doc["refreshed"].as_array().unwrap();
    assert!(
        refreshed.iter().any(
            |item| Path::new(item["target"].as_str().unwrap()) == index_js
                && item["changed"] == true
        ),
        "expected Pi extension to be refreshed, got: {doc}"
    );
    assert_eq!(fs::read(&index_js).unwrap(), original_bytes);

    // 5. Clean `tmt uninstall --yes` removes the managed Pi extension directory.
    let (ok, doc, stderr) = world.run(&["uninstall", "--yes", "--json"]);
    assert!(ok, "uninstall failed: {stderr}");
    assert!(
        !ext_dir.exists(),
        "uninstall must remove managed extension dir"
    );
    assert!(
        doc["removed"]
            .as_array()
            .unwrap()
            .iter()
            .any(|path| Path::new(path.as_str().unwrap()) == ext_dir),
        "expected extension dir in uninstall removed list: {doc}"
    );

    // 6. Foreign directory without `.tmt-managed.json` is never modified or removed.
    fs::create_dir_all(&ext_dir).unwrap();
    let foreign_file = ext_dir.join("custom.js");
    fs::write(&foreign_file, b"export default function () {}\n").unwrap();

    let (ok, doc, stderr) = world.run(&["install", "pi", "--extension", "--yes", "--json"]);
    assert!(ok, "install pi against foreign dir failed: {stderr}");
    assert_eq!(doc["piExtension"]["status"], "blocked");
    assert_eq!(
        fs::read(&foreign_file).unwrap(),
        b"export default function () {}\n"
    );
    assert!(!marker_json.exists());

    let (ok, _, stderr) = world.run(&["__native-refresh-skills", "--json"]);
    assert!(ok, "refresh against foreign dir failed: {stderr}");
    assert_eq!(
        fs::read(&foreign_file).unwrap(),
        b"export default function () {}\n"
    );

    let (ok, doc, stderr) = world.run(&["uninstall", "--yes", "--json"]);
    assert!(ok, "uninstall against foreign dir failed: {stderr}");
    assert!(
        foreign_file.is_file(),
        "foreign extension must be preserved"
    );
    assert!(
        doc["kept"]
            .as_array()
            .unwrap()
            .iter()
            .any(|row| Path::new(row["path"].as_str().unwrap()) == ext_dir),
        "expected foreign extension in uninstall kept list: {doc}"
    );
}
