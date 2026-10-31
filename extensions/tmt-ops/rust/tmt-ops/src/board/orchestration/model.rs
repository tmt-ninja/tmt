//! Typed observations of Core's public API. No schedule or policy resolution lives here.
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const SAFE_INTEGER: u64 = 9_007_199_254_740_991;
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct Query {
    pub days: u8,
    pub at_ms: u64,
    pub plan: Option<String>,
    pub member: String,
}
impl Default for Query {
    fn default() -> Self {
        Self {
            days: 1,
            at_ms: crate::status::now_ms(),
            plan: None,
            member: String::new(),
        }
    }
}
impl Query {
    pub fn input(&self) -> Value {
        let mut value =
            serde_json::json!({"view":"overview","rangeDays":self.days,"atMs":self.at_ms});
        if let Some(plan) = &self.plan {
            value["plan"] = plan.clone().into();
        }
        if !self.member.is_empty() {
            value["memberQuery"] = self.member.clone().into();
        }
        value
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::board) struct Bounds {
    pub start_ms: u64,
    pub end_ms: u64,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::board) struct Source {
    pub kind: String,
    pub plan_id: Option<String>,
    pub identity_id: Option<String>,
    pub revision: u64,
    pub slot: Option<Bounds>,
    pub defaulted: bool,
}
#[derive(Clone, Debug, Deserialize)]
pub(in crate::board) struct Field<T> {
    pub value: T,
    pub source: Source,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub(in crate::board) enum Receiving {
    Direct,
    Auto,
    Batch {
        #[serde(rename = "intervalMs")]
        interval_ms: u64,
    },
    Urgent,
    Hold,
}
impl Receiving {
    pub fn label(&self) -> String {
        match self {
            Self::Direct => "direct".into(),
            Self::Auto => "auto".into(),
            Self::Batch { interval_ms } => {
                let (value, unit) = if interval_ms % 3_600_000 == 0 {
                    (interval_ms / 3_600_000, "h")
                } else if interval_ms % 60_000 == 0 {
                    (interval_ms / 60_000, "m")
                } else if interval_ms % 1_000 == 0 {
                    (interval_ms / 1_000, "s")
                } else {
                    (*interval_ms, "ms")
                };
                format!("batch {value}{unit}")
            }
            Self::Urgent => "urgent only".into(),
            Self::Hold => "hold all".into(),
        }
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::board) struct ReceivingField {
    pub value: Option<Receiving>,
    pub proposed_value: Option<Receiving>,
    pub available: bool,
    pub source: Source,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::board) struct Effective {
    pub state: Field<String>,
    pub receiving: ReceivingField,
    pub sending: Field<String>,
    pub routine: Field<String>,
    pub talk_limit: Field<Option<u32>>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::board) struct Member {
    pub identity_id: String,
    pub name: String,
    pub effective: Effective,
    pub active_plans: Vec<String>,
    pub next_change_at_ms: Option<u64>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::board) struct Interval {
    pub start_ms: u64,
    pub end_ms: u64,
    pub plan_ids: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::board) struct Overview {
    pub schema_version: u8,
    pub configuration_revision: u64,
    pub receiving_revision: u64,
    pub observed_at_ms: u64,
    pub at_ms: u64,
    pub time_zone: String,
    pub range: Bounds,
    pub plans: Vec<Value>,
    pub members: Vec<Member>,
    pub timeline: Vec<Interval>,
}
impl Overview {
    pub fn decode(value: Value) -> Result<Self, String> {
        // Missing nullable values must not turn malformed replies into unlimited/direct.
        let members = value["members"]
            .as_array()
            .ok_or("Orchestration members are missing.")?;
        for member in members {
            for field in ["state", "receiving", "sending", "routine", "talkLimit"] {
                if member["effective"][field].get("value").is_none() {
                    return Err(format!("Orchestration {field} observation is missing."));
                }
            }
        }
        let document: Self = serde_json::from_value(value)
            .map_err(|e| format!("Invalid Orchestration observation: {e}"))?;
        document.validate()?;
        Ok(document)
    }
    fn validate(&self) -> Result<(), String> {
        let valid_bounds =
            |bounds: &Bounds| bounds.start_ms < bounds.end_ms && bounds.end_ms <= SAFE_INTEGER;
        let mut ids = BTreeSet::new();
        let mut plans = BTreeSet::new();
        if self.schema_version != 1
            || self.configuration_revision > SAFE_INTEGER
            || self.receiving_revision > SAFE_INTEGER
            || self.observed_at_ms > SAFE_INTEGER
            || self.at_ms > SAFE_INTEGER
            || self.time_zone.is_empty()
            || !valid_bounds(&self.range)
            || self.members.len() > 256
            || self.plans.len() > 128
            || self.timeline.len() > 4096
        {
            return Err("Invalid or unsupported Orchestration observation.".into());
        }
        for plan in &self.plans {
            let id = plan["id"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or("A plan UUID is missing.")?;
            if !plans.insert(id)
                || plan["name"].as_str().is_none_or(str::is_empty)
                || plan["revision"]
                    .as_u64()
                    .is_none_or(|n| n == 0 || n > SAFE_INTEGER)
                || !plan["fields"].is_object()
                || !plan["schedule"].is_object()
                || !plan["targets"].is_array()
                || !plan["members"].is_array()
                || !plan["enabled"].is_boolean()
                || !plan["priority"].is_i64()
            {
                return Err("Invalid Orchestration plan observation.".into());
            }
        }
        for member in &self.members {
            let e = &member.effective;
            if member.identity_id.is_empty()
                || member.name.is_empty()
                || !ids.insert(&member.identity_id)
                || !matches!(e.state.value.as_str(), "awake" | "low" | "focus" | "sleep")
                || !matches!(e.sending.value.as_str(), "anyone" | "leads" | "paused")
                || !matches!(e.routine.value.as_str(), "run" | "hold")
                || e.talk_limit.value == Some(0)
                || e.receiving.available != e.receiving.value.is_some()
                || !e.receiving.available && e.receiving.proposed_value.is_none()
                || member.next_change_at_ms.is_some_and(|n| n > SAFE_INTEGER)
            {
                return Err("Invalid Orchestration member observation.".into());
            }
            for source in [
                &e.state.source,
                &e.receiving.source,
                &e.sending.source,
                &e.routine.source,
                &e.talk_limit.source,
            ] {
                if !matches!(source.kind.as_str(), "base" | "plan" | "member" | "focus")
                    || source.revision > SAFE_INTEGER
                    || source.slot.as_ref().is_some_and(|b| !valid_bounds(b))
                {
                    return Err("Invalid Orchestration source observation.".into());
                }
            }
            for receiving in e
                .receiving
                .value
                .iter()
                .chain(e.receiving.proposed_value.iter())
            {
                if matches!(receiving, Receiving::Batch { interval_ms } if *interval_ms == 0 || *interval_ms > SAFE_INTEGER)
                {
                    return Err("Invalid Orchestration receiving interval.".into());
                }
            }
        }
        if self
            .timeline
            .iter()
            .any(|interval| interval.start_ms >= interval.end_ms || interval.end_ms > SAFE_INTEGER)
        {
            return Err("Invalid Orchestration timeline observation.".into());
        }
        Ok(())
    }
    pub fn plan_name<'a>(&'a self, id: &'a str) -> &'a str {
        self.plans
            .iter()
            .find(|p| p["id"].as_str() == Some(id))
            .and_then(|p| p["name"].as_str())
            .unwrap_or(id)
    }
    pub fn source_label(&self, source: &Source) -> String {
        let owner = match source.kind.as_str() {
            "base" => "Base".to_owned(),
            "focus" => "Personal focus".to_owned(),
            _ => source
                .plan_id
                .as_deref()
                .map(|id| self.plan_name(id).to_owned())
                .unwrap_or_else(|| source.kind.clone()),
        };
        format!(
            "{owner} · revision {}{}",
            source.revision,
            if source.defaulted {
                " · state default"
            } else {
                ""
            }
        )
    }
}
/// Time-zone lookup and formatting occur on the worker, never while painting.
#[derive(Clone, Debug)]
pub(in crate::board) struct Snapshot {
    pub document: Overview,
    pub times: BTreeMap<u64, String>,
    pub writes: bool,
}
impl Snapshot {
    pub fn new(document: Overview, writes: bool) -> Result<Self, String> {
        let zone = jiff::tz::TimeZone::get(&document.time_zone)
            .map_err(|_| "Orchestration calendar zone is unavailable.".to_owned())?;
        let mut instants = BTreeSet::from([
            document.at_ms,
            document.observed_at_ms,
            document.range.start_ms,
            document.range.end_ms,
        ]);
        for interval in &document.timeline {
            instants.extend([interval.start_ms, interval.end_ms]);
        }
        for member in &document.members {
            instants.extend(member.next_change_at_ms);
            let e = &member.effective;
            for source in [
                &e.state.source,
                &e.receiving.source,
                &e.sending.source,
                &e.routine.source,
                &e.talk_limit.source,
            ] {
                if let Some(slot) = &source.slot {
                    instants.extend([slot.start_ms, slot.end_ms]);
                }
            }
        }
        let times = instants
            .into_iter()
            .map(|ms| {
                let timestamp = jiff::Timestamp::from_millisecond(ms as i64)
                    .map_err(|_| "Orchestration time cannot be displayed.".to_owned())?;
                Ok((
                    ms,
                    timestamp
                        .to_zoned(zone.clone())
                        .strftime("%Y-%m-%d %H:%M %:z")
                        .to_string(),
                ))
            })
            .collect::<Result<_, String>>()?;
        Ok(Self {
            document,
            times,
            writes,
        })
    }
    pub fn time(&self, ms: u64) -> String {
        self.times
            .get(&ms)
            .cloned()
            .unwrap_or_else(|| format!("{ms} ms"))
    }
}
