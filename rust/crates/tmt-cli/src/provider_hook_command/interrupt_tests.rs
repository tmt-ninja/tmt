//! An interrupt's commit shares the turn-end CAS (#3207): a binding or
//! preferences change between the hook's read and its commit wins.
use super::*;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use tmt_core::{
    binding::session::{
        RuntimeMode, SessionPreferences,
        activity::{ActivityPhase, Event},
    },
    endpoint::{PaneObservation, ServerEvidence},
    identity::{Lifetime, create_or_resolve},
};

struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "tmt-activity-cas-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        Self(path)
    }
}
impl Drop for Directory {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

fn turn(
    phase: ActivityPhase,
    id: &str,
) -> tmt_adapters::runtime::hook_protocol::ActivityObservation {
    tmt_adapters::runtime::hook_protocol::ActivityObservation {
        event: Event {
            kind: match phase {
                ActivityPhase::Working => {
                    tmt_core::binding::session::activity::EventKind::TurnStarted
                }
                ActivityPhase::Waiting => {
                    tmt_core::binding::session::activity::EventKind::ApprovalPrompt
                }
                ActivityPhase::Idle => tmt_core::binding::session::activity::EventKind::TurnEnded,
            },
            turn: Some(ProviderSessionId::new(id).unwrap()),
        },
        model: None,
    }
}

fn rows(database: &std::path::Path, table: &str) -> i64 {
    rusqlite::Connection::open(database)
        .unwrap()
        .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
            row.get(0)
        })
        .unwrap()
}

#[test]
fn live_replacement_requires_an_independent_host_and_no_live_or_unknown_owner() {
    let private = HostEvidence::Independent { runtime_pid: None };
    for (host, previous, owner, allowed) in [
        (private, RuntimeLiveness::Alive, None, true),
        (
            private,
            RuntimeLiveness::Alive,
            Some(RuntimeLiveness::Gone),
            true,
        ),
        (
            private,
            RuntimeLiveness::Alive,
            Some(RuntimeLiveness::Alive),
            false,
        ),
        (
            private,
            RuntimeLiveness::Alive,
            Some(RuntimeLiveness::Unknown),
            false,
        ),
        (private, RuntimeLiveness::Unknown, None, false),
        (
            HostEvidence::Ambiguous { runtime_pid: 20 },
            RuntimeLiveness::Alive,
            None,
            false,
        ),
    ] {
        assert_eq!(live_replacement_allowed(host, previous, owner), allowed);
    }
}

