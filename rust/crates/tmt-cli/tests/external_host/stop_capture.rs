//! Real Stop stdin and blocking Digest feedback in an owned external-host world.
use super::*;
use tmt_core::binding::BindingRepository;

pub(super) fn ok(output: (i32, String, String)) -> String {
    assert_eq!((output.0, output.2.as_str()), (0, ""), "hook: {output:?}");
    output.1
}

pub(super) fn install_capture_hook(fixture: &Fixture, driver: &str) {
    let settings = fixture.root.join(if driver == "claude" {
        "home/.claude/settings.json"
    } else {
        "home/.codex/hooks.json"
    });
    fs::create_dir_all(settings.parent().unwrap()).unwrap();
    let entry = tmt_adapters::runtime::hook_protocol::command_entry(driver, "/stable/tmt");
    fs::write(
        settings,
        serde_json::json!({"hooks":{"Stop":[entry]}}).to_string(),
    )
    .unwrap();
}

#[test]
fn a_blocking_digest_keeps_both_claude_finals_in_causal_order_for_both_hook_orders() {
    blocking_digest(
        "claude",
        true,
        &[(false, false), (true, true)],
        CaptureScenario::Normal,
    );
}

#[test]
fn a_member_bound_without_a_managed_launch_still_hands_off_its_digest() {
    blocking_digest(
        "claude",
        true,
        &[(false, false)],
        CaptureScenario::NoLaunchRow,
    );
}

#[test]
fn a_blocking_digest_keeps_the_answer_to_text_folded_into_a_running_claude_turn() {
    blocking_digest(
        "claude",
        true,
        &[(false, false), (true, true)],
        CaptureScenario::FoldedInput,
    );
}

#[test]
fn a_blocking_digest_keeps_both_claude_finals_after_a_compaction_inside_the_turn() {
    blocking_digest(
        "claude",
        true,
        &[(false, false), (true, true)],
        CaptureScenario::CompactedMidTurn,
    );
}

#[test]
fn a_blocking_digest_keeps_both_codex_finals_after_a_compaction_inside_the_turn() {
    blocking_digest(
        "codex",
        true,
        &[(false, false), (true, true)],
        CaptureScenario::CompactedMidTurn,
    );
}

#[test]
fn a_blocking_digest_keeps_both_codex_finals_in_causal_order_for_both_hook_orders() {
    blocking_digest(
        "codex",
        true,
        &[(false, false), (true, true)],
        CaptureScenario::Normal,
    );
}

#[test]
fn a_blocking_digest_keeps_the_agy_final_before_its_held_input_for_both_hook_orders() {
    blocking_digest(
        "agy",
        true,
        &[(false, false), (true, true)],
        CaptureScenario::Normal,
    );
}

#[test]
fn canceled_and_subagent_agy_stops_grant_no_final_or_digest_input() {
    for scenario in [CaptureScenario::Canceled, CaptureScenario::Subagent] {
        blocking_digest("agy", true, &[(false, false), (true, true)], scenario);
    }
}

#[test]
fn digest_does_not_enable_provider_capture_when_answer_hooks_are_not_installed() {
    blocking_digest(
        "agy",
        false,
        &[(false, false), (true, false), (true, true)],
        CaptureScenario::Normal,
    );
    blocking_digest(
        "claude",
        false,
        &[(false, false), (true, false), (true, true)],
        CaptureScenario::Normal,
    );
    blocking_digest(
        "codex",
        false,
        &[(false, false), (true, false), (true, true)],
        CaptureScenario::Normal,
    );
}

#[test]
fn an_unbound_capture_still_hands_off_a_verified_digest_launch() {
    for driver in ["agy", "claude", "codex"] {
        blocking_digest(
            driver,
            true,
            &[(false, false)],
            CaptureScenario::UnboundOnce,
        );
    }
}

#[test]
fn a_duplicate_stop_captured_by_the_observer_still_hands_off_digest() {
    for driver in ["agy", "claude", "codex"] {
        blocking_digest(driver, true, &[(true, false)], CaptureScenario::Normal);
    }
}

#[test]
fn a_queue_append_failure_holds_digest_before_publishing_its_input() {
    for driver in ["agy", "claude", "codex"] {
        blocking_digest(
            driver,
            true,
            &[(false, false)],
            CaptureScenario::QueueFailure,
        );
    }
}

#[test]
fn a_current_main_with_a_missing_or_incompatible_queue_keeps_the_direct_capture_path() {
    for scenario in [
        CaptureScenario::MissingQueue,
        CaptureScenario::IncompatibleQueue,
    ] {
        blocking_digest("claude", true, &[(false, false), (true, false)], scenario);
    }
}

