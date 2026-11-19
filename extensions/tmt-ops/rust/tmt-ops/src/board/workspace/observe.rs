//! Projection of already acquired roster rows and global identities. No second
//! Core read or authoritative membership store belongs to this module.
use super::*;
use crate::{
    action::Bindings,
    config::{Config, OpsKeyScope},
    core::SquadError,
};
use crate::{squad::Squad, tab_view::Acquired};
use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum BindingContext {
    Global,
    Host(String),
    Section(OpsTarget),
}
type BindingSources = BTreeMap<String, String>;

/// The bounded, read-only projection of Core's open provider forms.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderForm {
    pub form_id: String,
    pub identity_id: String,
    pub opened_ms: u64,
    pub kind: String,
    pub questions: Vec<ProviderQuestion>,
    pub tool: Option<ProviderTool>,
    pub plan: Option<String>,
    pub truncated: bool,
    pub answerable: bool,
    pub answer_in: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderQuestion {
    pub text: String,
    pub header: Option<String>,
    pub choice: String,
    pub options: Vec<ProviderOption>,
    pub free_text: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderOption {
    pub label: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProviderTool {
    pub name: String,
    pub summary: String,
}

impl ProviderForm {
    fn valid(&self) -> bool {
        let text = |value: &str, limit| value.len() <= limit;
        crate::config::uuid_like(&self.form_id)
            && crate::config::uuid_like(&self.identity_id)
            && matches!(
                self.kind.as_str(),
                "question" | "permission" | "planApproval"
            )
            && matches!(self.answer_in.as_str(), "client" | "terminal")
            && self.answerable == (self.answer_in == "client")
            && self.questions.len() <= 4
            && self.questions.iter().all(|question| {
                text(&question.text, 2048)
                    && question
                        .header
                        .as_deref()
                        .is_none_or(|header| text(header, 256))
                    && matches!(question.choice.as_str(), "single" | "multiple")
                    && question.options.len() <= 8
                    && question.options.iter().all(|option| {
                        text(&option.label, 256)
                            && option
                                .description
                                .as_deref()
                                .is_none_or(|description| text(description, 2048))
                    })
            })
            && self
                .tool
                .as_ref()
                .is_none_or(|tool| text(&tool.name, 256) && text(&tool.summary, 2048))
            && self
                .plan
                .as_deref()
                .is_none_or(|plan| text(plan, 64 * 1024))
    }

    pub(crate) fn summary(&self) -> String {
        match self.kind.as_str() {
            "question" => self.questions.first().map_or_else(
                || "Question".into(),
                |q| {
                    let options = q
                        .options
                        .iter()
                        .map(|option| option.label.as_str())
                        .collect::<Vec<_>>()
                        .join(" / ");
                    if options.is_empty() {
                        q.text.clone()
                    } else {
                        format!("{} · {options}", q.text)
                    }
                },
            ),
            "permission" => self
                .tool
                .as_ref()
                .map_or_else(|| "Permission".into(), |tool| tool.summary.clone()),
            _ => self.plan.clone().unwrap_or_else(|| "Plan approval".into()),
        }
    }
}

pub(crate) fn provider_forms(value: &Value) -> Option<Vec<ProviderForm>> {
    let rows = value.get("forms")?.as_array()?;
    if rows.len() > 1024 {
        return None;
    }
    fn optional_text(value: &Value, key: &str) -> Option<Option<String>> {
        match value.get(key) {
            None | Some(Value::Null) => Some(None),
            Some(value) => Some(Some(value.as_str()?.to_owned())),
        }
    }
    let mut forms = Vec::with_capacity(rows.len());
    for row in rows {
        let questions = match row.get("questions") {
            None => Vec::new(),
            Some(value) => value
                .as_array()?
                .iter()
                .map(|question| {
                    let options = question
                        .get("options")?
                        .as_array()?
                        .iter()
                        .map(|option| {
                            Some(ProviderOption {
                                label: option.get("label")?.as_str()?.to_owned(),
                                description: optional_text(option, "description")?,
                            })
                        })
                        .collect::<Option<Vec<_>>>()?;
                    Some(ProviderQuestion {
                        text: question.get("text")?.as_str()?.to_owned(),
                        header: optional_text(question, "header")?,
                        choice: question.get("choice")?.as_str()?.to_owned(),
                        options,
                        free_text: question.get("freeText")?.as_bool()?,
                    })
                })
                .collect::<Option<Vec<_>>>()?,
        };
        let tool = match row.get("tool") {
            None | Some(Value::Null) => None,
            Some(tool) => Some(ProviderTool {
                name: tool.get("name")?.as_str()?.to_owned(),
                summary: tool.get("summary")?.as_str()?.to_owned(),
            }),
        };
        forms.push(ProviderForm {
            form_id: row.get("formId")?.as_str()?.to_owned(),
            identity_id: row.get("identityId")?.as_str()?.to_owned(),
            opened_ms: row.get("openedMs")?.as_u64()?,
            kind: row.get("kind")?.as_str()?.to_owned(),
            questions,
            tool,
            plan: optional_text(row, "plan")?,
            truncated: row.get("truncated")?.as_bool()?,
            answerable: row.get("answerable")?.as_bool()?,
            answer_in: row.get("answerIn")?.as_str()?.to_owned(),
        });
    }
    if !forms.iter().all(ProviderForm::valid) {
        return None;
    }
    forms.sort_by_key(|form| form.opened_ms);
    let mut ids = std::collections::BTreeSet::new();
    forms
        .iter()
        .all(|form| ids.insert(&form.form_id))
        .then_some(forms)
}

#[derive(Debug, Default)]
pub(crate) struct OpsWorkspaceSnapshot {
    pub roster: OpsRoster,
    /// None is unavailable, distinct from a successful empty read.
    pub forms: Option<Vec<ProviderForm>>,
    pub forms_stale: bool,
    /// Immutable request identities, prepared with the roster rather than on clock/input turns.
    pub identity_ids: std::sync::Arc<[String]>,
    /// When the global core read behind `roster` returned. The board loader
    /// sets it; only hand-built test snapshots have none (no age limit).
    pub read_at: Option<std::time::Instant>,
    pub shell_counts: ShellCounts,
    pub hidden_count: usize,
    pub hidden_attention: ShellCounts,
    /// Exact admitted row projections used by the existing action/conversation
    /// adapters. Display models never reconstruct send data from visible text.
    pub rows: BTreeMap<OpsTarget, Value>,
    pub preferences: OpsPreferences,
    /// Reserve the member chip slot only when an assigned identity is in this roster.
    pub labels_present: bool,
    pub read_markers: crate::config::ReadMarkers,
    pub squad_looks: BTreeMap<String, crate::look::Look>,
    pub keys: BTreeMap<OpsKeyScope, Bindings>,
    pub hosts: BTreeMap<String, BTreeMap<OpsKeyScope, Bindings>>,
    pub sections: BTreeMap<OpsTarget, BTreeMap<OpsKeyScope, Bindings>>,
    pub config_path: String,
    pub binding_sources: BTreeMap<(OpsKeyScope, BindingContext), BindingSources>,
    pub notices: Vec<String>,
}

fn member(row: &Value) -> Option<OpsMember> {
    Some(OpsMember {
        id: row["id"].as_str()?.into(),
        name: row["name"].as_str()?.into(),
        state: row["state"].as_str().map(str::to_owned),
        waiting: crate::attention::waits_on_you(row),
        presence: match row["presence"].as_str() {
            Some("active") => Some(true),
            Some("offline") => Some(false),
            _ => None,
        },
        usage: None, // Source-provided formatted usage stays in the row projection.
        // Only the global core observation supplies activity (see `from_acquired`).
        activity: Default::default(),
    })
}

fn pool_row(row: &Value) -> Value {
    let mut projected = row.clone();
    if let Some(pane) = crate::squad::observed_pane(row) {
        projected["pane"] = pane;
    }
    projected
}

impl OpsWorkspaceSnapshot {
    /// When this snapshot's provider activity goes stale by read age; `None`
    /// when the roster read is not complete (stale now) or when it has no read
    /// time (only hand-built test snapshots, which never age).
    pub(crate) fn activity_deadline(
        &self,
        refresh: Option<std::time::Duration>,
    ) -> Option<std::time::Instant> {
        (self.roster.observation == OpsObservation::Complete)
            .then_some(self.read_at?)
            .map(|read| read + crate::board::activity::stale_after(refresh))
    }
    /// The one stale decision for STATE cells and counters: the roster read
    /// failed, or it is older than `activity::stale_after`. Never idle.
    pub(crate) fn activity_stale(
        &self,
        refresh: Option<std::time::Duration>,
        now: std::time::Instant,
    ) -> bool {
        self.roster.observation != OpsObservation::Complete
            || self
                .activity_deadline(refresh)
                .is_some_and(|deadline| now > deadline)
    }
    pub(crate) fn set_preferences(&mut self, preferences: OpsPreferences) {
        self.labels_present = preferences
            .labels
            .members
            .keys()
            .any(|id| self.roster.members.contains_key(id));
        self.hidden_count = self
            .roster
            .squads
            .iter()
            .filter(|squad| preferences.hidden.contains(&squad.room_id))
            .count();
        self.hidden_attention = self.roster.hidden_counts(&preferences.hidden);
        self.preferences = preferences;
    }

    pub(crate) fn configure(&mut self, config: &Config) -> Result<(), SquadError> {
        self.shell_counts = self.roster.shell_counts();
        self.set_preferences(config.workspace_preferences()?);
        self.read_markers = config.read_markers()?;
        self.config_path = config.path().display().to_string();
        for scope in OpsKeyScope::ALL {
            let keys = config.workspace_keys(scope, None, None)?;
            self.binding_sources
                .insert((scope, BindingContext::Global), keys.sources);
            self.keys.insert(scope, keys.bindings);
            self.notices.extend(keys.notices);
        }
        for host in config.host_bindings()?.into_keys() {
            let mut tables = BTreeMap::new();
            for scope in OpsKeyScope::ALL {
                let keys = config.workspace_keys(scope, Some(&host), None)?;
                self.binding_sources
                    .insert((scope, BindingContext::Host(host.clone())), keys.sources);
                tables.insert(scope, keys.bindings);
                self.notices.extend(keys.notices);
            }
            self.hosts.insert(host, tables);
        }
        for squad in &self.roster.squads {
            let (theme, notice) = config.theme(&squad.name)?;
            self.squad_looks
                .insert(squad.room_id.clone(), crate::look::Look::new(theme));
            if let Some(notice) = notice {
                self.notices.push(notice);
            }
            let sections = config.sections(&squad.name)?;
            for (target, row) in &self.rows {
                if !matches!(target, OpsTarget::Member {room_id: Some(id), ..} if id == &squad.room_id)
                {
                    continue;
                }
                if let Some((index, section)) = sections
                    .iter()
                    .enumerate()
                    .find(|(_, section)| section.includes(row))
                {
                    let host = row["pane"]["location"]["host"].as_str();
                    let mut tables = BTreeMap::new();
                    for scope in OpsKeyScope::ALL {
                        let mut keys = config.workspace_keys(scope, host, Some(&section.bind))?;
                        for (key, source) in &mut keys.sources {
                            if source == "selected squad section.bind" {
                                *source =
                                    format!("squad.{}.section[{index}].bind.{key}", squad.name);
                            }
                        }
                        self.binding_sources.insert(
                            (scope, BindingContext::Section(target.clone())),
                            keys.sources,
                        );
                        tables.insert(scope, keys.bindings);
                        self.notices.extend(keys.notices);
                    }
                    self.sections.insert(target.clone(), tables);
                }
            }
        }
        self.notices.sort();
        self.notices.dedup();
        Ok(())
    }
    pub(crate) fn from_acquired(
        squads: &[&Squad],
        acquired: &Acquired,
        listed: &Result<Value, crate::core::SquadError>,
    ) -> Self {
        let mut result = Self::default();
        result.rows.insert(
            OpsTarget::Pool,
            serde_json::json!({"name":"Common pool","kind":"pool"}),
        );
        let identities = listed
            .as_ref()
            .ok()
            .and_then(|value| value["identities"].as_array());
        result.roster.observation = if identities.is_some_and(|rows| {
            rows.iter()
                .all(|row| row["retired"] == true || member(row).is_some())
        }) {
            OpsObservation::Complete
        } else {
            OpsObservation::Unavailable
        };
        result.roster.membership_complete =
            acquired.documents.len() == squads.len() && acquired.failures.is_empty();
        if let Some(identities) = identities {
            for row in identities {
                if row["retired"] == true {
                    continue;
                }
                if let Some(mut identity) = member(row) {
                    identity.activity = crate::board::activity::ObservedActivity::of(row);
                    result.rows.insert(
                        OpsTarget::Member {
                            room_id: None,
                            identity_id: identity.id.clone(),
                        },
                        pool_row(row),
                    );
                    result.roster.members.insert(identity.id.clone(), identity);
                }
            }
        }
        for squad in squads {
            let document = acquired.documents.get(&squad.name);
            let room = acquired.rooms.get(&squad.name);
            let room_admitted = room.is_some_and(|room| {
                room["id"] == squad.room_id
                    && room["name"] == crate::squad::room_name(&squad.name)
                    && room["retired"] == false
                    && room["revision"]
                        .as_u64()
                        .is_some_and(|revision| revision > 0)
                    && room["memberIds"].as_array().is_some_and(|ids| {
                        ids.iter()
                            .all(|id| id.as_str().is_some_and(crate::config::uuid_like))
                            && ids
                                .iter()
                                .enumerate()
                                .all(|(index, id)| !ids[..index].contains(id))
                    })
            });
            result.roster.membership_complete &= room_admitted;
            let observation = if document.is_some() && room_admitted {
                OpsObservation::Complete
            } else if document.is_some() {
                OpsObservation::Partial
            } else {
                OpsObservation::Unavailable
            };
            let lead = document
                .and_then(|document| document["squad"]["lead"]["id"].as_str())
                .map(str::to_owned);
            let mut projected = OpsSquad {
                room_id: squad.room_id.clone(),
                name: squad.name.clone(),
                members: if room_admitted {
                    room.unwrap()["memberIds"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter_map(|id| id.as_str().map(str::to_owned))
                        .collect()
                } else {
                    Vec::new()
                },
                lead,
                member_states: BTreeMap::new(),
                observation,
                idle_alert: document.and_then(super::IdleAlertSetting::of),
            };
            result.rows.insert(OpsTarget::Squad(squad.room_id.clone()), serde_json::json!({"name":squad.name,"squad":squad.name,"roomId":squad.room_id,"revision":room.map(|room| &room["revision"]),"memberIds":room.map(|room| &room["memberIds"]),"kind":"squad","lead":document.map(|value| &value["squad"]["lead"])}));
            for (row, rank) in acquired.projected_rows(&squad.name) {
                if let Some(identity) = member(row) {
                    projected.members.push(identity.id.clone());
                    projected.member_states.insert(
                        identity.id.clone(),
                        OpsMembershipState {
                            state: identity.state.clone(),
                            waiting: identity.waiting,
                            rank: Some(rank),
                            idle_over: row["idleAlert"]["state"] == "over",
                        },
                    );
                    result.rows.insert(
                        OpsTarget::Member {
                            room_id: Some(squad.room_id.clone()),
                            identity_id: identity.id.clone(),
                        },
                        observed_member_row(
                            row,
                            result.rows.get(&OpsTarget::Member {
                                room_id: None,
                                identity_id: identity.id.clone(),
                            }),
                        ),
                    );
                    // Presence belongs to the global identity observation, not
                    // the roster's unknown placeholder for that same identity.
                    result
                        .roster
                        .members
                        .entry(identity.id.clone())
                        .or_insert(identity);
                }
            }
            projected.members.sort();
            projected.members.dedup();
            result.roster.squads.push(projected);
        }
        result.identity_ids = result.roster.members.keys().cloned().collect();
        result
    }
}

fn observed_member_row(row: &Value, observed: Option<&Value>) -> Value {
    let mut projected = row.clone();
    // HOME's roster-only acquisition does not observe panes. Reuse the same
    // global observation as the workspace presence, retaining squad metadata.
    projected["presence"] = observed
        .and_then(|row| row.get("presence"))
        .cloned()
        .unwrap_or_else(|| Value::String("unknown".into()));
    projected["pane"] = observed
        .and_then(|row| row.get("pane"))
        .cloned()
        .unwrap_or(Value::Null);
    // Provider activity is the global row's too; a roster row never supplies it.
    projected["session"] = observed
        .and_then(|row| row.get("session"))
        .cloned()
        .unwrap_or(Value::Null);
    projected
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn provider_forms_distinguish_empty_invalid_and_bounded_truncated_content() {
        let form = json!({
            "formId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "identityId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "openedMs":10, "kind":"question", "truncated":true,
            "answerable":false, "answerIn":"terminal",
            "questions":[{"text":"Which?", "choice":"single", "options":[{"label":"One"}], "freeText":false}]
        });
        assert!(provider_forms(&json!({"forms":[]})).unwrap().is_empty());
        assert!(provider_forms(&json!({})).is_none());
        let parsed = provider_forms(&json!({"forms":[form.clone()]})).unwrap();
        assert!(parsed[0].truncated);
        assert_eq!(parsed[0].questions[0].options[0].label, "One");
        let mut invalid = form.clone();
        invalid["questions"][0]["options"] =
            json!((0..9).map(|_| json!({"label":"x"})).collect::<Vec<_>>());
        assert!(provider_forms(&json!({"forms":[invalid]})).is_none());
        let mut invalid = form;
        invalid["questions"][0]["text"] = json!("x".repeat(2049));
        assert!(provider_forms(&json!({"forms":[invalid]})).is_none());
    }

    #[test]
    fn pool_uses_the_same_observed_pane_as_squad_rows_for_host_actions() {
        let mut listed = json!({"id":"uuid", "name":"worker", "presence":"active",
            "pane":"%7", "target":"work:2.1", "cwd":"/work",
            "location":{"host":"tmux", "session":"work", "window":"2"}});
        let row = pool_row(&listed);
        assert_eq!(row["pane"]["id"], "%7");
        assert_eq!(row["pane"]["location"], listed["location"]);
        assert_eq!(
            crate::board::overview::actions::host(&row, true),
            Ok("uuid")
        );
        listed["location"]["host"] = json!("herdr");
        assert!(crate::board::overview::actions::host(&pool_row(&listed), true).is_err());
        listed.as_object_mut().unwrap().remove("location");
        assert!(pool_row(&listed)["pane"].get("location").is_none());
        assert!(crate::board::overview::actions::host(&pool_row(&listed), true).is_err());
        listed["pane"] = Value::Null;
        assert!(pool_row(&listed)["pane"].is_null());
    }

    #[test]
    fn squad_actions_reuse_global_presence_without_replacing_squad_state() {
        let roster = json!({"id":"uuid", "state":"blocked", "presence":"unknown",
            "pane":null, "fields":{"task":"keep squad task"}});
        let observed = pool_row(&json!({"id":"uuid", "presence":"active", "pane":"%7",
            "location":{"host":"tmux"}, "state":"working"}));
        let row = observed_member_row(&roster, Some(&observed));
        assert_eq!(
            crate::board::overview::actions::host(&row, true),
            Ok("uuid")
        );
        assert_eq!(row["state"], "blocked");
        assert_eq!(row["fields"], roster["fields"]);
        let absent = observed_member_row(&row, None);
        assert_eq!(absent["presence"], "unknown");
        assert!(absent["pane"].is_null());
        assert!(crate::board::overview::actions::host(&absent, true).is_err());
    }
}
