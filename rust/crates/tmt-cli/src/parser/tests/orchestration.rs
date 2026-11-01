use super::*;
use crate::invocation::{OrchOperation, OrchWriteOperation};
#[test]
fn orchestration_mutations_use_typed_operands_and_explicit_consent() {
    assert_eq!(
        parsed(&[
            "orch",
            "plan",
            "set",
            "Quiet",
            "--file",
            "plan.json",
            "--yes"
        ])
        .invocation,
        Invocation::Orch(OrchOperation::Write {
            operation: OrchWriteOperation::SetPlan {
                plan: "Quiet".into(),
                file: "plan.json".into()
            },
            yes: true
        })
    );
    for (text, ms) in [
        ("2h", 7_200_000),
        ("30d", 2_592_000_000),
        ("1.5m", 90_000),
        ("0.001s", 1),
    ] {
        assert_eq!(
            parsed(&["orch", "focus", "worker-1", text]).invocation,
            Invocation::Orch(OrchOperation::Write {
                operation: OrchWriteOperation::Focus {
                    member: "worker-1".into(),
                    duration_ms: Some(ms)
                },
                yes: false
            })
        );
    }
    assert_eq!(
        parsed(&["orch", "focus", "worker-1", "off"]).invocation,
        Invocation::Orch(OrchOperation::Write {
            operation: OrchWriteOperation::Focus {
                member: "worker-1".into(),
                duration_ms: None
            },
            yes: false
        })
    );
    for text in [
        "0",
        "0.1ms",
        "-1h",
        "30.000000001d",
        "2592000001ms",
        "30.001d",
        "1e3s",
        "+1s",
        "1.",
        "1 h",
        "18446744073709551615d",
    ] {
        assert!(
            parse(&args(&["orch", "focus", "worker-1", text])).is_err(),
            "{text}"
        );
    }
    for argv in [
        vec!["orch", "plan", "add"],
        vec!["orch", "plan", "rm", "Quiet", "--file", "plan.json"],
        vec![
            "orch",
            "focus",
            "worker-1",
            "1h",
            "--at",
            "2026-10-25 00:00",
        ],
    ] {
        assert!(parse(&args(&argv)).is_err());
    }
}

#[test]
fn jobs_have_bounded_filters_and_explicit_mutation_consent() {
    assert_eq!(
        parsed(&["orch", "job", "ls", "--owner", "worker-1", "--limit", "2"]).invocation,
        Invocation::Orch(OrchOperation::Jobs {
            owner: Some("worker-1".into()),
            room: None,
            limit: 2,
            cursor: None
        })
    );
    assert_eq!(
        parsed(&["orch", "job", "edit", "j1", "--file", "job.json", "--yes"]).invocation,
        Invocation::Orch(OrchOperation::Write {
            operation: OrchWriteOperation::EditJob {
                job: "j1".into(),
                file: "job.json".into()
            },
            yes: true
        })
    );
    for argv in [
        vec!["orch", "job", "add"],
        vec!["orch", "job", "ls", "--limit", "0"],
        vec!["orch", "job", "ls", "--limit", "129"],
        vec!["orch", "job", "show", "j1", "--yes"],
        vec!["orch", "job", "rm", "j1", "--file", "job.json"],
    ] {
        assert!(parse(&args(&argv)).is_err(), "{argv:?}");
    }
}