#[test]
fn a_stop_without_a_new_activity_transition_still_records_consented_usage() {
    register();
    for (driver, tree, source, tokens) in [
        (
            "claude",
            ".claude/projects/-workspace",
            include_str!("../../../tmt-adapters/src/runtime/fixtures/claude-usage-sequence.jsonl"),
            355113,
        ),
        (
            "codex",
            ".codex/sessions/2026/09/29",
            include_str!("../../../tmt-adapters/src/runtime/fixtures/codex-token-count.jsonl"),
            146577,
        ),
    ] {
        let fixture = Fixture::delivering(&format!("capture-usage-{driver}"));
        let record = fixture.approve();
        bind(&fixture, record);
        let home = fixture.root.join("home");
        let transcript = home.join(tree).join("s-1.jsonl");
        fs::create_dir_all(transcript.parent().unwrap()).unwrap();
        fs::write(
            &transcript,
            format!(
                "{{\"type\":\"user\"}}\n{}\n",
                source.lines().next().unwrap()
            ),
        )
        .unwrap();
        let settings = home.join(if driver == "claude" {
            ".claude/settings.json"
        } else {
            ".codex/hooks.json"
        });
        let entry = tmt_adapters::runtime::hook_protocol::command_entry(driver, "/stable/tmt");
        fs::write(
            settings,
            serde_json::json!({"hooks":{"Stop":[entry]}}).to_string(),
        )
        .unwrap();
        let mut provider = SteppedProvider::start(&fixture, driver, "usage-steps");
        let event = |name| {
            if driver == "claude" {
                claude_event(name)
            } else {
                codex_event(name, None)
            }
        };
        ok(provider.hook(event("SessionStart")));
        // No prompt was admitted, so this Stop cannot produce a captured final.
        // It must still refresh usage, as must an ordinary repeated Stop.
        let mut stop = event("Stop");
        stop["transcript_path"] = transcript.to_string_lossy().into_owned().into();
        stop["last_assistant_message"] = "not an admitted final".into();
        for _ in 0..2 {
            ok(provider.hook(stop.clone()));
            let list = fixture.json(&["ls", "--json"]);
            assert_eq!(
                worker(&list)["resume"]["usage"]["tokens"],
                tokens,
                "{list:#}"
            );
        }
        let db = rusqlite::Connection::open(fixture.state().join("tmt.db")).unwrap();
        let count: i64 = db
            .query_row("SELECT count(*) FROM recent_responses", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }
}

#[test]
fn a_stop_without_an_admitted_start_leaves_one_bounded_diagnostic() {
    register();
    for driver in ["claude", "codex"] {
        let fixture = Fixture::delivering(&format!("missing-start-{driver}"));
        bind(&fixture, fixture.approve());
        let agent = worker(&fixture.json(&["ls", "--json"]))["id"]
            .as_str()
            .unwrap()
            .to_owned();
        install_capture_hook(&fixture, driver);
        let mut provider = SteppedProvider::start(&fixture, driver, "missing-start-steps");
        let event = |name, turn| {
            if driver == "claude" {
                claude_event(name)
            } else {
                codex_event(name, Some(turn))
            }
        };
        ok(provider.hook(event("SessionStart", "missing")));
        let ProcessObservation::Live(owner) = observe_runtime_process(
            &UnixCommandRunner,
            u64::from(std::process::id()),
            deadline(),
        )
        .unwrap() else {
            panic!("the fixture launch owner must be live");
        };
        let launch = record_admitted_launch(&fixture, &agent, driver, &owner);
        let observation = serde_json::to_string(&launch).unwrap();
        let hook = |provider: &mut SteppedProvider, payload| {
            ok(provider.hook_with_env(
                payload,
                &[("TMT_LAUNCH_OBSERVATION", observation.as_bytes())],
            ))
        };
        let db = rusqlite::Connection::open(fixture.state().join("tmt.db")).unwrap();
        let lifetime =
            || {
                db.query_row(
                "SELECT count(*),min(created_at_ms),min(expires_at_ms) FROM launch_observations",
                [],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?)),
            )
            .unwrap()
            };
        let original_lifetime = lifetime();
        let finals = || {
            db.query_row("SELECT count(*) FROM recent_responses", [], |row| {
                row.get::<_, i64>(0)
            })
            .unwrap()
        };
        let mut stop = event("Stop", "missing");
        stop["last_assistant_message"] = "a discarded answer must not enter diagnostics".into();
        for _ in 0..2 {
            hook(&mut provider, stop.clone());
            let listed = fixture.json(&["ls", "--json"]);
            let session = &worker(&listed)["session"];
            assert_eq!(
                session["learning"]["detail"], "stopped:turn:Stop:no_admitted_start",
                "missing-start Stop must leave its fixed diagnostic: {listed:#}"
            );
            assert_eq!(session["learning"]["step"], "storage");
            assert_eq!(session["learning"]["reason"], "not_admitted");
            assert_eq!(session["unbound"], false, "the session remains admitted");
            assert_eq!(
                lifetime(),
                original_lifetime,
                "repeat does not grow or renew the row"
            );
            assert_eq!(finals(), 0, "an unadmitted final remains dropped");
        }

        // A later real start clears the old diagnostic under the ordinary stage rules.
        let mut prompt = event("UserPromptSubmit", "normal");
        prompt["prompt"] = "a new question".into();
        hook(&mut provider, prompt);
        assert!(worker(&fixture.json(&["ls", "--json"]))["session"]["learning"].is_null());
        let mut stop = event("Stop", "normal");
        stop["last_assistant_message"] = "one admitted answer".into();
        for _ in 0..2 {
            hook(&mut provider, stop.clone());
            assert!(worker(&fixture.json(&["ls", "--json"]))["session"]["learning"].is_null());
            assert_eq!(
                finals(),
                1,
                "a duplicate Stop does not append another final"
            );
        }
        if driver == "codex" {
            hook(&mut provider, event("Interrupt", "never-started"));
            assert!(worker(&fixture.json(&["ls", "--json"]))["session"]["learning"].is_null());
            assert_eq!(finals(), 1, "an interrupt stays activity-only");
        }
        drop(db);
    }
}

fn observer(
    provider: &mut SteppedProvider,
    payload: Value,
    capture: bool,
    scenario: CaptureScenario,
) {
    if !capture {
        fs::write(
            provider
                .steps
                .join(provider.next.to_string())
                .with_extension("activity"),
            "",
        )
        .unwrap();
    }
    let output = provider.hook(payload);
    if scenario == CaptureScenario::Subagent {
        assert_eq!(output.0, 0, "{output:?}");
        assert_eq!(output.1.trim(), "{}", "{output:?}");
        assert_eq!(
            output.2.trim(),
            "tmt: lifecycle context unavailable; continuing without context.",
            "{output:?}"
        );
    } else {
        ok(output);
    }
}

