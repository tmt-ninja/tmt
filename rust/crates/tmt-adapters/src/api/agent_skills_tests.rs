use super::*;
use crate::runtime::skills::{InvocationSyntax, SkillRoot, SkillSource};
use crate::test_support::TestDirectory;
use serde_json::{Value, json};

const ID: &str = "0199a213-81c0-7800-8aa1-bbab2a035a53";

fn value(bytes: Vec<u8>) -> Value {
    serde_json::from_slice(&bytes).unwrap()
}

#[test]
fn input_is_one_identity_and_an_optional_stamp() {
    let ok = |input: Value| decode(input.to_string().as_bytes());
    assert!(matches!(
        ok(json!({"identityId": ID})),
        Ok(Request::AgentSkills { if_stamp: None, .. })
    ));
    assert!(matches!(
        ok(json!({"identityId": ID, "ifStamp": "a".repeat(64)})),
        Ok(Request::AgentSkills {
            if_stamp: Some(_),
            ..
        })
    ));
    for input in [
        json!({}),
        json!({"identityId": "Ada"}),
        json!({"identityId": ID, "ifStamp": "short"}),
        json!({"identityId": ID, "ifStamp": "g".repeat(64)}),
        json!({"identityId": ID, "extra": true}),
    ] {
        assert!(ok(input.clone()).is_err(), "{input}");
    }
}

#[test]
fn a_matching_stamp_answers_unchanged_and_a_stale_one_lists_again() {
    let root = TestDirectory::new();
    assert!(root.path.starts_with(std::env::temp_dir()));
    let user = root.path.join("skills");
    std::fs::create_dir_all(user.join("review")).unwrap();
    std::fs::write(
        user.join("review/SKILL.md"),
        "---\nname: review\ndescription: Review a diff\n---\n",
    )
    .unwrap();
    let roots = SkillRoots {
        syntax: InvocationSyntax::Prefix { sigil: '$' },
        roots: vec![SkillRoot {
            path: user.clone(),
            source: SkillSource::User,
        }],
    };
    let assets = root.path.join("skill-assets");
    let full = value(respond(&roots, None, &assets, None, 7).unwrap());
    let stamp = full["rootsStamp"].as_str().unwrap().to_owned();
    assert_eq!(
        full,
        json!({
            "syntax": {"kind": "prefix", "sigil": "$"},
            "driver": null,
            "skills": [{"name": "review", "description": "Review a diff",
                "source": {"group": "user"}}],
            "truncated": false,
            "rootsStamp": stamp,
            "observedAtMs": 7,
        })
    );
    assert_eq!(
        value(respond(&roots, None, &assets, Some(&stamp), 8).unwrap()),
        json!({"unchanged": true, "rootsStamp": stamp, "observedAtMs": 8})
    );
    std::fs::remove_dir_all(user.join("review")).unwrap();
    let fresh = value(respond(&roots, None, &assets, Some(&stamp), 9).unwrap());
    assert_eq!(fresh["skills"], json!([]));
    assert_ne!(fresh["rootsStamp"], json!(stamp));
}

#[test]
fn an_unsupported_or_unknown_driver_lists_only_tmt_published_skills() {
    let root = TestDirectory::new();
    assert!(root.path.starts_with(std::env::temp_dir()));
    let global = root.path.join("tmt");
    std::fs::create_dir_all(global.join("skill-assets")).unwrap();
    let roots = tmt_only(&global);
    assert_eq!(roots.syntax, InvocationSyntax::Unsupported);
    // The bundle of this tmt is the first source; a provider's own directory never is.
    let bundle = &roots.roots[0];
    assert_eq!(bundle.source, SkillSource::Tmt);
    assert!(
        bundle
            .path
            .starts_with(std::fs::canonicalize(global.join("skill-assets")).unwrap())
    );
    let write = |dir: &std::path::Path, name: &str| {
        std::fs::create_dir_all(dir.join(name)).unwrap();
        std::fs::write(
            dir.join(name).join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {name} help\n---\n"),
        )
        .unwrap();
    };
    write(&bundle.path, "tmt-colab");
    write(&bundle.path, "tmt");
    // A link inside the bundle that leads elsewhere is not followed.
    let outside = root.path.join("outside");
    write(&outside, "far");
    std::os::unix::fs::symlink(outside.join("far"), bundle.path.join("far")).unwrap();
    let assets = global.join("skill-assets");
    let report = value(respond(&roots, Some("gemini"), &assets, None, 1).unwrap());
    assert_eq!(report["syntax"], json!({"kind": "unsupported"}));
    assert_eq!(report["driver"], json!("gemini"));
    assert_eq!(
        report["skills"],
        json!([
            {"name": "tmt", "description": "tmt help", "source": {"group": "tmt"}},
            {"name": "tmt-colab", "description": "tmt-colab help", "source": {"group": "tmt"}},
        ])
    );
    // A changed bundle changes the stamp.
    let before = report["rootsStamp"].clone();
    write(&bundle.path, "tmt-ops");
    let after = value(respond(&roots, Some("gemini"), &assets, None, 2).unwrap());
    assert_ne!(after["rootsStamp"], before);
    // An unknown identity has no driver.
    let unknown = value(respond(&roots, None, &assets, None, 3).unwrap());
    assert_eq!(unknown["driver"], Value::Null);
    assert_eq!(unknown["skills"].as_array().unwrap().len(), 3);
}

#[test]
fn the_driver_is_additive_and_an_older_reader_ignores_it() {
    let root = TestDirectory::new();
    let roots = SkillRoots {
        syntax: InvocationSyntax::Prefix { sigil: '/' },
        roots: Vec::new(),
    };
    let assets = root.path.join("skill-assets");
    let claude = respond(&roots, Some("claude"), &assets, None, 1).unwrap();
    assert_eq!(value(claude.clone())["driver"], json!("claude"));
    // The v1 shape a reader had before the field: it still parses.
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[allow(dead_code)]
    struct OlderReader {
        syntax: Value,
        skills: Vec<Value>,
        truncated: bool,
        roots_stamp: String,
        observed_at_ms: u64,
    }
    assert!(serde_json::from_slice::<OlderReader>(&claude).is_ok());
    // The answering driver is part of the stamp.
    assert_ne!(
        value(claude)["rootsStamp"],
        value(respond(&roots, Some("codex"), &assets, None, 1).unwrap())["rootsStamp"]
    );
}
