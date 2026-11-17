//! Owner-local shell observations retained with the member's conversation.
use super::{App, ConversationKey};
use serde_json::Value;

/// Reject malformed or misrouted observations rather than inventing a success.
pub(in crate::board) fn valid_result(identity: &str, value: &Value) -> bool {
    value["identityId"].as_str() == Some(identity)
        && value["cwd"]
            .as_str()
            .is_some_and(|cwd| std::path::Path::new(cwd).is_absolute())
        && value["stdout"]
            .as_str()
            .zip(value["stderr"].as_str())
            .is_some_and(|(out, err)| out.len().saturating_add(err.len()) <= 3 * 65_536)
        && (value["exitCode"].is_null() || value["exitCode"].as_i64().is_some())
        && (value["signal"].is_null() || value["signal"].as_i64().is_some())
        && value.get("exitCode").is_some()
        && value.get("signal").is_some()
        && value["timedOut"].as_bool().is_some()
        && value["truncated"].as_bool().is_some()
}

pub(super) struct Run {
    pub command: String,
    pub private: bool,
    pub result: Option<Result<Value, String>>,
    pub attached: bool,
}

impl App {
    pub(in crate::board) fn shell_running(&self) -> bool {
        self.conversation
            .borrow()
            .sessions
            .values()
            .any(|session| session.shell_runs.iter().any(|run| run.result.is_none()))
    }

    pub(in crate::board) fn shell_start(
        &mut self,
        key: &(String, String),
        command: &str,
        private: bool,
    ) -> bool {
        let mut state = self.conversation.borrow_mut();
        if state.sessions.iter().any(|((_, member), session)| {
            member == &key.1 && session.shell_runs.iter().any(|run| run.result.is_none())
        }) {
            return false;
        }
        let session = state
            .sessions
            .entry((Some(key.0.clone()), key.1.clone()))
            .or_default();
        if session.shell_runs.len() >= 16 {
            if let Some(index) = session.shell_runs.iter().position(|run| {
                run.result
                    .as_ref()
                    .is_some_and(|result| run.private || run.attached || result.is_err())
            }) {
                session.shell_runs.remove(index);
            } else {
                return false;
            }
        }
        session.shell_runs.push(Run {
            command: command.into(),
            private,
            result: None,
            attached: false,
        });
        session.stale = true;
        session.set_follow(true);
        true
    }

    pub(in crate::board) fn shell_finished(
        &mut self,
        key: (String, String),
        result: Result<Value, String>,
    ) {
        let mut state = self.conversation.borrow_mut();
        let identity: ConversationKey = (Some(key.0), key.1);
        if let Some(session) = state.sessions.get_mut(&identity)
            && let Some(run) = session
                .shell_runs
                .iter_mut()
                .find(|run| run.result.is_none())
        {
            run.result = Some(result);
            session.stale = true;
            session.set_follow(true);
        }
    }

    /// Consume pending observations only when the next Talk is admitted for dispatch.
    pub(in crate::board) fn shell_attachment(
        &self,
        key: &(String, String),
        consume: bool,
    ) -> Option<String> {
        let mut state = self.conversation.borrow_mut();
        let session = state
            .sessions
            .get_mut(&(Some(key.0.clone()), key.1.clone()))?;
        let mut result = String::new();
        for run in session
            .shell_runs
            .iter_mut()
            .filter(|run| !run.private && !run.attached)
        {
            let Some(Ok(value)) = &run.result else {
                continue;
            };
            let block = attachment(&run.command, value);
            result.push_str(&block);
            if consume {
                run.attached = true;
            }
        }
        if result.is_empty() {
            None
        } else {
            if consume {
                session.stale = true;
            }
            Some(result)
        }
    }
}

fn attachment(command: &str, value: &Value) -> String {
    let cwd = value["cwd"].as_str().unwrap_or("unknown");
    let stdout = value["stdout"].as_str().unwrap_or("");
    let stderr = value["stderr"].as_str().unwrap_or("");
    let status = format!(
        "exit {} · signal {} · timed out {} · truncated {}",
        value["exitCode"], value["signal"], value["timedOut"], value["truncated"]
    );
    let full = format!(
        "Shell command: {command}\nDirectory: {cwd}\n{status}\nstdout:\n{stdout}\nstderr:\n{stderr}"
    );
    const LIMIT: usize = 16 * 1024;
    let mut end = full.len().min(LIMIT);
    while !full.is_char_boundary(end) {
        end -= 1;
    }
    let note = if end < full.len() {
        "\n[output truncated for attachment]"
    } else {
        ""
    };
    format!(
        "--- shell result ---\n{}{note}\n--- end shell result ---\n\n",
        &full[..end]
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn result_admission_refuses_missing_or_misrouted_evidence() {
        let value = json!({"identityId":"member","cwd":"/work","stdout":"ok","stderr":"","exitCode":0,"signal":null,"timedOut":false,"truncated":false});
        assert!(valid_result("member", &value));
        assert!(!valid_result("other", &value));
        let mut missing = value.clone();
        missing.as_object_mut().unwrap().remove("signal");
        assert!(!valid_result("member", &missing));
        let mut oversized = value;
        oversized["stdout"] = json!("x".repeat(3 * 65_536 + 1));
        assert!(!valid_result("member", &oversized));
    }
}
