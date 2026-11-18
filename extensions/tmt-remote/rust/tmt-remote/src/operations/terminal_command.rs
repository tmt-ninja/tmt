//! Fixed Core terminal calls. The signed journal claims a command once, before
//! either Core call. An observation never opens a terminal or submits input.
use super::*;
use crate::{members::service, store::TERMINAL_COMMAND_SCOPE};
use rusqlite::Connection;

const RUN: &str = "terminal.command.run";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Targets {
    identity_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Command {
    operation_id: String,
    identity_id: String,
    target: Target,
    command: String,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Target {
    Existing { terminal_id: String },
    New,
}

fn denied() -> RemoteError {
    RemoteError::new(
        "REMOTE_SCOPE_DENIED",
        "Terminal commands require the designated local owner browser.",
    )
}

fn enabled(grant: &Grant) -> bool {
    grant.agents == "all"
        && grant.mode == "direct"
        && grant.permits_scope("talk")
        && grant.permits_scope(TERMINAL_COMMAND_SCOPE)
}

fn require_designated(c: &Connection, grant: &Grant, now: u64) -> Result<(), RemoteError> {
    let current = crate::store::grant_in(c, &grant.client_id)?.ok_or_else(denied)?;
    if enabled(&current)
        && service::scope(c, service::Caller::Browser(grant), now)
            .is_ok_and(|scope| scope.administrator())
    {
        Ok(())
    } else {
        Err(denied())
    }
}

pub(super) fn admit(permit: &MessagePermit) -> Result<(), RemoteError> {
    if !permit.owner_browser() || !enabled(&permit.grant) {
        return Err(denied());
    }
    permit.with_store(|store| require_designated(&store.connection, &permit.grant, now_ms()?))
}

/// Validate the public Core terminal.run input contract before any terminal can open.
fn command_line(command: &str) -> bool {
    !command.trim().is_empty()
        && command.len() <= 4096
        && !command.chars().any(|c| {
            c.is_control() || matches!(c, '\u{00ad}' | '\u{034f}' | '\u{061c}' | '\u{180e}' | '\u{200b}'..='\u{200f}' | '\u{2028}'..='\u{202e}' | '\u{2060}'..='\u{206f}' | '\u{feff}' | '\u{fff9}'..='\u{fffb}')
        })
}

#[derive(Clone, Copy)]
enum Stage<'a> {
    Open,
    Run(&'a str),
}
impl<'a> Stage<'a> {
    fn name(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Run(_) => "run",
        }
    }
    fn terminal(self) -> Option<&'a str> {
        match self {
            Self::Open => None,
            Self::Run(id) => Some(id),
        }
    }
}

#[derive(Debug)]
enum Effect {
    Opened(String),
    Outcome(Value),
}
fn outcome(
    id: &str,
    state: &str,
    stage: &str,
    terminal: Option<&str>,
    code: Option<&str>,
) -> Value {
    let mut value = json!({"operationId":id,"state":state,"stage":stage});
    if let Some(terminal) = terminal {
        value["terminalId"] = json!(terminal);
    }
    if let Some(code) = code {
        value["code"] = json!(code);
    }
    value
}
fn stage_outcome(input: &Command, stage: Stage<'_>, result: Result<Value, RemoteError>) -> Effect {
    let id = &input.operation_id;
    let value = match result {
        Ok(value) if value["identityId"] == input.identity_id => {
            let terminal = value["terminalId"]
                .as_str()
                .filter(|id| canonical::terminal_id(id));
            match (stage, terminal) {
                (Stage::Open, Some(terminal)) => return Effect::Opened(terminal.into()),
                (Stage::Run(expected), Some(terminal))
                    if terminal == expected && value["submitted"] == true =>
                {
                    json!({"operationId":id,"state":"submitted","identityId":input.identity_id,"terminalId":terminal})
                }
                _ => outcome(id, "unconfirmed", stage.name(), stage.terminal(), None),
            }
        }
        Err(error)
            if matches!(
                error.code.as_str(),
                "NAME_NOT_FOUND"
                    | "TERMINAL_STREAM_UNAVAILABLE"
                    | "TERMINAL_LIMIT"
                    | "TERMINAL_OPEN_FAILED"
                    | "API_INPUT_INVALID"
                    | "TERMINAL_STALE"
                    | "TERMINAL_BUSY"
                    | "TERMINAL_ENDED"
                    | "TERMINAL_NOT_FOUND"
                    | "TERMINAL_RUN_UNSUPPORTED"
            ) =>
        {
            outcome(
                id,
                "refused",
                stage.name(),
                stage.terminal(),
                Some(&error.code),
            )
        }
        Err(error) if matches!(stage, Stage::Open) && error.code == "TERMINAL_OPEN_UNCONFIRMED" => {
            let terminal = error
                .message
                .strip_prefix("Terminal ")
                .and_then(|message| message.split_once(' '))
                .map(|(id, _)| id)
                .filter(|id| canonical::terminal_id(id));
            outcome(id, "unconfirmed", "open", terminal, None)
        }
        _ => outcome(id, "unconfirmed", stage.name(), stage.terminal(), None),
    };
    Effect::Outcome(value)
}

