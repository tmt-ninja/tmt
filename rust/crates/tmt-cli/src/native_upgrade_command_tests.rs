use super::*;
use std::cell::Cell;
use tmt_adapters::process::{CommandError, CommandOutput};

struct Runner {
    calls: Cell<usize>,
    bytes: &'static [u8],
}
impl CommandRunner for Runner {
    fn execute(&self, request: CommandRequest<'_>) -> Result<CommandOutput, CommandError> {
        self.calls.set(self.calls.get() + 1);
        assert_eq!(request.program, "/managed/releases/new/tmt");
        assert_eq!(
            request.args,
            &[
                std::ffi::OsString::from("__native-refresh-skills"),
                "--managed".into(),
                "--json".into()
            ]
        );
        assert!(request.input.is_empty());
        assert!(request.deadline > Instant::now());
        Ok(CommandOutput {
            stdout: self.bytes.to_vec(),
            stderr: vec![],
        })
    }
}

#[test]
fn refresh_runs_new_immutable_executable_and_validates_its_report() {
    let runner = Runner {
        calls: Cell::new(0),
        bytes:
            br#"{"refreshed":[{"target":"/agent/tmt","changed":true}],"skipped":[],"conflicts":[]}"#,
    };
    let report = refresh(Path::new("/managed/releases/new/tmt"), &runner).unwrap();
    assert_eq!(runner.calls.get(), 1);
    assert_eq!(report["refreshed"][0]["changed"], true);
    for bytes in [b"not JSON".as_slice(), br#"{"refreshed":[],"skipped":[],"conflicts":[],"unexpected":"field"}"#, br#"{"refreshed":[],"skipped":[],"conflicts":[],"error":{"code":"FAIL","message":"failed"}}"#] {
        let runner = Runner { calls: Cell::new(0), bytes };
        assert!(refresh(Path::new("/managed/releases/new/tmt"), &runner).is_err());
    }
}

#[test]
fn completed_nonzero_child_keeps_its_valid_partial_skill_report() {
    struct ExitingRunner;
    impl CommandRunner for ExitingRunner {
        fn execute(&self, request: CommandRequest<'_>) -> Result<CommandOutput, CommandError> {
            assert_eq!(request.program, "/managed/releases/new/tmt");
            UnixCommandRunner.execute(CommandRequest {
                program: std::ffi::OsStr::new("/bin/sh"),
                args: &["-c".into(), "printf '%s' '{\"refreshed\":[{\"target\":\"/valid\",\"changed\":true}],\"skipped\":[],\"conflicts\":[\"/modified\"],\"error\":{\"code\":\"SKILL_REFRESH_FAILED\",\"message\":\"conflict\"}}'; exit 1".into()],
                input: &[], deadline: request.deadline, max_output_bytes: request.max_output_bytes,
            })
        }
    }
    let (document, error) =
        refresh(Path::new("/managed/releases/new/tmt"), &ExitingRunner).unwrap_err();
    let document = document.expect("preserve the validated partial report");
    assert_eq!(document["refreshed"][0]["target"], "/valid");
    assert_eq!(document["conflicts"][0], "/modified");
    assert!(!error.to_string().contains("/modified"));
}

#[test]
fn retry_guidance_retains_an_explicit_pin() {
    let mut report = UpgradeReport {
        installation: native_install::InstallReport {
            executable: "/managed/bin/tmt".into(),
            active_executable: "/managed/releases/new/tmt".into(),
            version: "5.0.0".into(),
            changed: true,
        },
        state: tmt_core::native_install::InstalledVersion {
            version: "5.0.0".parse().unwrap(),
            channel: Channel::Stable,
            pinned_version: None,
        },
        skipped_pinned: false,
    };
    assert_eq!(retry_hint(&report), "tmt upgrade");
    report.state.pinned_version = Some(report.state.version.clone());
    assert_eq!(retry_hint(&report), "tmt upgrade --to 5.0.0");
}