#[test]
fn live_replacement_loses_to_a_concurrent_binding_or_preferences_change() {
    use tmt_core::binding::session::{BindingSessionState, ObservedSessionKey, SessionTransition};
    let harness = HarnessId::new("claude").unwrap();
    let registry = RuntimeRegistry::first_party();
    let lifecycle = registry.lifecycle(&harness).unwrap();
    let event = lifecycle.decode(br#"{"hook_event_name":"SessionStart","session_id":"new","source":"startup","cwd":"/src","model":"test"}"#).unwrap();
    let mode = RuntimeMode::new("default").unwrap();
    for race in ["unchanged", "binding", "preferences"] {
        let directory = Directory::new();
        let database = directory.0.join("state.db");
        let mut storage = Storage::open(&database).unwrap();
        let identity = create_or_resolve(&mut storage, "Worker", Lifetime::Saved)
            .unwrap()
            .identity;
        let server = ServerEvidence {
            host: tmt_core::host::HostKind::Tmux,
            server_id: "123e4567-e89b-42d3-a456-426614174000".into(),
            socket_path: "/tmp/test.sock".into(),
            server_pid: 10,
            server_start_time: "server".into(),
        };
        let pane = PaneObservation {
            agent_name: None,
            id: "%1".into(),
            target: None,
            cwd: None,
            command: "claude".into(),
            pane_pid: 11,
            pane_incarnation: Some("pane".into()),
            suggested_name: None,
            marker: None,
            location: None,
        };
        let old = BindingSessionState::default()
            .admit(
                ObservedSessionKey {
                    incarnation: ProcessIncarnation::new(20, "old").unwrap(),
                    provider_session: Some(ProviderSessionId::new("old").unwrap()),
                },
                SessionTransition::Started,
                RuntimeLiveness::Alive,
            )
            .unwrap();
        storage
            .with_binding_transaction::<_, StorageError>(|records| {
                let binding = records.insert_binding(&identity, &server, &pane)?;
                records.set_session_state(&binding.id, &binding.session, &old)?;
                Ok(())
            })
            .unwrap();
        storage.close().unwrap();
        let stored = Storage::context_by_identity(&database, &identity.id, 0)
            .unwrap()
            .unwrap();
        let next = event
            .propose_superseding(&old, &ProcessIncarnation::new(21, "new").unwrap())
            .unwrap();
        let mut storage = Storage::open(&database).unwrap();
        storage
            .with_binding_transaction::<_, StorageError>(|records| {
                match race {
                    "binding" => {
                        records.detach_binding(&stored.entry.binding.as_ref().unwrap().id)?;
                        records.insert_binding(&identity, &server, &pane)?;
                    }
                    "preferences" => {
                        let preferences = SessionPreferences {
                            channel: Some(true),
                            preferred_harness: Some(harness.clone()),
                            ..Default::default()
                        };
                        records.set_session_preferences(&identity.id, &preferences)?;
                    }
                    _ => (),
                }
                Ok(())
            })
            .unwrap();
        storage.close().unwrap();
        let before = Storage::context_by_identity(&database, &identity.id, 0)
            .unwrap()
            .unwrap();
        let mut storage = Storage::open(&database).unwrap();
        let changed = commit_session(
            &mut storage,
            SessionCommit {
                stored: &stored,
                next: &next,
                event: event.as_ref(),
                harness: &harness,
                mode: &mode,
                fence_preferences: true,
                launch: None,
            },
        )
        .unwrap();
        storage.close().unwrap();
        let after = Storage::context_by_identity(&database, &identity.id, 0)
            .unwrap()
            .unwrap();
        assert_eq!(changed, race == "unchanged", "{race}");
        if changed {
            assert_eq!(after.entry.binding.unwrap().session, next);
        } else {
            assert_eq!(after.entry, before.entry, "{race}");
            assert_eq!(after.preferences, before.preferences, "{race}");
        }
    }
}

#[test]
fn a_racing_binding_or_preferences_change_wins_over_an_interrupt() {
    assert_activity_cas("codex", "Interrupt", ActivityPhase::Idle);
}

#[test]
fn a_racing_binding_or_preferences_change_wins_over_an_approval_notification() {
    assert_activity_cas("claude", "Notification", ActivityPhase::Waiting);
}

#[test]
fn an_uncorrelated_claude_prompt_opens_a_batch_even_while_activity_is_working() {
    assert_activity_cas("claude", "UserPromptSubmit", ActivityPhase::Working);
}

#[test]
fn a_pending_stop_does_not_invalidate_the_next_prompt_inside_its_commit() {
    assert_activity_cas("codex", "UserPromptSubmit", ActivityPhase::Working);
}

fn assert_activity_cas(provider: &str, event: &str, expected_phase: ActivityPhase) {
    let prompt = event == "UserPromptSubmit";
    let registry = RuntimeRegistry::first_party();
    let driver = registry
        .lifecycle(&HarnessId::new(provider).unwrap())
        .unwrap();
    let session = ProviderSessionId::new("s-1").unwrap();
    let process = ProcessIncarnation::new(20, "runtime").unwrap();
    let interrupt = driver
        .decode_activity(
            serde_json::json!({
                "hook_event_name":event, "session_id":"s-1", "turn_id":if prompt { "b" } else { "a" },
                "notification_type":"permission_prompt", "model":"hook-model",
            })
            .to_string()
            .as_bytes(),
        )
        .unwrap();
    let start = |id| {
        let mut event = turn(ActivityPhase::Working, id);
        if provider == "claude" {
            event.event.turn = None;
        }
        event
    };
    let observed = |state: &tmt_core::binding::session::DriverState| {
        driver
            .state_observed_model(state)
            .map(|observed| observed.model)
    };
    let races = if prompt {
        &["unchanged", "preferences", "binding", "queued-stop"][..]
    } else {
        &["unchanged", "preferences", "binding"][..]
    };
    for &race in races {
        let directory = Directory::new();
        let paths = ConfigPaths {
            global_dir: directory.0.clone(),
            global_config: directory.0.join("config.json"),
            local_config: directory.0.join("local.json"),
            database: directory.0.join("state.db"),
        };
        let mut storage = Storage::open(&paths.database).unwrap();
        let identity = create_or_resolve(&mut storage, "Worker", Lifetime::Saved)
            .unwrap()
            .identity;
        let server = ServerEvidence {
            host: tmt_core::host::HostKind::Tmux,
            server_id: "123e4567-e89b-42d3-a456-426614174000".into(),
            socket_path: "/tmp/test.sock".into(),
            server_pid: 10,
            server_start_time: "server".into(),
        };
        let pane = PaneObservation {
            agent_name: None,
            id: "%1".into(),
            target: None,
            cwd: None,
            command: provider.into(),
            pane_pid: 11,
            pane_incarnation: Some("pane".into()),
            suggested_name: None,
            marker: None,
            location: None,
        };
        let harness = HarnessId::new(provider).unwrap();
        let mode = RuntimeMode::new("embedded").unwrap();
        let mut preferences = SessionPreferences::default();
        preferences.remember(harness.clone(), mode.clone(), session.clone());
        let working = driver
            .activity_state(&start("a"), &session, &process, None, 100)
            .unwrap();
        preferences.remembered.as_mut().unwrap().state = Some(working.clone());
        storage
            .with_binding_transaction::<_, StorageError>(|records| {
                let binding = records.insert_binding(&identity, &server, &pane)?;
                let mut state = binding.session.clone();
                state.state = tmt_core::binding::session::RuntimeState::Running;
                state.key = Some(tmt_core::binding::session::ObservedSessionKey {
                    incarnation: process.clone(),
                    provider_session: Some(session.clone()),
                });
                assert!(records.set_session_state(&binding.id, &binding.session, &state)?);
                records.set_session_preferences(&identity.id, &preferences)
            })
            .unwrap();
        storage.close().unwrap();
        let stored = Storage::context_by_identity(&paths.database, &identity.id, 0)
            .unwrap()
            .unwrap();
        let next = driver.activity_state(&interrupt, &session, &process, Some(&working), 200);
        assert!(next.is_some());

        // The concurrent writer commits between the hook's read and its commit.
        let mut storage = Storage::open(&paths.database).unwrap();
        storage
            .with_binding_transaction::<_, StorageError>(|records| {
                match race {
                    "preferences" => {
                        let mut racer = start("b");
                        racer.model = (provider == "codex").then(|| "racer-model".into());
                        let later =
                            driver.activity_state(&racer, &session, &process, Some(&working), 150);
                        preferences.remembered.as_mut().unwrap().state = later;
                        records.set_session_preferences(&identity.id, &preferences)?;
                    }
                    "binding" => {
                        records.detach_binding(&stored.entry.binding.as_ref().unwrap().id)?;
                        records.insert_binding(&identity, &server, &pane)?;
                    }
                    _ => (),
                }
                Ok(())
            })
            .unwrap();
        storage.close().unwrap();
        let queue =
            tmt_adapters::storage::hook_queue::HookQueue::open(&paths.database, Duration::ZERO)
                .unwrap();
        let _flusher = queue.claim().unwrap();
        let mut queued_batch = None;
        if race == "queued-stop" {
            // Force enqueue after the prompt's snapshot, before its writer.
            // Holding the finite flusher fence leaves only the shared writer
            // wrapper capable of running this older Stop during the commit.
            let mut end = turn(ActivityPhase::Idle, "a");
            if provider == "claude" {
                end.event.turn = None;
            }
            let event = tmt_adapters::storage::hook_queue::CaptureEvent::prepare(
                &paths.database,
                &tmt_adapters::storage::TurnCapture {
                    expected: &stored,
                    process: &process,
                    activity: &end,
                    response: Some(tmt_adapters::storage::ResponseCapture {
                        text: tmt_core::responses::FinalText::new("previous answer").unwrap(),
                    }),
                    interrupted: false,
                    now_ms: 150,
                    deadline: Instant::now() + Duration::from_secs(2),
                },
                Default::default(),
            )
            .unwrap();
            queue.enqueue(&event).unwrap();
            queued_batch = serde_json::to_value(queue.next().unwrap().unwrap()).unwrap()["capture"]
                ["batch"]
                .as_str()
                .map(str::to_owned);
            assert!(queued_batch.is_some());
        }
        let before = Storage::context_by_identity(&paths.database, &identity.id, 0)
            .unwrap()
            .unwrap();
        let applied = commit_observation(
            &paths,
            &stored,
            next.clone(),
            None,
            None,
            prompt.then_some(tmt_adapters::storage::TurnBoundary::StartedWithoutPrompt {
                turn: (provider == "codex").then_some("b"),
            }),
            Instant::now() + Duration::from_secs(2),
        )
        .unwrap();
        let after = Storage::context_by_identity(&paths.database, &identity.id, 0)
            .unwrap()
            .unwrap();
        assert_eq!(
            applied,
            matches!(race, "unchanged" | "queued-stop"),
            "{race}"
        );
        if prompt {
            assert_eq!(
                rows(&paths.database, "capture_batches"),
                if applied { 1 } else { 0 },
                "a verified prompt creates its boundary in the same CAS"
            );
        }
        if applied {
            let state = after
                .preferences
                .remembered
                .as_ref()
                .unwrap()
                .state
                .as_ref()
                .unwrap();
            assert_eq!(Some(state), next.as_ref());
            assert_eq!(driver.state_activity(state).unwrap().phase, expected_phase);
            assert_eq!(
                observed(state).as_deref(),
                (provider == "codex").then_some("hook-model")
            );
        } else {
            assert_eq!(after.entry, before.entry, "{race}");
            assert_eq!(after.preferences, before.preferences, "{race}");
            // The losing hook's model is never stored. A racing Claude prompt
            // can clear optional state, which must stay cleared after this CAS.
            let state = after
                .preferences
                .remembered
                .as_ref()
                .unwrap()
                .state
                .as_ref();
            let expected = (race == "preferences" && provider == "codex").then_some("racer-model");
            assert_eq!(state.and_then(observed).as_deref(), expected, "{race}");
        }
        // Activity observation never adds a consumption source or a response.
        assert_eq!(rows(&paths.database, "consumption_sources"), 0);
        assert_eq!(rows(&paths.database, "recent_responses"), 0);
        if race == "queued-stop" {
            assert!(queue.next().unwrap().is_some());
            let mut storage = Storage::open(&paths.database).unwrap();
            storage
                .ingest_pending_hook_captures_for_identity(&identity.id)
                .unwrap();
            storage.close().unwrap();
            let retained = Storage::context_by_identity(&paths.database, &identity.id, 0)
                .unwrap()
                .unwrap();
            assert_eq!(retained.preferences, after.preferences);
            assert_eq!(rows(&paths.database, "recent_responses"), 1);
            let db = rusqlite::Connection::open_with_flags(
                &paths.database,
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .unwrap();
            let (final_batch, closed): (String, Option<i64>) = db.query_row(
                "SELECT e.batch_id,b.closed_ms FROM capture_entries e JOIN capture_batches b ON b.id=e.batch_id WHERE e.kind='final'",
                [], |row| Ok((row.get(0)?,row.get(1)?)),
            ).unwrap();
            assert_eq!(Some(final_batch.clone()), queued_batch);
            assert!(
                closed.is_some(),
                "the older final stays in its historical batch"
            );
            let current_batch: String = db
                .query_row(
                    "SELECT id FROM capture_batches WHERE identity_id=? AND closed_ms IS NULL",
                    [&identity.id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_ne!(current_batch, final_batch);
        }
    }
}

#[test]
fn tool_completions_probe_only_when_storage_reports_waiting_and_never_write_the_precheck() {
    use tmt_core::binding::session::{
        DriverState,
        activity::{Activity, EventKind},
    };
    struct Probe(AtomicU64);
    impl RuntimeLifecycle for Probe {
        fn host_evidence(
            &self,
        ) -> Result<HostEvidence, tmt_adapters::runtime::lifecycle::LifecycleUnavailable> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Ok(HostEvidence::Unsupported)
        }
        fn state_activity(&self, state: &DriverState) -> Option<Activity> {
            tmt_adapters::runtime::driver_state::state_activity(state)
        }
    }
    let registry = RuntimeRegistry::first_party();
    let claude = registry
        .lifecycle(&HarnessId::new("claude").unwrap())
        .unwrap();
    let harness = HarnessId::new("claude").unwrap();
    let session = ProviderSessionId::new("session").unwrap();
    let process = ProcessIncarnation::new(20, "runtime").unwrap();
    for (phase, probes) in [
        (ActivityPhase::Working, 0),
        (ActivityPhase::Waiting, 1),
        (ActivityPhase::Idle, 0),
    ] {
        let directory = Directory::new();
        let paths = ConfigPaths {
            global_dir: directory.0.clone(),
            global_config: directory.0.join("config.json"),
            local_config: directory.0.join("local.json"),
            database: directory.0.join("state.db"),
        };
        let mut storage = Storage::open(&paths.database).unwrap();
        let identity = create_or_resolve(&mut storage, "Tool agent", Lifetime::Saved)
            .unwrap()
            .identity;
        let start = tmt_adapters::runtime::hook_protocol::ActivityObservation {
            event: Event {
                kind: EventKind::TurnStarted,
                turn: None,
            },
            model: None,
        };
        let working = claude
            .activity_state(&start, &session, &process, None, 100)
            .unwrap();
        let state = if phase == ActivityPhase::Working {
            working
        } else {
            claude
                .activity_state(
                    &tmt_adapters::runtime::hook_protocol::ActivityObservation {
                        event: Event {
                            kind: if phase == ActivityPhase::Waiting {
                                EventKind::ApprovalPrompt
                            } else {
                                EventKind::TurnEnded
                            },
                            turn: None,
                        },
                        model: None,
                    },
                    &session,
                    &process,
                    Some(&working),
                    101,
                )
                .unwrap()
        };
        storage.close().unwrap();
        let connection = rusqlite::Connection::open(&paths.database).unwrap();
        connection.execute("INSERT INTO bindings (id, identity_id, transport, pane_id, server_id, socket_path, server_pid, server_start_time, pane_pid, bound_at, last_verified_at, runtime_pid, runtime_start_identity, observed_provider_session_id) VALUES ('binding', ?1, 'tmux', '%1', 'server', '/tmp/test.sock', 10, 'start', 11, 'original', 'original', 20, 'runtime', 'session')", [&identity.id]).unwrap();
        connection.execute("INSERT INTO identity_session_preferences (identity_id, remembered_harness, runtime_mode, provider_session_id, driver_state_version, driver_state) VALUES (?1, 'claude', 'embedded', 'session', ?2, ?3)", rusqlite::params![identity.id, state.version(), state.document()]).unwrap();
        drop(connection);
        let before = fs::read(&paths.database).unwrap();
        for event in ["PostToolUse", "PostToolUseFailure"] {
            let activity = claude
                .decode_activity(
                    serde_json::json!({"hook_event_name":event,"session_id":"session"})
                        .to_string()
                        .as_bytes(),
                )
                .unwrap();
            let probe = Probe(AtomicU64::new(0));
            let output = observe_activity_event(
                &harness,
                &probe,
                &session,
                &activity,
                None,
                Run {
                    deadline: Instant::now() + Duration::from_secs(2),
                    learning: None,
                    event: SessionLearningEvent::from_hook_name(Some(event)),
                },
                || Ok(paths.clone()),
            )
            .unwrap();
            assert_eq!(output.context, "");
            assert!(
                output.workspace.is_none(),
                "unadmitted/no-op tool events cannot request recovery probes"
            );
            assert_eq!(probe.0.load(Ordering::Relaxed), probes, "{phase:?} {event}");
            assert_eq!(fs::read(&paths.database).unwrap(), before);
        }
    }
}

/// Initial learning is one binding/preferences CAS, not a replacement path.
/// Even saved channel and preferred-driver choices survive learning a session.
#[test]
fn initial_session_adoption_preserves_preferences_and_loses_to_concurrent_changes() {
    use tmt_core::binding::session::{
        BindingSessionState, ObservedSessionKey, RuntimeState, SessionTransition,
    };
    for case in [
        "unchanged",
        "preferences",
        "binding",
        "observed",
        "ended",
        "remembered",
        "retained",
    ] {
        let directory = Directory::new();
        let database = directory.0.join("state.db");
        let mut storage = Storage::open(&database).unwrap();
        let identity = create_or_resolve(&mut storage, "Worker", Lifetime::Saved)
            .unwrap()
            .identity;
        let server = ServerEvidence {
            host: tmt_core::host::HostKind::Tmux,
            server_id: "123e4567-e89b-42d3-a456-426614174000".into(),
            socket_path: "/tmp/test.sock".into(),
            server_pid: 10,
            server_start_time: "server".into(),
        };
        let pane = PaneObservation {
            agent_name: None,
            id: "%1".into(),
            target: None,
            cwd: None,
            command: "claude".into(),
            pane_pid: 11,
            pane_incarnation: Some("pane".into()),
            suggested_name: None,
            marker: None,
            location: None,
        };
        let harness = HarnessId::new("claude").unwrap();
        let session = ProviderSessionId::new("s-1").unwrap();
        let mode = RuntimeMode::new("default").unwrap();
        let mut preferences = SessionPreferences {
            channel: Some(false),
            preferred_harness: Some(HarnessId::new("codex").unwrap()),
            remembered: None,
            retained: Vec::new(),
        };
        if case == "retained" {
            let mut previous = SessionPreferences::default();
            previous.remember(
                harness.clone(),
                mode.clone(),
                ProviderSessionId::new("old").unwrap(),
            );
            preferences
                .retained
                .push(tmt_core::binding::session::RetainedSession {
                    session: previous.remembered.unwrap(),
                    channel: Some(true),
                });
        }
        let next = BindingSessionState::default()
            .admit(
                ObservedSessionKey {
                    incarnation: ProcessIncarnation::new(20, "runtime").unwrap(),
                    provider_session: Some(session.clone()),
                },
                SessionTransition::Started,
                RuntimeLiveness::Alive,
            )
            .unwrap();
        storage
            .with_binding_transaction::<_, StorageError>(|records| {
                let binding = records.insert_binding(&identity, &server, &pane)?;
                if matches!(case, "observed" | "ended") {
                    let mut old = next.clone();
                    if case == "ended" {
                        old.state = RuntimeState::Ended;
                        old.last_transition = Some(SessionTransition::Ended);
                    }
                    records.set_session_state(&binding.id, &binding.session, &old)?;
                }
                if case == "remembered" {
                    preferences.remember(
                        harness.clone(),
                        mode.clone(),
                        ProviderSessionId::new("old").unwrap(),
                    );
                }
                records.set_session_preferences(&identity.id, &preferences)
            })
            .unwrap();
        storage.close().unwrap();
        let stored = Storage::context_by_identity(&database, &identity.id, 0)
            .unwrap()
            .unwrap();
        let mut proposed_preferences = stored.preferences.clone();
        proposed_preferences.remember(harness, mode, session);
        let mut storage = Storage::open(&database).unwrap();
        storage
            .with_binding_transaction::<_, StorageError>(|records| {
                match case {
                    "preferences" => {
                        let mut changed = preferences.clone();
                        changed.channel = Some(true);
                        records.set_session_preferences(&identity.id, &changed)?;
                    }
                    "binding" => {
                        records.detach_binding(&stored.entry.binding.as_ref().unwrap().id)?;
                        records.insert_binding(&identity, &server, &pane)?;
                    }
                    _ => (),
                }
                Ok(())
            })
            .unwrap();
        storage.close().unwrap();
        let before = Storage::context_by_identity(&database, &identity.id, 0)
            .unwrap()
            .unwrap();
        let mut storage = Storage::open(&database).unwrap();
        let changed =
            commit_initial_session(&mut storage, &stored, &next, &proposed_preferences).unwrap();
        storage.close().unwrap();
        let after = Storage::context_by_identity(&database, &identity.id, 0)
            .unwrap()
            .unwrap();
        assert_eq!(changed, case == "unchanged", "{case}");
        if changed {
            assert_eq!(after.entry.binding.unwrap().session, next);
            assert_eq!(after.preferences, proposed_preferences);
            assert_eq!(after.preferences.channel, Some(false));
            assert_eq!(
                after.preferences.preferred_harness.unwrap().as_str(),
                "codex"
            );
        } else {
            assert_eq!(after.entry, before.entry, "{case}");
            assert_eq!(after.preferences, before.preferences, "{case}");
        }
    }
}

#[test]
fn detaching_during_prompt_context_callback_refuses_context_and_emits_notice() {
    let registry = RuntimeRegistry::first_party();
    let harness = HarnessId::new("claude").unwrap();
    let lifecycle = registry.lifecycle(&harness).unwrap();
    let session = ProviderSessionId::new("11111111-1111-4111-8111-111111111111").unwrap();
    let process = ProcessIncarnation::new(20, "runtime").unwrap();
    let host = HostEvidence::Independent { runtime_pid: None };

    for detach_in_callback in [false, true] {
        let directory = Directory::new();
        let paths = ConfigPaths {
            global_dir: directory.0.clone(),
            global_config: directory.0.join("config.json"),
            local_config: directory.0.join("local.json"),
            database: directory.0.join("state.db"),
        };
        let mut storage = Storage::open(&paths.database).unwrap();
        let identity = create_or_resolve(&mut storage, "Prompt Reader", Lifetime::Saved)
            .unwrap()
            .identity;
        let server = ServerEvidence {
            host: tmt_core::host::HostKind::Tmux,
            server_id: "123e4567-e89b-42d3-a456-426614174000".into(),
            socket_path: "/tmp/test.sock".into(),
            server_pid: 10,
            server_start_time: "server".into(),
        };
        let mut pane = PaneObservation {
            agent_name: None,
            id: "%1".into(),
            target: None,
            cwd: None,
            command: "claude".into(),
            pane_pid: 11,
            pane_incarnation: Some("pane".into()),
            suggested_name: None,
            marker: None,
            location: None,
        };
        let mode = RuntimeMode::new("embedded").unwrap();
        let mut preferences = SessionPreferences::default();
        preferences.remember(harness.clone(), mode, session.clone());
        let binding = storage
            .with_binding_transaction::<_, StorageError>(|records| {
                let binding = records.insert_binding(&identity, &server, &pane)?;
                let mut state = binding.session.clone();
                state.state = tmt_core::binding::session::RuntimeState::Running;
                state.key = Some(tmt_core::binding::session::ObservedSessionKey {
                    incarnation: process.clone(),
                    provider_session: Some(session.clone()),
                });
                assert!(records.set_session_state(&binding.id, &binding.session, &state)?);
                records.set_session_preferences(&identity.id, &preferences)?;
                Ok(binding)
            })
            .unwrap();
        storage.close().unwrap();

        let stored = Storage::context_by_identity(&paths.database, &identity.id, 0)
            .unwrap()
            .unwrap();
        pane.marker = Some(binding.marker(&stored.entry.identity));
        let snapshot = EndpointSnapshot {
            server,
            panes: vec![pane],
        };
        let binding_id = binding.id;
        let payload = br#"{"hook_event_name":"UserPromptSubmit","session_id":"11111111-1111-4111-8111-111111111111","prompt":"hi"}"#;
        let result = observe_bound_main_event_with(
            "claude",
            &harness,
            lifecycle,
            &session,
            None,
            MainEvent::Prompt(payload),
            BoundCaller {
                host,
                paths: paths.clone(),
                stored,
                snapshot,
                process: process.clone(),
            },
            Run {
                deadline: Instant::now() + Duration::from_secs(2),
                learning: None,
                event: SessionLearningEvent::UserPromptSubmit,
            },
            |_stored, cb_paths, _| {
                if detach_in_callback {
                    let mut storage = Storage::open(&cb_paths.database).unwrap();
                    storage
                        .with_binding_transaction::<_, StorageError>(|records| {
                            records.detach_binding(&binding_id)
                        })
                        .unwrap();
                    storage.close().unwrap();
                }
                "Extension ctxfix context.\n".into()
            },
        );

        if detach_in_callback {
            assert!(result.is_err());
            let mut err = Vec::new();
            write_unavailable_context_error(&mut err, false, false, false);
            assert_eq!(String::from_utf8(err).unwrap(), format!("{ERROR_LINE}\n"));
            assert!(
                Storage::context_by_identity(&paths.database, &identity.id, 0)
                    .unwrap()
                    .unwrap()
                    .entry
                    .binding
                    .is_none()
            );
        } else {
            let observation = result.unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&observation.context).unwrap();
            assert_eq!(
                parsed,
                serde_json::json!({
                    "hookSpecificOutput": {
                        "hookEventName": "UserPromptSubmit",
                        "additionalContext": "Extension ctxfix context.\n",
                    }
                })
            );
        }
    }
}

#[test]
fn owner_liveness_reuses_learning_owner_only_on_exact_pid_and_start_match() {
    use tmt_adapters::process::{
        CommandError, CommandOutput, CommandRequest, CommandRunner, runtime::ProcessObservation,
    };

    struct PanicOrLiveRunner {
        probes: AtomicU64,
        allow_probe: bool,
        pid: u64,
        start: &'static str,
    }
    impl CommandRunner for PanicOrLiveRunner {
        fn execute(&self, _: CommandRequest<'_>) -> Result<CommandOutput, CommandError> {
            panic!("unexpected command execution");
        }
        fn process_observation(&self, pid: u64, _: Instant) -> Option<ProcessObservation> {
            assert!(self.allow_probe, "matching verified owner must not probe");
            self.probes.fetch_add(1, Ordering::Relaxed);
            Some(if pid == self.pid {
                ProcessObservation::Live(ProcessIncarnation::new(self.pid, self.start).unwrap())
            } else {
                ProcessObservation::Gone
            })
        }
    }

    let owner = ProcessIncarnation::new(42, "start-a").unwrap();
    let learning = Learning::with_verified_owner_for_test("claude", &owner);
    let no_probe = PanicOrLiveRunner {
        probes: AtomicU64::new(0),
        allow_probe: false,
        pid: 42,
        start: "start-a",
    };
    let deadline = Instant::now() + Duration::from_secs(5);

    // Exact match reuses Learning's cached owner without probing.
    assert_eq!(
        owner_liveness_with(&no_probe, Some(&learning), &owner, deadline),
        RuntimeLiveness::Alive
    );
    assert_eq!(no_probe.probes.load(Ordering::Relaxed), 0);

    // Pid or start incarnation mismatch (or missing Learning) falls back to probing.
    for (candidate, expected) in [
        (
            ProcessIncarnation::new(42, "start-b").unwrap(),
            RuntimeLiveness::Gone,
        ),
        (
            ProcessIncarnation::new(99, "start-a").unwrap(),
            RuntimeLiveness::Gone,
        ),
    ] {
        let probing = PanicOrLiveRunner {
            probes: AtomicU64::new(0),
            allow_probe: true,
            pid: 42,
            start: "start-a",
        };
        assert_eq!(
            owner_liveness_with(&probing, Some(&learning), &candidate, deadline),
            expected
        );
        assert_eq!(probing.probes.load(Ordering::Relaxed), 1);
    }

    let absent = PanicOrLiveRunner {
        probes: AtomicU64::new(0),
        allow_probe: true,
        pid: 42,
        start: "start-a",
    };
    assert_eq!(
        owner_liveness_with(&absent, None, &owner, deadline),
        RuntimeLiveness::Alive
    );
    assert_eq!(absent.probes.load(Ordering::Relaxed), 1);
}