impl Operations {
    pub(super) fn terminal_command_targets(
        &self,
        permit: &MessagePermit,
    ) -> Result<Vec<u8>, RemoteError> {
        admit(permit)?;
        let input: Targets = read_input(permit)?;
        if !canonical::is_core_id(&input.identity_id) {
            return Err(invalid());
        }
        let ask = json!({"version":1,"operation":"terminal.list","input":{"identityId":input.identity_id}});
        let response = self.api(ask.to_string().as_bytes());
        admit(permit)?;
        let unavailable = || {
            RemoteError::new(
                "REMOTE_CORE_UNAVAILABLE",
                "Could not verify terminal targets.",
            )
        };
        let response = response.map_err(|_| unavailable())?;
        if response["identityId"] != input.identity_id {
            return Err(unavailable());
        }
        let rows = response["terminals"]
            .as_array()
            .filter(|rows| rows.len() <= 8)
            .ok_or_else(unavailable)?;
        let mut seen = std::collections::HashSet::new();
        let mut targets = Vec::new();
        for (index, row) in rows.iter().enumerate() {
            let id = row["terminalId"]
                .as_str()
                .filter(|id| canonical::terminal_id(id) && seen.insert(*id))
                .ok_or_else(unavailable)?;
            let busy = row["busy"].as_bool().ok_or_else(unavailable)?;
            targets.push(json!({"terminalId":id,"ordinal":index+1,"busy":busy}));
        }
        permit.response(&json!({"identityId":input.identity_id,"terminals":targets}))
    }

    pub(super) fn terminal_command_run(
        &self,
        permit: &MessagePermit,
    ) -> Result<Vec<u8>, RemoteError> {
        admit(permit)?;
        let input: Command = read_input(permit)?;
        let id = &input.operation_id;
        if id != permit.message.envelope().id
            || canonical::uuid(id).is_err()
            || !canonical::is_core_id(&input.identity_id)
            || !command_line(&input.command)
            || matches!(&input.target, Target::Existing { terminal_id: id } if !canonical::terminal_id(id))
        {
            return Err(invalid());
        }
        if !self.retry_safe.load(Ordering::Acquire) {
            return Err(RemoteError::new(
                "REMOTE_CLOSED",
                "Core cleanup is unconfirmed.",
            ));
        }
        let owned = permit.adopt(
            Some(&permit.message.payload),
            std::slice::from_ref(&input.identity_id),
        )?;
        if !owned.newly_adopted {
            return permit.response(&owned.receipt);
        }
        let existing = match &input.target {
            Target::Existing { terminal_id } => terminal_id.clone(),
            Target::New => match self.terminal_effect(permit, id, Stage::Open) {
                Effect::Opened(terminal) => terminal,
                Effect::Outcome(value) => return permit.response(&value),
            },
        };
        match self.terminal_effect(permit, id, Stage::Run(&existing)) {
            Effect::Outcome(value) => permit.response(&value),
            Effect::Opened(_) => unreachable!("only terminal.open can open"),
        }
    }

