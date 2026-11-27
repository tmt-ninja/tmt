//! Explicit publication of Ops' lead union through Core's preview/consent/CAS port.
use super::Outcome;
use crate::{
    consent::{self, Consent},
    core::{Core, SquadError},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Preview(Value);

fn invalid(message: &str) -> SquadError {
    SquadError::new("SQUAD_LEADS_PREVIEW_INVALID", message)
}

impl Preview {
    pub fn from_document(value: &Value) -> Result<Self, SquadError> {
        let raw = &value["preview"];
        if value["status"] != "preview"
            || raw["schemaVersion"] != 1
            || raw["requiresConsent"] != true
            || raw["mutation"]["kind"] != "leads.set"
            || raw["mutation"]["identityIds"].as_array().is_none()
            || raw["configurationRevision"].as_u64().is_none()
            || raw["previewAtMs"].as_u64().is_none()
            || raw["previewDigest"].as_str().is_none_or(str::is_empty)
            || value["before"].as_array().is_none()
            || value["after"].as_array().is_none()
        {
            return Err(invalid(
                "Core did not return a complete leads preview; reopen to try again.",
            ));
        }
        Ok(Self(value.clone()))
    }
    pub fn document(&self) -> Value {
        self.0.clone()
    }
    pub fn text(&self) -> String {
        let before = self.0["before"].as_array().expect("validated preview");
        let after = self.0["after"].as_array().expect("validated preview");
        let contains = |rows: &[Value], id: &Value| rows.iter().any(|row| row["identityId"] == *id);
        let label = |row: &Value| match row["name"].as_str() {
            Some(name) => format!("{name} · {}", row["identityId"].as_str().unwrap_or("?")),
            None => format!("{} · retired", row["identityId"].as_str().unwrap_or("?")),
        };
        let mut lines = vec![
            "Squad changed. Core leads not updated yet.".into(),
            "Replace Core's global leads with all active Ops squad leads.".into(),
            "Core-only leads below will be removed. Declining keeps the squad change.".into(),
            format!(
                "Core revision {} · {} removed · {} added",
                self.0["preview"]["configurationRevision"],
                before
                    .iter()
                    .filter(|row| !contains(after, &row["identityId"]))
                    .count(),
                after
                    .iter()
                    .filter(|row| !contains(before, &row["identityId"]))
                    .count()
            ),
        ];
        for row in before
            .iter()
            .filter(|row| !contains(after, &row["identityId"]))
        {
            lines.push(format!("Remove: {}", label(row)));
        }
        for row in after {
            lines.push(format!(
                "{}: {}",
                if contains(before, &row["identityId"]) {
                    "Keep"
                } else {
                    "Add"
                },
                label(row)
            ));
        }
        if after.is_empty() {
            lines.push("No Ops leads: Core's leads list will be empty.".into());
        }
        lines.join("\n")
    }
    fn apply_input(&self) -> Value {
        let raw = &self.0["preview"];
        json!({"phase":"apply", "mutation":raw["mutation"],
            "expectedConfigurationRevision":raw["configurationRevision"],
            "previewAtMs":raw["previewAtMs"], "previewDigest":raw["previewDigest"], "consent":true})
    }
    fn apply_with(
        &self,
        api: impl FnOnce(&str, Value) -> Result<Value, SquadError>,
    ) -> Result<Value, SquadError> {
        let result = api("orchestration.write", self.apply_input())?;
        if result["schemaVersion"] != 1
            || result["requiresConsent"] != false
            || result["configurationRevision"].as_u64().is_none()
            || result["changed"].as_bool().is_none()
            || result["preview"] != self.0["preview"]
        {
            return Err(invalid(
                "Core's leads update was not confirmed; inspect its revision before another attempt.",
            ));
        }
        let mut publication = self.document();
        publication["status"] = json!("applied");
        publication["result"] = result;
        Ok(publication)
    }
}

fn prepare(core: &Core) -> Result<Preview, SquadError> {
    // Publication needs a complete replacement inventory. Keep this stricter admission
    // local: ordinary board/CLI readers deliberately tolerate incomplete optional fields.
    let listed = core.json(&["room", "list"])?;
    let rooms = listed["rooms"]
        .as_array()
        .ok_or_else(|| invalid("Core returned no squad room inventory."))?;
    let mut leads = BTreeMap::new();
    for room in rooms {
        let name = room["name"]
            .as_str()
            .ok_or_else(|| invalid("Core returned an incomplete room inventory."))?;
        let Some(name) = name
            .strip_prefix("squad-")
            .filter(|name| crate::squad::valid_name(name))
        else {
            continue;
        };
        let id = room["id"]
            .as_str()
            .ok_or_else(|| invalid("Core returned no squad room ID."))?;
        let prefix = format!("squad.{name}.");
        let roster = core.api("rooms.roster", json!({"room":id,"metadataPrefix":prefix}))?;
        let members = roster["members"]
            .as_array()
            .ok_or_else(|| invalid("Core returned no squad members."))?;
        for member in members {
            let id = member["id"]
                .as_str()
                .ok_or_else(|| invalid("Core returned no member ID."))?;
            let name = member["name"]
                .as_str()
                .ok_or_else(|| invalid("Core returned no member name."))?;
            let metadata = member["metadata"]
                .as_object()
                .ok_or_else(|| invalid("Core returned incomplete member metadata."))?;
            let mut fields = BTreeMap::new();
            for (key, value) in metadata {
                let value = value
                    .as_str()
                    .ok_or_else(|| invalid("Core returned invalid member metadata."))?;
                if let Some(field) = key.strip_prefix(&prefix) {
                    fields.insert(field.to_owned(), value.to_owned());
                }
            }
            let marker = fields
                .remove(crate::squad::LEAD_MARKER)
                .map(|marker| marker == "true");
            if crate::squad::lead_from_fields(&fields, marker) {
                leads.insert(id.to_owned(), name.to_owned());
                if leads.len() > 256 {
                    return Err(SquadError::new(
                        "SQUAD_LEADS_LIMIT",
                        "Core accepts at most 256 distinct leads; nothing was published.",
                    ));
                }
            }
        }
    }
    // Never let unknown caller evidence become an unattributed person for this write.
    let actor = match core.json(&["whoami"]) {
        Ok(shown) if shown["bound"] == false => None,
        Ok(shown) if shown["bound"] == true && shown["name"].is_string() => Some(
            shown["id"]
                .as_str()
                .ok_or_else(|| invalid("Core returned no caller identity."))?
                .to_owned(),
        ),
        Ok(_) => return Err(invalid("Core returned incomplete caller attribution.")),
        Err(error) if error.code == "PANE_NOT_FOUND" => None,
        Err(error) => return Err(error),
    };
    let mut mutation = json!({"kind":"leads.set","identityIds":leads.keys().collect::<Vec<_>>()});
    if let Some(actor) = actor {
        mutation["actorId"] = json!(actor);
    }
    prepare_intent(
        core,
        mutation,
        leads
            .into_iter()
            .map(|(id, name)| json!({"identityId":id,"name":name}))
            .collect(),
    )
}

fn same_intent(left: &Value, right: &Value) -> bool {
    let ids = |value: &Value| {
        let mut ids = value["identityIds"]
            .as_array()?
            .iter()
            .map(Value::as_str)
            .collect::<Option<Vec<_>>>()?;
        ids.sort_unstable();
        Some(ids.into_iter().map(str::to_owned).collect::<Vec<_>>())
    };
    left["kind"] == "leads.set"
        && right["kind"] == "leads.set"
        && left.get("actorId") == right.get("actorId")
        && ids(left).is_some_and(|left_ids| Some(left_ids) == ids(right))
}

fn prepare_intent(core: &Core, mutation: Value, after: Vec<Value>) -> Result<Preview, SquadError> {
    // Core's write preview has effective policies, not its explicit lead list.
    // The talks view supplies that list at the same configuration revision.
    let current = core.api("orchestration.read", json!({"view":"talks","limit":1}))?;
    let before = current["leads"]
        .as_array()
        .ok_or_else(|| invalid("Core did not return its current leads; nothing was published."))?;
    if before.len() > 256
        || before.iter().any(|row| {
            row["identityId"].as_str().is_none()
                || row["retired"].as_bool().is_none()
                || !(row["name"].is_null() || row["name"].is_string())
        })
    {
        return Err(invalid(
            "Core returned an incomplete leads list; nothing was published.",
        ));
    }
    let preview = core.api(
        "orchestration.write",
        json!({"phase":"preview","mutation":mutation}),
    )?;
    if !same_intent(&preview["mutation"], &mutation) {
        return Err(invalid(
            "Core returned a different leads intent; nothing was published.",
        ));
    }
    if current["configurationRevision"].as_u64().is_none()
        || current["configurationRevision"] != preview["configurationRevision"]
    {
        return Err(SquadError::new(
            "SQUAD_LEADS_PREVIEW_CHANGED",
            "Core's configuration changed while preparing the preview; reopen it. Nothing was published.",
        ));
    }
    Preview::from_document(
        &json!({"status":"preview","preview":preview,"before":before,
        "after":after}),
    )
}

pub(crate) fn failure(error: &SquadError) -> Value {
    json!({"status":"failed","error":{"code":error.code,"message":error.message}})
}

pub(crate) fn message(publication: &Value) -> Option<String> {
    match publication["status"].as_str()? {
        "failed" => Some(format!(
            "Squad changed. Core leads not updated: {}",
            publication["error"]["message"]
                .as_str()
                .unwrap_or("The outcome was not confirmed.")
        )),
        "declined" => Some("Squad changed. Core leads not updated; publication declined.".into()),
        "applied" => Some("Squad changed. Core leads updated.".into()),
        _ => None,
    }
}

/// Called only after a successful lead change, on the existing action lane.
pub(crate) fn offer(core: &Core, mut outcome: Outcome) -> Outcome {
    if !outcome.complete {
        return outcome;
    }
    match prepare(core) {
        Ok(preview) => outcome.document["coreLeads"] = preview.document(),
        Err(error) => {
            outcome.document["coreLeads"] = failure(&error);
            outcome.complete = false;
        }
    }
    outcome
}

/// Refresh only the reviewed replacement intent, never repeat the squad mutation or apply.
pub(crate) fn refresh(core: &Core, preview: &Preview) -> Outcome {
    match prepare_intent(
        core,
        preview.0["preview"]["mutation"].clone(),
        preview.0["after"].as_array().unwrap().clone(),
    ) {
        Ok(preview) => json!({"coreLeads":preview.document()}).into(),
        Err(error) => Outcome {
            document: json!({"coreLeads":failure(&error)}),
            complete: false,
        },
    }
}

pub(crate) fn apply(core: &Core, preview: &Preview) -> Outcome {
    match preview.apply_with(|operation, input| core.api(operation, input)) {
        Ok(result) => json!({"coreLeads":result}).into(),
        Err(error) => Outcome {
            document: json!({"coreLeads":failure(&error)}),
            complete: false,
        },
    }
}

pub(crate) fn command(core: &Core, outcome: Outcome, consent: Consent) -> Outcome {
    let squad_complete = outcome.complete;
    let mut outcome = offer(core, outcome);
    if !squad_complete {
        return outcome;
    }
    if let Ok(preview) = Preview::from_document(&outcome.document["coreLeads"])
        && consent != Consent::Unavailable
    {
        if consent::ask(consent, &preview.text(), "Publish squad leads to Core?").is_err() {
            outcome.document["coreLeads"] = json!({"status":"declined"});
        } else {
            let applied = apply(core, &preview);
            outcome.document["coreLeads"] = applied.document["coreLeads"].clone();
            outcome.complete = applied.complete;
        }
    }
    // Without --yes this command reports the completed squad mutation; publication
    // remains a separate offer/result, never a failure of the successful squad change.
    if consent != Consent::Given {
        outcome.complete = true;
    }
    let publication = &mut outcome.document["coreLeads"];
    if let Some(message) = message(publication) {
        publication["message"] = json!(message);
    } else if publication["status"] == "preview" {
        publication["message"] = json!("Squad changed. Core leads not updated yet.");
    }
    outcome
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{Scratch, write_ready_executable};
    use std::fs;
    const ONE: &str = "22222222-2222-4222-8222-222222222222";
    const TWO: &str = "44444444-4444-4444-8444-444444444444";
    const EXTERNAL: &str = "55555555-5555-4555-8555-555555555555";
    struct Fixture {
        core: Core,
        root: Scratch,
    }
    impl Fixture {
        fn new() -> Self {
            let root = Scratch::new("publish-leads");
            let executable = root.join("core");
            for (file, value) in [
                (
                    "rooms",
                    json!({"rooms":[{"id":"a","name":"squad-a"},{"id":"b","name":"squad-b"}]}),
                ),
                (
                    "a",
                    json!({"members":[{"id":ONE,"name":"one","lifetime":"saved","metadata":{"squad.a.lead.marker":"true"}}]}),
                ),
                (
                    "b",
                    json!({"members":[{"id":ONE,"name":"one","lifetime":"saved","metadata":{"squad.b.lead.marker":"true"}},{"id":TWO,"name":"two","lifetime":"saved","metadata":{"squad.b.role":"lead"}}]}),
                ),
                ("caller", json!({"bound":false})),
                (
                    "current",
                    json!({"configurationRevision":7,"leads":[{"identityId":EXTERNAL,"name":"external","retired":false}]}),
                ),
                (
                    "preview",
                    json!({"schemaVersion":1,"configurationRevision":7,"previewAtMs":1791600000000_u64,
                    "timeZone":"Asia/Tokyo","mutation":{"kind":"leads.set","identityIds":[ONE,TWO]},
                    "before":{},"after":{},"changes":[],"validUntilMs":null,"requiresConsent":true,"previewDigest":"digest"}),
                ),
            ] {
                fs::write(root.join(file), value.to_string()).unwrap();
            }
            write_ready_executable(
                &executable,
                r#"#!/bin/sh
root=${0%/*}
respond() {
  value=$(cat "$root/$1")
  printf '%s\n' "$value"
  case "$value" in *'"error"'*) return 1 ;; esac
}
case "$1" in
  whoami) respond caller; exit $? ;;
  room) respond rooms; exit $? ;;
  api)
    input=$(cat)
    printf '%s\n' "$input" >> "$root/calls"
    case "$input" in
      *'"operation":"rooms.roster"'*)
        case "$input" in *'"room":"a"'*) respond a ;; *) respond b ;; esac ;;
      *'"operation":"orchestration.read"'*) respond current ;;
      *'"phase":"preview"'*) respond preview ;;
      *) printf '%s\n' '{"error":{"code":"ORCH_CONFLICT","message":"Core configuration changed; preview again."}}'; exit 1 ;;
    esac ;;
  *) exit 2 ;;
esac
"#,
            );
            Self {
                core: Core::at(executable),
                root,
            }
        }
        fn calls(&self) -> Vec<Value> {
            fs::read_to_string(self.root.join("calls"))
                .unwrap_or_default()
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect()
        }
        fn outcome(&self) -> Outcome {
            json!({"squad":"a","lead":{"id":ONE,"name":"one"}}).into()
        }
        fn put(&self, file: &str, value: Value) {
            fs::write(self.root.join(file), value.to_string()).unwrap();
        }
    }
    #[test]
    fn publication_uses_all_squads_deduplicates_and_shows_core_only_removals() {
        let f = Fixture::new();
        let preview = prepare(&f.core).unwrap();
        assert_eq!(preview.0["after"].as_array().unwrap().len(), 2);
        let calls = f.calls();
        let write = calls
            .iter()
            .find(|call| call["operation"] == "orchestration.write")
            .unwrap();
        assert_eq!(
            write["input"],
            json!({"phase":"preview","mutation":{"kind":"leads.set","identityIds":[ONE,TWO]}})
        );
        assert!(preview.text().contains("Remove: external"));
        assert!(preview.text().contains("Add: one"));
    }
    #[test]
    fn publication_without_consent_never_applies_and_keeps_the_squad_result() {
        let f = Fixture::new();
        let outcome = command(&f.core, f.outcome(), Consent::Unavailable);
        assert!(outcome.complete);
        assert_eq!(outcome.document["lead"]["id"], ONE);
        assert_eq!(outcome.document["coreLeads"]["status"], "preview");
        assert!(
            f.calls()
                .iter()
                .all(|call| call["input"]["phase"] != "apply")
        );
    }
    #[test]
    fn publication_yes_applies_once_and_reports_core_conflict_without_rollback() {
        let f = Fixture::new();
        let outcome = command(&f.core, f.outcome(), Consent::Given);
        assert!(!outcome.complete);
        assert_eq!(outcome.document["lead"]["id"], ONE);
        assert_eq!(
            outcome.document["coreLeads"]["error"]["code"],
            "ORCH_CONFLICT"
        );
        assert_eq!(
            f.calls()
                .iter()
                .filter(|call| call["input"]["phase"] == "apply")
                .count(),
            1
        );
        assert_eq!(
            message(&outcome.document["coreLeads"]).unwrap(),
            "Squad changed. Core leads not updated: Core configuration changed; preview again."
        );
    }
    #[test]
    fn publication_apply_copies_the_normalized_preview_and_does_no_extra_reads() {
        let f = Fixture::new();
        let preview = prepare(&f.core).unwrap();
        let raw = preview.0["preview"].clone();
        let applied=preview.apply_with(|operation,input| {
            assert_eq!(operation,"orchestration.write");
            assert_eq!(input,json!({"phase":"apply","mutation":raw["mutation"],"expectedConfigurationRevision":7,"previewAtMs":1791600000000_u64,"previewDigest":"digest","consent":true}));
            Ok(json!({"schemaVersion":1,"configurationRevision":8,"changed":true,"requiresConsent":false,"preview":raw}))
        }).unwrap();
        assert_eq!(applied["status"], "applied");
    }
    #[test]
    fn publication_preserves_the_real_caller_and_core_permission_refusal() {
        let f = Fixture::new();
        f.put(
            "caller",
            json!({"bound":true,"id":ONE,"name":"one","lifetime":"saved"}),
        );
        f.put("preview",json!({"error":{"code":"ORCH_NOT_PERMITTED","message":"Only a person or a current lead may change leads."}}));
        let outcome = offer(&f.core, f.outcome());
        assert!(!outcome.complete);
        assert_eq!(
            outcome.document["coreLeads"]["error"]["code"],
            "ORCH_NOT_PERMITTED"
        );
        assert!(
            f.calls()
                .iter()
                .any(|call| call["input"]["mutation"]["actorId"] == ONE)
        );
        assert!(
            f.calls()
                .iter()
                .all(|call| call["input"]["phase"] != "apply")
        );
    }
    #[test]
    fn publication_refuses_incomplete_inventory_and_rosters_instead_of_clearing_core() {
        for (file, value) in [
            ("rooms", json!({})),
            ("a", json!({})),
            (
                "a",
                json!({"members":[{"id":ONE,"name":"one","lifetime":"saved"}]}),
            ),
        ] {
            let f = Fixture::new();
            f.put(file, value);
            let outcome = offer(&f.core, f.outcome());
            assert!(!outcome.complete);
            assert_eq!(outcome.document["coreLeads"]["status"], "failed");
            assert!(
                f.calls()
                    .iter()
                    .all(|call| call["operation"] != "orchestration.write")
            );
        }
    }
    #[test]
    fn publication_refuses_over_256_distinct_leads_without_truncating() {
        let f = Fixture::new();
        let members:Vec<_>=(0..257).map(|i|json!({"id":format!("{i:08x}-1111-4111-8111-111111111111"),"name":format!("lead-{i}"),"lifetime":"saved","metadata":{"squad.a.lead.marker":"true"}})).collect();
        f.put("a", json!({"members":members}));
        let error = prepare(&f.core).unwrap_err();
        assert_eq!(error.code, "SQUAD_LEADS_LIMIT");
        assert!(
            f.calls()
                .iter()
                .all(|call| call["operation"] != "orchestration.write")
        );
    }
    #[test]
    fn publication_does_not_offer_after_a_partial_squad_change() {
        let f = Fixture::new();
        let original = Outcome {
            document: json!({"failed":{"stage":"lead"}}),
            complete: false,
        };
        assert_eq!(offer(&f.core, original.clone()), original);
        assert!(f.calls().is_empty());
    }
    #[test]
    fn publication_rejects_a_mismatched_configuration_snapshot_without_retrying() {
        let f = Fixture::new();
        f.put("current", json!({"configurationRevision":6,"leads":[]}));
        let outcome = offer(&f.core, f.outcome());
        assert!(!outcome.complete);
        assert_eq!(
            outcome.document["coreLeads"]["error"]["code"],
            "SQUAD_LEADS_PREVIEW_CHANGED"
        );
        assert_eq!(
            f.calls()
                .iter()
                .filter(|call| call["operation"] == "orchestration.write")
                .count(),
            1
        );
    }
    #[test]
    fn publication_can_clear_the_authoritative_union_without_preserving_core_only_entries() {
        let f = Fixture::new();
        f.put("a", json!({"members":[]}));
        f.put("b", json!({"members":[]}));
        let mut raw: Value =
            serde_json::from_str(&fs::read_to_string(f.root.join("preview")).unwrap()).unwrap();
        raw["mutation"]["identityIds"] = json!([]);
        f.put("preview", raw);
        let preview = prepare(&f.core).unwrap();
        assert_eq!(preview.0["after"], json!([]));
        assert!(preview.text().contains("Remove: external"));
        assert!(preview.text().contains("will be empty"));
    }
    #[test]
    fn publication_never_turns_an_ambiguous_caller_into_an_unattributed_person() {
        let f = Fixture::new();
        f.put(
            "caller",
            json!({"error":{"code":"CALLER_IDENTITY_AMBIGUOUS","message":"Caller is ambiguous."}}),
        );
        let outcome = offer(&f.core, f.outcome());
        assert!(!outcome.complete);
        assert_eq!(
            outcome.document["coreLeads"]["error"]["code"],
            "CALLER_IDENTITY_AMBIGUOUS"
        );
        assert!(
            f.calls()
                .iter()
                .all(|call| call["operation"] != "orchestration.write")
        );
    }
    #[test]
    fn publication_reports_an_older_core_refusal_without_fallback_or_a_write() {
        let f = Fixture::new();
        f.put(
            "current",
            json!({"error":{"code":"ORCH_INPUT_INVALID","message":"Unknown orchestration view."}}),
        );
        let outcome = offer(&f.core, f.outcome());
        assert!(!outcome.complete);
        assert_eq!(
            outcome.document["coreLeads"]["error"]["message"],
            "Unknown orchestration view."
        );
        assert!(
            f.calls()
                .iter()
                .all(|call| call["operation"] != "orchestration.write")
        );
    }
    #[test]
    fn publication_never_promotes_malformed_caller_attribution_to_a_person() {
        let f = Fixture::new();
        f.put("caller", json!({}));
        let outcome = offer(&f.core, f.outcome());
        assert!(
            !outcome.complete,
            "unknown caller evidence must not become a person"
        );
        assert_eq!(outcome.document["coreLeads"]["status"], "failed");
        assert!(
            f.calls()
                .iter()
                .all(|call| call["operation"] != "orchestration.write")
        );
    }
    #[test]
    fn publication_summary_names_removed_and_added_counts() {
        let fixture = Fixture::new();
        let text = prepare(&fixture.core).unwrap().text();
        assert!(
            text.contains("Core revision 7 · 1 removed · 2 added"),
            "{text}"
        );
    }
    #[test]
    fn publication_refresh_uses_the_frozen_intent_and_never_applies() {
        let f = Fixture::new();
        let preview = prepare(&f.core).unwrap();
        let calls = f.calls().len();
        f.put("rooms", json!({"rooms":[]}));
        f.put("current", json!({"configurationRevision":8,"leads":[]}));
        let mut raw = preview.0["preview"].clone();
        raw["configurationRevision"] = json!(8);
        raw["previewDigest"] = json!("fresh");
        f.put("preview", raw);
        let outcome = refresh(&f.core, &preview);
        assert!(outcome.complete);
        let fresh = Preview::from_document(&outcome.document["coreLeads"]).unwrap();
        assert_eq!(fresh.0["preview"]["configurationRevision"], 8);
        assert_eq!(
            fresh.0["preview"]["mutation"],
            preview.0["preview"]["mutation"]
        );
        assert_eq!(fresh.0["after"], preview.0["after"]);
        assert!(
            f.calls()[calls..]
                .iter()
                .all(|call| call["input"]["phase"] != "apply")
        );
    }
    #[test]
    fn publication_strictness_does_not_change_shared_readers() {
        let f = Fixture::new();
        f.put("rooms", json!({"rooms":[{}]}));
        assert!(crate::squad::Squad::list(&f.core).unwrap().is_empty());
        assert!(prepare(&f.core).is_err());
        let f = Fixture::new();
        f.put("a", json!({"members":[{"id":ONE,"name":"one","lifetime":"saved","metadata":{"squad.a.role":"lead","odd":1}}]}));
        assert_eq!(
            crate::squad::Squad {
                name: "a".into(),
                room_id: "a".into()
            }
            .roster(&f.core)
            .unwrap()
            .len(),
            1
        );
        assert!(prepare(&f.core).is_err());
        let f = Fixture::new();
        f.put("caller", json!({}));
        assert!(crate::me::caller(&f.core).unwrap().is_none());
        assert!(prepare(&f.core).is_err());
    }

    #[test]
    fn publication_admits_core_id_order_and_additive_mutation_fields() {
        let f = Fixture::new();
        let mut raw: Value =
            serde_json::from_str(&fs::read_to_string(f.root.join("preview")).unwrap()).unwrap();
        raw["mutation"]["identityIds"] = json!([TWO, ONE]);
        raw["mutation"]["additive"] = json!(true);
        f.put("preview", raw.clone());
        let preview = prepare(&f.core).unwrap();
        assert_eq!(
            preview.apply_input()["mutation"],
            raw["mutation"],
            "apply retains Core's normalized mutation"
        );
        assert!(!same_intent(
            &json!({"kind":"leads.set","identityIds":[ONE],"actorId":ONE}),
            &json!({"kind":"leads.set","identityIds":[ONE],"actorId":TWO})
        ));
        assert!(!same_intent(
            &json!({"kind":"leads.set","identityIds":[ONE]}),
            &json!({"kind":"leads.set","identityIds":[TWO]})
        ));
        assert!(!same_intent(
            &json!({"kind":"leads.set","identityIds":[1]}),
            &json!({"kind":"leads.set","identityIds":[1]})
        ));
    }
    #[test]
    fn publication_offer_failure_keeps_the_successful_command_exit_without_yes() {
        for consent in [Consent::Unavailable, Consent::Given] {
            let f = Fixture::new();
            f.put("caller",json!({"error":{"code":"ORCH_NOT_PERMITTED","message":"Only current leads may publish."}}));
            let outcome = command(&f.core, f.outcome(), consent);
            assert_eq!(outcome.complete, consent != Consent::Given);
            assert_eq!(outcome.document["lead"]["id"], ONE);
            assert_eq!(outcome.document["coreLeads"]["status"], "failed");
            assert!(
                outcome.document["coreLeads"]["message"]
                    .as_str()
                    .unwrap()
                    .contains("Squad changed. Core leads not updated")
            );
            assert!(
                f.calls()
                    .iter()
                    .all(|call| call["input"]["phase"] != "apply")
            );
        }
        let f = Fixture::new();
        let original = Outcome {
            document: json!({"failed":{"stage":"lead"}}),
            complete: false,
        };
        assert!(!command(&f.core, original, Consent::Unavailable).complete);
        assert!(f.calls().is_empty());
    }
}
