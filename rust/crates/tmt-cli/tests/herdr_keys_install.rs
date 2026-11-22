//! Private-world lifecycle of the Herdr back key (#6117): `tmt install herdr`
//! writes one managed block into a fixture Herdr configuration only with
//! consent and after a stand-in `herdr config check` passes; otherwise it
//! prints the block. `tmt uninstall` restores the user's bytes. No Herdr runs.
#![cfg(unix)]
#[allow(dead_code)]
mod support;

use serde_json::Value;
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

/// The stand-in validator: it logs the file it was asked about and rejects
/// any configuration containing `BROKEN`, as Herdr reports diagnostics.
const HERDR: &str = r#"#!/bin/sh
d=$(dirname "$0")
[ "$1 $2" = "config check" ] || exit 2
echo "$HERDR_CONFIG_PATH" >> "$d/checked"
if grep -q BROKEN "$HERDR_CONFIG_PATH"; then
  echo "config: issues found"; echo "config parse error: BROKEN is not a key"; exit 1
fi
echo "config: ok"
"#;

const USER: &str = "[ui]\ntheme = \"dark\"\n";

struct World {
    root: PathBuf,
}

impl World {
    fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!("tmt-hk-{label}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("bin")).unwrap();
        let herdr = root.join("bin/herdr");
        fs::write(&herdr, HERDR).unwrap();
        fs::set_permissions(&herdr, fs::Permissions::from_mode(0o755)).unwrap();
        Self { root }
    }

    fn config(&self) -> PathBuf {
        self.root.join("herdr-config/config.toml")
    }

    fn run(&self, args: &[&str]) -> (Option<i32>, Value) {
        let output = support::command(&self.root, args)
            .env("TMT_HOME", self.root.join("tmt-home"))
            .env("HERDR_CONFIG_PATH", self.config())
            .env(
                "PATH",
                format!("{}:/usr/bin:/bin", self.root.join("bin").display()),
            )
            .output()
            .unwrap();
        let stdout = String::from_utf8_lossy(&output.stdout);
        let json = serde_json::from_str(stdout.trim()).unwrap_or_else(|error| {
            panic!(
                "invalid JSON from {args:?}: {error}\n{stdout}\n{}",
                String::from_utf8_lossy(&output.stderr)
            )
        });
        (output.status.code(), json)
    }

    fn checked(&self) -> Vec<String> {
        fs::read_to_string(self.root.join("bin/checked"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }

    fn text(&self) -> String {
        fs::read_to_string(self.config()).unwrap()
    }
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn keys(document: &Value) -> &Value {
    &document["herdrKeys"]
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

#[test]
fn the_herdr_back_key_is_written_only_with_consent_and_uninstall_restores_the_bytes() {
    let world = World::new("life");
    write(&world.config(), USER);

    // Without consent the exact block is printed and nothing is written.
    let (code, printed) = world.run(&["install", "herdr", "--json"]);
    assert_eq!(code, Some(0), "{printed}");
    assert_eq!(keys(&printed)["status"], "printed");
    let block = keys(&printed)["block"].as_str().unwrap().to_owned();
    assert!(block.starts_with("# BEGIN tmt herdr keys"), "{block}");
    assert!(
        block.contains("key = \"prefix+G\"\ntype = \"shell\"\n"),
        "{block}"
    );
    assert!(
        block.contains(" ops squad back\"\n# END tmt herdr keys\n"),
        "{block}"
    );
    assert_eq!(world.text(), USER);
    assert!(world.checked().is_empty());

    // `--yes` writes it after Herdr's check passed on a candidate, not the file.
    let (code, installed) = world.run(&["install", "herdr", "--yes", "--json"]);
    assert_eq!(code, Some(0), "{installed}");
    assert_eq!(keys(&installed)["status"], "installed");
    assert_eq!(keys(&installed)["path"], world.config().to_str().unwrap());
    assert_eq!(world.text(), format!("{USER}\n{block}"));
    let checked = world.checked();
    assert_eq!(checked.len(), 1);
    assert_ne!(checked[0], world.config().to_str().unwrap());
    assert!(!Path::new(&checked[0]).exists(), "the candidate is gone");

    let (_, current) = world.run(&["install", "herdr", "--yes", "--json"]);
    assert_eq!(keys(&current)["status"], "current");

    // Uninstall removes exactly the block.
    let (code, removed) = world.run(&["uninstall", "--yes", "--json"]);
    assert_eq!(code, Some(0), "{removed}");
    assert!(
        removed["removed"]
            .as_array()
            .unwrap()
            .iter()
            .any(|path| path == world.config().to_str().unwrap()),
        "{removed}"
    );
    assert_eq!(world.text(), USER);
}

#[test]
fn a_rejected_check_a_user_binding_and_an_edited_block_leave_the_file_unchanged() {
    let world = World::new("refusals");
    let broken = format!("{USER}BROKEN = 1\n");
    write(&world.config(), &broken);
    let (code, rejected) = world.run(&["install", "herdr", "--yes", "--json"]);
    assert_eq!(code, Some(0), "{rejected}");
    assert_eq!(keys(&rejected)["status"], "printed");
    assert_eq!(
        keys(&rejected)["reason"],
        "config parse error: BROKEN is not a key"
    );
    assert_eq!(world.text(), broken);

    let taken = "[[keys.command]]\nkey = \"prefix+G\"\ntype = \"shell\"\ncommand = \"mine\"\n";
    write(&world.config(), taken);
    let (_, skipped) = world.run(&["install", "herdr", "--yes", "--json"]);
    assert_eq!(keys(&skipped)["status"], "printed");
    assert_eq!(
        keys(&skipped)["reason"],
        "your configuration already binds prefix+G"
    );
    assert_eq!(world.text(), taken);

    let edited = format!("{USER}# BEGIN tmt herdr keys (managed by tmt install herdr)\nkey = 1\n");
    write(&world.config(), &edited);
    let (code, refused) = world.run(&["install", "herdr", "--yes", "--json"]);
    assert_eq!(code, Some(1), "{refused}");
    assert_eq!(refused["error"]["code"], "HERDR_KEYS_EDITED");
    assert_eq!(world.text(), edited);
    assert_eq!(
        world.checked().len(),
        1,
        "only the first install was checked"
    );
}
