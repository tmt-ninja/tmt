//! Where a member's terminal stream is, and what runs there. Core publishes it
//! (`terminal.stream`); a client never derives a path, and a member with no stream has no frame.
use std::{path::PathBuf, time::Duration};

/// How long the read may take before the tab says it could not ask.
const WITHIN: Duration = Duration::from_secs(3);
/// Core waits up to 60 s for a relaunched agent to admit its launch.
const RELAUNCH_WITHIN: Duration = Duration::from_secs(70);
/// Core's refusal for a member that is not on the built-in host, has no binding, or has ended.
const UNAVAILABLE: &str = "TERMINAL_STREAM_UNAVAILABLE";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Address {
    pub socket: PathBuf,
    pub pane: String,
}

/// What core said runs on the member's kept terminal (#5994, #5988).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(in crate::board) struct MemberTerm {
    /// Stopped by job control; `terminal.resume` continues it.
    pub paused: bool,
    /// The agent ended, as core words it (`exit 0`, `signal 2`); `terminal.relaunch` starts it.
    pub ended: Option<String>,
    /// A relaunched login shell, not the agent, runs there.
    pub shell: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum Located {
    Stream(Address, MemberTerm),
    /// Not a built-in-host member, or one whose supervisor is gone: no frame.
    NoStream,
    /// Core could not answer; the words it gave, to be tried again.
    Failed(String),
}

/// One `terminal.stream` read of `identity`.
pub(in crate::board) fn locate(core: &crate::core::Core, identity: &str) -> Located {
    if !crate::board::recent_responses::canonical_identity(identity) {
        return Located::NoStream;
    }
    match core.api_within(
        "terminal.stream",
        serde_json::json!({"identityId": identity}),
        WITHIN,
    ) {
        Ok(value) => from_value(identity, &value),
        Err(error) if error.code == UNAVAILABLE => Located::NoStream,
        Err(error) => Located::Failed(crate::board::notes::single_line(&error.message)),
    }
}

/// One frame action through core; the words say what happened, or why not.
pub(in crate::board) fn act(
    core: &crate::core::Core,
    identity: &str,
    op: &crate::board::app::TerminalOp,
) -> Result<String, String> {
    use crate::board::app::TerminalOp;
    use tmt_pty_protocol::RelaunchKind;
    let failed = |error: crate::core::SquadError| crate::board::notes::single_line(&error.message);
    match op {
        TerminalOp::Resume => core
            .api_within(
                "terminal.resume",
                serde_json::json!({"identityId": identity}),
                WITHIN,
            )
            .map(|_| "Resumed.".to_owned())
            .map_err(failed),
        TerminalOp::Relaunch(kind) => {
            let kind = match kind {
                RelaunchKind::Resume => "resume",
                RelaunchKind::New => "new",
                RelaunchKind::Shell => "shell",
            };
            core.api_within(
                "terminal.relaunch",
                serde_json::json!({"identityId": identity, "kind": kind}),
                RELAUNCH_WITHIN,
            )
            .map(|_| match kind {
                "shell" => "A shell runs on the member's terminal.".to_owned(),
                "new" => "Started a new session.".to_owned(),
                _ => "Resumed the last session.".to_owned(),
            })
            .map_err(failed)
        }
        TerminalOp::Colab => {
            let opened = core
                .json_within(&["colab", "open", "--json"], WITHIN)
                .map_err(failed)?;
            let link = opened["link"]
                .as_str()
                .or_else(|| opened["shortLink"].as_str())
                .ok_or_else(|| "Colab gave no link; is `tmt colab serve` running?".to_owned())?;
            crate::effects::open(link, None).map(|()| format!("Opened {link}"))
        }
    }
}

/// The answer, checked: it must name this identity, the built-in host and an absolute socket.
fn from_value(identity: &str, value: &serde_json::Value) -> Located {
    let address = (|| {
        if value["identityId"].as_str()? != identity || value["host"].as_str()? != "pty" {
            return None;
        }
        let socket = PathBuf::from(value["socket"].as_str()?);
        let pane = value["pane"].as_str()?.to_owned();
        (socket.is_absolute() && !pane.is_empty()).then_some(Address { socket, pane })
    })();
    let ended = match &value["ended"] {
        serde_json::Value::Object(end) => end
            .get("code")
            .and_then(serde_json::Value::as_i64)
            .map(|code| format!("exit {code}"))
            .or_else(|| {
                end.get("signal")
                    .and_then(serde_json::Value::as_i64)
                    .map(|signal| format!("signal {signal}"))
            }),
        _ => None,
    };
    let term = MemberTerm {
        paused: value["paused"] == true,
        ended,
        shell: value["foreground"] == "shell",
    };
    address.map_or_else(
        || Located::Failed("the answer was not a terminal stream".into()),
        |address| Located::Stream(address, term),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ID: &str = "11111111-1111-4111-8111-111111111111";

    #[test]
    fn an_answer_for_this_member_on_the_built_in_host_is_its_address() {
        let answer =
            json!({"identityId": ID, "host": "pty", "socket": "/data/pty/p1.sock", "pane": "p1"});
        let address = Address {
            socket: "/data/pty/p1.sock".into(),
            pane: "p1".into(),
        };
        assert_eq!(
            from_value(ID, &answer),
            Located::Stream(address.clone(), MemberTerm::default())
        );
        let paused = json!({"identityId": ID, "host": "pty", "socket": "/data/pty/p1.sock", "pane": "p1", "paused": true});
        let ended = json!({"identityId": ID, "host": "pty", "socket": "/data/pty/p1.sock", "pane": "p1", "paused": false, "ended": {"signal": 2}});
        let shell = json!({"identityId": ID, "host": "pty", "socket": "/data/pty/p1.sock", "pane": "p1", "foreground": "shell"});
        for (answer, term) in [
            (
                paused,
                MemberTerm {
                    paused: true,
                    ended: None,
                    shell: false,
                },
            ),
            (
                ended,
                MemberTerm {
                    paused: false,
                    ended: Some("signal 2".into()),
                    shell: false,
                },
            ),
            (
                shell,
                MemberTerm {
                    paused: false,
                    ended: None,
                    shell: true,
                },
            ),
        ] {
            assert_eq!(
                from_value(ID, &answer),
                Located::Stream(address.clone(), term)
            );
        }
    }

    #[test]
    fn an_answer_that_is_not_for_this_member_or_host_or_path_is_refused() {
        for answer in [
            json!({"identityId": "other", "host": "pty", "socket": "/s", "pane": "p"}),
            json!({"identityId": ID, "host": "tmux", "socket": "/s", "pane": "p"}),
            json!({"identityId": ID, "host": "pty", "socket": "relative/s", "pane": "p"}),
            json!({"identityId": ID, "host": "pty", "socket": "/s", "pane": ""}),
            json!({"identityId": ID, "host": "pty", "socket": "/s"}),
            json!("text"),
        ] {
            assert!(
                matches!(from_value(ID, &answer), Located::Failed(_)),
                "{answer}"
            );
        }
    }
}