    fn terminal_effect(&self, permit: &MessagePermit, id: &str, stage: Stage<'_>) -> Effect {
        let mut invoked = false;
        let result = now_ms().and_then(|now| {
            permit.sessions.with_live_store(
                &permit.grant,
                &permit.message,
                now,
                |store, session_live| {
                    store.terminal_effect(&permit.grant, id, stage, session_live, |ask| {
                        if !self.retry_safe.load(Ordering::Acquire) {
                            return Err(RemoteError::new(
                                "REMOTE_CLOSED",
                                "Core cleanup is unconfirmed.",
                            ));
                        }
                        invoked = true;
                        Ok(self.api(ask.to_string().as_bytes()))
                    })
                },
            )
        });
        result.map(|(effect, _)| effect).unwrap_or_else(|error| {
            Effect::Outcome(if invoked {
                outcome(id, "unconfirmed", stage.name(), stage.terminal(), None)
            } else {
                outcome(
                    id,
                    "refused",
                    stage.name(),
                    stage.terminal(),
                    Some(&error.code),
                )
            })
        })
    }
}

impl Store {
    fn terminal_effect(
        &mut self,
        grant: &Grant,
        id: &str,
        stage: Stage<'_>,
        session_live: &dyn Fn() -> bool,
        invoke: impl FnOnce(Value) -> Result<Result<Value, RemoteError>, RemoteError>,
    ) -> Result<Effect, RemoteError> {
        self.owned_effect(grant, id, RUN, now_ms, |tx, now, frozen, digest| {
            if !session_live() {
                return Err(RemoteError::new("REMOTE_SESSION_ENDED", "Device session ended."));
            }
            require_designated(tx, grant, now)?;
            let envelope: ReadEnvelope<Command> = serde_json::from_slice(frozen).map_err(|_| invalid())?;
            let input = envelope.input;
            if envelope.version != 1 || envelope.operation != RUN || input.operation_id != id {
                return Err(invalid());
            }
            let (phase, previous): (String, String) = tx.query_row(
                "SELECT phase,receipt FROM operations WHERE id=?1",
                [id], |row| Ok((row.get(0)?, row.get(1)?)),
            ).map_err(database)?;
            let previous: Value = serde_json::from_str(&previous).map_err(database)?;
            let allowed = match (&input.target, stage) {
                (Target::New, Stage::Open) => phase == "uncertain" && previous["stage"] == "unknown",
                (Target::New, Stage::Run(terminal)) => phase == "dispatching" && previous["terminalId"] == terminal,
                (Target::Existing { terminal_id }, Stage::Run(terminal)) =>
                    phase == "uncertain" && previous["stage"] == "unknown" && terminal_id == terminal,
                _ => false,
            };
            if !allowed {
                return Err(invalid());
            }
            let ask = match stage {
                Stage::Open => json!({"version":1,"operation":"terminal.open","input":{"identityId":input.identity_id}}),
                Stage::Run(terminal) => json!({"version":1,"operation":"terminal.run","input":{"identityId":input.identity_id,"terminalId":terminal,"command":input.command}}),
            };
            let effect = stage_outcome(&input, stage, invoke(ask)?);
            let pending;
            let (phase, decision, receipt) = match &effect {
                Effect::Opened(terminal) => {
                    pending = outcome(id, "unconfirmed", "run", Some(terminal), None);
                    ("dispatching", "accepted", &pending)
                }
                Effect::Outcome(value) if value["state"] == "submitted" => ("accepted", "accepted", value),
                Effect::Outcome(value) if value["state"] == "refused" => ("refused", "refused", value),
                Effect::Outcome(value) => ("uncertain", "uncertain", value),
            };
            let resource = receipt["terminalId"].as_str().unwrap_or(&input.identity_id);
            audit::append(tx, audit::AuditMetadata {
                time: now,
                client: &grant.client_id,
                request: id,
                operation: if matches!(stage, Stage::Open) { "terminal.open" } else { "terminal.run" },
                operation_id: Some(id),
                resources: &[resource.into()],
                digest,
                revision: grant.revision,
                decision,
                code: receipt["code"].as_str().unwrap_or(""),
            })?;
            tx.execute(
                "UPDATE operations SET phase=?2,receipt=?3,updated_ms=?4,frozen=CASE WHEN ?2='dispatching' THEN frozen END WHERE id=?1",
                params![id, phase, receipt.to_string(), now as i64],
            ).map_err(database)?;
            Ok(effect)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{state::Layout, store::uuid_v4, wire::SignedMessage};

    #[test]
    fn confirmed_open_does_not_authorize_run_after_designation_is_removed() {
        struct Root(std::path::PathBuf);
        impl Drop for Root {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let root = Root(format!("/tmp/t6496-{}", uuid_v4().unwrap()).into());
        let layout = Layout::open(&root.0).unwrap();
        let serving = layout.serve_lock().unwrap();
        let mut store = Store::open(&serving).unwrap();
        let grant = Grant {
            client_id: uuid_v4().unwrap(),
            public_key: ed25519_dalek::SigningKey::from_bytes(&[1; 32])
                .verifying_key()
                .to_bytes(),
            kind: "browser".into(),
            origin: "http://127.0.0.1:32100".into(),
            name: "Private fixture".into(),
            agents: "all".into(),
            scopes: vec!["talk".into(), TERMINAL_COMMAND_SCOPE.into()],
            mode: "direct".into(),
            issued_at_ms: now_ms().unwrap(),
            expires_at_ms: None,
            revision: 1,
            disabled: false,
        };
        store.insert_grant(&grant).unwrap();
        store
            .designate(&grant.client_id, &grant.origin, now_ms().unwrap())
            .unwrap();
        let identity = uuid_v4().unwrap();
        let id = uuid_v4().unwrap();
        let terminal = "term_11111111111111111111111111111111";
        let data = json!({"version":1,"operation":RUN,"input":{
            "operationId":id,"identityId":identity,"target":{"kind":"new"},"command":"pwd"
        }})
        .to_string();
        let signed = json!({"version":1,"profile":"local-v1","kind":"request","id":id,
            "correlationId":null,"machineId":store.machine().unwrap().id,"windowId":uuid_v4().unwrap(),
            "clientId":grant.client_id,"sessionId":uuid_v4().unwrap(),"sequence":"1","timestampMs":grant.issued_at_ms,
            "origin":grant.origin,"operation":RUN,"payload":canonical::base64url(data.as_bytes()),
            "signature":canonical::base64url(&[0;64])});
        let message = SignedMessage::decode(signed.to_string().as_bytes(), 65536).unwrap();
        store
            .adopt(
                &grant,
                &message,
                Some(data.as_bytes()),
                std::slice::from_ref(&identity),
                b"{}",
                now_ms().unwrap(),
            )
            .unwrap();
        let opened = store
            .terminal_effect(&grant, &id, Stage::Open, &|| true, |ask| {
                assert_eq!(ask["operation"], "terminal.open");
                Ok(Ok(json!({"identityId":identity,"terminalId":terminal})))
            })
            .unwrap();
        assert!(matches!(opened, Effect::Opened(id) if id == terminal));
        assert_eq!(
            store
                .terminal_effect(&grant, &id, Stage::Run(terminal), &|| false, |_| panic!(
                    "ended session invoked Core"
                ))
                .unwrap_err()
                .code,
            "REMOTE_SESSION_ENDED"
        );
        store.undesignate().unwrap();
        let current = store.grant(&grant.client_id).unwrap().unwrap();
        assert_eq!(current.revision, grant.revision + 1);
        assert!(!current.permits_scope(TERMINAL_COMMAND_SCOPE));
        assert_eq!(
            store
                .terminal_effect(&current, &id, Stage::Run(terminal), &|| true, |_| panic!(
                    "lost designation invoked Core"
                ))
                .unwrap_err()
                .code,
            "REMOTE_SCOPE_DENIED"
        );
        assert_eq!(
            store
                .owned(&current, &id, now_ms().unwrap())
                .unwrap()
                .receipt["terminalId"],
            terminal
        );
    }
}
