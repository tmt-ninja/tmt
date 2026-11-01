//! The public `requests.list` conversation view in an owned world, without tmux (#5807).
#![cfg(unix)]
mod support;
use rusqlite::Connection;
use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    process::{Child, Output, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tmt_adapters::storage::Storage;
use tmt_core::identity::{Lifetime, create_or_resolve};

static NEXT: AtomicU64 = AtomicU64::new(0);
struct Fixture {
    root: PathBuf,
    child: Option<Child>,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "tmt-conversation-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self { root, child: None }
    }
    fn db(&self) -> PathBuf {
        support::state_dir(&self.root).join("tmt.db")
    }
    fn run(&mut self, args: &[&str], input: Option<Value>) -> Output {
        let mut command = support::command(&self.root, args);
        let stdin = match input {
            Some(input) => {
                let path = self.root.join("input.json");
                fs::write(&path, input.to_string()).unwrap();
                Stdio::from(fs::File::open(path).unwrap())
            }
            None => Stdio::null(),
        };
        self.child = Some(
            command
                .stdin(stdin)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap(),
        );
        support::wait(&mut self.child, Duration::from_secs(15))
            .wait_with_output()
            .unwrap()
    }
    fn api(&mut self, operation: &str, input: Value) -> Value {
        let o = self.run(
            &["api"],
            Some(json!({"version":1,"operation":operation,"input":input})),
        );
        serde_json::from_slice(&o.stdout).unwrap()
    }
    fn identities(&self) -> i64 {
        Connection::open(self.db())
            .unwrap()
            .query_row("SELECT count(*) FROM identities", [], |r| r.get(0))
            .unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        support::stop(&mut self.child);
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn the_person_reads_one_member_conversation_and_nothing_is_created() {
    let mut f = Fixture::new();
    assert!(
        f.run(&["config", "set", "user.name", "ben", "--global"], None)
            .status
            .success()
    );
    let mut storage = Storage::open(f.db()).unwrap();
    let member = create_or_resolve(&mut storage, "worker-a", Lifetime::Saved)
        .unwrap()
        .identity
        .id;
    create_or_resolve(&mut storage, "worker-b", Lifetime::Saved).unwrap();
    storage.close().unwrap();
    let list = json!({"view":"conversation","memberId":member});
    // No configured person yet: refused, and no identity appears.
    let before = f.identities();
    let refused = f.api("requests.list", list.clone());
    assert_eq!(refused["error"]["code"], "API_UNAVAILABLE");
    assert_eq!(f.identities(), before);
    let person = f.api("user.identity", json!({}))["identityId"]
        .as_str()
        .unwrap()
        .to_owned();
    for (to, from) in [
        ("worker-a", "ben"),
        ("worker-b", "ben"),
        ("ben", "worker-a"),
    ] {
        let o = f.run(
            &[
                "talk",
                to,
                "hello",
                "--identity",
                from,
                "--detach",
                "--json",
            ],
            None,
        );
        assert!(o.status.success(), "{}", String::from_utf8_lossy(&o.stdout));
    }
    let page = f.api("requests.list", list.clone());
    assert_eq!(page["viewerId"], person.as_str());
    assert_eq!(page["member"], "active");
    let items = page["items"].as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["direction"], "fromMember");
    assert_eq!(items[1]["direction"], "toMember");
    assert!(items.iter().all(|i| i.get("roomId").is_none()));
    let position = page["changePosition"].as_str().unwrap().to_owned();
    let unchanged = f.api(
        "requests.list",
        json!({"view":"conversation","memberId":member,"since":position}),
    );
    assert_eq!(unchanged["changedSince"], json!({"count":0,"more":false}));
    let foreign = f.api(
        "requests.list",
        json!({"view":"conversation","memberId":member,"since":"c1-000000000000-1-1-1"}),
    );
    assert_eq!(foreign["changedSince"], "unknown");
    let invalid = f.api(
        "requests.list",
        json!({"view":"conversation","memberId":member,"since":"not a position"}),
    );
    assert_eq!(invalid["error"]["code"], "API_INPUT_INVALID");
    let unknown = f.api(
        "requests.list",
        json!({"view":"conversation","memberId":"99999999-9999-4999-8999-999999999999"}),
    );
    assert_eq!(unknown["member"], "unknown");
    assert_eq!(unknown["items"], json!([]));
}
