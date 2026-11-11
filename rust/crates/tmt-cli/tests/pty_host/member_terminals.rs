//! A member's extra terminals (#5991) through the public API, as the Ops board calls it: each
//! is a login shell the member owns, found again by any later process, never a Talk target, and
//! gone once the member is closed, removed or its supervisor ends.
use super::terminal_stream::View;
use super::*;
use std::io::Write;
use tmt_adapters::pty::protocol::{ClientMessage, ServerMessage};

fn call(world: &World, operation: &str, input: Value) -> Value {
    let mut child = world
        .command(&["api"])
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    let request = serde_json::json!({"version": 1, "operation": operation, "input": input});
    child
        .stdin
        .take()
        .unwrap()
        .write_all(request.to_string().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    serde_json::from_slice(&output.stdout).unwrap_or_else(|_| panic!("{output:?}"))
}

/// Starts a saved member whose program waits for input, and returns its identity UUID.
fn member(world: &mut World, name: &str) -> String {
    let started = world.run(&[
        "run",
        "--no-channel",
        "--save",
        name,
        "sh",
        "-c",
        "while IFS= read -r line; do :; done",
    ]);
    assert!(started.status.success(), "{started:?}");
    let listed = world.json(&["ls", "--json"]);
    listed["identities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == name)
        .expect("the member is listed")["id"]
        .as_str()
        .unwrap()
        .to_owned()
}

/// Ends a member's plain program by EOF in its own terminal, which `tmt rm` requires; the
/// supervisor keeps the terminal and the binding.
fn end_program(world: &mut World, name: &str) {
    let listed = world.json(&["ls", "--json"]);
    let pane = listed["identities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == name)
        .unwrap()["pane"]
        .as_str()
        .unwrap()
        .to_owned();
    Connection::connect(&support::state_dir(&world.root).join("pty"), &pane)
        .unwrap()
        .input(b"\x04")
        .unwrap();
    wait_program_ended(world, name);
}

fn no_terminal_socket(world: &World) -> bool {
    fs::read_dir(support::state_dir(&world.root).join("pty"))
        .unwrap()
        .flatten()
        .all(|file| !file.file_name().to_string_lossy().starts_with("term_"))
}

fn open(world: &mut World, identity: &str) -> Value {
    let opened = call(
        world,
        "terminal.open",
        serde_json::json!({"identityId": identity}),
    );
    // The terminal's supervisor and shell are owned by this world from here on.
    world.remember();
    opened
}

fn listed(world: &World, identity: &str) -> Vec<String> {
    let listed = call(
        world,
        "terminal.list",
        serde_json::json!({"identityId": identity}),
    );
    assert_eq!(listed["identityId"], identity, "{listed}");
    listed["terminals"]
        .as_array()
        .unwrap_or_else(|| panic!("{listed}"))
        .iter()
        .map(|terminal| terminal["terminalId"].as_str().unwrap().to_owned())
        .collect()
}

fn close(world: &World, terminal: &str, force: bool) -> Value {
    call(
        world,
        "terminal.close",
        serde_json::json!({"terminalId": terminal, "force": force}),
    )
}

#[test]
fn a_member_opens_lists_types_into_and_closes_its_own_terminals() {
    let mut world = World::new();
    let identity = member(&mut world, "owner");
    let other = member(&mut world, "other");
    let rows_before = world.json(&["ls", "--json"])["identities"]
        .as_array()
        .unwrap()
        .len();

    let opened = open(&mut world, &identity);
    assert_eq!(opened["identityId"], identity.as_str(), "{opened}");
    let terminal = opened["terminalId"].as_str().unwrap().to_owned();
    assert!(terminal.starts_with("term_"), "{opened}");
    assert_eq!(opened["pane"], terminal.as_str());
    let socket = PathBuf::from(opened["socket"].as_str().unwrap());
    assert!(socket.is_absolute() && socket.exists(), "{opened}");
    assert!(
        opened["directory"]
            .as_str()
            .is_some_and(|d| d.starts_with('/')),
        "{opened}"
    );

    // Each call is a new process, as after an Ops board restart: the terminal is found again,
    // only under its own member.
    assert_eq!(listed(&world, &identity), std::slice::from_ref(&terminal));
    assert!(listed(&world, &other).is_empty());
    // The world has no `SHELL`, so the terminal runs `/bin/sh`; at its prompt no
    // program is named (#6112).
    let idle = call(
        &world,
        "terminal.list",
        serde_json::json!({"identityId": identity}),
    );
    assert_eq!(idle["terminals"][0]["shell"], "sh", "{idle}");
    assert!(idle["terminals"][0].get("program").is_none(), "{idle}");

    // The stream is the member stream protocol; a shell inside is not the member.
    let mut view = View::open(&socket);
    let whoami = world.root.join("whoami.json");
    let typed = format!(
        "'{}' whoami --json > '{}' 2>&1; printf 'WHO-%s\\n' DONE\r",
        env!("CARGO_BIN_EXE_tmt"),
        whoami.display()
    );
    view.send(&ClientMessage::Input(typed.into_bytes()));
    // The echoed command line spells `WHO-%s`; only the printed answer says `WHO-DONE`.
    view.output_until("WHO-DONE");
    let who = fs::read_to_string(&whoami).unwrap();
    assert!(
        !who.contains("\"owner\""),
        "the terminal is not the member: {who}"
    );

    // Never a pane, binding or Talk target.
    let rows = world.json(&["ls", "--json"]);
    assert_eq!(rows["identities"].as_array().unwrap().len(), rows_before);
    assert!(!rows.to_string().contains(&terminal), "{rows}");
    let talked = world.run(&["talk", &terminal, "hello", "--detach", "--json"]);
    assert!(!talked.status.success(), "{talked:?}");
    assert!(
        String::from_utf8_lossy(&talked.stdout).contains("NAME_NOT_FOUND"),
        "{talked:?}"
    );

    // A running program makes it busy; closing then needs force.
    view.send(&ClientMessage::Input(b"/bin/sleep 60\r".to_vec()));
    let deadline = Instant::now() + WAIT;
    loop {
        let terminals = call(
            &world,
            "terminal.list",
            serde_json::json!({"identityId": identity}),
        );
        // The job holds the terminal from the shell's fork until `sleep` is exec'd, so
        // its name is awaited too.
        if terminals["terminals"][0]["busy"] == true
            && terminals["terminals"][0]["program"] == "sleep"
        {
            assert_eq!(terminals["terminals"][0]["shell"], "sh", "{terminals}");
            break;
        }
        assert!(Instant::now() < deadline, "never busy: {terminals}");
        std::thread::sleep(Duration::from_millis(50));
    }
    let refused = close(&world, &terminal, false);
    assert_eq!(refused["error"]["code"], "TERMINAL_BUSY", "{refused}");
    assert!(socket.exists(), "a refused close leaves it running");
    let closed = close(&world, &terminal, true);
    assert_eq!(
        closed,
        serde_json::json!({"terminalId": terminal, "closed": true})
    );
    assert!(!socket.exists());
    loop {
        match view.next() {
            ServerMessage::Exited(_) => break,
            ServerMessage::Output(_) | ServerMessage::Resized(_) => {}
            other => panic!("expected the hang-up: {other:?}"),
        }
    }
    let again = close(&world, &terminal, true);
    assert_eq!(again["error"]["code"], "TERMINAL_NOT_FOUND", "{again}");
    assert!(listed(&world, &identity).is_empty());

    // At most eight per member.
    for _ in 0..8 {
        let opened = open(&mut world, &identity);
        assert!(opened["terminalId"].is_string(), "{opened}");
    }
    let ninth = open(&mut world, &identity);
    assert_eq!(ninth["error"]["code"], "TERMINAL_LIMIT", "{ninth}");
    assert_eq!(listed(&world, &identity).len(), 8);

    // Removing the member through the API closes all of them, all at once.
    end_program(&mut world, "owner");
    let removed = call(
        &world,
        "identity.remove",
        serde_json::json!({"identityId": identity, "expectedName": "owner"}),
    );
    assert_eq!(removed["outcome"], "removed", "{removed}");
    assert!(removed.get("terminalsLeft").is_none(), "{removed}");
    assert!(no_terminal_socket(&world), "no terminal socket is left");
    assert!(world.clean());
}

#[test]
fn removing_a_member_or_losing_its_supervisor_ends_its_terminals() {
    let mut world = World::new();
    let removed = member(&mut world, "removed");
    let lost = member(&mut world, "lost");
    let gone = open(&mut world, &removed);
    let orphan = open(&mut world, &lost);
    let gone = PathBuf::from(gone["socket"].as_str().unwrap());
    let orphan = PathBuf::from(orphan["socket"].as_str().unwrap());

    end_program(&mut world, "removed");
    let result = world.run(&["rm", "removed", "--force", "--json"]);
    assert!(result.status.success(), "{result:?}");
    let document: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert!(document.get("terminalsLeft").is_none(), "{document}");
    assert!(!gone.exists(), "rm closed the terminal");

    // A member supervisor that dies takes its terminals with it.
    let listed = world.json(&["ls", "--json"]);
    let pane = listed["identities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == "lost")
        .unwrap()["pane"]
        .as_str()
        .unwrap()
        .to_owned();
    let ControlReply::State { supervisor_pid, .. } =
        Connection::connect(&support::state_dir(&world.root).join("pty"), &pane)
            .unwrap()
            .control(Control::Inspect, WAIT)
            .unwrap()
    else {
        panic!("supervisor evidence")
    };
    kill(Pid::from_raw(supervisor_pid as i32), Signal::SIGKILL).unwrap();
    let deadline = Instant::now() + WAIT;
    while orphan.exists() {
        assert!(
            Instant::now() < deadline,
            "the orphaned terminal kept running"
        );
        std::thread::sleep(Duration::from_millis(50));
    }
    assert!(world.clean());
}

#[test]
fn stopping_a_member_with_close_closes_its_terminals() {
    let mut world = World::new();
    let provider = super::e2e::replying_provider(&mut world);
    let started = world.run(&[
        "run",
        "--no-channel",
        "--save",
        "alpha",
        provider.to_str().unwrap(),
    ]);
    assert!(started.status.success(), "{started:?}");
    // A recorded session is what lets `tmt stop` prove the agent.
    let (identity, _, _) = record_provider_session(&world, None, super::e2e::SESSION);
    world.remember();
    for _ in 0..2 {
        let opened = open(&mut world, &identity);
        assert!(opened["terminalId"].is_string(), "{opened}");
    }
    let stopped = world.json(&["stop", "alpha", "--close", "--json"]);
    assert_eq!(stopped["pane"], "closed", "{stopped}");
    assert!(stopped.get("terminalsLeft").is_none(), "{stopped}");
    assert!(
        no_terminal_socket(&world),
        "stop --close closed every terminal"
    );
    assert!(world.clean());
}
