//! Real archive/publication/receipt proof for the Colab plain hosted tree; no app/account run.
use super::*;
use crate::native_install::{Product, inspect_product};
use std::{os::unix::fs::symlink, path::Path};
use tmt_core::native_install::{Channel, PinAction};
const ROOT: &str = "tmux-team-1.2.3-aarch64-apple-darwin";
const HOSTED: [(&str, &[u8]); 4] = [
    ("dist-hosted/empty.js", b""),
    ("dist-hosted/index.html", b"<h1>Hosted fixture</h1>"),
    ("dist-hosted/THIRD-PARTY-NOTICES.txt", b"Fixture notices"),
    (
        "dist-hosted/assets/app-abcd1234.js",
        b"export const fixture = true;",
    ),
];
fn hosted_entries() -> Vec<Entry> {
    HOSTED
        .iter()
        .map(|(name, bytes)| Entry::File {
            path: format!("{ROOT}/{name}"),
            bytes: bytes.to_vec(),
            mode: 0o644,
        })
        .collect()
}
fn fixture(product: Product, extra: Vec<Entry>, declared: bool) -> Fixture {
    let mut entries = valid_entries(ROOT);
    entries[0] = Entry::File {
        path: format!("{ROOT}/{}", product.executable()),
        bytes: b"fixture executable".to_vec(),
        mode: 0o755,
    };
    entries.extend(extra);
    let mut files = product.files().to_vec();
    if declared {
        files.push("dist-hosted");
    }
    product_fixture(entries, product.package(), &files)
}
fn install(fixture: &Fixture, prefix: &Path) -> io::Result<super::super::InstallReport> {
    super::super::install_product(
        Product::Colab,
        super::super::InstallRequest {
            archive: &fixture.archive,
            manifest: &fixture.manifest,
            prefix,
            target: TARGET,
            channel: Channel::Stable,
            pin: PinAction::Preserve,
        },
        None,
        || Ok(()),
    )
}
#[test]
fn hosted_tree_is_published_hashed_and_verified_with_its_relocated_release() {
    let fixture = fixture(Product::Colab, hosted_entries(), true);
    let prefix = fixture.directory.path.join("prefix");
    let report = install(&fixture, &prefix).unwrap();
    let release = report.active_executable.parent().unwrap();
    let receipt: serde_json::Value =
        serde_json::from_slice(&fs::read(release.join("receipt.json")).unwrap()).unwrap();
    for (name, bytes) in HOSTED {
        assert_eq!(fs::read(release.join(name)).unwrap(), bytes);
        assert_eq!(receipt["file_sha256"][name], artifact::digest(bytes));
    }
    inspect_product(Product::Colab, &report.executable).unwrap();
    assert!(!install(&fixture, &prefix).unwrap().changed);
    let moved = fixture.directory.path.join("relocated prefix");
    fs::rename(&prefix, &moved).unwrap();
    // Receipts bind the prefix; an explicit migration is not fabricated here. Tree paths,
    // however, are entirely relative and still accompany the relocated executable.
    assert_eq!(
        fs::read(moved.join("lib/tmt-colab/current/dist-hosted/index.html")).unwrap(),
        HOSTED[1].1
    );
}
#[test]
fn changed_missing_extra_and_symlinked_hosted_files_refuse_without_rewriting_receipts() {
    for change in ["changed", "missing", "extra", "leaf-link", "directory-link"] {
        let fixture = fixture(Product::Colab, hosted_entries(), true);
        let prefix = fixture.directory.path.join("prefix");
        let report = install(&fixture, &prefix).unwrap();
        let release = report.active_executable.parent().unwrap();
        let receipt = fs::read(release.join("receipt.json")).unwrap();
        let target = release.join(HOSTED[3].0);
        match change {
            "changed" => fs::write(&target, b"changed").unwrap(),
            "missing" => fs::remove_file(&target).unwrap(),
            "extra" => fs::write(release.join("dist-hosted/extra.js"), b"extra").unwrap(),
            "leaf-link" => {
                fs::remove_file(&target).unwrap();
                symlink(release.join(HOSTED[1].0), &target).unwrap();
            }
            _ => {
                let assets = release.join("dist-hosted/assets");
                let other = fixture.directory.path.join("outside");
                fs::rename(&assets, &other).unwrap();
                symlink(other, assets).unwrap();
            }
        }
        assert!(
            inspect_product(Product::Colab, &report.executable).is_err(),
            "{change}"
        );
        assert_eq!(
            fs::read(release.join("receipt.json")).unwrap(),
            receipt,
            "{change}"
        );
    }
}
#[test]
fn unsafe_or_incomplete_hosted_archives_are_rejected_before_publication() {
    for change in [
        "undeclared",
        "missing-entry",
        "symlink",
        "traversal",
        "executable",
        "empty-directory",
    ] {
        let mut entries = hosted_entries();
        match change {
            "missing-entry" => {
                entries.remove(1);
            }
            "symlink" => entries.push(Entry::Symlink {
                path: format!("{ROOT}/dist-hosted/link.js"),
                target: "index.html".into(),
            }),
            "traversal" => entries.push(Entry::AdversarialFile {
                path: format!("{ROOT}/dist-hosted/../outside"),
                bytes: b"x".to_vec(),
                mode: 0o644,
            }),
            "executable" => entries.push(Entry::File {
                path: format!("{ROOT}/dist-hosted/execute.js"),
                bytes: b"x".to_vec(),
                mode: 0o755,
            }),
            "empty-directory" => entries.push(Entry::Directory {
                path: format!("{ROOT}/dist-hosted/empty/"),
            }),
            _ => (),
        }
        let fixture = fixture(Product::Colab, entries, change != "undeclared");
        assert!(
            artifact::acquire_product(Product::Colab, &fixture.manifest, &fixture.archive, TARGET)
                .is_err(),
            "{change}"
        );
        assert!(!fixture.directory.path.join("prefix").exists());
    }
}
#[test]
fn hosted_tree_is_colab_only_and_legacy_colab_archives_still_read() {
    for product in [Product::Cli, Product::Ops, Product::Remote, Product::Digest] {
        let fixture = fixture(product, hosted_entries(), true);
        assert!(
            artifact::acquire_product(product, &fixture.manifest, &fixture.archive, TARGET)
                .is_err()
        );
    }
    let fixture = fixture(Product::Colab, vec![], false);
    assert!(
        artifact::acquire_product(Product::Colab, &fixture.manifest, &fixture.archive, TARGET)
            .is_ok()
    );
}
