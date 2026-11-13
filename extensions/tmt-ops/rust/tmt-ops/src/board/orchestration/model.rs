//! Typed observations of Core's public API. No schedule or policy resolution lives here.
use crate::cron_service::rows::{JobRows, JobState};
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
#[derive(Clone, Debug)]
pub(in crate::board) struct Bounds {
    pub start_ms: u64,
    pub end_ms: u64,
}
#[derive(Clone, Debug)]
pub(in crate::board) struct Source {
    pub kind: String,
    pub plan_id: Option<String>,
    pub revision: u64,
    pub slot: Option<Bounds>,
}
#[derive(Clone, Debug)]
pub(in crate::board) struct Field<T> {
    pub value: T,
    pub source: Source,
}
#[derive(Clone, Debug)]
pub(in crate::board) enum Receiving {
    Direct,
    Auto,
    Batch { interval_ms: u64 },
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
#[derive(Clone, Debug)]
pub(in crate::board) struct ReceivingField {
    pub value: Option<Receiving>,
    pub proposed_value: Option<Receiving>,
    pub available: bool,
    pub source: Source,
}
#[derive(Clone, Debug)]
pub(in crate::board) struct Effective {
    pub state: Field<String>,
    pub receiving: ReceivingField,
    pub sending: Field<String>,
    pub routine: Field<String>,
    pub talk_limit: Field<Option<u32>>,
}
#[derive(Clone, Debug)]
pub(in crate::board) struct Member {
    pub identity_id: String,
    pub name: String,
    pub effective: Effective,
    pub active_plans: Vec<String>,
    pub next_change_at_ms: Option<u64>,
}
#[derive(Clone, Debug)]
pub(in crate::board) struct Interval {
    pub start_ms: u64,
    pub end_ms: u64,
    pub plan_ids: Vec<String>,
}
fn strings(v: &Value) -> Option<Vec<String>> {
    v.as_array()?
        .iter()
        .map(|s| s.as_str().map(str::to_owned))
        .collect()
}
impl Bounds {
    fn read(v: &Value) -> Option<Self> {
        Some(Self {
            start_ms: v["startMs"].as_u64()?,
            end_ms: v["endMs"].as_u64()?,
        })
    }
}
impl Source {
    pub(super) fn read(v: &Value) -> Option<Self> {
        let optional = |key: &str| match &v[key] {
            Value::Null => Some(None),
            Value::String(s) => Some(Some(s.clone())),
            _ => None,
        };
        // The member and default markers are checked on the wire; the board names sources only.
        optional("identityId")?;
        v["defaulted"].as_bool()?;
        Some(Self {
            kind: v["kind"].as_str()?.to_owned(),
            plan_id: optional("planId")?,
            revision: v["revision"].as_u64()?,
            slot: match &v["slot"] {
                Value::Null => None,
                slot => Some(Bounds::read(slot)?),
            },
        })
    }
}
impl Receiving {
    fn read(v: &Value) -> Option<Option<Self>> {
        if v.is_null() {
            return Some(None);
        }
        Some(Some(match v["mode"].as_str()? {
            "direct" => Self::Direct,
            "auto" => Self::Auto,
            "batch" => Self::Batch {
                interval_ms: v["intervalMs"].as_u64()?,
            },
            "urgent" => Self::Urgent,
            "hold" => Self::Hold,
            _ => return None,
        }))
    }
}
impl Member {
    fn read(v: &Value) -> Option<Self> {
        let e = &v["effective"];
        // Every field must carry a `value` key: absence is malformed, never a default.
        let field = |name: &str| {
            e[name]
                .get("value")
                .map(|value| (value, &e[name]["source"]))
        };
        let text = |name: &str| -> Option<Field<String>> {
            let (value, source) = field(name)?;
            Some(Field {
                value: value.as_str()?.to_owned(),
                source: Source::read(source)?,
            })
        };
        let (limit, limit_source) = field("talkLimit")?;
        let receiving = &e["receiving"];
        receiving.get("value")?;
        Some(Self {
            identity_id: v["identityId"].as_str()?.to_owned(),
            name: v["name"].as_str()?.to_owned(),
            effective: Effective {
                state: text("state")?,
                receiving: ReceivingField {
                    value: Receiving::read(&receiving["value"])?,
                    proposed_value: match receiving.get("proposedValue") {
                        None => None,
                        Some(v) => Receiving::read(v)?,
                    },
                    available: receiving["available"].as_bool()?,
                    source: Source::read(&receiving["source"])?,
                },
                sending: text("sending")?,
                routine: text("routine")?,
                talk_limit: Field {
                    value: match limit {
                        Value::Null => None,
                        n => Some(u32::try_from(n.as_u64()?).ok()?),
                    },
                    source: Source::read(limit_source)?,
                },
            },
            active_plans: strings(&v["activePlans"])?,
            next_change_at_ms: match &v["nextChangeAtMs"] {
                Value::Null => None,
                n => Some(n.as_u64()?),
            },
        })
    }
}
#[derive(Clone, Debug)]
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
        let document = Self::read(&value).ok_or("Invalid Orchestration observation.")?;
        document.validate()?;
        Ok(document)
    }
    fn read(v: &Value) -> Option<Self> {
        Some(Self {
            schema_version: u8::try_from(v["schemaVersion"].as_u64()?).ok()?,
            configuration_revision: v["configurationRevision"].as_u64()?,
            receiving_revision: v["receivingRevision"].as_u64()?,
            observed_at_ms: v["observedAtMs"].as_u64()?,
            at_ms: v["atMs"].as_u64()?,
            time_zone: v["timeZone"].as_str()?.to_owned(),
            range: Bounds::read(&v["range"])?,
            plans: v["plans"].as_array()?.clone(),
            members: v["members"]
                .as_array()?
                .iter()
                .map(Member::read)
                .collect::<Option<_>>()?,
            timeline: v["timeline"]
                .as_array()?
                .iter()
                .map(|i| {
                    Some(Interval {
                        start_ms: i["startMs"].as_u64()?,
                        end_ms: i["endMs"].as_u64()?,
                        plan_ids: strings(&i["planIds"])?,
                    })
                })
                .collect::<Option<_>>()?,
        })
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
    /// Where a value comes from, by name only: revisions and identities stay in the CLI.
    pub fn source_label(&self, source: &Source) -> String {
        match source.kind.as_str() {
            "base" => "Base".to_owned(),
            "focus" => "Personal focus".to_owned(),
            "member" => "Member setting".to_owned(),
            _ => source
                .plan_id
                .as_deref()
                .map(|id| self.plan_name(id).to_owned())
                .unwrap_or_else(|| source.kind.clone()),
        }
    }
}
/// One ordered route's sending verdict, as Core's `routes` view states it (#4892).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) enum Verdict {
    Allowed,
    Blocked,
    NeedsPerson,
}
#[derive(Clone, Debug)]
pub(in crate::board) enum RouteSource {
    Policy(Source),
    Grant { until_ms: u64 },
}
#[derive(Clone, Debug)]
pub(in crate::board) struct Route {
    pub verdict: Verdict,
    pub source: RouteSource,
}
impl Route {
    pub(super) fn read(v: &Value) -> Option<((String, String), Self)> {
        let verdict = match v["verdict"].as_str()? {
            "allowed" => Verdict::Allowed,
            "blocked" => Verdict::Blocked,
            "needs_person" => Verdict::NeedsPerson,
            _ => return None,
        };
        let source = match v["source"]["kind"].as_str()? {
            "grant" => RouteSource::Grant {
                until_ms: v["source"]["grantUntilMs"].as_u64()?,
            },
            _ => RouteSource::Policy(Source::read(&v["source"])?),
        };
        Some((
            (v["from"].as_str()?.to_owned(), v["to"].as_str()?.to_owned()),
            Self { verdict, source },
        ))
    }
}
/// One agent pair from Core's `talks` view: counted requests in the window and held ones.
#[derive(Clone, Debug)]
pub(in crate::board) struct TalkPair {
    pub ids: (String, String),
    pub names: (String, String),
    pub count: u64,
    pub limit: Option<u64>,
    pub held: bool,
    pub held_count: u64,
    pub last_at_ms: Option<u64>,
}
impl TalkPair {
    pub(super) fn read(v: &Value) -> Option<Self> {
        let members = v["members"].as_array()?;
        let [first, second] = members.as_slice() else {
            return None;
        };
        let name = |m: &Value| m["name"].as_str().map(str::to_owned);
        Some(Self {
            ids: (
                first["identityId"].as_str()?.to_owned(),
                second["identityId"].as_str()?.to_owned(),
            ),
            names: (name(first)?, name(second)?),
            count: v["count"].as_u64()?,
            limit: match &v["limit"] {
                Value::Null => None,
                n => Some(n.as_u64()?),
            },
            held: match v["state"].as_str()? {
                "held" => true,
                "open" => false,
                _ => return None,
            },
            held_count: v["heldCount"].as_u64()?,
            last_at_ms: v["lastAtMs"].as_u64(),
        })
    }
}
/// What Core's sending views said, or that this Core has none (an older Core refuses the
/// unknown view, which reads as "not available").
#[derive(Clone, Debug, Default)]
pub(in crate::board) struct Sending {
    pub routes: Option<BTreeMap<(String, String), Route>>,
    pub talks: Option<Vec<TalkPair>>,
    /// More members than one bounded matrix read covers.
    pub truncated: bool,
}
impl Sending {
    pub fn route(&self, from: &str, to: &str) -> Option<&Route> {
        self.routes.as_ref()?.get(&(from.to_owned(), to.to_owned()))
    }
    pub fn pair(&self, a: &str, b: &str) -> Option<&TalkPair> {
        self.talks
            .as_ref()?
            .iter()
            .find(|p| (p.ids.0 == a && p.ids.1 == b) || (p.ids.0 == b && p.ids.1 == a))
    }
}
/// Where the parts of a day start in the 7-day strip, as local hours: night from midnight, day from
/// 08:00, evening from 16:00. The approved wireframe's `tmt orch --range 7d` output counts plans per
/// "night · day · evening"; its figures fit these thirds.
const DAY_PARTS: [i8; 2] = [8, 16];
/// One cell of the timeline strip: a span of the read range and how many plans are in effect in it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(in crate::board) struct StripCell {
    pub start_ms: u64,
    pub end_ms: u64,
    /// The highest plan count of any Core interval in the cell; 0 is base only.
    pub count: usize,
    /// The start of the first Core interval inside the cell: what a click selects.
    pub at_ms: u64,
    /// Every plan in effect somewhere in the cell: the plans list marks the selected one's cells.
    pub plan_ids: BTreeSet<String>,
}
/// The timeline strip of the read range, laid out on the worker: cells, axis ticks and labels.
#[derive(Clone, Debug, Default)]
pub(in crate::board) struct Strip {
    pub axis: &'static str,
    pub row: &'static str,
    pub cells: Vec<StripCell>,
    pub ticks: Vec<(u64, String)>,
    /// One cell per Core interval (1 day): a base-only span is dotted across its width.
    pub spans: bool,
}
impl Strip {
    fn new(document: &Overview, zone: &jiff::tz::TimeZone) -> Result<Self, String> {
        let fail = |_| "Orchestration time cannot be displayed.".to_owned();
        let (start, end) = (document.range.start_ms, document.range.end_ms);
        let zoned = |ms: u64| {
            jiff::Timestamp::from_millisecond(ms as i64)
                .map(|t| t.to_zoned(zone.clone()))
                .map_err(fail)
        };
        let local = |date: jiff::civil::Date, hour: i8| -> Result<(u64, jiff::Zoned), String> {
            let at = date
                .at(hour, 0, 0, 0)
                .to_zoned(zone.clone())
                .map_err(fail)?;
            Ok((at.timestamp().as_millisecond().max(0) as u64, at))
        };
        // The local days the range covers, by their midnights.
        let mut days = vec![zoned(start)?.date()];
        while let Some(last) = days.last()
            && local(last.tomorrow().map_err(fail)?, 0)?.0 < end
            && days.len() < 31
        {
            days.push(last.tomorrow().map_err(fail)?);
        }
        let mut timeline: Vec<&Interval> = document.timeline.iter().collect();
        timeline.sort_by_key(|interval| interval.start_ms);
        let cell = |from: u64, to: u64| {
            let inside = timeline
                .iter()
                .filter(|i| i.start_ms < to && from < i.end_ms);
            StripCell {
                start_ms: from,
                end_ms: to,
                count: inside.clone().map(|i| i.plan_ids.len()).max().unwrap_or(0),
                at_ms: inside
                    .clone()
                    .map(|i| i.start_ms.max(from))
                    .next()
                    .unwrap_or(from),
                plan_ids: inside.flat_map(|i| i.plan_ids.iter().cloned()).collect(),
            }
        };
        let day_end = |date: jiff::civil::Date| -> Result<u64, String> {
            Ok(local(date.tomorrow().map_err(fail)?, 0)?.0.min(end))
        };
        let mut strip = Self::default();
        if days.len() == 1 {
            strip.axis = "TIME";
            strip.row = "in effect";
            strip.spans = true;
            // Core's intervals, with the time none of them covers as base-only spans.
            let mut from = start;
            for interval in timeline
                .iter()
                .filter(|i| i.start_ms < end && start < i.end_ms)
            {
                let (at, until) = (interval.start_ms.max(start), interval.end_ms.min(end));
                if from < at {
                    strip.cells.push(cell(from, at));
                }
                if from < until {
                    strip.cells.push(cell(at.max(from), until));
                }
                from = from.max(until);
            }
            if from < end || strip.cells.is_empty() {
                strip.cells.push(cell(from, end));
            }
            for hour in (0..24).step_by(3) {
                let (at, zoned) = local(days[0], hour)?;
                strip
                    .ticks
                    .push((at.max(start), zoned.strftime("%H").to_string()));
            }
            strip.ticks.push((end, "24".into()));
        } else if days.len() <= 7 {
            strip.axis = "DAY";
            strip.row = "night·day·eve";
            for date in &days {
                let (midnight, zoned) = local(*date, 0)?;
                let midnight = midnight.max(start);
                strip
                    .ticks
                    .push((midnight, zoned.strftime("%a").to_string()));
                let mut bounds = vec![midnight];
                for hour in DAY_PARTS {
                    bounds.push(local(*date, hour)?.0);
                }
                bounds.push(day_end(*date)?);
                for pair in bounds.windows(2) {
                    strip.cells.push(cell(pair[0], pair[1]));
                }
            }
        } else {
            strip.axis = "DATE";
            strip.row = "in effect";
            let mut month = None;
            for (index, date) in days.iter().enumerate() {
                let (midnight, zoned) = local(*date, 0)?;
                let midnight = midnight.max(start);
                strip.cells.push(cell(midnight, day_end(*date)?));
                if index % 5 == 0 {
                    // The month name stands before the first tick and the first of a new month.
                    let label = if month == Some(date.month()) {
                        zoned.strftime("%-d").to_string()
                    } else {
                        zoned.strftime("%b %-d").to_string()
                    };
                    month = Some(date.month());
                    strip.ticks.push((midnight, label));
                }
            }
        }
        Ok(strip)
    }
}
/// Time-zone lookup and formatting occur on the worker, never while painting.
#[derive(Clone, Debug)]
pub(in crate::board) struct Snapshot {
    pub document: Overview,
    pub sending: Sending,
    pub times: BTreeMap<u64, String>,
    /// The same instants as weekday and clock time in the calendar zone (`Wed 23:00`).
    pub short: BTreeMap<u64, String>,
    /// Clock time alone on the selected time's day, weekday and clock time on any other.
    pub clock: BTreeMap<u64, String>,
    pub strip: Strip,
    pub writes: bool,
    /// Core's jobs, evaluated now, ordered by next run; paused, then ownerless, last.
    pub jobs: Jobs,
    /// Core's plans in its order, labelled on the worker.
    pub plan_rows: Vec<PlanRow>,
}
/// The policy fields a plan may set, in the order the board names them.
const PLAN_FIELDS: [(&str, &str); 5] = [
    ("state", "state"),
    ("sending", "sending"),
    ("receiving", "receiving"),
    ("routine", "routine"),
    ("talkLimit", "talk limit"),
];
/// One plan as the board shows it, labelled from Core's plan document.
#[derive(Clone, Debug)]
pub(in crate::board) struct PlanRow {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub priority: i64,
    /// `everyone`, the named members, or the pattern, as the targets say.
    pub who: String,
    /// Whether a target is a pattern or everyone: who it is depends on current names.
    pub open: bool,
    pub when: String,
    pub sets: String,
    /// The fields the plan neither sets nor implies through a state.
    pub leaves: Vec<&'static str>,
}
impl PlanRow {
    fn read(plan: &Value, members: &[Member], zone: &jiff::tz::TimeZone) -> Self {
        let mut open = false;
        let who: Vec<String> = plan["targets"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|target| match target["kind"].as_str() {
                Some("all") => {
                    open = true;
                    "everyone".to_owned()
                }
                Some("pattern") => {
                    open = true;
                    target["pattern"].as_str().unwrap_or("?").to_owned()
                }
                _ => {
                    let id = target["id"].as_str().unwrap_or_default();
                    members
                        .iter()
                        .find(|m| m.identity_id == id)
                        .map_or_else(|| "a former member".to_owned(), |m| m.name.clone())
                }
            })
            .collect();
        let fields = &plan["fields"];
        let mut sets: Vec<String> = PLAN_FIELDS
            .iter()
            .filter(|(key, _)| fields.get(*key).is_some())
            .map(|(key, word)| format!("{word} {}", field_value(key, &fields[*key])))
            .collect();
        let overrides = plan["members"].as_array().map_or(0, Vec::len);
        if overrides > 0 {
            sets.push(format!(
                "{overrides} member override{}",
                if overrides == 1 { "" } else { "s" }
            ));
        }
        let state = fields.get("state").is_some();
        let leaves = PLAN_FIELDS
            .iter()
            .filter(|(key, _)| {
                fields.get(*key).is_none() && !(state && matches!(*key, "receiving" | "routine"))
            })
            .map(|(_, word)| *word)
            .collect();
        Self {
            id: plan["id"].as_str().unwrap_or_default().to_owned(),
            name: plan["name"].as_str().unwrap_or("?").to_owned(),
            enabled: plan["enabled"].as_bool() == Some(true),
            priority: plan["priority"].as_i64().unwrap_or_default(),
            who: if who.is_empty() {
                "no one".into()
            } else {
                who.join(", ")
            },
            open,
            when: schedule_text(&plan["schedule"], zone),
            sets: if sets.is_empty() {
                "nothing".into()
            } else {
                sets.join(" · ")
            },
            leaves,
        }
    }
}
/// A plan field's value in words.
fn field_value(key: &str, value: &Value) -> String {
    match (key, value) {
        ("talkLimit", Value::Null) => "unlimited".into(),
        ("talkLimit", n) => format!("{n}/h"),
        ("receiving", v) => match Receiving::read(v) {
            Some(Some(receiving)) => receiving.label(),
            _ => "?".into(),
        },
        ("sending", v) => match v.as_str() {
            Some("leads") => "leads only".into(),
            Some(word) => word.into(),
            None => "?".into(),
        },
        ("state", v) => {
            let word = v.as_str().unwrap_or("?");
            let mut chars = word.chars();
            chars
                .next()
                .map(|c| c.to_uppercase().chain(chars).collect())
                .unwrap_or_default()
        }
        (_, v) => v.as_str().unwrap_or("?").into(),
    }
}
/// A plan schedule in words: `always`, `every day 22:00–08:00`, `weekdays 09:00–18:00`,
/// `Mon Wed 22:00–06:00 · every 2 weeks` or a `once` span.
fn schedule_text(schedule: &Value, zone: &jiff::tz::TimeZone) -> String {
    let hours = || {
        if schedule["allDay"].as_bool() == Some(true) {
            "all day".to_owned()
        } else {
            format!(
                "{}–{}",
                schedule["start"].as_str().unwrap_or("?"),
                schedule["end"].as_str().unwrap_or("?")
            )
        }
    };
    match schedule["kind"].as_str() {
        Some("always") => "always".into(),
        Some("daily") => format!("every day {}", hours()),
        Some("weekly") => {
            let days: Vec<u64> = schedule["weekdays"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_u64)
                .collect();
            let names = match days.as_slice() {
                [1, 2, 3, 4, 5] => "weekdays".to_owned(),
                [6, 7] => "weekends".to_owned(),
                [1, 2, 3, 4, 5, 6, 7] => "every day".to_owned(),
                days => days
                    .iter()
                    .map(|d| match d {
                        1 => "Mon",
                        2 => "Tue",
                        3 => "Wed",
                        4 => "Thu",
                        5 => "Fri",
                        6 => "Sat",
                        _ => "Sun",
                    })
                    .collect::<Vec<_>>()
                    .join(" "),
            };
            let every = match schedule["intervalWeeks"].as_u64() {
                Some(n) if n > 1 => format!(" · every {n} weeks"),
                _ => String::new(),
            };
            format!("{names} {}{every}", hours())
        }
        Some("once") => {
            let at = |key: &str| {
                schedule[key]
                    .as_u64()
                    .and_then(|ms| jiff::Timestamp::from_millisecond(ms as i64).ok())
                    .map_or_else(
                        || "?".to_owned(),
                        |t| {
                            t.to_zoned(zone.clone())
                                .strftime("%b %-d %H:%M")
                                .to_string()
                        },
                    )
            };
            format!("{} – {}", at("startMs"), at("endMs"))
        }
        _ => "?".into(),
    }
}
/// The jobs read, scoped to the Jobs section: a jobs problem never hides the rest of the tab.
#[derive(Clone, Debug)]
pub(in crate::board) enum Jobs {
    Listed(JobRows),
    /// An older Core without the jobs view.
    Unavailable,
    Failed(String),
}
impl Jobs {
    pub fn listed(&self) -> Option<&JobRows> {
        match self {
            Self::Listed(jobs) => Some(jobs),
            _ => None,
        }
    }
}
impl Snapshot {
    pub fn new(
        document: Overview,
        sending: Sending,
        writes: bool,
        jobs: Result<Option<JobRows>, String>,
    ) -> Result<Self, String> {
        let mut jobs = match jobs {
            Ok(Some(jobs)) => Jobs::Listed(jobs),
            Ok(None) => Jobs::Unavailable,
            Err(reason) => Jobs::Failed(reason),
        };
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
        for pair in sending.talks.iter().flatten() {
            instants.extend(pair.last_at_ms);
        }
        for route in sending.routes.iter().flat_map(|r| r.values()) {
            if let RouteSource::Grant { until_ms } = route.source {
                instants.insert(until_ms);
            }
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
        for job in jobs.listed().into_iter().flat_map(|jobs| &jobs.rows) {
            instants.extend(job.next_ms());
            instants.extend(job.last_run.as_ref().map(|run| run.at_ms));
        }
        if let Jobs::Listed(jobs) = &mut jobs {
            jobs.rows.sort_by_key(|job| {
                let rank = match job.state {
                    JobState::Paused => 1,
                    JobState::NoOwner => 2,
                    _ => 0,
                };
                (rank, job.next_ms().is_none(), job.next_ms())
            });
        }
        let zoned = |ms: u64| {
            jiff::Timestamp::from_millisecond(ms as i64)
                .map(|t| t.to_zoned(zone.clone()))
                .map_err(|_| "Orchestration time cannot be displayed.".to_owned())
        };
        let strip = Strip::new(&document, &zone)?;
        let day = zoned(document.at_ms)?.date();
        let mut times = BTreeMap::new();
        let mut short = BTreeMap::new();
        let mut clock = BTreeMap::new();
        for ms in instants {
            let zoned = zoned(ms)?;
            times.insert(ms, zoned.strftime("%Y-%m-%d %H:%M %:z").to_string());
            short.insert(ms, zoned.strftime("%a %H:%M").to_string());
            let format = if zoned.date() == day {
                "%H:%M"
            } else {
                "%a %H:%M"
            };
            clock.insert(ms, zoned.strftime(format).to_string());
        }
        let plan_rows = document
            .plans
            .iter()
            .map(|plan| PlanRow::read(plan, &document.members, &zone))
            .collect();
        Ok(Self {
            plan_rows,
            document,
            sending,
            times,
            short,
            clock,
            strip,
            writes,
            jobs,
        })
    }
    /// The members a plan applies to at the selected time, as Core reports them.
    pub fn plan_members(&self, id: &str) -> Vec<&Member> {
        self.document
            .members
            .iter()
            .filter(|m| m.active_plans.iter().any(|p| p == id))
            .collect()
    }
    /// The plan's span around the selected time, and its next start after it, in the read range.
    pub fn plan_now_next(&self, id: &str) -> (Option<u64>, Option<u64>) {
        let at = self.document.at_ms;
        let mut spans: Vec<&Interval> = self
            .document
            .timeline
            .iter()
            .filter(|i| i.plan_ids.iter().any(|p| p == id))
            .collect();
        spans.sort_by_key(|i| i.start_ms);
        // Neighbouring intervals that both hold the plan are one span of it.
        let mut merged: Vec<(u64, u64)> = Vec::new();
        for i in spans {
            match merged.last_mut() {
                Some(last) if last.1 >= i.start_ms => last.1 = last.1.max(i.end_ms),
                _ => merged.push((i.start_ms, i.end_ms)),
            }
        }
        // A span the read range cuts short ends where Core's slot for the plan ends, as its
        // members' sources say.
        let slot_end = self
            .plan_members(id)
            .iter()
            .flat_map(|m| {
                let e = &m.effective;
                [
                    &e.state.source,
                    &e.receiving.source,
                    &e.sending.source,
                    &e.routine.source,
                    &e.talk_limit.source,
                ]
            })
            .filter(|source| source.plan_id.as_deref() == Some(id))
            .filter_map(|source| source.slot.as_ref().map(|slot| slot.end_ms))
            .max();
        let until = merged
            .iter()
            .find(|(start, end)| *start <= at && at < *end)
            .map(|(_, end)| match slot_end {
                Some(slot) if *end >= self.document.range.end_ms => slot.max(*end),
                _ => *end,
            });
        let next = merged
            .iter()
            .find(|(start, _)| *start > at)
            .map(|(start, _)| *start);
        (until, next)
    }
    pub fn short(&self, ms: u64) -> String {
        self.short
            .get(&ms)
            .cloned()
            .unwrap_or_else(|| self.time(ms))
    }
    pub fn clock(&self, ms: u64) -> String {
        self.clock
            .get(&ms)
            .cloned()
            .unwrap_or_else(|| self.short(ms))
    }
    pub fn time(&self, ms: u64) -> String {
        self.times
            .get(&ms)
            .cloned()
            .unwrap_or_else(|| format!("{ms} ms"))
    }
}
