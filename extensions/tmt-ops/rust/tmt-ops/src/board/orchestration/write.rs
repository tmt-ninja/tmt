//! Orchestration writes and on-demand reads on the existing ordered action lane. Every
//! write is Core's preview first; only an explicit confirm applies that exact preview.
use crate::core::{Core, SquadError};
use serde_json::{Value, json};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum Step {
    /// Ask Core for the effect of `mutation`; it carries no actor yet.
    Preview { title: String, mutation: Value },
    /// Apply exactly the preview the person confirmed.
    Apply(Box<Value>),
    /// Read the decision journal for one identity.
    Why { identity_id: String, name: String },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Task {
    pub step: Step,
}
#[derive(Debug)]
pub(in crate::board) struct Completed {
    pub task: Task,
    pub result: Result<Value, SquadError>,
}

/// Mutations that record who allowed or resumed: a verified agent caller other than the
/// recorded person is attributed (Core admits only a current lead); the person is not.
const ATTRIBUTED: [&str; 2] = ["route.allow", "talks.resume"];

fn actor(core: &Core) -> Result<Option<String>, SquadError> {
    let person = crate::me::current(core)?;
    Ok(crate::me::caller(core)?
        .map(|caller| caller.me.id)
        .filter(|id| person.as_ref().is_none_or(|person| &person.id != id)))
}

pub(in crate::board) fn complete(core: &Core, task: Task) -> Completed {
    let result = match &task.step {
        Step::Preview { mutation, .. } => (|| {
            let mut mutation = mutation.clone();
            if ATTRIBUTED.contains(&mutation["kind"].as_str().unwrap_or_default())
                && let Some(id) = actor(core)?
            {
                mutation["actorId"] = id.into();
            }
            core.api(
                "orchestration.write",
                json!({"phase": "preview", "mutation": mutation}),
            )
        })(),
        Step::Apply(preview) => core.api(
            "orchestration.write",
            json!({
                "phase": "apply",
                "mutation": preview["mutation"],
                "expectedConfigurationRevision": preview["configurationRevision"],
                "previewAtMs": preview["previewAtMs"],
                "previewDigest": preview["previewDigest"],
                "consent": true,
            }),
        ),
        Step::Why { identity_id, .. } => core.api(
            "orchestration.read",
            json!({"view": "why", "subject": {"kind": "identity", "id": identity_id}, "limit": 20}),
        ),
    };
    Completed { task, result }
}

/// What the confirm dialog shows for a preview: Core's own effect, never a local guess.
pub(in crate::board) fn preview_lines(
    preview: &Value,
    name: impl Fn(&str) -> String,
) -> Vec<String> {
    let mut lines = Vec::new();
    match preview["mutation"]["kind"].as_str() {
        Some("talks.resume") => {
            let releases = preview["releases"].as_u64().unwrap_or(0);
            let held = preview["held"].as_array().map_or(0, Vec::len);
            lines.push(format!("Releases {releases} of {held} held messages."));
            if releases < held as u64 {
                lines.push("Expired held messages stay unsent.".into());
            }
            lines.push("They go out through normal delivery; the pair's hour restarts.".into());
        }
        _ => {
            let changes = preview["changes"].as_array().map_or(&[][..], Vec::as_slice);
            if changes.is_empty() {
                lines.push("No member's effective policy changes at this time.".into());
            }
            for change in changes.iter().take(8) {
                let fields: Vec<_> = change["fields"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect();
                lines.push(format!(
                    "{} · {}",
                    name(change["identityId"].as_str().unwrap_or("?")),
                    fields.join(", ")
                ));
            }
            if changes.len() > 8 {
                lines.push(format!("… and {} more members", changes.len() - 8));
            }
        }
    }
    lines.push("Running work is never interrupted.".into());
    lines
}

/// One journal entry per line, newest first, as Core recorded it.
pub(in crate::board) fn why_lines(page: &Value) -> Vec<String> {
    let items = page["items"].as_array().map_or(&[][..], Vec::as_slice);
    if items.is_empty() {
        return vec!["No recorded decision.".into()];
    }
    items
        .iter()
        .map(|item| {
            format!(
                "{} {} · {}",
                item["action"].as_str().unwrap_or("?"),
                item["outcome"].as_str().unwrap_or("?"),
                item["reason"].as_str().unwrap_or("?"),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_resume_preview_says_how_many_go_out_and_that_expired_ones_stay() {
        let lines = preview_lines(
            &json!({
                "mutation": {"kind": "talks.resume"},
                "releases": 1,
                "held": [{}, {}],
            }),
            str::to_owned,
        );
        assert_eq!(lines[0], "Releases 1 of 2 held messages.");
        assert_eq!(lines[1], "Expired held messages stay unsent.");
    }

    #[test]
    fn a_policy_preview_lists_core_changes_and_an_empty_journal_says_so() {
        let lines = preview_lines(
            &json!({
                "mutation": {"kind": "focus.set"},
                "changes": [{"identityId": "a", "fields": ["state", "receiving"]}],
            }),
            |id| format!("name-{id}"),
        );
        assert_eq!(lines[0], "name-a · state, receiving");
        assert_eq!(why_lines(&json!({"items": []})), ["No recorded decision."]);
    }
}