/// Each launch row's stored session learning (status, step, reason, detail): a detail such
/// as `digest_stop:launch:binding` names why a Digest Stop ended with no output (#5459).
/// Read only, so the diagnostic never writes to the store it reports on.
fn stored_launch_outcomes(fixture: &Fixture) -> Vec<[Option<String>; 4]> {
    let db = rusqlite::Connection::open_with_flags(
        fixture.state().join("tmt.db"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    let mut rows = db
        .prepare("SELECT status,step,reason,detail FROM launch_observations ORDER BY created_at_ms")
        .unwrap();
    rows.query_map([], |row| {
        Ok([row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?])
    })
    .unwrap()
    .collect::<Result<_, _>>()
    .unwrap()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CaptureScenario {
    Normal,
    Canceled,
    Subagent,
    UnboundOnce,
    QueueFailure,
    MissingQueue,
    IncompatibleQueue,
    /// Ben's text is typed into a turn another prompt started and a tool finishes
    /// before the Stop (#5268); no prompt ever announces it.
    FoldedInput,
    /// The provider compacts its context inside the turn, before the Stop (#5268).
    CompactedMidTurn,
    /// The member was bound without a managed launch, so no launch row exists.
    NoLaunchRow,
}

fn blocking_digest(
    driver: &'static str,
    capture: bool,
    orders: &[(bool, bool)],
    scenario: CaptureScenario,
) {
    register();
    let unbound_once = scenario == CaptureScenario::UnboundOnce;
    let event = |name| match driver {
        "claude" => claude_event(name),
        "codex" => codex_event(name, (name != "SessionStart").then_some("capture-turn")),
        "agy" => match name {
            "SessionStart" => serde_json::json!({"conversationId":"s-1"}),
            "UserPromptSubmit" => serde_json::json!({"conversationId":"s-1","invocationNum":1}),
            "Stop" => {
                serde_json::json!({"conversationId":"s-1","terminationReason":"NO_TOOL_CALL","executionNum":1,"fullyIdle":true})
            }
            _ => panic!("unsupported agy fixture event {name}"),
        },
        _ => panic!("unsupported capture fixture driver {driver}"),
    };
    let final_field = if driver == "agy" {
        "finalModelOutput"
    } else {
        "last_assistant_message"
    };
    for &(observer_first, activity_only) in orders {
        let fixture = Fixture::delivering(&format!(
            "capture-{driver}-{capture}-{observer_first}-{activity_only}-{scenario:?}"
        ));
        if unbound_once {
            // The first capture sees no caller pane. Digest's independent,
            // later launch verification sees the real owned pane again.
            let script = DRIVER.replace(
                "  caller)\n",
                r#"  caller)
    if [ -f "$d/capture-unbound-once" ]; then
      rm "$d/capture-unbound-once"
      echo capture-unbound >> "$d/calls"
      printf '{"ok":{"pane":null}}'
      exit 0
    fi
"#,
            );
            tmt_test_support::write_executable(&fixture.driver, script.as_bytes(), 0o755).unwrap();
        }
        let record = fixture.approve();
        bind(&fixture, record);
        let agent = worker(&fixture.json(&["ls", "--json"]))["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let person = fixture.json(&["identity", "create", "ben", "--json"])["identity"]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        fixture.json(&[
            "identity",
            "meta",
            "set",
            "user",
            "true",
            "--identity",
            "ben",
            "--json",
        ]);
        fixture.json(&["identity", "create", "core-1", "--json"]);
        if capture {
            let settings = fixture.root.join(match driver {
                "claude" => "home/.claude/settings.json",
                "codex" => "home/.codex/hooks.json",
                "agy" => "home/.gemini/config/hooks.json",
                _ => unreachable!(),
            });
            fs::create_dir_all(settings.parent().unwrap()).unwrap();
            let hooks = if driver == "agy" {
                let observer =
                    tmt_adapters::runtime::hook_protocol::flat_command_entry(driver, "/stable/tmt");
                serde_json::json!({"tmt":{"Stop":[observer]}})
            } else {
                let observer =
                    tmt_adapters::runtime::hook_protocol::command_entry(driver, "/stable/tmt");
                serde_json::json!({"hooks":{"Stop":[observer]}})
            };
            fs::write(settings, hooks.to_string()).unwrap();
        }
        let mut provider = SteppedProvider::start(&fixture, driver, "capture-steps");
        ok(provider.hook(event("SessionStart")));
        // This stand-in has no run wrapper. The test owns its live parent and
        // records that exact native incarnation as the launch owner, as a run
        // fixture would; Digest still verifies it through the public hook.
        let owner = observe_runtime_process(
            &UnixCommandRunner,
            u64::from(std::process::id()),
            deadline(),
        )
        .unwrap();
        let ProcessObservation::Live(owner) = owner else {
            panic!("test owner is not live");
        };
        if scenario == CaptureScenario::NoLaunchRow {
            // A member bound without a managed launch: Digest still verifies the owner, but
            // has no launch row to record a refusal on.
            let mut storage = Storage::open(fixture.state().join("tmt.db")).unwrap();
            storage
                .with_binding_transaction::<_, tmt_adapters::storage::StorageError>(|rows| {
                    let binding = rows.entry_by_id(&agent)?.unwrap().binding.unwrap();
                    let mut state = binding.session.clone();
                    state.launch_owner = Some(owner.clone());
                    assert!(rows.set_session_state(&binding.id, &binding.session, &state)?);
                    Ok(())
                })
                .unwrap();
            storage.close().unwrap();
        } else {
            // As a managed launch: an admitted launch row and its observation on every hook,
            // so a Digest Stop that hands nothing off stores why (#5459).
            let launch = record_admitted_launch(&fixture, &agent, driver, &owner);
            provider.launch = Some(serde_json::to_string(&launch).unwrap());
        }
        let now = tmt_adapters::request_runtime::wall_time_ms();
        let policy = passthrough::api(
            &fixture,
            "ok",
            "digest.policy.set",
            serde_json::json!({"identityId":agent,"ownerIdentityId":person,"setterIdentityId":person,"expectedRevision":0,"untilMs":now+60_000}),
        );
        assert_eq!(policy["active"], true, "{policy:#}");
        let folded = scenario == CaptureScenario::FoldedInput;
        if folded {
            let mut earlier = event("UserPromptSubmit");
            earlier["prompt"] = "A request that began the turn".into();
            ok(provider.hook(earlier));
        }
        let sent = fixture.json(&[
            "talk",
            "worker",
            "Ben question",
            "--passthrough",
            "--identity",
            "ben",
            "--detach",
            "--json",
        ]);
        let request = sent["requestId"].as_str().unwrap();
        let mut prompt = event("UserPromptSubmit");
        prompt[if driver == "agy" {
            "lastUserInput"
        } else {
            "prompt"
        }] = "Ben question".into();
        if folded {
            ok(provider.hook(event("PostToolUse")));
        } else {
            ok(provider.hook(prompt));
        }
        if scenario == CaptureScenario::CompactedMidTurn {
            let mut compacted = event("SessionStart");
            compacted["source"] = "compact".into();
            ok(provider.hook(compacted));
        }
        let held = fixture.json(&[
            "talk",
            "worker",
            "Core decision item",
            "--identity",
            "core-1",
            "--detach",
            "--json",
        ]);
        assert_eq!(held["digest"], true, "{held:#}");
        let mut first = event("Stop");
        if driver != "agy" {
            first["stop_hook_active"] = false.into();
        }
        first[final_field] = "A: answer to Ben".into();
        match scenario {
            CaptureScenario::Canceled => first["terminationReason"] = "USER_CANCELED".into(),
            CaptureScenario::Subagent => first["parentConversationId"] = "parent-session".into(),
            _ => (),
        }
        let before_stop = passthrough::api(
            &fixture,
            "ok",
            "responses.timeline",
            serde_json::json!({"identityId":agent}),
        );
        match scenario {
            CaptureScenario::MissingQueue => {
                fs::remove_file(fixture.state().join("hook-writes.db")).unwrap()
            }
            CaptureScenario::IncompatibleQueue => {
                let queue =
                    rusqlite::Connection::open(fixture.state().join("hook-writes.db")).unwrap();
                queue
                    .pragma_update(
                        None,
                        "user_version",
                        tmt_adapters::storage::hook_queue::QUEUE_SCHEMA_VERSION + 1,
                    )
                    .unwrap();
            }
            _ => {}
        }
        if observer_first {
            if activity_only {
                fs::write(
                    provider
                        .steps
                        .join(provider.next.to_string())
                        .with_extension("activity"),
                    "",
                )
                .unwrap();
            }
            observer(&mut provider, first.clone(), capture, scenario);
        }
        if unbound_once {
            fs::write(fixture.root.join("driver/capture-unbound-once"), "").unwrap();
        }
        if scenario == CaptureScenario::QueueFailure {
            // Queue admission fails before any durable handoff. A main-writer
            // failure after enqueue is pending work, never a failed capture.
            let queue = rusqlite::Connection::open(fixture.state().join("hook-writes.db")).unwrap();
            queue.execute_batch("CREATE TRIGGER refuse_capture BEFORE INSERT ON hook_writes BEGIN SELECT RAISE(ABORT, 'queue append fixture failure'); END;").unwrap();
        }
        let feedback = ok(provider.digest_hook(first.clone()));
        if matches!(
            scenario,
            CaptureScenario::Canceled | CaptureScenario::Subagent
        ) {
            assert_eq!(
                feedback.trim(),
                "{}",
                "no Digest continuation for {scenario:?}"
            );
            if !observer_first || activity_only {
                observer(&mut provider, first.clone(), capture, scenario);
            }
            let after = passthrough::api(
                &fixture,
                "ok",
                "responses.timeline",
                serde_json::json!({"identityId":agent}),
            );
            assert_eq!(after["responses"], serde_json::json!([]), "{after:#}");
            assert_eq!(
                after["entries"], before_stop["entries"],
                "no final or invented Digest input: {after:#}"
            );
            let shown = passthrough::api(
                &fixture,
                "ok",
                "requests.show",
                serde_json::json!({"requestId":request}),
            );
            assert_eq!(
                shown["passthrough"]["state"],
                if scenario == CaptureScenario::Canceled {
                    "no_answer"
                } else {
                    "bound"
                },
                "{shown:#}"
            );
            let db = rusqlite::Connection::open(fixture.state().join("tmt.db")).unwrap();
            let (batches, open): (i64, i64) = db
                .query_row(
                    "SELECT count(*),sum(closed_ms IS NULL) FROM capture_batches",
                    [],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .unwrap();
            assert_eq!(
                (batches, open),
                (
                    1,
                    if scenario == CaptureScenario::Canceled {
                        0
                    } else {
                        1
                    }
                ),
                "{scenario:?}"
            );
            continue;
        }
        if scenario == CaptureScenario::QueueFailure {
            assert!(
                (feedback.is_empty() || (driver == "agy" && feedback.trim() == "{}")),
                "failed capture must precede Digest publication"
            );
            let timeline = passthrough::api(
                &fixture,
                "ok",
                "responses.timeline",
                serde_json::json!({"identityId":agent}),
            );
            let entries = timeline["entries"].as_array().unwrap();
            assert!(
                entries.iter().any(|entry| entry["kind"] == "failure"
                    && entry["failure"]["code"] == "storage_error"),
                "{timeline:#}"
            );
            assert!(
                !entries
                    .iter()
                    .any(|entry| entry["kind"] == "input" && entry["text"] == "Core decision item"),
                "{timeline:#}"
            );
            let failed_before = entries
                .iter()
                .filter(|entry| entry["kind"] == "failure")
                .count();
            let recorded_batch = before_stop["entries"][0]["inputBatchId"].clone();
            assert!(
                entries
                    .iter()
                    .filter(|entry| entry["kind"] == "failure")
                    .all(|entry| entry["inputBatchId"] == recorded_batch),
                "{timeline:#}"
            );
            let mut second_miss = first.clone();
            second_miss[final_field] = "A distinct final also could not be published".into();
            observer(&mut provider, second_miss, capture, scenario);
            let after = passthrough::api(
                &fixture,
                "ok",
                "responses.timeline",
                serde_json::json!({"identityId":agent}),
            );
            let failures: Vec<_> = after["entries"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|entry| entry["kind"] == "failure")
                .collect();
            assert_eq!(failures.len(), failed_before + 1, "{after:#}");
            assert!(
                failures
                    .iter()
                    .all(|entry| entry["inputBatchId"] == recorded_batch),
                "{after:#}"
            );
            assert_eq!(after["responses"], serde_json::json!([]));
            continue;
        }
        assert!(
            !(feedback.is_empty() || (driver == "agy" && feedback.trim() == "{}")),
            "a verified Digest launch must still hand off the held item; stored launch outcomes: {:?}",
            stored_launch_outcomes(&fixture)
        );
        let feedback: Value = serde_json::from_str(&feedback).unwrap();
        assert_eq!(
            feedback["decision"],
            if driver == "agy" { "continue" } else { "block" },
            "{feedback:#}"
        );
        assert!(
            feedback["reason"]
                .as_str()
                .unwrap()
                .contains("Core decision item")
        );
        if unbound_once {
            assert!(fixture.calls().iter().any(|call| call == "capture-unbound"));
            let timeline = passthrough::api(
                &fixture,
                "ok",
                "responses.timeline",
                serde_json::json!({"identityId":agent}),
            );
            assert_eq!(timeline["responses"], serde_json::json!([]), "{timeline:#}");
            assert!(
                timeline["entries"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|entry| entry["kind"] == "input" && entry["text"] == "Core decision item"),
                "{timeline:#}"
            );
            continue;
        }
        if !observer_first {
            observer(&mut provider, first.clone(), capture, scenario);
        }
        let mut second = event("Stop");
        second[if driver == "agy" {
            "continuationActive"
        } else {
            "stop_hook_active"
        }] = true.into();
        second[final_field] = "B: answer to core-1".into();
        ok(provider.digest_hook(second.clone()));
        if activity_only {
            fs::write(
                provider
                    .steps
                    .join(provider.next.to_string())
                    .with_extension("activity"),
                "",
            )
            .unwrap();
            observer(&mut provider, second.clone(), capture, scenario);
        }
        observer(&mut provider, second, capture, scenario);
        let timeline = passthrough::api(
            &fixture,
            "ok",
            "responses.timeline",
            serde_json::json!({"identityId":agent}),
        );
        if !capture {
            assert_eq!(timeline["responses"], serde_json::json!([]), "{timeline:#}");
            assert!(
                timeline["entries"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|e| e["kind"] == "input"),
                "{timeline:#}"
            );
            continue;
        }
        let entries = timeline["entries"]
            .as_array()
            .unwrap_or_else(|| panic!("{timeline:#}"));
        assert_eq!(
            entries
                .iter()
                .map(|e| e["kind"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["input", "final", "input", "final"],
            "{timeline:#}"
        );
        assert_eq!(entries[0]["requestId"], request);
        assert_eq!(entries[2]["text"], "Core decision item");
        assert_eq!(entries[2]["sender"]["name"], "core-1");
        assert!(
            entries
                .iter()
                .all(|e| e["inputBatchId"] == entries[0]["inputBatchId"])
        );
        let responses = timeline["responses"].as_array().unwrap();
        assert_eq!(responses.len(), 2, "{timeline:#}");
        assert_eq!(responses[0]["provider"], driver);
        assert_eq!(responses[0]["text"], "A: answer to Ben");
        assert_eq!(responses[0]["requestId"], request);
        assert_eq!(responses[1]["provider"], driver);
        assert_eq!(responses[1]["text"], "B: answer to core-1");
        assert_ne!(responses[0]["responseId"], responses[1]["responseId"]);
        assert!(responses[1].get("requestId").is_none());
        assert_eq!(entries[3]["acknowledgements"], serde_json::json!([]));
        assert_eq!(entries[1]["acknowledgements"][0]["identityId"], person);
        assert_eq!(entries[1]["acknowledgements"][0]["requestId"], request);
        let shown = passthrough::api(
            &fixture,
            "ok",
            "requests.show",
            serde_json::json!({"requestId":request}),
        );
        assert_eq!(
            shown["passthrough"]["answer"]["text"], "A: answer to Ben",
            "{shown:#}"
        );
        assert_eq!(
            shown["passthrough"]["inputBatchId"],
            entries[0]["inputBatchId"]
        );
        observer(&mut provider, first, capture, scenario);
        let after = passthrough::api(
            &fixture,
            "ok",
            "responses.timeline",
            serde_json::json!({"identityId":agent}),
        );
        assert_eq!(
            after["entries"], timeline["entries"],
            "duplicate ordinary Stop changes nothing"
        );
    }
}

#[test]
fn pi_captures_prompt_and_settled_reply_without_usage_consent() {
    register();
    let fixture = Fixture::delivering("capture-pi-per-launch");
    bind(&fixture, fixture.approve());
    let agent = worker(&fixture.json(&["ls", "--json"]))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let person = fixture.json(&["identity", "create", "ben", "--json"])["identity"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    fixture.json(&[
        "identity",
        "meta",
        "set",
        "user",
        "true",
        "--identity",
        "ben",
        "--json",
    ]);
    let session = "33333333-3333-4333-8333-333333333333";
    let mut provider = SteppedProvider::start(&fixture, "pi", "pi-capture-steps");
    ok(provider.hook(serde_json::json!({
        "event": "session_start",
        "session_id": session,
        "reason": "startup",
        "model": "unknown"
    })));
    let listed = fixture.json(&["ls", "--json"]);
    assert_eq!(
        worker(&listed)["resume"]["session"],
        session,
        "session_start must admit session: {listed:#}"
    );
    assert!(
        worker(&listed)["resume"]
            .get("model")
            .is_none_or(Value::is_null),
        "unknown model must not be recorded for resume: {listed:#}"
    );
    let sent = fixture.json(&[
        "talk",
        "worker",
        "Pi question",
        "--passthrough",
        "--identity",
        "ben",
        "--detach",
        "--json",
    ]);
    let request = sent["requestId"].as_str().unwrap();
    ok(provider.hook(serde_json::json!({
        "event": "before_agent_start",
        "session_id": session,
        "prompt": "Pi question"
    })));
    let after_prompt = fixture.json(&["ls", "--json"]);
    assert_eq!(
        worker(&after_prompt)["session"]["activity"]["state"],
        "working",
        "after prompt: {after_prompt:#}"
    );
    ok(provider.hook(serde_json::json!({
        "event": "agent_settled",
        "session_id": session,
        "aborted": false,
        "final_text": "Pi answer"
    })));
    // Turn-end capture enqueues into HookQueue and flushes asynchronously via `__hook-flush`.
    let wait_until = std::time::Instant::now() + std::time::Duration::from_secs(5);
    let timeline = loop {
        let timeline = passthrough::api(
            &fixture,
            "ok",
            "responses.timeline",
            serde_json::json!({"identityId": agent}),
        );
        let settled = worker(&fixture.json(&["ls", "--json"]))["session"]["activity"]["state"]
            == "idle"
            && timeline["entries"]
                .as_array()
                .is_some_and(|entries| entries.len() == 2);
        if settled || std::time::Instant::now() >= wait_until {
            break timeline;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    };
    let after_settled = fixture.json(&["ls", "--json"]);
    assert_eq!(
        worker(&after_settled)["session"]["activity"]["state"],
        "idle",
        "after settled: {after_settled:#}"
    );
    assert_eq!(timeline["capture"], serde_json::json!({"enabled": true}));
    let entries = timeline["entries"].as_array().unwrap();
    assert_eq!(
        entries
            .iter()
            .map(|e| e["kind"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["input", "final"],
        "{timeline:#}"
    );
    assert_eq!(entries[0]["requestId"], request);
    assert_eq!(entries[1]["acknowledgements"][0]["identityId"], person);
    assert_eq!(entries[1]["acknowledgements"][0]["requestId"], request);
    let responses = timeline["responses"].as_array().unwrap();
    assert_eq!(responses.len(), 1, "{timeline:#}");
    assert_eq!(responses[0]["provider"], "pi");
    assert_eq!(responses[0]["text"], "Pi answer");
    assert_eq!(responses[0]["requestId"], request);
    let shown = passthrough::api(
        &fixture,
        "ok",
        "requests.show",
        serde_json::json!({"requestId": request}),
    );
    assert_eq!(
        shown["passthrough"]["answer"]["text"], "Pi answer",
        "{shown:#}"
    );
}

#[test]
fn pi_usage_collection_follows_per_launch_setup_consent() {
    register();
    let fixture = Fixture::delivering("pi-per-launch-consent");
    bind(&fixture, fixture.approve());
    let agent = worker(&fixture.json(&["ls", "--json"]))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let session = "33333333-3333-4333-8333-333333333333";
    let transcript = fixture.root.join(format!(
        "home/.pi/agent/sessions/proj/2026-11-17_{session}.jsonl"
    ));
    fs::create_dir_all(transcript.parent().unwrap()).unwrap();
    let write_turn = |tokens: u64, text: &str| {
        let entry = serde_json::json!({
            "type": "message",
            "id": format!("msg-{tokens}"),
            "parentId": null,
            "timestamp": "2026-11-17T00:00:00.000Z",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": text}],
                "provider": "anthropic",
                "model": "claude-sonnet-4-5",
                "usage": {
                    "input": tokens,
                    "output": 0,
                    "cacheRead": 0,
                    "cacheWrite": 0,
                    "totalTokens": tokens
                },
                "stopReason": "stop",
                "timestamp": 1794873600000u64
            }
        });
        fs::write(&transcript, format!("{entry}\n")).unwrap();
    };
    write_turn(170, "Pi answer 1");

    // Unconsented by default: setup --status fails closed.
    let status = fixture.json(&["setup", "pi", "--status", "--json"]);
    assert_eq!(status["integrations"][0]["provider"], "pi");
    assert_eq!(status["integrations"][0]["usage"], false);
    assert_eq!(status["integrations"][0]["perLaunch"], true);

    let mut provider = SteppedProvider::start(&fixture, "pi", "pi-consent-steps");
    ok(provider.hook(serde_json::json!({
        "event": "session_start",
        "session_id": session,
        "session_file": transcript,
        "reason": "startup"
    })));
    ok(provider.hook(serde_json::json!({
        "event": "before_agent_start",
        "session_id": session,
        "session_file": transcript,
        "prompt": "first"
    })));
    ok(provider.hook(serde_json::json!({
        "event": "agent_settled",
        "session_id": session,
        "session_file": transcript,
        "aborted": false,
        "final_text": "Pi answer 1"
    })));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let timeline = passthrough::api(
            &fixture,
            "ok",
            "responses.timeline",
            serde_json::json!({"identityId": agent}),
        );
        if timeline["responses"]
            .as_array()
            .is_some_and(|r| r.len() == 1)
            || std::time::Instant::now() >= deadline
        {
            assert_eq!(
                timeline["responses"][0]["text"], "Pi answer 1",
                "{timeline:#}"
            );
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    assert!(
        worker(&fixture.json(&["ls", "--json"]))["resume"]["usage"].is_null(),
        "usage must stay uncollected before setup consent"
    );

    // Explicit `tmt setup pi --yes` enables persisted per-launch consent.
    let setup_on = fixture.json(&["setup", "pi", "--yes", "--json"]);
    assert_eq!(setup_on["provider"], "pi");
    assert_eq!(setup_on["changed"], true);
    assert_eq!(setup_on["usage"], true);
    assert_eq!(
        fixture.json(&["setup", "pi", "--status", "--json"])["integrations"][0]["usage"],
        true
    );

    write_turn(250, "Pi answer 2");
    ok(provider.hook(serde_json::json!({
        "event": "before_agent_start",
        "session_id": session,
        "session_file": transcript,
        "prompt": "second"
    })));
    ok(provider.hook(serde_json::json!({
        "event": "agent_settled",
        "session_id": session,
        "session_file": transcript,
        "aborted": false,
        "final_text": "Pi answer 2"
    })));
    let deadline2 = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let list = fixture.json(&["ls", "--json"]);
        if worker(&list)["resume"]["usage"]["tokens"] == 250
            || std::time::Instant::now() >= deadline2
        {
            assert_eq!(worker(&list)["resume"]["usage"]["tokens"], 250, "{list:#}");
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }

    // Opting out stops future usage collection while keeping Chat replies flowing.
    let setup_off = fixture.json(&["setup", "pi", "--no-usage", "--yes", "--json"]);
    assert_eq!(setup_off["usage"], false);
    write_turn(400, "Pi answer 3");
    ok(provider.hook(serde_json::json!({
        "event": "before_agent_start",
        "session_id": session,
        "session_file": transcript,
        "prompt": "third"
    })));
    ok(provider.hook(serde_json::json!({
        "event": "agent_settled",
        "session_id": session,
        "session_file": transcript,
        "aborted": false,
        "final_text": "Pi answer 3"
    })));
    let deadline3 = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let timeline = passthrough::api(
            &fixture,
            "ok",
            "responses.timeline",
            serde_json::json!({"identityId": agent}),
        );
        if timeline["responses"]
            .as_array()
            .is_some_and(|r| r.len() == 3)
            || std::time::Instant::now() >= deadline3
        {
            assert_eq!(
                timeline["responses"][2]["text"], "Pi answer 3",
                "{timeline:#}"
            );
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    assert_eq!(
        worker(&fixture.json(&["ls", "--json"]))["resume"]["usage"]["tokens"],
        250
    );

    let removed = fixture.json(&["setup", "pi", "--remove", "--yes", "--json"]);
    assert_eq!(removed["removed"], true);
    assert_eq!(removed["usage"], false);
    assert_eq!(
        fixture.json(&["setup", "pi", "--status", "--json"])["integrations"][0]["usage"],
        false
    );
}

#[test]
fn woken_turns_measure_tokens_after_first_turn_while_ordinary_prompts_skip_start_reads() {
    register();
    let fixture = Fixture::delivering("wake-turns-measured");
    bind(&fixture, fixture.approve());
    fixture.json(&["identity", "create", "ben", "--json"]);
    let agent = worker(&fixture.json(&["ls", "--json"]))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let home = fixture.root.join("home");
    let transcript = home.join(".claude/projects/-workspace/s-wake.jsonl");
    fs::create_dir_all(transcript.parent().unwrap()).unwrap();
    let source =
        include_str!("../../../tmt-adapters/src/runtime/fixtures/claude-usage-sequence.jsonl");
    let line1 = source.lines().next().unwrap();
    let line2 = source.lines().nth(1).unwrap();
    let line4 = source.lines().nth(3).unwrap();
    fs::write(&transcript, format!("{{\"type\":\"user\"}}\n{line1}\n")).unwrap();
    install_capture_hook(&fixture, "claude");

    let mut provider = SteppedProvider::start(&fixture, "claude", "wake-measured-steps");
    ok(provider.hook(claude_event("SessionStart")));
    let tmt_adapters::process::runtime::ProcessObservation::Live(owner) = observe_runtime_process(
        &UnixCommandRunner,
        u64::from(std::process::id()),
        deadline(),
    )
    .unwrap() else {
        panic!("test owner is not live");
    };
    let launch = record_admitted_launch(&fixture, &agent, "claude", &owner);
    provider.launch = Some(serde_json::to_string(&launch).unwrap());

    // Turn 1 (ordinary first turn): establishes initial consumption state in remembered.state.
    let mut prompt1 = claude_event("UserPromptSubmit");
    prompt1["prompt"] = "ordinary turn 1".into();
    prompt1["transcript_path"] = transcript.to_string_lossy().into_owned().into();
    ok(provider.hook(prompt1));
    let mut stop1 = claude_event("Stop");
    stop1["stop_hook_active"] = false.into();
    stop1["transcript_path"] = transcript.to_string_lossy().into_owned().into();
    stop1["last_assistant_message"] = "ordinary answer 1".into();
    ok(provider.hook(stop1));

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let list = fixture.json(&["ls", "--json"]);
        if worker(&list)["resume"]["usage"]["tokens"] == 355_113
            || std::time::Instant::now() >= deadline
        {
            assert_eq!(
                worker(&list)["resume"]["usage"]["tokens"],
                355_113,
                "{list:#}"
            );
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    let db = rusqlite::Connection::open(fixture.state().join("tmt.db")).unwrap();
    let wake_count: i64 = db
        .query_row("SELECT count(*) FROM wake_turns", [], |row| row.get(0))
        .unwrap();
    assert_eq!(wake_count, 0);

    // Turn 2 (woken subsequent turn with existing remembered consumption): must read baseline at
    // UserPromptSubmit and close wake_turns as measured after Stop follow-up.
    let sent = fixture.json(&[
        "talk",
        "worker",
        "wake task 2",
        "--identity",
        "ben",
        "--detach",
        "--json",
    ]);
    let req_id = sent["requestId"].as_str().unwrap().to_owned();
    let mut prompt2 = claude_event("UserPromptSubmit");
    prompt2["prompt"] = "wake task 2".into();
    prompt2["transcript_path"] = transcript.to_string_lossy().into_owned().into();
    ok(provider.hook(prompt2));

    let (ended_at_start, baseline): (Option<i64>, Option<String>) = db
        .query_row(
            "SELECT ended_ms, baseline FROM wake_turns ORDER BY started_ms DESC LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert!(ended_at_start.is_none());
    assert!(
        baseline.is_some(),
        "woken TurnStarted must capture start baseline even after Turn 1"
    );

    fs::write(
        &transcript,
        format!("{{\"type\":\"user\"}}\n{line1}\n{line2}\n"),
    )
    .unwrap();
    let mut stop2 = claude_event("Stop");
    stop2["stop_hook_active"] = false.into();
    stop2["transcript_path"] = transcript.to_string_lossy().into_owned().into();
    stop2["last_assistant_message"] = "wake answer 2".into();
    ok(provider.hook(stop2));

    let deadline2 = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let page = passthrough::api(
            &fixture,
            "ok",
            "digest.wakeTurns",
            serde_json::json!({
                "identityIds": [agent],
                "fromMs": 0,
                "throughMs": tmt_core::limits::MAX_JS_SAFE_INTEGER,
                "limit": 10
            }),
        );
        let turns = page["turns"].as_array().unwrap();
        if turns.len() == 1 && !turns[0]["endedAtMs"].is_null()
            || std::time::Instant::now() >= deadline2
        {
            assert_eq!(turns.len(), 1, "{page:#}");
            let turn = &turns[0];
            assert!(!turn["endedAtMs"].is_null(), "{turn:#}");
            assert_eq!(turn["measured"], true, "{turn:#}");
            assert_eq!(turn["requestIds"], serde_json::json!([req_id]));
            assert_eq!(turn["tokens"]["inputTokens"], 355_402, "{turn:#}");
            assert_eq!(turn["tokens"]["outputTokens"], 546, "{turn:#}");
            assert_eq!(turn["tokens"]["cachedInputTokens"], 355_111, "{turn:#}");
            assert_eq!(turn["byModel"][0]["modelId"], "claude-opus-5-5", "{turn:#}");
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }

    // Turn 3 (ordinary prompt, no pending wake): mutate transcript BEFORE UserPromptSubmit and
    // verify ordinary prompt performs no transcript read (sampled_at_ms & tokens stay at Turn 2).
    let (sampled_before_t3, latest_before_t3): (Option<i64>, Option<String>) = db
        .query_row(
            "SELECT sampled_at_ms, latest FROM consumption_sources WHERE identity_id=?",
            [&agent],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    fs::write(
        &transcript,
        format!("{{\"type\":\"user\"}}\n{line1}\n{line2}\n{line4}\n"),
    )
    .unwrap();
    let mut prompt3 = claude_event("UserPromptSubmit");
    prompt3["prompt"] = "ordinary turn 3".into();
    prompt3["transcript_path"] = transcript.to_string_lossy().into_owned().into();
    ok(provider.hook(prompt3));
    let (sampled_after_p3, latest_after_p3): (Option<i64>, Option<String>) = db
        .query_row(
            "SELECT sampled_at_ms, latest FROM consumption_sources WHERE identity_id=?",
            [&agent],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(sampled_after_p3, sampled_before_t3);
    assert_eq!(latest_after_p3, latest_before_t3);

    let mut stop3 = claude_event("Stop");
    stop3["stop_hook_active"] = false.into();
    stop3["transcript_path"] = transcript.to_string_lossy().into_owned().into();
    stop3["last_assistant_message"] = "ordinary answer 3".into();
    ok(provider.hook(stop3));
    let deadline3 = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let timeline = passthrough::api(
            &fixture,
            "ok",
            "responses.timeline",
            serde_json::json!({"identityId": agent}),
        );
        if timeline["responses"]
            .as_array()
            .is_some_and(|r| r.len() == 3)
            || std::time::Instant::now() >= deadline3
        {
            assert_eq!(
                timeline["responses"].as_array().unwrap().len(),
                3,
                "{timeline:#}"
            );
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    let wake_count_after: i64 = db
        .query_row("SELECT count(*) FROM wake_turns", [], |row| row.get(0))
        .unwrap();
    assert_eq!(wake_count_after, 1);
}

#[test]
fn interrupted_unreadable_and_unconsented_woken_stops_close_wake_turns_unmeasured() {
    register();
    let fixture = Fixture::delivering("wake-turns-unmeasured");
    bind(&fixture, fixture.approve());
    fixture.json(&["identity", "create", "ben", "--json"]);
    assert_eq!(
        fixture.json(&["setup", "pi", "--yes", "--json"])["usage"],
        true
    );
    let agent = worker(&fixture.json(&["ls", "--json"]))["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let session = "44444444-4444-4444-8444-444444444444";
    let transcript = fixture.root.join(format!(
        "home/.pi/agent/sessions/proj/2026-11-18_{session}.jsonl"
    ));
    fs::create_dir_all(transcript.parent().unwrap()).unwrap();
    let write_pi = |tokens: u64, text: &str| {
        let entry = serde_json::json!({
            "type": "message",
            "id": format!("msg-{tokens}"),
            "parentId": null,
            "timestamp": "2026-11-18T00:00:00.000Z",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": text}],
                "provider": "anthropic",
                "model": "claude-sonnet-4-5",
                "usage": {
                    "input": tokens,
                    "output": 10,
                    "cacheRead": 0,
                    "cacheWrite": 0,
                    "totalTokens": tokens + 10
                },
                "stopReason": "stop",
                "timestamp": 1794873600000u64
            }
        });
        fs::write(&transcript, format!("{entry}\n")).unwrap();
    };
    write_pi(100, "Pi base");

    let mut provider = SteppedProvider::start(&fixture, "pi", "pi-unmeasured-steps");
    ok(provider.hook(serde_json::json!({
        "event": "session_start",
        "session_id": session,
        "session_file": transcript,
        "reason": "startup"
    })));
    let db = rusqlite::Connection::open(fixture.state().join("tmt.db")).unwrap();
    let rows = || -> Vec<(Option<i64>, i64)> {
        let mut stmt = db
            .prepare("SELECT ended_ms, measured FROM wake_turns ORDER BY started_ms")
            .unwrap();
        stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    };

    // 1. Interrupted Stop closes wake turn with measured=0.
    fixture.json(&[
        "talk",
        "worker",
        "wake 1",
        "--identity",
        "ben",
        "--detach",
        "--json",
    ]);
    ok(provider.hook(serde_json::json!({
        "event": "before_agent_start",
        "session_id": session,
        "session_file": transcript,
        "prompt": "wake 1"
    })));
    write_pi(200, "aborted reply");
    ok(provider.hook(serde_json::json!({
        "event": "agent_settled",
        "session_id": session,
        "session_file": transcript,
        "aborted": true,
        "final_text": "aborted reply"
    })));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let r = rows();
        if (r.len() == 1 && r[0].0.is_some()) || std::time::Instant::now() >= deadline {
            assert_eq!(r.len(), 1, "{r:?}");
            assert!(r[0].0.is_some(), "interrupted Stop must close wake turn");
            assert_eq!(r[0].1, 0, "interrupted Stop must have measured=0");
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }

    // 2. Unreadable transcript at Stop closes wake turn with measured=0.
    write_pi(200, "before unreadable");
    fixture.json(&[
        "talk",
        "worker",
        "wake 2",
        "--identity",
        "ben",
        "--detach",
        "--json",
    ]);
    ok(provider.hook(serde_json::json!({
        "event": "before_agent_start",
        "session_id": session,
        "session_file": transcript,
        "prompt": "wake 2"
    })));
    fs::write(&transcript, "{not-valid-json\n").unwrap();
    ok(provider.hook(serde_json::json!({
        "event": "agent_settled",
        "session_id": session,
        "session_file": transcript,
        "aborted": false,
        "final_text": "done unreadable"
    })));
    let deadline2 = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let r = rows();
        let timeline = passthrough::api(
            &fixture,
            "ok",
            "responses.timeline",
            serde_json::json!({"identityId": agent}),
        );
        if (r.len() == 2 && r[1].0.is_some()) || std::time::Instant::now() >= deadline2 {
            assert_eq!(r.len(), 2, "{r:?} {timeline:#}");
            assert!(r[1].0.is_some(), "unreadable Stop must close wake turn");
            assert_eq!(r[1].1, 0, "unreadable Stop must have measured=0");
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }

    // 3. Unconsented Stop closes wake turn with measured=0.
    write_pi(300, "before unconsented");
    fixture.json(&[
        "talk",
        "worker",
        "wake 3",
        "--identity",
        "ben",
        "--detach",
        "--json",
    ]);
    ok(provider.hook(serde_json::json!({
        "event": "before_agent_start",
        "session_id": session,
        "session_file": transcript,
        "prompt": "wake 3"
    })));
    assert_eq!(
        fixture.json(&["setup", "pi", "--no-usage", "--yes", "--json"])["usage"],
        false
    );
    write_pi(450, "done unconsented");
    ok(provider.hook(serde_json::json!({
        "event": "agent_settled",
        "session_id": session,
        "session_file": transcript,
        "aborted": false,
        "final_text": "done unconsented"
    })));
    let deadline3 = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        let r = rows();
        if (r.len() == 3 && r[2].0.is_some()) || std::time::Instant::now() >= deadline3 {
            assert_eq!(r.len(), 3, "{r:?}");
            assert!(r[2].0.is_some(), "unconsented Stop must close wake turn");
            assert_eq!(r[2].1, 0, "unconsented Stop must have measured=0");
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
}
