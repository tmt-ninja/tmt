//! Closed owner-browser metadata commands. They use the existing structured publisher and
//! save operation/status lifetime; they grant no link editor or commenter content authority.
use super::{
    StructuredAction,
    save::{Prepared, SourceOpener},
};
use crate::decoder::StructuredKind;
use serde_json::Value;

pub struct MetadataEdit {
    pub page: String,
    pub operation_id: String,
    pub expected_revision: String,
    pub action: String,
    pub body: Value,
}

/// Reject unknown actions and excess fields before opening a native source.
pub fn validate(action: &str, body: &Value) -> crate::Result<StructuredKind> {
    let invalid = || super::Fault::Invalid;
    match action {
        "page.state" => {
            crate::page_state::validate_action(action, body).map_err(|_| invalid())?;
            Ok(StructuredKind::PageState)
        }
        "creator.set" => {
            crate::question_registry::validate_creator_selection(body).map_err(|_| invalid())?;
            // A browser never chooses the editor's machine attribution.
            if body.get("machineId").is_some() {
                return Err(invalid().into());
            }
            Ok(StructuredKind::Creator)
        }
        "question.handle" | "question.reopen" => {
            crate::closed::keys(body, &["id"], &[]).map_err(|_| invalid())?;
            if !body["id"]
                .as_str()
                .is_some_and(crate::page_check::valid_question_id)
            {
                return Err(invalid().into());
            }
            Ok(StructuredKind::Questions)
        }
        "question.agent" => {
            // A browser names the recipient with a `selector` and never supplies a label; the
            // serve resolves it (`prepare`). No `selector` follows the page's creator again.
            crate::closed::keys(body, &["id"], &["selector"]).map_err(|_| invalid())?;
            if !body["id"]
                .as_str()
                .is_some_and(crate::page_check::valid_question_id)
                || body
                    .get("selector")
                    .is_some_and(|selector| !selector.as_str().is_some_and(valid_selector))
            {
                return Err(invalid().into());
            }
            Ok(StructuredKind::Questions)
        }
        _ => Err(invalid().into()),
    }
}

/// A name or canonical ID a browser selects an identity by: at most 256 bytes, no control
/// character, no surrounding whitespace. The one grammar of `creator.set` and `question.agent`.
pub fn valid_selector(selector: &str) -> bool {
    !selector.is_empty()
        && selector.len() <= 256
        && selector.trim() == selector
        && !selector.chars().any(char::is_control)
}

/// The registry's own body for a validated `question.agent`: the selector resolved to the
/// identity the owner's directory knows (`COLAB_IDENTITY_UNKNOWN` / `COLAB_IDENTITY_UNVERIFIED`
/// otherwise), never a label the browser sent.
fn resolve_question_agent(body: &Value) -> crate::Result<Value> {
    resolve_question_agent_with(body, crate::core::identity_lookup)
}
fn resolve_question_agent_with(
    body: &Value,
    lookup: impl Fn(&str) -> crate::core::IdentityLookup,
) -> crate::Result<Value> {
    let mut resolved = serde_json::json!({"id": body["id"]});
    if let Some(selector) = body.get("selector").and_then(Value::as_str) {
        resolved["agent"] =
            crate::edit_request::metadata::resolve_selection(lookup(selector))?["agent"].clone();
    }
    Ok(resolved)
}

