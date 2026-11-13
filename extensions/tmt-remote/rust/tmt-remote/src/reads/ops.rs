//! The Ops board projection: an allowlist over `tmt ops squad ls --json` and
//! `tmt ops squad cron ls --json`. A pane's id, target and cwd, unrelated room IDs, unlisted row fields
//! and all but the first line of a schedule message never leave the machine's own terminal.
use crate::limits;
use serde_json::{Map, Value, json};

const MAX_SAFE: u64 = 9_007_199_254_740_991;

/// Text for the browser: control and bidi-control characters become spaces or vanish, the
/// result is trimmed and cut to `cap` Unicode scalars. Empty text is absent.
fn text(value: &Value, cap: usize) -> Option<String> {
    let cleaned: String = value
        .as_str()?
        .chars()
        .filter_map(|c| match c {
            '\u{061c}'
            | '\u{200e}'
            | '\u{200f}'
            | '\u{202a}'..='\u{202e}'
            | '\u{2066}'..='\u{2069}' => None,
            c if c.is_control() => Some(' '),
            c => Some(c),
        })
        .collect();
    let cut: String = cleaned.trim().chars().take(cap).collect();
    let cut = cut.trim_end().to_owned();
    (!cut.is_empty()).then_some(cut)
}
/// A short lowercase token (`[a-z0-9-]`), such as a UUID, a presence or a colour token.
fn token(value: &Value, cap: usize) -> Option<String> {
    let text = value.as_str()?;
    (!text.is_empty()
        && text.len() <= cap
        && text
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-'))
    .then(|| text.to_owned())
}
fn safe(value: &Value) -> Option<u64> {
    value.as_u64().filter(|n| *n <= MAX_SAFE)
}
fn link(value: &Value) -> Option<String> {
    let text = value.as_str()?;
    (text.starts_with("https://")
        && text.len() <= limits::READ_OPS_LINK
        && !text.chars().any(|c| c.is_control() || c.is_whitespace()))
    .then(|| text.to_owned())
}
fn put(object: &mut Map<String, Value>, key: &str, value: Option<impl Into<Value>>) {
    if let Some(value) = value {
        object.insert(key.into(), value.into());
    }
}

fn agent(row: &Value, squad: &str, role: &str) -> Option<Value> {
    let mut agent = Map::new();
    agent.insert("id".into(), json!(token(&row["id"], 36)?));
    agent.insert(
        "name".into(),
        json!(text(&row["name"], limits::READ_OPS_NAME)?),
    );
    agent.insert("squad".into(), json!(squad));
    agent.insert("role".into(), json!(role));
    agent.insert("tokens1d".into(), Value::Null);
    // Ops owns the conversation checklist. Until its read-only batch port exists,
    // no per-member command or private-store fallback belongs in a board read.
    agent.insert("checklistCount".into(), Value::Null);
    put(&mut agent, "presence", token(&row["presence"], 16));
    let activity = &row["activity"];
    if matches!(
        activity["state"].as_str(),
        Some("working" | "idle" | "unknown" | "ended")
    ) && (activity["sinceMs"].is_null() || safe(&activity["sinceMs"]).is_some())
    {
        agent.insert(
            "activity".into(),
            json!({"state": activity["state"], "sinceMs": activity["sinceMs"]}),
        );
    }
    let fields = &row["fields"];
    put(
        &mut agent,
        "state",
        text(&row["state"], limits::READ_OPS_STATE)
            .or_else(|| text(&fields["state"], limits::READ_OPS_STATE)),
    );
    put(&mut agent, "stateTone", token(&row["colors"]["state"], 24));
    put(
        &mut agent,
        "task",
        text(&fields["task"], limits::READ_OPS_TEXT),
    );
    put(
        &mut agent,
        "next",
        text(&fields["next"], limits::READ_OPS_TEXT),
    );
    put(
        &mut agent,
        "model",
        text(&fields["model"], limits::READ_OPS_NAME),
    );
    put(&mut agent, "link", link(&fields["link"]));
    put(
        &mut agent,
        "pending",
        text(&row["pending"], limits::READ_OPS_TEXT),
    );
    let waiting = row["waitingOnYou"].as_array().map_or(0, Vec::len);
    agent.insert("waitingOnYou".into(), json!(waiting.min(9999)));
    let digest = &row["digest"];
    if let (Some(active), Some(held)) = (digest["active"].as_bool(), safe(&digest["heldCount"])) {
        agent.insert(
            "digest".into(),
            json!({"active": active, "remainingMs": safe(&digest["remainingMs"]), "heldCount": held}),
        );
    }
    put(
        &mut agent,
        "staleness",
        token(&row["staleness"]["state"], 16),
    );
    Some(Value::Object(agent))
}

fn squad(
    document: &Value,
    rooms: Option<&Value>,
    squads: &mut Vec<Value>,
    agents: &mut Vec<Value>,
    truncated: &mut bool,
) {
    let head = &document["squad"];
    let Some(name) = text(&head["name"], limits::READ_OPS_NAME) else {
        return;
    };
    let lead = agent(&head["lead"], &name, "lead");
    let mut entry = Map::new();
    entry.insert("name".into(), json!(name));
    let room = rooms
        .and_then(|value| value["rooms"].as_array())
        .and_then(|rows| {
            let id = head["roomId"]
                .as_str()
                .filter(|id| crate::canonical::is_core_id(id))?;
            let mut matches = rows.iter().filter(|row| row["id"] == id);
            let row = matches.next()?;
            if matches.next().is_some()
                || row["name"] != format!("squad-{name}")
                || row["retired"] != false
            {
                return None;
            }
            let revision = safe(&row["revision"]).filter(|revision| *revision > 0)?;
            Some(json!({"roomId":id,"revision":revision}))
        });
    entry.insert("room".into(), room.unwrap_or(Value::Null));
    put(&mut entry, "layout", token(&head["layout"], 24));
    if let Some(lead) = &lead {
        entry.insert(
            "lead".into(),
            json!({"id": lead["id"], "name": lead["name"]}),
        );
    }
    if head["idleAlert"]["enabled"] == true
        && let Some(after) = safe(&head["idleAlert"]["afterMs"])
    {
        entry.insert("idleAlertMs".into(), json!(after));
    }
    if let (Some(state), Some(waiting), Some(blocked)) = (
        token(&head["attention"]["state"], 16),
        safe(&head["attention"]["waiting"]),
        safe(&head["attention"]["blocked"]),
    ) {
        entry.insert(
            "attention".into(),
            json!({"state": state, "waiting": waiting, "blocked": blocked}),
        );
    }
    squads.push(Value::Object(entry));
    let rows = lead.into_iter().chain(
        document["sections"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|section| section["rows"].as_array().into_iter().flatten())
            .filter_map(|row| agent(row, &name, "member")),
    );
    for row in rows {
        if agents.len() >= limits::READ_OPS_AGENTS {
            *truncated = true;
            break;
        }
        if !agents
            .iter()
            .any(|seen| seen["id"] == row["id"] && seen["squad"] == row["squad"])
        {
            agents.push(row);
        }
    }
}

fn timers(document: &Value, truncated: &mut bool) -> Option<Vec<Value>> {
    let jobs = document["jobs"].as_array()?;
    let mut timers = Vec::new();
    for job in jobs {
        if timers.len() >= limits::READ_OPS_TIMERS {
            *truncated = true;
            break;
        }
        let mut timer = Map::new();
        let (Some(id), Some(squad), Some(schedule)) = (
            token(&job["id"], 16),
            text(&job["squad"], limits::READ_OPS_NAME),
            text(&job["scheduleText"], limits::READ_OPS_STATE),
        ) else {
            continue;
        };
        timer.insert("id".into(), json!(id));
        timer.insert("squad".into(), json!(squad));
        timer.insert("scheduleText".into(), json!(schedule));
        put(
            &mut timer,
            "owner",
            text(&job["owner"], limits::READ_OPS_NAME),
        );
        let state = match job["state"].as_str() {
            Some("on") if job["ownerMissing"] != true => Some("on"),
            Some("on" | "paused" | "no owner") => Some("paused"),
            _ => None,
        };
        timer.insert(
            "state".into(),
            state.map_or(Value::Null, |state| json!(state)),
        );
        let next = (state == Some("on"))
            .then(|| job["nextMs"].get(0).and_then(safe))
            .flatten();
        timer.insert(
            "nextMs".into(),
            next.map_or(Value::Null, |next| json!(next)),
        );
        // The first line only: a message often names local files.
        let first = job["message"].as_str().and_then(|m| m.lines().next());
        put(
            &mut timer,
            "what",
            first.and_then(|line| text(&json!(line), limits::READ_OPS_WHAT)),
        );
        timers.push(Value::Object(timer));
    }
    Some(timers)
}

/// `None` when the squad document is not the expected shape. A cron document that is
/// absent or malformed leaves `timers` null.
pub(super) fn project(
    board: &Value,
    cron: Option<&Value>,
    rooms: Option<&Value>,
) -> Option<Map<String, Value>> {
    let listed = board["squads"].as_array()?;
    let (mut squads, mut agents, mut truncated) = (Vec::new(), Vec::new(), false);
    for document in listed {
        if squads.len() >= limits::READ_OPS_SQUADS {
            truncated = true;
            break;
        }
        squad(document, rooms, &mut squads, &mut agents, &mut truncated);
    }
    let timers = cron.and_then(|cron| timers(cron, &mut truncated));
    let mut payload = Map::new();
    payload.insert("squads".into(), Value::Array(squads));
    payload.insert("agents".into(), Value::Array(agents));
    payload.insert("timers".into(), timers.map_or(Value::Null, Value::Array));
    payload.insert("truncated".into(), json!(truncated));
    payload.insert("defaultIdleAlertMs".into(), Value::Null);
    Some(payload)
}

/// Config owns the no-squad effective default and emits whole seconds. Unknown
/// context, duplicate entries or unsupported values are unavailable, never 30m by guess.
pub(super) fn idle_default(settings: &Value) -> Option<u64> {
    if settings.get("context") != Some(&Value::Null) {
        return None;
    }
    let mut entries = settings["entries"]
        .as_array()?
        .iter()
        .filter(|entry| entry["key"] == "idle_alert.after");
    let value = entries.next()?["value"].as_str()?;
    if entries.next().is_some() {
        return None;
    }
    let seconds = value.strip_suffix('s')?;
    if seconds.is_empty() || seconds.len() > 5 || !seconds.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let seconds: u64 = seconds.parse().ok()?;
    (300..=86_400).contains(&seconds).then_some(seconds * 1000)
}

/// One Core-owned closed-day aggregate; cached inputs are already included in
/// inputTokens. Missing coverage and an unobserved zero never become a measured zero.
pub(super) fn tokens1d(document: &Value, id: &str) -> Option<Value> {
    const DAY: u64 = 86_400_000;
    let observed = safe(&document["asOfMs"])?;
    let through = safe(&document["throughMs"])?;
    if through > observed || through % 5000 != 0 {
        return None;
    }
    let mut identities = document["identities"]
        .as_array()?
        .iter()
        .filter(|row| row["id"] == id);
    let row = identities.next()?;
    if identities.next().is_some() || row["found"] != true || row["reporting"] != true {
        return None;
    }
    let mut windows = row["windows"]
        .as_array()?
        .iter()
        .filter(|window| window["windowMs"] == DAY);
    let window = windows.next()?;
    if windows.next().is_some()
        || window["toMs"] != through
        || window["fromMs"] != through.saturating_sub(DAY)
    {
        return None;
    }
    let available = safe(&window["availableFromMs"])?;
    if available > through {
        return None;
    }
    let [bucket] = window["buckets"].as_array()?.as_slice() else {
        return None;
    };
    if bucket["fromMs"] != window["fromMs"] || bucket["toMs"] != window["toMs"] {
        return None;
    }
    let input = safe(&bucket["inputTokens"])?;
    let output = safe(&bucket["outputTokens"])?;
    if safe(&bucket["cachedInputTokens"])? > input {
        return None;
    }
    let tokens = input
        .checked_add(output)
        .filter(|tokens| *tokens <= MAX_SAFE)?;
    let complete = bucket["complete"].as_bool()?;
    let covered = safe(&bucket["coveredMs"])?;
    let duration = through - through.saturating_sub(DAY);
    if covered > duration || complete && covered != duration || !complete && tokens == 0 {
        return None;
    }
    Some(json!({"tokens":tokens,"complete":complete}))
}
