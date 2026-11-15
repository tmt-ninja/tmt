//! The interactive forms providers wait on (#6424): `forms.list` reads them, and
//! `forms.answer` sends a client's answer as the keys the provider's driver captured for
//! that provider version. Answering is the user's action from a client. An answer is sent
//! at most once, marked sent before its first key, and is confirmed only when the provider
//! closes the form; otherwise it is uncertain and never sent again.

use super::{Fault, Request, invalid};
use crate::{
    delivery,
    host::{Host, OperationOptions},
    runtime::{
        RuntimeRegistry,
        provider_form::{Choice, FormAnswer, FormKey, FormKind, QuestionAnswer},
    },
    storage::{Storage, StoredForm},
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::time::{Duration, Instant};
use tmt_core::binding::{
    Binding, BindingEvidence, evaluate_binding,
    session::{RuntimeState, activity::ActivityPhase},
};
use tmt_core::host::HostKind;
use tmt_core::request::RequestEndpoint;

/// How long an answer waits for the provider to close its form.
const CLOSE_WAIT: Duration = Duration::from_secs(5);
const CLOSE_POLL: Duration = Duration::from_millis(100);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ListInput {
    #[serde(default)]
    identity_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AnswerInput {
    form_id: String,
    answer: Answer,
}

/// One answer: for a question form, the picked options of each question in order and,
/// per question, the text typed as "Other" (or null); for a plan approval, a decision.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Answer {
    #[serde(default)]
    choices: Option<Vec<Vec<usize>>>,
    #[serde(default)]
    other: Option<Vec<Option<String>>>,
    #[serde(default)]
    decision: Option<Decision>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
enum Decision {
    Allow,
    Deny,
}

pub(super) fn decode_list(input: &[u8]) -> Result<Request, Fault> {
    let input: ListInput = serde_json::from_slice(input).map_err(|_| invalid())?;
    if input
        .identity_id
        .as_deref()
        .is_some_and(|id| !tmt_core::dispatch::canonical_id(id))
    {
        return Err(invalid());
    }
    Ok(Request::FormsList {
        identity_id: input.identity_id,
    })
}

pub(super) fn decode_answer(input: &[u8]) -> Result<Request, Fault> {
    let input: AnswerInput = serde_json::from_slice(input).map_err(|_| invalid())?;
    if !tmt_core::dispatch::canonical_id(&input.form_id) {
        return Err(invalid());
    }
    Ok(Request::FormsAnswer {
        form_id: input.form_id,
        answer: input.answer,
    })
}

pub(super) fn list(storage: &mut Storage, identity_id: Option<&str>) -> Result<Vec<u8>, Fault> {
    if let Some(id) = identity_id {
        delivery::current(storage, id)
            .map_err(|_| Fault::unavailable())?
            .ok_or_else(not_found_identity)?;
    }
    let forms = storage
        .provider_forms(identity_id)
        .map_err(|_| Fault::unavailable())?;
    let registry = RuntimeRegistry::first_party();
    let mut open = Vec::new();
    for form in forms {
        if let Some(session) = open_session(storage, &form)? {
            let answerable = sample(&form)
                .and_then(|answer| plan(&registry, &session, &form, &answer))
                .is_some();
            open.push(document(&form, answerable));
        }
    }
    serde_json::to_vec(&json!({"forms": open})).map_err(|_| Fault::unavailable())
}

pub(super) fn answer(
    storage: &mut Storage,
    form_id: &str,
    answer: &Answer,
) -> Result<Vec<u8>, Fault> {
    let Some(form) = storage
        .provider_form(form_id)
        .map_err(|_| Fault::unavailable())?
    else {
        return Err(Fault::new("FORM_NOT_FOUND", "No form has this ID."));
    };
    let Some(session) = open_session(storage, &form)? else {
        return Err(closed());
    };
    let checked = validate(&form, answer)?;
    if form.sent_ms.is_some() {
        return Err(already_sent());
    }
    let registry = RuntimeRegistry::first_party();
    let Some(keys) = plan(&registry, &session, &form, &checked) else {
        return Err(Fault::new(
            "FORM_DELIVERY_UNSUPPORTED",
            "This provider version or terminal host takes no answer from a client; answer the form in the member's terminal.",
        ));
    };
    let binding = &session.binding;
    let host = Host::for_server(&binding.server);
    let entry = delivery::current(storage, &form.identity_id)
        .map_err(|_| Fault::unavailable())?
        .ok_or_else(closed)?;
    let probe = host
        .probe(
            &binding.server,
            OperationOptions {
                deadline: None,
                pane_ids: Some(std::slice::from_ref(&binding.pane_id)),
            },
        )
        .map_err(|_| Fault::unavailable())?;
    match evaluate_binding(&entry, &probe) {
        BindingEvidence::Active(_) if entry.binding.as_ref() == Some(binding) => {}
        BindingEvidence::Active(_) | BindingEvidence::EndpointLost => return Err(closed()),
        BindingEvidence::MarkerMismatch | BindingEvidence::Unknown => {
            return Err(Fault::unavailable());
        }
    }
    // Sent before the first key: whatever happens next, nothing is typed twice.
    if !storage
        .mark_provider_form_sent(form_id, crate::request_runtime::wall_time_ms())
        .map_err(|_| Fault::unavailable())?
    {
        return Err(already_sent());
    }
    let endpoint = RequestEndpoint {
        server: binding.server.clone(),
        pane_id: binding.pane_id.clone(),
        pane_pid: binding.pane_pid,
    };
    if !matches!(host.keys(&endpoint, &keys), Some(Ok(()))) {
        return Err(uncertain());
    }
    // The provider closes the form through an admitted event that ends waiting.
    let deadline = Instant::now() + CLOSE_WAIT;
    loop {
        if open_session(storage, &form)?.is_none() {
            return serde_json::to_vec(&json!({"formId": form_id, "delivered": true}))
                .map_err(|_| Fault::unavailable());
        }
        if Instant::now() >= deadline {
            return Err(uncertain());
        }
        std::thread::sleep(CLOSE_POLL);
    }
}

/// The open session a form belongs to: its binding and the remembered provider harness.
struct OpenSession {
    binding: Binding,
    harness: tmt_core::binding::session::HarnessId,
}

/// Open while the identity's provider session waits, in the waiting period the form
/// opened in. Anything admitted since, such as the answer itself, ends that period.
fn open_session(storage: &mut Storage, stored: &StoredForm) -> Result<Option<OpenSession>, Fault> {
    let Some(entry) =
        delivery::current(storage, &stored.identity_id).map_err(|_| Fault::unavailable())?
    else {
        return Ok(None);
    };
    let Some(binding) = entry.binding else {
        return Ok(None);
    };
    let preferences = storage
        .session_preferences(&stored.identity_id)
        .map_err(|_| Fault::unavailable())?;
    let Some(remembered) = preferences.remembered else {
        return Ok(None);
    };
    let Some(key) = binding.session.key.as_ref() else {
        return Ok(None);
    };
    if binding.session.state != RuntimeState::Running
        || key.provider_session.as_ref() != Some(&remembered.provider_session)
    {
        return Ok(None);
    }
    let registry = RuntimeRegistry::first_party();
    let waiting = registry
        .lifecycle(&remembered.harness)
        .and_then(|driver| {
            remembered
                .state
                .as_ref()
                .and_then(|state| driver.state_activity(state))
        })
        .is_some_and(|activity| {
            activity.matches(&remembered.provider_session, &key.incarnation)
                && activity.phase == ActivityPhase::Waiting
                && stored.opened_ms >= activity.since_ms
        });
    Ok(waiting.then_some(OpenSession {
        binding,
        harness: remembered.harness,
    }))
}

/// The keys for a checked answer, when a client may send one: not sent yet, on a tmux
/// pane, from a provider version whose driver captured this form's keys.
fn plan(
    registry: &RuntimeRegistry,
    session: &OpenSession,
    form: &StoredForm,
    answer: &FormAnswer,
) -> Option<Vec<FormKey>> {
    if form.sent_ms.is_some() || session.binding.server.host != HostKind::Tmux {
        return None;
    }
    registry.lifecycle(&session.harness)?.form_keys(
        &form.form,
        form.provider_version.as_deref()?,
        answer,
    )
}

/// An answer the form takes, to ask the driver whether it has keys for this shape.
fn sample(form: &StoredForm) -> Option<FormAnswer> {
    match form.form.kind {
        FormKind::Permission => None,
        FormKind::PlanApproval => Some(FormAnswer::Decision(true)),
        FormKind::Question => form
            .form
            .questions
            .iter()
            .map(|question| {
                (!question.options.is_empty()).then(|| QuestionAnswer {
                    picks: vec![0],
                    other: None,
                })
            })
            .collect::<Option<Vec<_>>>()
            .map(FormAnswer::Questions),
    }
}

fn closed() -> Fault {
    Fault::new(
        "FORM_CLOSED",
        "The form is no longer open: it was answered, or its turn ended.",
    )
}

fn already_sent() -> Fault {
    Fault::new(
        "FORM_ANSWER_SENT",
        "An answer to this form was already sent; check the member's terminal.",
    )
}

fn uncertain() -> Fault {
    Fault::new(
        "FORM_DELIVERY_UNCERTAIN",
        "The keys were sent but the provider did not confirm the answer; check the member's terminal and answer there. Do not resend.",
    )
}

/// A truncated question form cannot be answered (ruling on #6424), and a permission form
/// is shown but never answered from a client (R1 (b)).
fn validate(stored: &StoredForm, answer: &Answer) -> Result<FormAnswer, Fault> {
    let refused = |message: &'static str| Err(Fault::new("FORM_ANSWER_INVALID", message));
    let form = &stored.form;
    match form.kind {
        FormKind::Permission => Err(Fault::new(
            "FORM_DELIVERY_UNSUPPORTED",
            "A permission form is answered in the member's terminal only.",
        )),
        FormKind::PlanApproval => match answer {
            Answer {
                decision: Some(decision),
                choices: None,
                other: None,
            } => Ok(FormAnswer::Decision(*decision == Decision::Allow)),
            _ => refused("A plan approval takes a decision: allow or deny."),
        },
        FormKind::Question if form.truncated => refused(
            "This question form was too large to show whole, so it is answered in the member's terminal.",
        ),
        FormKind::Question => {
            let (Some(choices), None) = (&answer.choices, answer.decision) else {
                return refused("A question form takes choices, and optional other text.");
            };
            let others = match &answer.other {
                Some(others) => others.clone(),
                None => vec![None; choices.len()],
            };
            if choices.len() != form.questions.len() || others.len() != choices.len() {
                return refused(
                    "Give one choice list, and at most one other text, per question, in order.",
                );
            }
            let mut answers = Vec::with_capacity(choices.len());
            for ((picked, other), question) in choices.iter().zip(others).zip(&form.questions) {
                let mut picks = picked.clone();
                picks.sort_unstable();
                picks.dedup();
                let in_range = picks.iter().all(|index| *index < question.options.len());
                let text_ok = other.as_deref().is_none_or(|text| {
                    question.free_text
                        && !text.is_empty()
                        && text.len() <= crate::runtime::provider_form::MAX_TEXT
                        && !text.chars().any(char::is_control)
                });
                let count_ok = match question.choice {
                    Choice::Single => picks.len() + usize::from(other.is_some()) == 1,
                    Choice::Multiple => !picks.is_empty() || other.is_some(),
                };
                if !in_range || picks.len() != picked.len() || !text_ok || !count_ok {
                    return refused(
                        "A choice is out of range or repeated, a single choice has not exactly one answer, or the other text is empty, too long, has control characters or is not taken.",
                    );
                }
                answers.push(QuestionAnswer { picks, other });
            }
            Ok(FormAnswer::Questions(answers))
        }
    }
}

fn document(stored: &StoredForm, answerable: bool) -> Value {
    let mut value = serde_json::to_value(&stored.form).unwrap_or(Value::Null);
    if let Value::Object(map) = &mut value {
        map.remove("toolUseId");
        map.insert("formId".into(), stored.form_id.clone().into());
        map.insert("identityId".into(), stored.identity_id.clone().into());
        map.insert("openedMs".into(), stored.opened_ms.into());
        // Whether a client may send an answer now, and where the user answers it.
        map.insert("answerable".into(), answerable.into());
        map.insert(
            "answerIn".into(),
            if answerable { "client" } else { "terminal" }.into(),
        );
    }
    value
}

fn not_found_identity() -> Fault {
    Fault::new("NAME_NOT_FOUND", "The selected identity was not found.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime::provider_form::{FormOption, FormQuestion, ProviderForm};

    fn stored(kind: FormKind, choices: &[Choice], truncated: bool) -> StoredForm {
        StoredForm {
            form_id: "f".into(),
            identity_id: "i".into(),
            opened_ms: 1,
            form: ProviderForm {
                kind,
                tool_use_id: None,
                questions: choices
                    .iter()
                    .map(|choice| FormQuestion {
                        text: "q".into(),
                        header: None,
                        choice: *choice,
                        options: ["a", "b", "c"]
                            .map(|label| FormOption {
                                label: label.into(),
                                description: None,
                            })
                            .into(),
                        free_text: true,
                    })
                    .collect(),
                tool: None,
                plan: None,
                truncated,
            },
            provider_version: Some("2.1.325".into()),
            sent_ms: None,
        }
    }

    fn check(form: &StoredForm, answer: Value) -> Result<FormAnswer, &'static str> {
        validate(form, &serde_json::from_value(answer).unwrap()).map_err(|fault| fault.code)
    }

    /// Answers become the checked shape the key plans take, and every misfit is refused,
    /// so nothing is sent for it; a list shows where each form is answered.
    #[test]
    fn answers_are_checked_into_the_shape_the_key_plans_take() {
        let questions = stored(
            FormKind::Question,
            &[Choice::Single, Choice::Multiple],
            false,
        );
        assert_eq!(
            check(
                &questions,
                json!({"choices": [[], [2, 0]], "other": ["abc", "xyz"]})
            ),
            Ok(FormAnswer::Questions(vec![
                QuestionAnswer {
                    picks: vec![],
                    other: Some("abc".into())
                },
                QuestionAnswer {
                    picks: vec![0, 2],
                    other: Some("xyz".into())
                },
            ]))
        );
        assert_eq!(
            check(&questions, json!({"choices": [[1], [0]]})),
            Ok(FormAnswer::Questions(vec![
                QuestionAnswer {
                    picks: vec![1],
                    other: None
                },
                QuestionAnswer {
                    picks: vec![0],
                    other: None
                },
            ]))
        );
        for misfit in [
            json!({"choices": [[0, 1], [0]]}),
            json!({"choices": [[0], [0]], "other": ["abc", null]}),
            json!({"choices": [[], []]}),
            json!({"choices": [[3], [0]]}),
            json!({"choices": [[0], [1, 1]]}),
            json!({"choices": [[0]]}),
            json!({"choices": [[0], [0]], "other": [null]}),
            json!({"choices": [[], [0]], "other": ["a\nb", null]}),
            json!({"choices": [[], [0]], "other": ["", null]}),
            json!({"decision": "allow"}),
        ] {
            assert_eq!(
                check(&questions, misfit.clone()),
                Err("FORM_ANSWER_INVALID"),
                "{misfit}"
            );
        }
        let plan = stored(FormKind::PlanApproval, &[], false);
        assert_eq!(
            check(&plan, json!({"decision": "allow"})),
            Ok(FormAnswer::Decision(true))
        );
        assert_eq!(
            check(&plan, json!({"decision": "deny"})),
            Ok(FormAnswer::Decision(false))
        );
        assert_eq!(
            check(&plan, json!({"choices": [[0]]})),
            Err("FORM_ANSWER_INVALID")
        );
        assert_eq!(
            check(
                &stored(FormKind::Question, &[Choice::Single], true),
                json!({"choices": [[0]]})
            ),
            Err("FORM_ANSWER_INVALID")
        );
        assert_eq!(
            check(
                &stored(FormKind::Permission, &[], false),
                json!({"decision": "allow"})
            ),
            Err("FORM_DELIVERY_UNSUPPORTED")
        );
        assert_eq!(sample(&stored(FormKind::Permission, &[], false)), None);
        let shown = document(&questions, false);
        assert_eq!(
            (&shown["answerable"], &shown["answerIn"]),
            (&json!(false), &json!("terminal"))
        );
        assert_eq!(document(&plan, true)["answerIn"], "client");
    }
}