pub fn prepare(
    open: &SourceOpener,
    edit: &MetadataEdit,
    clock: &dyn Fn() -> crate::Result<u64>,
) -> crate::Result<Prepared> {
    let kind = validate(&edit.action, &edit.body)?;
    let body = if edit.action == "question.agent" {
        resolve_question_agent(&edit.body)?
    } else {
        edit.body.clone()
    };
    let mut source = open()?;
    let prepared = super::prepare_structured_publication(
        &source.store,
        &source.keyring,
        &edit.page,
        StructuredAction {
            kind,
            action: &edit.action,
            body: &body,
            expected_revision: Some(&edit.expected_revision),
            display_agent: None,
            operation_id: Some(&edit.operation_id),
        },
        &mut source.decoder,
        clock,
    )?;
    super::save::structured(&source, &edit.page, &edit.operation_id, prepared)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn browser_metadata_is_closed_and_cannot_register_or_forge_attribution() {
        let id = "10000000-0000-4000-8000-000000000001";
        for action in ["question.handle", "question.reopen"] {
            assert!(validate(action, &json!({"id":id})).is_ok());
            for body in [
                json!({"id":id,"task":"T-1"}),
                json!({"id":"bad"}),
                json!({"id":id,"attribution":{}}),
            ] {
                assert!(validate(action, &body).is_err());
            }
        }
        let body = json!({"agent":{"id":id,"name":"A creator"}});
        assert!(validate("creator.set", &body).is_ok());
        assert!(
            validate(
                "creator.set",
                &json!({"agent":body["agent"],"machineId":id})
            )
            .is_err()
        );
        for action in [
            "question.add",
            "task.add",
            "creator.clear",
            "question.answered",
        ] {
            assert!(validate(action, &body).is_err());
        }
    }

    #[test]
    fn question_agent_names_a_recipient_by_selector_and_never_carries_a_label() {
        let id = "10000000-0000-4000-8000-000000000001";
        let agent = "30000000-0000-4000-8000-000000000001";
        for body in [
            json!({"id":id}),
            json!({"id":id,"selector":"reviewer"}),
            json!({"id":id,"selector":agent}),
        ] {
            assert!(validate("question.agent", &body).is_ok(), "{body}");
        }
        for body in [
            json!({"selector":"reviewer"}),
            json!({"id":"bad","selector":"reviewer"}),
            json!({"id":id,"selector":""}),
            json!({"id":id,"selector":" reviewer"}),
            json!({"id":id,"selector":"a\nb"}),
            json!({"id":id,"selector":"x".repeat(257)}),
            json!({"id":id,"selector":7}),
            json!({"id":id,"selector":null}),
            // The browser never sends a label or a registration.
            json!({"id":id,"agent":{"id":agent,"name":"A creator"}}),
            json!({"id":id,"selector":"reviewer","title":"New"}),
            json!({"id":id,"selector":"reviewer","group":id}),
        ] {
            assert!(validate("question.agent", &body).is_err(), "{body}");
        }
    }

    #[test]
    fn the_serve_resolves_the_selector_and_only_the_resolved_identity_enters_the_body() {
        use crate::core::{CallerSnapshot, IdentityLookup};
        let id = "10000000-0000-4000-8000-000000000001";
        let agent = "30000000-0000-4000-8000-000000000001";
        let found = |_: &str| {
            IdentityLookup::Found(CallerSnapshot {
                agent_id: Some(agent.into()),
                name: "reviewer".into(),
            })
        };
        assert_eq!(
            resolve_question_agent_with(&json!({"id":id,"selector":"rev"}), found).unwrap(),
            json!({"id":id,"agent":{"id":agent,"name":"reviewer"}})
        );
        // No selector follows the page's creator again, with no lookup at all.
        assert_eq!(
            resolve_question_agent_with(&json!({"id":id}), |_| unreachable!("no lookup")).unwrap(),
            json!({"id":id})
        );
        for (lookup, code) in [
            (IdentityLookup::NotFound, "COLAB_IDENTITY_UNKNOWN"),
            (IdentityLookup::Unavailable, "COLAB_IDENTITY_UNVERIFIED"),
            (
                // A reply that names no ID binds nothing.
                IdentityLookup::Found(CallerSnapshot {
                    agent_id: None,
                    name: "reviewer".into(),
                }),
                "COLAB_IDENTITY_UNVERIFIED",
            ),
        ] {
            let lookup = std::cell::Cell::new(Some(lookup));
            let error = resolve_question_agent_with(&json!({"id":id,"selector":"rev"}), |_| {
                lookup.take().unwrap()
            })
            .unwrap_err();
            let refused = error
                .downcast_ref::<crate::edit_request::metadata::IdentityRefused>()
                .expect("an identity refusal");
            assert_eq!(refused.0, code);
        }
    }
}
