//! Core observations must not own the object/session currency fence while blocked.
use super::*;
use nix::poll::{PollFd, PollFlags, PollTimeout, poll};
use std::{
    io::Read,
    os::{
        fd::AsFd,
        unix::net::{UnixListener, UnixStream},
    },
    sync::mpsc,
    time::Duration,
};
use tmt_remote::{
    mount::{OwnerBinding, Sessions},
    store::Store,
};

// Release on unwind so Core is reaped before the fixture's private root is removed.
struct Resume(UnixStream);
impl Drop for Resume {
    fn drop(&mut self) {
        let _ = self.0.write_all(b"x");
    }
}
fn entered(listener: &UnixListener, operation: &str) -> Resume {
    let mut ready = [PollFd::new(listener.as_fd(), PollFlags::POLLIN)];
    assert!(
        poll(&mut ready, PollTimeout::from(5_000_u16)).unwrap() > 0,
        "Core observation did not reach its barrier: {operation}"
    );
    let (mut stream, _) = listener.accept().unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut marker = [0];
    stream.read_exact(&mut marker).unwrap();
    assert_eq!(&marker, b"r");
    Resume(stream)
}
fn opened(owner: &OwnerDoor) -> (String, OwnerBinding) {
    let payload = json!({"clientNonce":uuid_v4().unwrap().replace('-',"")});
    let wire = owner.wire("new", "0", "session.open", payload.to_string().as_bytes());
    let opened = owner
        .sessions
        .open(owner.request_origin(), &serde_json::to_vec(&wire).unwrap())
        .unwrap();
    let reply: Value = serde_json::from_slice(&opened.response).unwrap();
    owner.verify_reply(&reply, &wire);
    let cookie = opened.cookie.unwrap();
    let admitted = owner.sessions.context(cookie.split(';').next()).unwrap();
    let binding = OwnerBinding {
        session: admitted.session,
        device_id: admitted.context.device_id,
        grant_revision: admitted.context.grant_revision,
    };
    (reply["sessionId"].as_str().unwrap().into(), binding)
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum During {
    Currency,
    Revoke,
    Close,
}
fn overlap(operation: &str, change: During) {
    let owner = OwnerDoor::owner_browser("direct");
    let core = Core::new();
    fs::write(
        core.root.join("agents"),
        json!({"identities":[]}).to_string(),
    )
    .unwrap();
    let operations = core.operations();
    let (session, binding) = opened(&owner);
    assert!(owner.sessions.current(&binding));
    let id = uuid_v4().unwrap();
    let request = format!("req_{id}");
    let payload = match operation {
        "agents.list" => json!({}),
        "identities.status" => {
            json!({"version":1,"operation":operation,"input":{"identityIds":[id]}})
        }
        "check" => json!({"agentId":id,"lines":1}),
        "requests.show" => json!({"version":1,"operation":operation,"input":{"requestId":request}}),
        "result" => json!({"requestId":request}),
        "orchestration.read" => {
            json!({"version":1,"operation":operation,"input":{"view":"routes","limit":256}})
        }
        _ => unreachable!(),
    };
    let wire = owner.wire(&session, "1", operation, payload.to_string().as_bytes());
    // An independent connection detects a retained SQLite observation transaction.
    let mut revoker = Store::open(&owner._serving).unwrap();
    let listener = UnixListener::bind(core.root.join("observation.sock")).unwrap();
    std::thread::scope(|scope| {
        let reading = scope.spawn(|| append(&owner, operations, &wire));
        let resume = entered(&listener, operation);
        if change == During::Currency {
            // ObjectService::standing uses this currency query for the same owner binding.
            let current = owner.sessions.current(&binding);
            drop(resume);
            let reply = reading.join().unwrap();
            assert!(
                current,
                "owner session must stay current while Core observation is held: {operation}"
            );
            assert!(reply.get("error").is_none(), "{operation}: {reply}");
        } else {
            let (done, completed) = mpsc::channel();
            let sessions = Arc::clone(&owner.sessions);
            let client = owner.grant.client_id.clone();
            let changing = scope.spawn(move || {
                let result = if change == During::Revoke {
                    revoker.revoke(&client).map(|grant| grant.unwrap().disabled)
                } else {
                    sessions.end_device(&client);
                    Ok(true)
                };
                done.send(result).unwrap();
            });
            let changed = completed.recv_timeout(Duration::from_secs(1));
            drop(resume);
            let reply = reading.join().unwrap();
            changing.join().unwrap();
            assert!(
                changed
                    .expect("authority change must complete before Core is released")
                    .unwrap()
            );
            assert_eq!(
                reply["error"]["code"], "REMOTE_CLOSED",
                "{operation}: {reply}"
            );
            assert!(
                reply.get("identities").is_none(),
                "Core payload must not escape after authority loss"
            );
            assert!(!owner.sessions.current(&binding));
        }
    });
    assert_eq!(
        core.calls().len(),
        1,
        "one Core observation only: {operation}"
    );
}
const READS: [&str; 6] = [
    "agents.list",
    "identities.status",
    "check",
    "requests.show",
    "result",
    "orchestration.read",
];
#[test]
fn object_currency_succeeds_while_core_observations_are_held() {
    for operation in READS {
        overlap(operation, During::Currency);
    }
}
#[test]
fn grant_revoked_during_core_observation_refuses_its_result() {
    for operation in READS {
        overlap(operation, During::Revoke);
    }
}
#[test]
fn session_closed_during_core_observation_refuses_its_result() {
    for operation in READS {
        overlap(operation, During::Close);
    }
}