#[test]
fn aggregate_report_keeps_cli_and_extension_outcomes_independent() {
    let report = UpgradeReport {
        installation: native_install::InstallReport {
            executable: "/managed/bin/tmt".into(),
            active_executable: "/managed/releases/new/tmt".into(),
            version: "5.0.0".into(),
            changed: true,
        },
        state: tmt_core::native_install::InstalledVersion {
            version: "5.0.0".parse().unwrap(),
            channel: Channel::Stable,
            pinned_version: None,
        },
        skipped_pinned: false,
    };
    let squad = json!({"product":"squad","status":"changed","version":"1.1.0"});
    let rows = product_rows(Some(&report), None, vec![squad.clone()]);
    assert_eq!(rows[0]["status"], "changed");
    assert_eq!(rows[0]["version"], "5.0.0");
    assert_eq!(rows[1], squad);
    let mode = OutputMode { json: true };
    let consent = json!({"product":"squad","status":"consentRequired","hint":"tmt upgrade --yes"});
    assert_eq!(
        publish_products(Some(&report), None, None, vec![consent], mode).unwrap(),
        0
    );
    let failure = json!({"product":"digest","status":"failed","error":{"code":"EXTENSION_UPGRADE_FAILED","message":"refused"}});
    // A product only offered for install, whose discovery failed, is reported but never
    // fails the upgrade; a selected one does (#6137, the alpha.558 colab row).
    let unselected = json!({"product":"colab","action":"install","status":"failed","selected":false,
        "message":"Could not check for colab updates on raw.githubusercontent.com: timed out"});
    assert_eq!(
        publish_products(Some(&report), None, None, vec![unselected.clone()], mode).unwrap(),
        0
    );
    let selected = json!({"product":"colab","action":"install","status":"failed","selected":true,
        "message":"Could not install colab"});
    assert_eq!(
        publish_products(Some(&report), None, None, vec![selected], mode).unwrap(),
        1
    );
    assert_eq!(
        publish_products(Some(&report), None, None, vec![failure, squad], mode).unwrap(),
        1
    );
    // This nonexistent prefix would fail inspection if the extension phase ran.
    assert_eq!(
        finish(
            &report,
            None,
            Some(Failure::new("NATIVE_UPGRADE_FAILED", "CLI failed", 7)),
            true,
            &Prior {
                repeat: "tmt upgrade".into(),
                ran_from_moved_prefix: false,
                versions: BTreeMap::new(),
                extensions: crate::extension_install_command::upgrade_all::complete::Plan {
                    installed: crate::extension_install_command::upgrade_all::Plan {
                        products: Vec::new(),
                        pending: Vec::new()
                    },
                    missing: Vec::new(),
                    providers: Vec::new(),
                },
            },
            FinishContext {
                database: DatabaseSteps::default(),
                interrupt: None,
                runner: &UnixCommandRunner
            },
            mode
        )
        .unwrap(),
        7
    );
}

#[test]
fn upgrade_failure_document_always_keeps_a_nonempty_cause() {
    for cause in ["connection refused", ""] {
        let failure = Failure::new("NATIVE_UPGRADE_FAILED", "Cannot update installation", 1)
            .caused_by(io::Error::other(cause));
        let document = failure_document(&failure);
        let diagnostic = document["error"]["cause"].as_str().unwrap();
        assert!(!diagnostic.is_empty());
        assert_eq!(
            diagnostic,
            if cause.is_empty() {
                "Cannot update installation"
            } else {
                cause
            }
        );
    }
}

#[test]
fn conflict_commands_quote_paths_and_preserve_sources() {
    let target = Path::new("/isolated/agent's home/skills/tmt-inbox");
    let hint = crate::skill_refresh_command::conflict_hint(target);
    assert!(hint.contains("User-owned or modified skill preserved"));
    assert!(hint.contains("'\\''"));
    assert!(hint.contains(".tmt-skill-backups/upgrade-conflict.XXXXXXXX"));
    assert!(hint.contains("mv "));
    assert!(!hint.contains("rm "));
}

#[test]
fn upgrade_json_retains_rate_limit_reset_and_token_hint_in_cause() {
    let cause = "GitHub API rate limit: reset/earliest retry time 2030-01-01 UTC; the required wait exceeds the remaining deadline. Retry later or optionally set GITHUB_TOKEN.";
    let failure = Failure::new("NATIVE_UPGRADE_FAILED", "Native upgrade failed", 1)
        .caused_by(std::io::Error::other(cause));
    let document = failure_document(&failure);
    assert_eq!(document["error"]["code"], "NATIVE_UPGRADE_FAILED");
    assert_eq!(document["error"]["cause"], cause);
}

#[test]
fn skill_failure_is_a_warning_with_partial_publication_and_the_cause() {
    let partial = json!({"refreshed":[{"target":"/agent/tmt","changed":true}],"skipped":[],"conflicts":[],"error":{"code":"SKILL_REFRESH_FAILED","message":"permission denied at /agent/tmt-inbox"}});
    let report = super::skill_outcome(Err((
        Some(partial),
        std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "child exited with status 1",
        ),
    )));
    assert_eq!(report["status"], "warning");
    assert_eq!(report["refreshed"][0]["target"], "/agent/tmt");
    assert!(report.get("error").is_none());
    assert!(
        report["warning"]["message"]
            .as_str()
            .unwrap()
            .contains("/agent/tmt-inbox")
    );
    let report = super::skill_outcome(Ok(json!({"refreshed":[],"skipped":[],"conflicts":[]})));
    assert_eq!(report["status"], "current");
}

