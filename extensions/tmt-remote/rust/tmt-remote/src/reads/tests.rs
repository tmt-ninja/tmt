use super::*;
use crate::core::tests::executable_fixture;
use std::{
    fs,
    sync::atomic::{AtomicUsize, Ordering},
    thread,
};

static NEXT: AtomicUsize = AtomicUsize::new(0);

/// A fake public `tmt`: it logs each argv line and prints `<argv joined by _>.out`, exiting with
/// `<argv joined by _>.exit` when that file exists. Tests write those files, never the script.
struct Fake(PathBuf);
impl Fake {
    fn new() -> Self {
        let root = PathBuf::from(format!(
            "/tmp/tmt-4325-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        executable_fixture::write_executable(
            &root.join("tmt"),
            &format!(
                "cd '{0}'\nkey=$(printf '%s_' \"$@\")\necho \"$*\" >> calls\n\
                 if [ \"$1\" = api ] && [ -f api.py ]; then exec python3 api.py; fi\n\
                 [ -f \"$key.sleep\" ] && /bin/sleep \"$(cat \"$key.sleep\")\"\n\
                 [ -f \"$key.out\" ] && cat \"$key.out\"\n\
                 [ -f \"$key.exit\" ] && exit \"$(cat \"$key.exit\")\"\nexit 0\n",
                root.display()
            ),
        )
        .unwrap();
        Self(root)
    }
    fn reads(&self) -> Reads {
        Reads::new(self.0.join("tmt"), Arc::new(AtomicBool::new(false)))
    }
    fn answer(&self, argv: &str, output: &str) {
        let key: String = argv.split(' ').map(|word| format!("{word}_")).collect();
        fs::write(self.0.join(format!("{key}.out")), output).unwrap();
    }
    fn set(&self, argv: &str, extension: &str, value: &str) {
        let key: String = argv.split(' ').map(|word| format!("{word}_")).collect();
        fs::write(self.0.join(format!("{key}.{extension}")), value).unwrap();
    }
    fn calls(&self) -> Vec<String> {
        fs::read_to_string(self.0.join("calls"))
            .map(|calls| calls.lines().map(str::to_owned).collect())
            .unwrap_or_default()
    }
}
impl Drop for Fake {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

const LS: &str = "ops squad ls --json";
const DIGEST: &str = "digest usage report --since 24h --json";

fn body(reads: &Reads, target: Target) -> Value {
    serde_json::from_slice(&reads.body(target)).unwrap()
}

#[test]
fn routes_accept_exactly_the_named_reads_and_no_query_or_other_path() {
    assert_eq!(Target::route("ops"), None);
    assert_eq!(Target::route("limits"), Some(Target::Limits));
    for (segment, range) in [
        ("24h", Range::Day),
        ("7d", Range::Week),
        ("30d", Range::Month),
    ] {
        assert_eq!(
            Target::route(&format!("digest/{segment}")),
            Some(Target::Digest(range))
        );
        assert_eq!(
            Target::route(&format!("digest/savings/{segment}")),
            Some(Target::Savings(range))
        );
    }
    for unrouted in [
        "",
        "shell",
        "limits/",
        "limits?x=1",
        "Limits",
        "ops/",
        "ops/x",
        "opsx",
        "OPS",
        "-/ops",
        "digest",
        "digest/",
        "digest/1h",
        "digest/24H",
        "digest/7d/",
        "digest/7d/x",
        "digest//7d",
        "digest?since=7d",
        "digest/7d?x=1",
        "digest/savings",
        "digest/savings/",
        "digest/savings/1h",
        "digest/savings/7d/",
        "digest/savings/7d/x",
        "digest/savings//7d",
        "digest/savings?since=7d",
        "digest/savings/7d?x=1",
        "digest/7d/savings",
        "ops?x=1",
    ] {
        assert_eq!(Target::route(unrouted), None, "{unrouted}");
    }
}

#[test]
fn digest_forwards_the_usage_document_unchanged_under_report() {
    let fake = Fake::new();
    let report = json!({"version": 1, "observedAtMs": 5, "since": "24h", "window": null,
        "usage": {"seats": [], "unavailable": [], "lines": [], "providers": [
            {"driver":"agy", "totals":{"input":100,"output":20,"cached":0},
             "inputCost":{"usdMicros":150},"costUnavailable":[],"seats":[],"partialSeats":0}]},
        "pricing":{"version":"2026-11-15","basis":"standard-base-input","origin":"built-in"},
        "limits": [], "exchange": null});
    fake.answer(DIGEST, &report.to_string());
    let document = body(&fake.reads(), Target::Digest(Range::Day));
    assert_eq!(document["state"], "ok");
    assert_eq!(document["since"], "24h");
    assert_eq!(document["report"], report);
    assert_eq!(fake.calls(), [DIGEST]);
}

const SAVINGS: &str = "digest decisions --report --since 24h --json";

/// The smallest report the savings read accepts.
fn savings_report(since: &str) -> Value {
    json!({"version": 1, "since": since, "members": [], "total": {}})
}

#[test]
fn savings_forwards_the_delivery_report_unchanged_under_report() {
    let fake = Fake::new();
    let report = json!({"version": 1, "since": "24h", "fromMs": 1, "throughMs": 2,
        "members": [{"id": "00000000-0000-4000-8000-000000000001", "name": "worker", "messages": 3,
            "measuredSaved": null, "turnsSaved": 2, "avoidedCost": {"usdMicros": null,
            "reason": "no_price", "estimate": true}}],
        "total": {"messages": 3, "turnsSaved": 2}, "wakeMethod": {"pricing": {"origin": "built-in"}}});
    fake.answer(SAVINGS, &report.to_string());
    let document = body(&fake.reads(), Target::Savings(Range::Day));
    assert_eq!(document["state"], "ok");
    assert_eq!(document["since"], "24h");
    assert_eq!(document["report"], report);
    // One fixed argv: never --recompute or --flush-count.
    assert_eq!(fake.calls(), [SAVINGS]);
}

#[test]
fn savings_refuses_a_report_for_another_range_version_or_shape() {
    for (since, report) in [
        (
            "7d",
            json!({"version": 1, "since": "24h", "members": [], "total": {}}),
        ),
        (
            "7d",
            json!({"version": 2, "since": "7d", "members": [], "total": {}}),
        ),
        (
            "7d",
            json!({"version": 1, "since": "7d", "members": {}, "total": {}}),
        ),
        ("7d", json!({"version": 1, "since": "7d", "total": {}})),
        (
            "7d",
            json!({"version": 1, "since": "7d", "members": [], "total": []}),
        ),
        ("7d", json!({"version": 1, "since": "7d", "members": []})),
    ] {
        let fake = Fake::new();
        fake.answer(
            &format!("digest decisions --report --since {since} --json"),
            &report.to_string(),
        );
        let document = body(&fake.reads(), Target::Savings(Range::Week));
        assert_eq!(document["state"], "unavailable", "{report}");
        assert_eq!(document["reason"], "read_failed", "{report}");
        assert!(document.get("report").is_none());
    }
}

#[test]
fn usage_and_savings_of_one_range_never_share_an_answer() {
    let fake = Fake::new();
    fake.answer(DIGEST, &json!({"version": 1, "since": "24h"}).to_string());
    fake.answer(
        SAVINGS,
        &json!({"version": 1, "since": "24h", "members": [], "total": {}}).to_string(),
    );
    let reads = fake.reads();
    let usage = body(&reads, Target::Digest(Range::Day));
    let savings = body(&reads, Target::Savings(Range::Day));
    assert!(usage["report"].get("members").is_none());
    assert_eq!(savings["report"]["members"], json!([]));
    assert_eq!(fake.calls(), [DIGEST, SAVINGS]);
}

#[test]
fn digest_reads_the_requested_range_and_rejects_a_document_for_another() {
    let fake = Fake::new();
    let week = "digest usage report --since 7d --json";
    fake.answer(week, &json!({"version": 1, "since": "7d"}).to_string());
    let reads = fake.reads();
    assert_eq!(body(&reads, Target::Digest(Range::Week))["since"], "7d");
    fake.answer(
        "digest usage report --since 30d --json",
        &json!({"version": 1, "since": "24h"}).to_string(),
    );
    let document = body(&reads, Target::Digest(Range::Month));
    assert_eq!(document["state"], "unavailable");
    assert_eq!(document["reason"], "read_failed");
}

#[test]
fn every_failure_maps_to_one_closed_reason_and_never_to_an_empty_ok() {
    let fake = Fake::new();
    let reads = fake.reads();
    // Absent extension: a fixed argv can only be a usage error when the command is absent.
    fake.answer(
        DIGEST,
        r#"{"error":{"code":"USAGE_ERROR","message":"unrecognized subcommand"}}"#,
    );
    fake.set(DIGEST, "exit", "1");
    assert_eq!(
        body(&reads, Target::Digest(Range::Day))["reason"],
        "not_installed"
    );
    // A structured failure, a bad exit with no JSON, and a wrong version are all read_failed.
    let week = "digest usage report --since 7d --json";
    fake.answer(
        week,
        r#"{"error":{"code":"ROSTER_UNAVAILABLE","message":"x"}}"#,
    );
    fake.set(week, "exit", "1");
    assert_eq!(
        body(&reads, Target::Digest(Range::Week))["reason"],
        "read_failed"
    );
    let month = "digest usage report --since 30d --json";
    fake.answer(month, "not json");
    assert_eq!(
        body(&reads, Target::Digest(Range::Month))["reason"],
        "read_failed"
    );
    let day = body(&reads, Target::Digest(Range::Day));
    let month = body(&reads, Target::Digest(Range::Month));
    for document in [day, month] {
        assert_eq!(document["version"], 1);
        assert_eq!(document["state"], "unavailable");
        assert!(document.get("report").is_none());
    }
}

#[test]
fn a_slow_read_is_cut_at_the_deadline_and_a_missing_executable_is_core_unavailable() {
    let fake = Fake::new();
    fake.answer(DIGEST, &json!({"version": 1, "since": "24h"}).to_string());
    fake.set(DIGEST, "sleep", "30");
    fake.answer(SAVINGS, &savings_report("24h").to_string());
    fake.set(SAVINGS, "sleep", "30");
    let reads = fake.reads().with_wait(Duration::from_millis(600));
    for target in [Target::Digest(Range::Day), Target::Savings(Range::Day)] {
        let began = Instant::now();
        assert_eq!(body(&reads, target)["reason"], "timeout", "{target:?}");
        assert!(
            began.elapsed() < Duration::from_secs(5),
            "{:?}",
            began.elapsed()
        );
    }
    let missing = Reads::new(
        PathBuf::from("/tmp/tmt-4325-does-not-exist"),
        Arc::new(AtomicBool::new(false)),
    );
    for target in [Target::Digest(Range::Day), Target::Savings(Range::Day)] {
        assert_eq!(
            body(&missing, target)["reason"],
            "core_unavailable",
            "{target:?}"
        );
    }
}

#[test]
fn an_oversized_output_is_too_large_not_truncated() {
    let fake = Fake::new();
    let big = json!({"version": 1, "since": "24h",
        "pad": "x".repeat(limits::READ_DIGEST_BYTES + 1)});
    fake.answer(DIGEST, &big.to_string());
    let document = body(&fake.reads(), Target::Digest(Range::Day));
    assert_eq!(document["state"], "unavailable");
    assert_eq!(document["reason"], "too_large");
    // Past the subprocess capture bound the read is cut, not parsed.
    let huge = json!({"version": 1, "since": "7d",
        "pad": "x".repeat(limits::READ_SUBPROCESS_BYTES + 1)});
    fake.answer("digest usage report --since 7d --json", &huge.to_string());
    let document = body(&fake.reads(), Target::Digest(Range::Week));
    assert_eq!(document["reason"], "too_large");
    // The savings read shares the Digest cap: a well-formed report over it is too large too.
    let mut report = savings_report("24h");
    report["pad"] = json!("x".repeat(limits::READ_DIGEST_BYTES + 1));
    fake.answer(SAVINGS, &report.to_string());
    let document = body(&fake.reads(), Target::Savings(Range::Day));
    assert_eq!(document["state"], "unavailable");
    assert_eq!(document["reason"], "too_large");
    assert!(document.get("report").is_none());
}

#[test]
fn concurrent_requests_share_one_read_and_a_fresh_answer_is_reused() {
    let fake = Fake::new();
    fake.answer(DIGEST, &json!({"version": 1, "since": "24h"}).to_string());
    fake.set(DIGEST, "sleep", "1");
    let reads = Arc::new(fake.reads());
    let answers: Vec<_> = (0..8)
        .map(|_| {
            let reads = Arc::clone(&reads);
            thread::spawn(move || reads.body(Target::Digest(Range::Day)))
        })
        .collect();
    let answers: Vec<_> = answers.into_iter().map(|t| t.join().unwrap()).collect();
    assert!(answers.iter().all(|answer| answer == &answers[0]));
    assert_eq!(fake.calls().len(), 1, "{:?}", fake.calls());
    // Inside the fresh window another request costs nothing; a different key is separate.
    reads.body(Target::Digest(Range::Day));
    assert_eq!(fake.calls().len(), 1);
    fake.answer(
        "digest usage report --since 7d --json",
        &json!({"version": 1, "since": "7d"}).to_string(),
    );
    reads.body(Target::Digest(Range::Week));
    assert_eq!(fake.calls().len(), 2);
}

#[test]
fn nothing_runs_without_a_request_and_a_stale_answer_is_read_again() {
    let fake = Fake::new();
    fake.answer(DIGEST, &json!({"version": 1, "since": "24h"}).to_string());
    let reads = fake.reads();
    thread::sleep(Duration::from_millis(200));
    assert!(fake.calls().is_empty(), "a read ran without a request");
    reads.body(Target::Digest(Range::Day));
    // Age the answer past its window instead of sleeping through it.
    reads
        .lock()
        .get_mut(&Target::Digest(Range::Day))
        .unwrap()
        .fresh
        .as_mut()
        .unwrap()
        .0 = Instant::now() - limits::READ_FRESH - Duration::from_millis(1);
    reads.body(Target::Digest(Range::Day));
    assert_eq!(fake.calls().len(), 2);
}

#[test]
fn a_failed_read_is_also_reused_so_a_broken_command_is_not_hammered() {
    let fake = Fake::new();
    fake.answer(DIGEST, "not json");
    let reads = fake.reads();
    for _ in 0..5 {
        assert_eq!(
            body(&reads, Target::Digest(Range::Day))["reason"],
            "read_failed"
        );
    }
    assert_eq!(fake.calls().len(), 1);
}

fn vectors() -> Value {
    let path =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../contracts/owner-reads-v1.json");
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

#[test]
fn the_shared_vectors_are_what_the_door_answers_and_leak_nothing() {
    let vectors = vectors();
    let forbidden: Vec<&str> = vectors["forbiddenInAnswers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|word| word.as_str().unwrap())
        .collect();
    assert!(!forbidden.is_empty());
    for case in vectors["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let fake = Fake::new();
        for (argv, result) in case["commands"].as_object().unwrap() {
            let stdout = match &result["stdout"] {
                Value::String(raw) => raw.clone(),
                document => document.to_string(),
            };
            fake.answer(argv, &stdout);
            fake.set(argv, "exit", &result["exit"].to_string());
        }
        let target = Target::route(case["target"].as_str().unwrap())
            .unwrap_or_else(|| panic!("{name}: target is not a route"));
        let wire = fake.reads().body(target);
        let text = String::from_utf8(wire.to_vec()).unwrap();
        for word in &forbidden {
            assert!(!text.contains(word), "{name}: {word} leaked: {text}");
        }
        let mut answer: Value = serde_json::from_str(&text).unwrap();
        assert!(answer["observedAtMs"].as_u64().unwrap() > 0, "{name}");
        answer.as_object_mut().unwrap().remove("observedAtMs");
        assert_eq!(answer, case["expect"], "{name}");
    }
}

#[test]
fn the_vector_paths_that_are_no_read_are_no_route() {
    let vectors = vectors();
    let paths = vectors["notRoutes"].as_array().unwrap();
    assert!(!paths.is_empty());
    for path in paths {
        let path = path.as_str().unwrap();
        assert_eq!(Target::route(path), None, "{path}");
    }
    // Every named route is a read, so a renamed route cannot pass by leaving the vectors behind.
    for (name, template) in vectors["routes"].as_object().unwrap() {
        let rest = template
            .as_str()
            .unwrap()
            .strip_prefix("<prefix>/x/-/")
            .unwrap();
        let rest = rest.replace("{24h|7d|30d}", "24h");
        assert!(Target::route(&rest).is_some(), "{name}: {rest}");
    }
}

#[test]
fn the_vector_reason_set_is_the_code_set() {
    // An exhaustive match: a new reason fails to compile here until the vector names it.
    let all = |reason: Reason| match reason {
        Reason::NotInstalled
        | Reason::CoreUnavailable
        | Reason::Timeout
        | Reason::ReadFailed
        | Reason::TooLarge
        | Reason::NotSampled => reason.code(),
    };
    let codes: Vec<&str> = [
        Reason::NotInstalled,
        Reason::CoreUnavailable,
        Reason::Timeout,
        Reason::ReadFailed,
        Reason::TooLarge,
        Reason::NotSampled,
    ]
    .into_iter()
    .map(all)
    .collect();
    let vectors = vectors();
    let named: Vec<&str> = vectors["reasons"]
        .as_array()
        .unwrap()
        .iter()
        .map(|reason| reason.as_str().unwrap())
        .collect();
    assert_eq!(codes, named);
}

#[test]
fn the_vector_bounds_are_the_door_bounds() {
    let vectors = vectors();
    let bounds = &vectors["bounds"];
    assert_eq!(bounds["freshMs"], limits::READ_FRESH.as_millis() as u64);
    assert_eq!(bounds["waitMs"], limits::READ_WAIT.as_millis() as u64);
    assert_eq!(
        bounds["subprocessStdoutBytes"],
        limits::READ_SUBPROCESS_BYTES
    );
    assert_eq!(bounds["digestBytes"], limits::READ_DIGEST_BYTES);
    assert_eq!(bounds["limitsBytes"], limits::READ_LIMITS_BYTES);
}

#[test]
fn squad_summary_uses_only_the_public_roster_and_reports_missing_failed_or_changed_ops_as_unavailable()
 {
    let fake = Fake::new();
    fake.answer(
        LS,
        r#"{"squads":[{"squad":{"name":"tmt-core","lead":null},"sections":[]}]}"#,
    );
    // The background roster budget is independent of the browser's wait.
    let summary = fake
        .reads()
        .with_wait(Duration::ZERO)
        .squad_summary("Studio")
        .unwrap();
    assert_eq!(summary.squads().unwrap()[0].squad, "tmt-core");
    assert_eq!(fake.calls(), [LS]);
    fake.set(LS, "exit", "2");
    fake.answer(
        LS,
        r#"{"error":{"code":"USAGE_ERROR","message":"Ops absent"}}"#,
    );
    assert!(
        fake.reads()
            .squad_summary("Studio")
            .unwrap()
            .squads()
            .is_none()
    );
    fake.set(LS, "exit", "1");
    fake.answer(LS, r#"{"error":{"code":"FAILED","message":"Ops failed"}}"#);
    assert!(
        fake.reads()
            .squad_summary("Studio")
            .unwrap()
            .squads()
            .is_none()
    );
    fake.set(LS, "exit", "0");
    for changed in [
        "not-json",
        r#"{"squads":{}}"#,
        r#"{"squads":[{"squad":null}]}"#,
    ] {
        fake.answer(LS, changed);
        let unavailable = fake.reads().squad_summary("Studio").unwrap();
        let value = serde_json::to_value(unavailable).unwrap();
        assert_eq!(value["status"], "unavailable");
        assert_eq!(value["machineName"], "Studio");
        assert!(value.get("squads").is_none());
    }
    assert!(
        fake.calls().iter().all(|argv| argv == LS),
        "no cron read or fallback"
    );
}
