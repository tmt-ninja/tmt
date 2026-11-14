//! The interactive forms providers wait on (#6424): `forms.list` reads them, and
//! `forms.answer` checks an answer against one. Answering is the user's action from a
//! client; no provider can take an answer yet, so every valid answer is refused with
//! `FORM_DELIVERY_UNSUPPORTED` and nothing reaches the provider's terminal.

use super::{Fault, Request, invalid};
use crate::{
    delivery,
    runtime::{
        RuntimeRegistry,
        provider_form::{Choice, FormKind},
    },
    storage::{Storage, StoredForm},
};
use serde::Deserialize;
use serde_json::{Value, json};
use tmt_core::binding::session::{RuntimeState, activity::ActivityPhase};

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

/// One answer: a choice per question in order, several for a multiple choice, text, or
/// a decision for a permission or plan.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Answer {
    #[serde(default)]
    choices: Option<Vec<Vec<usize>>>,
    #[serde(default)]
    text: Option<String>,
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
    let mut open = Vec::new();
    for form in forms {
        if is_open(storage, &form)? {
            open.push(document(&form));
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
    if !is_open(storage, &form)? {
        return Err(Fault::new(
            "FORM_CLOSED",
            "The form is no longer open: it was answered, or its turn ended.",
        ));
    }
    validate(&form, answer)?;
    Err(Fault::new(
        "FORM_DELIVERY_UNSUPPORTED",
        "No provider takes an answer from a client yet; answer the form in the member's terminal.",
    ))
}

/// Open while the identity's provider session waits, in the waiting period the form
/// opened in. Anything admitted since, such as the answer itself, ends that period.
fn is_open(storage: &mut Storage, stored: &StoredForm) -> Result<bool, Fault> {
    let Some(entry) =
        delivery::current(storage, &stored.identity_id).map_err(|_| Fault::unavailable())?
    else {
        return Ok(false);
    };
    let Some(binding) = entry.binding.as_ref() else {
        return Ok(false);
    };
    let preferences = storage
        .session_preferences(&stored.identity_id)
        .map_err(|_| Fault::unavailable())?;
    let Some(remembered) = preferences.remembered.as_ref() else {
        return Ok(false);
    };
    let Some(key) = binding.session.key.as_ref() else {
        return Ok(false);
    };
    if binding.session.state != RuntimeState::Running
        || key.provider_session.as_ref() != Some(&remembered.provider_session)
    {
        return Ok(false);
    }
    let registry = RuntimeRegistry::first_party();
    Ok(registry
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
        }))
}

/// A truncated question form cannot be answered (ruling on #6424), and a permission form
/// is shown but never answered from a client (R1 (b)).
fn validate(stored: &StoredForm, answer: &Answer) -> Result<(), Fault> {
    let refused = |message: &'static str| Err(Fault::new("FORM_ANSWER_INVALID", message));
    let form = &stored.form;
    match form.kind {
        FormKind::Permission => Err(Fault::new(
            "FORM_DELIVERY_UNSUPPORTED",
            "A permission form is answered in the member's terminal only.",
        )),
        FormKind::PlanApproval => match answer {
            Answer {
                decision: Some(_),
                choices: None,
                text: None,
            } => Ok(()),
            _ => refused("A plan approval takes a decision: allow or deny."),
        },
        FormKind::Question if form.truncated => refused(
            "This question form was too large to show whole, so it is answered in the member's terminal.",
        ),
        FormKind::Question => {
            if answer.decision.is_some() {
                return refused("A question takes choices or text, not a decision.");
            }
            match (&answer.choices, &answer.text) {
                (Some(choices), None) => {
                    if choices.len() != form.questions.len() {
                        return refused("Give one choice list per question, in order.");
                    }
                    for (picked, question) in choices.iter().zip(&form.questions) {
                        let in_range = picked.iter().all(|index| *index < question.options.len());
                        let mut unique = picked.clone();
                        unique.sort_unstable();
                        unique.dedup();
                        let count_ok = match question.choice {
                            Choice::Single => picked.len() == 1,
                            Choice::Multiple => !picked.is_empty(),
                        };
                        if !in_range || unique.len() != picked.len() || !count_ok {
                            return refused(
                                "A choice is out of range, repeated, or not one for a single choice.",
                            );
                        }
                    }
                    Ok(())
                }
                (None, Some(text)) if form.questions.len() == 1 && form.questions[0].free_text => {
                    if text.is_empty() || text.len() > crate::runtime::provider_form::MAX_TEXT {
                        refused("The text answer is empty or too long.")
                    } else {
                        Ok(())
                    }
                }
                _ => refused("Give choices, or text for a one-question form that takes text."),
            }
        }
    }
}

fn document(stored: &StoredForm) -> Value {
    let mut value = serde_json::to_value(&stored.form).unwrap_or(Value::Null);
    if let Value::Object(map) = &mut value {
        map.remove("toolUseId");
        map.insert("formId".into(), stored.form_id.clone().into());
        map.insert("identityId".into(), stored.identity_id.clone().into());
        map.insert("openedMs".into(), stored.opened_ms.into());
        // Whether a client may send an answer; none can yet.
        map.insert("answerable".into(), false.into());
    }
    value
}

fn not_found_identity() -> Fault {
    Fault::new("NAME_NOT_FOUND", "The selected identity was not found.")
}