#[test]
fn the_repeated_command_carries_every_flag_the_invocation_had() {
    assert_eq!(
        repeat_command(None, None, false, false, false),
        "tmt upgrade"
    );
    assert_eq!(
        repeat_command(
            Some(Channel::Alpha),
            Some("5.0.0-alpha.8"),
            true,
            true,
            true
        ),
        "tmt upgrade --channel alpha --to 5.0.0-alpha.8 --unpin --yes --allow-schema-ahead"
    );
}

#[test]
fn release_links_name_actual_products_and_pr_candidates_without_inventing_release_tags() {
    let mut report = UpgradeReport {
        installation: native_install::InstallReport {
            executable: "/managed/bin/tmt".into(),
            active_executable: "/managed/releases/new/tmt".into(),
            version: "5.0.0".into(),
            changed: true,
        },
        state: tmt_core::native_install::InstalledVersion {
            version: "5.0.0".parse().unwrap(),
            channel: Channel::Stable,
            pinned_version: None,
        },
        skipped_pinned: false,
    };
    let rows = product_rows(
        Some(&report),
        None,
        vec![json!({"product":"ops","status":"changed","version":"1.2.3"})],
    );
    assert_eq!(
        rows[0]["releaseUrl"],
        "https://github.com/tmt-ninja/tmt/releases/tag/v5.0.0"
    );
    assert_eq!(
        rows[1]["releaseUrl"],
        "https://github.com/tmt-ninja/tmt/releases/tag/tmt-ops-v1.2.3"
    );
    report.state.channel = Channel::parse("pr4770").unwrap();
    let rows = product_rows(Some(&report), None, vec![]);
    assert_eq!(
        rows[0]["releaseUrl"],
        "https://github.com/tmt-ninja/tmt/pull/4770"
    );
    assert!(product_rows(None, None, vec![])[0]["releaseUrl"].is_null());
}

/// A pinned CLI plans its extensions offline: the real pin read from the receipt selects the
/// offline plan, discovery is never called (it panics), and an installed extension row says
/// it was not checked because the CLI is pinned (#6137).
#[test]
fn a_pinned_cli_plans_extensions_offline_and_never_discovers() {
    use std::{
        fs,
        os::unix::fs::{PermissionsExt, symlink},
    };
    use tmt_adapters::native_install::Product;
    use tmt_core::content_digest::sha256;

    struct Fixture(std::path::PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.0).unwrap();
        }
    }
    let fixture = Fixture(
        std::env::temp_dir().join(format!("tmt-pinned-extension-plan-{}", std::process::id())),
    );
    fs::create_dir(&fixture.0).unwrap();
    let prefix = fixture.0.canonicalize().unwrap();
    fs::create_dir(prefix.join("bin")).unwrap();
    let install = |product: Product, version: &str, pinned: bool| {
        let id = "12345678-1234-4234-8234-123456789abc";
        let root = prefix.join(product.namespace());
        let release = root.join("releases").join(id);
        fs::create_dir_all(&release).unwrap();
        let bytes = b"managed pinned plan fixture\n";
        let mut hashes = serde_json::Map::new();
        for name in product.files() {
            fs::write(release.join(name), bytes).unwrap();
            if name == product.executable() {
                fs::set_permissions(release.join(name), fs::Permissions::from_mode(0o755)).unwrap();
            }
            hashes.insert(name.into(), json!(sha256(bytes)));
        }
        fs::write(
            release.join("receipt.json"),
            serde_json::to_vec(&json!({
                "schema_version": 1, "release_id": id, "prefix": prefix,
                "version": version, "channel": "alpha",
                "pinned_version": pinned.then_some(version),
                "archive": format!("tmt-{}-{version}-aarch64-apple-darwin.tar.gz", product.as_str()),
                "archive_sha256": sha256(b"archive"), "target": "aarch64-apple-darwin",
                "file_sha256": hashes, "source": "local-archive"
            }))
            .unwrap(),
        )
        .unwrap();
        symlink(format!("releases/{id}"), root.join("current")).unwrap();
        for name in product.links() {
            symlink(product.link_target(), prefix.join("bin").join(name)).unwrap();
        }
        release.join(product.executable())
    };
    let executable = install(Product::Cli, "5.0.0-alpha.1", true);
    install(Product::Ops, "0.1.0-alpha.2", false);

    let prepared = native_install::prepare_upgrade(
        Product::Cli,
        UpgradeRequest {
            executable: &executable,
            channel: None,
            exact: None,
            unpin: false,
        },
        false,
    )
    .unwrap();
    assert!(prepared.pinned());
    let plan = extension_plan(
        &prepared,
        |_| panic!("a pinned CLI must not discover extension updates"),
        |_| Vec::new(),
    );
    assert!(plan.missing.is_empty());
    assert_eq!(
        plan.installed.products,
        [json!({
            "product": "ops",
            "status": "notChecked",
            "version": "0.1.0-alpha.2",
            "reason": "cliPinned",
            "hint": "tmt extension upgrade ops",
        })]
    );
}
