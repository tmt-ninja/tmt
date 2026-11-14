//! A provider's interactive form, as its consented hook reports it (#6424): a question,
//! a permission request or a plan approval the provider waits on in its terminal. This is
//! observation only. Nothing here answers a form, and nothing is read from the screen.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// At most this many questions, and options per question, are kept.
pub const MAX_QUESTIONS: usize = 4;
pub const MAX_OPTIONS: usize = 8;
/// UTF-8 byte bounds for each kept text.
pub const MAX_TEXT: usize = 2048;
pub const MAX_LABEL: usize = 256;
pub const MAX_PLAN: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FormKind {
    Question,
    Permission,
    PlanApproval,
}

impl FormKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Question => "question",
            Self::Permission => "permission",
            Self::PlanApproval => "planApproval",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Choice {
    Single,
    Multiple,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormOption {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormQuestion {
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    pub choice: Choice,
    pub options: Vec<FormOption>,
    pub free_text: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormTool {
    pub name: String,
    pub summary: String,
}

/// One open form. `tool_use_id` correlates it with the provider's own tool call when the
/// provider names one. `truncated` means some content was cut to the bounds above.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderForm {
    pub kind: FormKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_use_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub questions: Vec<FormQuestion>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<FormTool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<String>,
    pub truncated: bool,
}

/// The tools whose `PreToolUse` opens a Claude form; setup installs that hook only for them.
pub const CLAUDE_FORM_TOOLS: &str = "AskUserQuestion|ExitPlanMode";

/// A Claude main-session form from `PreToolUse` (`AskUserQuestion`, `ExitPlanMode`) or
/// `PermissionRequest`. A subagent's form, another tool or a malformed payload is none.
pub fn decode_claude(bytes: &[u8]) -> Option<ProviderForm> {
    if bytes.len() > super::hook_protocol::HOOK_INPUT_LIMIT {
        return None;
    }
    let payload: Value = serde_json::from_slice(bytes).ok()?;
    if payload.get("agent_id").is_some() || payload.get("agent_type").is_some() {
        return None;
    }
    let tool = payload["tool_name"].as_str()?;
    let input = &payload["tool_input"];
    let tool_use_id = payload["tool_use_id"]
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= MAX_LABEL)
        .map(str::to_owned);
    let mut truncated = false;
    let form = match (payload["hook_event_name"].as_str()?, tool) {
        ("PreToolUse", "AskUserQuestion") => {
            let asked = input["questions"].as_array()?;
            truncated |= asked.len() > MAX_QUESTIONS;
            let questions = asked
                .iter()
                .take(MAX_QUESTIONS)
                .map(|question| claude_question(question, &mut truncated))
                .collect::<Option<Vec<_>>>()?;
            if questions.is_empty() {
                return None;
            }
            ProviderForm {
                kind: FormKind::Question,
                tool_use_id,
                questions,
                tool: None,
                plan: None,
                truncated,
            }
        }
        ("PreToolUse", "ExitPlanMode") => ProviderForm {
            kind: FormKind::PlanApproval,
            tool_use_id,
            questions: Vec::new(),
            tool: None,
            plan: Some(bounded(input["plan"].as_str()?, MAX_PLAN, &mut truncated)),
            truncated,
        },
        ("PermissionRequest", _) => {
            let summary = match input {
                Value::Null => String::new(),
                Value::String(text) => text.clone(),
                other => other.to_string(),
            };
            ProviderForm {
                kind: FormKind::Permission,
                tool_use_id,
                questions: Vec::new(),
                tool: Some(FormTool {
                    name: bounded(tool, MAX_LABEL, &mut truncated),
                    summary: bounded(&summary, MAX_TEXT, &mut truncated),
                }),
                plan: None,
                truncated,
            }
        }
        _ => return None,
    };
    Some(form)
}

fn claude_question(question: &Value, truncated: &mut bool) -> Option<FormQuestion> {
    let offered = question["options"].as_array()?;
    *truncated |= offered.len() > MAX_OPTIONS;
    let options = offered
        .iter()
        .take(MAX_OPTIONS)
        .map(|option| {
            Some(FormOption {
                label: bounded(option["label"].as_str()?, MAX_LABEL, truncated),
                description: option["description"]
                    .as_str()
                    .filter(|text| !text.is_empty())
                    .map(|text| bounded(text, MAX_TEXT, truncated)),
            })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(FormQuestion {
        text: bounded(question["question"].as_str()?, MAX_TEXT, truncated),
        header: question["header"]
            .as_str()
            .filter(|text| !text.is_empty())
            .map(|text| bounded(text, MAX_LABEL, truncated)),
        choice: if question["multiSelect"].as_bool().unwrap_or(false) {
            Choice::Multiple
        } else {
            Choice::Single
        },
        options,
        // Claude always offers its own "Other" answer, which takes text.
        free_text: true,
    })
}

/// `text` cut at a character boundary within `limit` bytes; a cut sets `truncated`.
fn bounded(text: &str, limit: usize, truncated: &mut bool) -> String {
    if text.len() <= limit {
        return text.to_owned();
    }
    *truncated = true;
    text[..text.floor_char_boundary(limit)].to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn decode(value: Value) -> Option<ProviderForm> {
        decode_claude(value.to_string().as_bytes())
    }

    #[test]
    fn a_question_form_keeps_its_choices_and_bounds() {
        let form = decode(json!({"hook_event_name":"PreToolUse","session_id":"s","tool_name":"AskUserQuestion","tool_use_id":"toolu_1","tool_input":{"questions":[
            {"question":"Which?","header":"Pick","multiSelect":false,"options":[{"label":"A","description":"first"},{"label":"B"}]},
            {"question":"Which ones?","multiSelect":true,"options":[{"label":"X"},{"label":"Y"}]}]}}))
        .unwrap();
        assert_eq!(form.kind, FormKind::Question);
        assert_eq!(form.tool_use_id.as_deref(), Some("toolu_1"));
        assert_eq!(form.questions.len(), 2);
        assert_eq!(form.questions[0].choice, Choice::Single);
        assert_eq!(
            form.questions[0].options[0].description.as_deref(),
            Some("first")
        );
        assert_eq!(form.questions[1].choice, Choice::Multiple);
        assert!(form.questions.iter().all(|question| question.free_text));
        assert!(!form.truncated);

        let many = (0..10)
            .map(|n| json!({"label": format!("o{n}")}))
            .collect::<Vec<_>>();
        let long = "é".repeat(MAX_TEXT);
        let form = decode(json!({"hook_event_name":"PreToolUse","session_id":"s","tool_name":"AskUserQuestion","tool_input":{"questions":[
            {"question":long,"options":many}]}}))
        .unwrap();
        assert!(form.truncated);
        assert_eq!(form.questions[0].options.len(), MAX_OPTIONS);
        assert!(form.questions[0].text.len() <= MAX_TEXT);
    }

    #[test]
    fn plan_and_permission_forms_and_what_is_not_a_form() {
        let plan = decode(json!({"hook_event_name":"PreToolUse","session_id":"s","tool_name":"ExitPlanMode","tool_input":{"plan":"1. do it"}})).unwrap();
        assert_eq!(
            (plan.kind, plan.plan.as_deref()),
            (FormKind::PlanApproval, Some("1. do it"))
        );
        let permission = decode(json!({"hook_event_name":"PermissionRequest","session_id":"s","tool_name":"Bash","tool_input":{"command":"ls"}})).unwrap();
        assert_eq!(permission.kind, FormKind::Permission);
        assert_eq!(permission.tool.unwrap().name, "Bash");
        for other in [
            json!({"hook_event_name":"PreToolUse","session_id":"s","tool_name":"Bash","tool_input":{}}),
            json!({"hook_event_name":"PreToolUse","session_id":"s","tool_name":"AskUserQuestion","agent_id":"a","tool_input":{"questions":[{"question":"q","options":[]}]}}),
            json!({"hook_event_name":"PreToolUse","session_id":"s","tool_name":"AskUserQuestion","tool_input":{"questions":[]}}),
            json!({"hook_event_name":"PostToolUse","session_id":"s","tool_name":"AskUserQuestion","tool_input":{}}),
        ] {
            assert_eq!(decode(other.clone()), None, "{other}");
        }
    }
}
