//! Owner-browser provider forms over Core's public API. Core validates options and owns
//! provider delivery; this boundary owns scopes, bounded projection and same-device recovery.
use super::{Operations, invalid, read_input};
use crate::{
    admission::MessagePermit, authority::PermittedAgents, canonical, error::RemoteError, limits,
    pairing::now_ms, store::database,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

pub(super) fn admit(permit: &MessagePermit) -> Result<(), RemoteError> {
    if !permit.owner_browser() || permit.authority.agents != PermittedAgents::All {
        return Err(RemoteError::new(
            "REMOTE_SCOPE_DENIED",
            "Provider forms require the owner browser and every agent.",
        ));
    }
    Ok(())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListInput {
    identity_id: Option<String>,
}
pub(super) fn read_request(permit: &MessagePermit) -> Result<Value, RemoteError> {
    admit(permit)?;
    let input: Value = read_input(permit)?;
    let operation = permit.message.envelope().operation;
    if operation == "forms.list" {
        let parsed: ListInput = serde_json::from_value(input.clone()).map_err(|_| invalid())?;
        if parsed
            .identity_id
            .as_deref()
            .is_some_and(|id| !canonical::is_core_id(id))
            || input.get("identityId").is_some_and(Value::is_null)
        {
            return Err(invalid());
        }
    } else if input != json!({}) {
        return Err(invalid());
    }
    Ok(json!({"version":1,"operation":operation,"input":input}))
}
fn safe(value: &Value) -> bool {
    value.as_u64().is_some_and(|n| n <= 9_007_199_254_740_991)
}
fn bounded(text: &str, bytes: usize) -> bool {
    text.len() <= bytes
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OptionText {
    label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Question {
    text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    header: Option<String>,
    choice: String,
    options: Vec<OptionText>,
    free_text: bool,
}
#[derive(Deserialize, Serialize)]
struct Tool {
    name: String,
    summary: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Form {
    form_id: String,
    identity_id: String,
    opened_ms: u64,
    kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    questions: Option<Vec<Question>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<Tool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    plan: Option<String>,
    truncated: bool,
    answerable: bool,
    answer_in: String,
}
fn form(value: &Value) -> Result<Value, RemoteError> {
    let f: Form = serde_json::from_value(value.clone()).map_err(|_| invalid())?;
    if !canonical::is_core_id(&f.form_id)
        || !canonical::is_core_id(&f.identity_id)
        || f.opened_ms > 9_007_199_254_740_991
        || !matches!(f.kind.as_str(), "question" | "permission" | "planApproval")
        || !matches!(f.answer_in.as_str(), "client" | "terminal")
        || f.answerable != (f.answer_in == "client")
        || f.plan
            .as_deref()
            .is_some_and(|p| !bounded(p, limits::FORM_PLAN_BYTES))
        || f.tool.as_ref().is_some_and(|t| {
            !bounded(&t.name, limits::FORM_TEXT_BYTES)
                || !bounded(&t.summary, limits::FORM_TEXT_BYTES)
        })
    {
        return Err(invalid());
    }
    if let Some(qs) = &f.questions {
        if qs.len() > limits::FORM_QUESTIONS {
            return Err(invalid());
        }
        for q in qs {
            if !bounded(&q.text, limits::FORM_TEXT_BYTES)
                || q.header
                    .as_deref()
                    .is_some_and(|h| !bounded(h, limits::FORM_LABEL_BYTES))
                || !matches!(q.choice.as_str(), "single" | "multiple")
                || q.options.len() > limits::FORM_OPTIONS
                || q.options.iter().any(|o| {
                    !bounded(&o.label, limits::FORM_LABEL_BYTES)
                        || o.description
                            .as_deref()
                            .is_some_and(|d| !bounded(d, limits::FORM_TEXT_BYTES))
                })
            {
                return Err(invalid());
            }
        }
    }
    serde_json::to_value(f).map_err(|_| invalid())
}
pub(super) fn read_response(operation: &str, value: &Value) -> Result<Value, RemoteError> {
    let result = (|| {
        if operation == "changes.cursor" {
            if !safe(&value["cursor"]) || value.get("usage").is_some_and(|v| !safe(v)) {
                return Err(invalid());
            }
            let mut answer = json!({"cursor":value["cursor"]});
            if let Some(usage) = value.get("usage") {
                answer["usage"] = usage.clone();
            }
            return Ok(answer);
        }
        let rows = value["forms"].as_array().ok_or_else(invalid)?;
        let mut forms = Vec::new();
        let mut ids = std::collections::HashSet::new();
        for row in rows {
            let projected = form(row)?;
            if !ids.insert(projected["formId"].as_str().unwrap().to_owned()) {
                return Err(invalid());
            }
            forms.push(projected);
        }
        Ok(json!({"forms":forms}))
    })();
    result.map_err(|_: RemoteError| {
        RemoteError::new("REMOTE_CORE_UNAVAILABLE", "Provider forms are unavailable.")
    })
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnswerInput {
    operation_id: String,
    form_id: String,
    answer: Value,
}
fn answer_input(permit: &MessagePermit) -> Result<AnswerInput, RemoteError> {
    let input: AnswerInput = read_input(permit)?;
    if input.operation_id != permit.message.envelope().id
        || !canonical::is_core_id(&input.operation_id)
        || !canonical::is_core_id(&input.form_id)
        || serde_json::to_vec(&input.answer)
            .map_err(|_| invalid())?
            .len()
            > limits::FORMS_ANSWER_BYTES
    {
        return Err(invalid());
    }
    let fields = input.answer.as_object().ok_or_else(invalid)?;
    // Structural bounds only. Core decides whether choices/Other fit this exact form.
    if fields.contains_key("decision") {
        if fields.len() != 1 || !matches!(input.answer["decision"].as_str(), Some("allow" | "deny"))
        {
            return Err(invalid());
        }
    } else {
        if fields
            .keys()
            .any(|k| !matches!(k.as_str(), "choices" | "other"))
        {
            return Err(invalid());
        }
        let choices = input.answer["choices"].as_array().ok_or_else(invalid)?;
        if choices.len() > limits::FORM_QUESTIONS
            || choices.iter().any(|q| {
                q.as_array()
                    .is_none_or(|p| p.len() > limits::FORM_OPTIONS || p.iter().any(|i| !safe(i)))
            })
        {
            return Err(invalid());
        }
        if let Some(other) = fields.get("other") {
            let texts = other.as_array().ok_or_else(invalid)?;
            if texts.len() > limits::FORM_QUESTIONS
                || texts.iter().any(|v| {
                    !v.is_null()
                        && v.as_str()
                            .is_none_or(|s| !bounded(s, limits::FORM_TEXT_BYTES))
                })
            {
                return Err(invalid());
            }
        }
    }
    Ok(input)
}
fn outcome(id: &str, form: &str, result: Result<Value, RemoteError>, attempted: bool) -> Value {
    match result {
        Ok(value) if value["formId"] == form && value["delivered"] == true => {
            json!({"operationId":id,"formId":form,"state":"accepted","delivered":true})
        }
        Err(error)
            if matches!(
                error.code.as_str(),
                "FORM_NOT_FOUND"
                    | "FORM_CLOSED"
                    | "FORM_DELIVERY_UNSUPPORTED"
                    | "FORM_ANSWER_INVALID"
                    | "FORM_ANSWER_SENT"
                    | "FORM_DELIVERY_UNCERTAIN"
            ) =>
        {
            let mut value = json!({"operationId":id,"formId":form,"state":if error.code=="FORM_DELIVERY_UNCERTAIN" {"uncertain"}else{"refused"},"reason":error.code});
            if error.message.len() <= limits::FORM_TEXT_BYTES
                && !error.message.chars().any(char::is_control)
            {
                value["message"] = json!(error.message);
            }
            value
        }
        _ if !attempted => {
            json!({"operationId":id,"formId":form,"state":"refused","reason":"REMOTE_CORE_UNAVAILABLE"})
        }
        _ => {
            json!({"operationId":id,"formId":form,"state":"uncertain","reason":"REMOTE_CORE_UNCERTAIN"})
        }
    }
}
fn gate(page: Value, id: &str) -> Result<(), RemoteError> {
    let forms = page["forms"].as_array().ok_or_else(invalid)?;
    let f = forms
        .iter()
        .find(|f| f["formId"] == id)
        .ok_or_else(|| RemoteError::new("FORM_NOT_FOUND", "No open form has this ID."))?;
    if f["truncated"] == true {
        return Err(RemoteError::new(
            "FORM_ANSWER_INVALID",
            "A truncated form is answered in the terminal.",
        ));
    }
    if f["kind"] == "permission" || f["answerable"] != true || f["answerIn"] != "client" {
        return Err(RemoteError::new(
            "FORM_DELIVERY_UNSUPPORTED",
            "A terminal-only form is answered in the terminal.",
        ));
    }
    Ok(())
}
impl Operations {
    pub(super) fn forms_answer(&self, permit: &MessagePermit) -> Result<Vec<u8>, RemoteError> {
        admit(permit)?;
        let input = answer_input(permit)?;
        let resources = vec![input.form_id.clone()];
        // Adoption commits uncertainty before any provider action. Only this fresh invocation
        // may call Core; retries, restart and another session only observe the stored outcome.
        let owned = permit.adopt(None, &resources)?;
        if !owned.newly_adopted {
            return permit.response(&owned.receipt);
        }
        permit.revalidate()?;
        let observed = self.api_with_limit(
            br#"{"version":1,"operation":"forms.list","input":{}}"#,
            limits::FORMS_RESPONSE_BYTES,
        );
        permit.revalidate()?;
        let checked = observed
            .and_then(|v| read_response("forms.list", &v))
            .map_err(|_| {
                RemoteError::new("REMOTE_CORE_UNAVAILABLE", "Provider forms are unavailable.")
            })
            .and_then(|v| gate(v, &input.form_id));
        let mut attempted = false;
        let result = match checked {
            Err(error) => Err(error),
            Ok(()) => {
                let ask = json!({"version":1,"operation":"forms.answer","input":{"formId":input.form_id,"answer":input.answer}});
                let result = permit.with_store(|store| {
                    let (tx, now) = store.authorized_at(&permit.grant, now_ms)?;
                    crate::journal::require_operation_member(
                        &tx,
                        &permit.grant.client_id,
                        &input.operation_id,
                    )?;
                    let digest = crate::journal::intent(&permit.message)?;
                    crate::audit::append(
                        &tx,
                        crate::audit::AuditMetadata {
                            time: now,
                            client: &permit.grant.client_id,
                            request: &input.operation_id,
                            operation: "forms.answer",
                            operation_id: Some(&input.operation_id),
                            resources: &resources,
                            digest: &digest,
                            revision: permit.grant.revision,
                            decision: "dispatching",
                            code: "",
                        },
                    )?;
                    attempted = true;
                    let result = self.api(ask.to_string().as_bytes());
                    tx.commit().map_err(database)?;
                    Ok(result)
                });
                match result {
                    Ok(value) => value,
                    Err(error) if error.code == "REMOTE_CLOSED" => return Err(error),
                    Err(error) => Err(error),
                }
            }
        };
        let payload = outcome(&input.operation_id, &input.form_id, result, attempted);
        let metadata = permit.sessions.operation_response(
            &permit.grant,
            &input.operation_id,
            &payload,
            Some(permit.message.envelope().session_id),
        );
        if metadata
            .and_then(|m| {
                permit.with_store(|store| {
                    store.settle(
                        &permit.grant,
                        &input.operation_id,
                        &payload,
                        m.as_deref(),
                        now_ms()?,
                    )
                })
            })
            .is_err()
        {
            return permit.response(&owned.receipt);
        }
        permit.sessions.changed();
        permit.response(&payload)
    }
}
