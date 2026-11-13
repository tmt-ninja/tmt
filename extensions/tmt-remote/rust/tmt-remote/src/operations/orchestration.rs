//! `orchestration.read` and `orchestration.write` for the owner's own browser (#4894). The door
//! passes Core's input through unchanged after least-authority checks: it adds no actor, no
//! consent and no preview of its own. Core's answer is the reply; Core's own refusal travels as
//! `{refused:{code,message?}}` so the page can say what Core decided.
use super::{invalid, read_input};
use crate::{admission::MessagePermit, authority::PermittedAgents, error::RemoteError};
use serde_json::{Value, json};

/// Views the page reads. Core refuses an unknown one too; the door names its own surface.
const VIEWS: [&str; 6] = ["overview", "plans", "preview", "why", "talks", "routes"];
/// The writes the browser page offers; `plan.set` is narrowed to on/off below.
const MUTATIONS: [&str; 5] = [
    "focus.set",
    "focus.clear",
    "route.allow",
    "talks.resume",
    "plan.set",
];

/// Only this machine's own-origin owner browser, holding every agent: orchestration describes and
/// changes every member at once, so a grant limited to some agents cannot read or change it.
fn admit(permit: &MessagePermit) -> Result<(), RemoteError> {
    if !permit.owner_browser() {
        return Err(RemoteError::new(
            "REMOTE_SCOPE_DENIED",
            "Orchestration requires the owner browser.",
        ));
    }
    if permit.authority.agents != PermittedAgents::All {
        return Err(RemoteError::new(
            "REMOTE_SCOPE_DENIED",
            "Orchestration requires a grant for every agent.",
        ));
    }
    Ok(())
}

/// The Core request for an admitted read, its input unchanged.
pub(super) fn read(permit: &MessagePermit) -> Result<Value, RemoteError> {
    admit(permit)?;
    let input: Value = read_input(permit)?;
    if !input["view"]
        .as_str()
        .is_some_and(|view| VIEWS.contains(&view))
    {
        return Err(invalid());
    }
    Ok(json!({"version":1,"operation":"orchestration.read","input":input}))
}

/// The Core request and optional preview revision for an admitted write. Both plan on/off phases
/// read and compare current plans; the owner browser names no actor and Core still owns effects.
pub(super) fn write(
    permit: &MessagePermit,
    read_plans: impl FnOnce() -> Result<Value, RemoteError>,
) -> Result<(Value, Option<u64>), RemoteError> {
    admit(permit)?;
    let input: Value = read_input(permit)?;
    let mutation = &input["mutation"];
    if !matches!(input["phase"].as_str(), Some("preview" | "apply"))
        || !mutation["kind"]
            .as_str()
            .is_some_and(|kind| MUTATIONS.contains(&kind))
    {
        return Err(RemoteError::new(
            "REMOTE_SCOPE_DENIED",
            "This orchestration change is not available from the browser.",
        ));
    }
    if mutation.get("actorId").is_some() {
        return Err(RemoteError::new(
            "REMOTE_SCOPE_DENIED",
            "The owner browser acts as the person and names no actor.",
        ));
    }
    let revision = if mutation["kind"] == "plan.set" {
        let enabled = mutation["candidate"]["enabled"]
            .as_bool()
            .ok_or_else(plan_denied)?;
        let id = mutation["plan"].as_str().ok_or_else(plan_denied)?;
        let plans = read_plans()?;
        let revision = plans["configurationRevision"]
            .as_u64()
            .ok_or_else(invalid)?;
        if input["phase"] == "apply"
            && input["expectedConfigurationRevision"].as_u64() != Some(revision)
        {
            return Err(conflict());
        }
        let rows = plans["plans"].as_array().ok_or_else(invalid)?;
        let mut matching = rows.iter().filter(|plan| plan["id"] == id);
        let current = matching.next().ok_or_else(plan_denied)?;
        if matching.next().is_some() || !current["enabled"].is_boolean() {
            return Err(invalid());
        }
        let mut candidate = current.clone();
        candidate["enabled"] = json!(enabled);
        if candidate != mutation["candidate"] {
            return Err(plan_denied());
        }
        (input["phase"] == "preview").then_some(revision)
    } else {
        None
    };
    Ok((
        json!({"version":1,"operation":"orchestration.write","input":input}),
        revision,
    ))
}
fn plan_denied() -> RemoteError {
    RemoteError::new(
        "REMOTE_SCOPE_DENIED",
        "The browser may only turn a current plan on or off.",
    )
}
fn conflict() -> RemoteError {
    RemoteError::new(
        "ORCH_CONFLICT",
        "The orchestration configuration changed; preview again.",
    )
}
/// Core's preview must describe the same configuration as the comparison. Apply separately checks
/// its expected revision and candidate before Core's digest/revision-bound write.
pub(super) fn preview_revision(answer: Value, revision: Option<u64>) -> Result<Value, RemoteError> {
    if revision.is_some_and(|revision| answer["configurationRevision"].as_u64() != Some(revision)) {
        return Err(conflict());
    }
    Ok(answer)
}

/// Core's answer for the browser. An `ORCH_*` refusal (a conflict, a limit, a missing permission)
/// is Core's decision and becomes `{refused}`; a code or sentence that is not a plain bounded word or
/// line is not forwarded. Any other failure stays this door's own refusal.
pub(super) fn outcome(result: Result<Value, RemoteError>) -> Result<Value, RemoteError> {
    match result {
        Ok(answer) => Ok(answer),
        Err(error)
            if error.code.starts_with("ORCH_")
                && error.code.len() <= 64
                && error
                    .code
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b == b'_') =>
        {
            let mut refused = json!({"code":error.code});
            if error.message.len() <= 256 && !error.message.chars().any(char::is_control) {
                refused["message"] = json!(error.message);
            }
            Ok(json!({"refused":refused}))
        }
        Err(error) => Err(error),
    }
}
