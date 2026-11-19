use super::*;
use crate::{action::Action, config::OpsKeyScope};
use serde_json::json;

struct Fixture {
    root: std::path::PathBuf,
    core: Core,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("ops-host-opening-{}", crate::id::new_v4().unwrap()));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("caller"), r#"{"bound":false,"pane":"%9"}"#).unwrap();
        let executable = root.join("core");
        crate::test_support::write_ready_executable(
            &executable,
            r#"#!/bin/sh
root=${0%/*}
printf '%s\n' "$*" >> "$root/calls"
case "$1:$2" in
  config:show) printf '{"paths":{"global":"%s/config.json"},"resolved":{}}\n' "$root" ;;
  api:--session) IFS= read -r request; printf '%s\n' "$request" > "$root/api-input"; printf '%s\n' '{"identityId":"member","cwd":"/work","stdout":"","stderr":"","exitCode":0,"signal":null,"timedOut":false,"truncated":false}'; cat >/dev/null ;;
  api:*) cat > "$root/api-input"; if grep -q '"operation":"shell.run"' "$root/api-input"; then printf '%s\n' '{"identityId":"member","cwd":"/work","stdout":"","stderr":"","exitCode":0,"signal":null,"timedOut":false,"truncated":false}'; else printf '{"dataRoot":"%s/data"}\n' "$root"; fi ;;
  whoami:*) cat "$root/caller" ;;
  *) printf '%s\n' '{"error":{"code":"UNEXPECTED","message":"Unexpected fake-Core call."}}'; exit 1 ;;
esac
"#,
        );
        Self {
            root,
            core: Core::at(executable),
        }
    }
    fn whoami_count(&self) -> usize {
        std::fs::read_to_string(self.root.join("calls"))
            .unwrap()
            .lines()
            .filter(|call| call.starts_with("whoami "))
            .count()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

fn selection() -> super::super::settings::host_action::Selection {
    super::super::settings::host_action::Selection {
        row: Some(json!({"id":"identity", "name":"alpha", "fields":{"board_pane":"%99"}})),
        recipient: Some(json!({"id":"identity", "name":"alpha", "fields":{"board_pane":"%99"}})),
        factory_bindings: crate::config::workspace_defaults(OpsKeyScope::Member),
        squad: None,
        scope: OpsKeyScope::Member,
        invoker_tmux: true,
        ops: json!({}),
    }
}

#[test]
fn finish_does_not_join_an_in_flight_shell_worker() {
    use std::sync::mpsc::channel;
    use std::time::Duration;
    let fixture = Fixture::new();
    let (started, ready) = channel();
    let (release, held) = channel::<()>();
    let (finished, observed) = channel();
    let worker = std::thread::spawn(move || {
        started.send(()).unwrap();
        let _ = held.recv();
        finished.send(()).unwrap();
    });
    ready.recv_timeout(Duration::from_secs(2)).unwrap();
    let (events, _received) = channel();
    let lane = Lane {
        jobs: None,
        thread: None,
        shell_core: fixture.core.clone(),
        shell_events: events,
        shell_threads: std::cell::RefCell::new(vec![worker]),
        shell_stop: Default::default(),
    };
    let (returned, done) = channel();
    let closer = std::thread::spawn(move || {
        lane.finish();
        returned.send(()).unwrap();
    });
    let outcome = done.recv_timeout(Duration::from_secs(2));
    release.send(()).unwrap();
    observed.recv_timeout(Duration::from_secs(2)).unwrap();
    closer.join().unwrap();
    outcome.expect("quit must not wait for an in-flight shell worker");
}

#[test]
fn shell_uses_one_dedicated_api_invocation_without_replay() {
    let fixture = Fixture::new();
    let (events, received) = std::sync::mpsc::channel();
    let core = fixture.core.clone().with_api_session().unwrap();
    let lane = Lane::spawn(core, None, events);
    let key = ("sender".to_owned(), "member".to_owned());
    lane.submit(Job::Shell {
        key: key.clone(),
        command: "pwd".into(),
    });
    assert!(
        matches!(received.recv_timeout(std::time::Duration::from_secs(5)).unwrap(), BoardEvent::ShellDone { key: actual, result: Ok(_) } if actual == key)
    );
    lane.finish();
    let calls = std::fs::read_to_string(fixture.root.join("calls")).unwrap();
    assert_eq!(
        calls
            .lines()
            .filter(|line| *line == "api --session")
            .count(),
        1,
        "{calls}"
    );
    let input: serde_json::Value =
        serde_json::from_slice(&std::fs::read(fixture.root.join("api-input")).unwrap()).unwrap();
    assert_eq!(input["operation"], "shell.run");
    assert_eq!(input["input"]["command"], "pwd");
}

#[test]
fn only_host_action_opening_reads_public_caller_context_and_keeps_null_unavailable() {
    let f = Fixture::new();
    for opening in [Opening::Settings, Opening::ThemePicker(None)] {
        match run(&f.core, None, Job::Open(opening)) {
            BoardEvent::Opened {
                config, board_pane, ..
            } => {
                assert!(config.is_ok());
                assert!(board_pane.is_none());
            }
            _ => panic!("expected config opening"),
        }
    }
    assert_eq!(f.whoami_count(), 0);
    match run(
        &f.core,
        None,
        Job::Open(Opening::HostAction(Box::new(selection()))),
    ) {
        BoardEvent::Opened {
            config,
            board_pane,
            opening: Opening::HostAction(held),
        } => {
            assert!(config.is_ok());
            assert_eq!(board_pane.as_deref(), Some("%9"));
            assert_eq!(*held, selection());
        }
        _ => panic!("expected host action opening"),
    }
    assert_eq!(f.whoami_count(), 1);
    std::fs::write(f.root.join("caller"), r#"{"bound":false}"#).unwrap();
    match run(
        &f.core,
        None,
        Job::Open(Opening::HostAction(Box::new(selection()))),
    ) {
        BoardEvent::Opened {
            config, board_pane, ..
        } => {
            assert!(config.is_ok());
            assert!(board_pane.is_none());
        }
        _ => panic!("expected host action opening"),
    }
    assert_eq!(f.whoami_count(), 2);
}

#[test]
fn prepared_run_refuses_missing_context_without_starting_the_program() {
    let f = Fixture::new();
    std::fs::write(f.root.join("caller"), r#"{"bound":false}"#).unwrap();
    let marker = f.root.join("unexpected");
    let action = Action::parse(&format!("run touch {} {{board_pane}}", marker.display())).unwrap();
    let request = Request::PreparedRun {
        action,
        row: json!({"id":"identity", "fields":{"board_pane":"%99"}}),
        ops: json!({}),
    };
    match run(&f.core, None, Job::Act(request)) {
        BoardEvent::Acted {
            outcome: Err(error),
            jump: false,
            sends: false,
        } => assert!(error.contains("board_pane is empty")),
        _ => panic!("unavailable context must refuse"),
    }
    assert_eq!(f.whoami_count(), 1);
    assert!(!marker.exists());
}

#[test]
fn checklist_reads_use_the_worker_while_mutations_and_jumps_use_the_action_lane() {
    use crate::board::{
        app::workspace::tests::{MEMBER, ROOM},
        conversation_checklist::{Key, State, Subject, Write},
    };
    use std::time::Instant;

    let room = Key::room(ROOM);
    let member = Key {
        room: ROOM.into(),
        subject: Subject::Conversation(MEMBER.into()),
    };
    let now = Instant::now();
    for key in [&room, &member] {
        let task = State::reading().offer(Some(key), now).unwrap();
        route(
            Job::Notes(task.clone()),
            |read| assert_eq!(read, task),
            |job| panic!("checklist read reached the action lane: {job:?}"),
        );
    }

    let mut notes = State::reading();
    notes.offer(Some(&member), now).unwrap();
    let mutation = notes
        .write(
            &member,
            Write::Add {
                title: "Review the draft".into(),
                body: None,
                reference: None,
                inventory: None,
            },
        )
        .unwrap();
    route(
        Job::Notes(mutation.clone()),
        |_| panic!("checklist mutation reached the worker"),
        |job| assert!(matches!(job, Job::Notes(task) if task == mutation)),
    );
    route(
        Job::Jump {
            member: MEMBER.into(),
        },
        |_| panic!("jump reached the checklist worker"),
        |job| assert!(matches!(job, Job::Jump { member } if member == MEMBER)),
    );
}
