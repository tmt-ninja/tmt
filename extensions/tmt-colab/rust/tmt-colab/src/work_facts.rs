//! Bounded owner-local GitHub observations for a page's explicitly linked pull requests.
//! These facts are display data, never content or authority. No token is read or passed here.
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    ffi::{OsStr, OsString},
    path::PathBuf,
    sync::{Mutex, atomic::AtomicBool},
    time::{Duration, Instant},
};

const PR_INTERVAL: Duration = Duration::from_secs(60);
const RELEASE_INTERVAL: Duration = Duration::from_secs(300);
const CALL_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_OUTPUT: usize = 64 * 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PullLink {
    pub owner: String,
    pub repo: String,
    pub number: u64,
}
impl PullLink {
    pub fn parse(url: &str) -> Option<Self> {
        let path = url.strip_prefix("https://github.com/")?;
        let parts: Vec<_> = path.split('/').collect();
        if parts.len() != 4 || parts[2] != "pull" {
            return None;
        }
        let valid = |s: &str| {
            !s.is_empty()
                && s.len() <= 100
                && !s.starts_with('-')
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
        };
        if !valid(parts[0])
            || !valid(parts[1])
            || !parts[3].bytes().all(|b| b.is_ascii_digit())
            || parts[3].starts_with('0')
        {
            return None;
        }
        let number = parts[3].parse().ok()?;
        Some(Self {
            owner: parts[0].into(),
            repo: parts[1].into(),
            number,
        })
    }
    pub fn url(&self) -> String {
        format!(
            "https://github.com/{}/{}/pull/{}",
            self.owner, self.repo, self.number
        )
    }
    pub fn same_pull(&self, other: &Self) -> bool {
        self.number == other.number
            && self.owner.eq_ignore_ascii_case(&other.owner)
            && self.repo.eq_ignore_ascii_case(&other.repo)
    }
    fn repo_key(&self) -> String {
        format!("{}/{}", self.owner, self.repo)
    }
}

pub(crate) fn text_urls(text: &str, out: &mut Vec<String>) {
    for tail in text.split("https://github.com/").skip(1) {
        let path: String = tail
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '_' | '.'))
            .take(320)
            .collect();
        out.push(format!("https://github.com/{}", path.trim_end_matches('.')));
    }
}

fn marks(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::Object(map) => {
            if map.get("mark").and_then(Value::as_str) == Some("link")
                && let Some(url) = map.get("value").and_then(Value::as_str)
            {
                out.push(url.to_owned());
            }
            if let Some(text) = map.get("s").and_then(Value::as_str) {
                text_urls(text, out);
            }
            for child in map.values() {
                marks(child, out);
            }
        }
        Value::Array(items) => {
            for child in items {
                marks(child, out);
            }
        }
        _ => {}
    }
}

/// The link candidates in one block's text and table cells.
fn block_candidates(block: &Value, out: &mut Vec<String>) {
    if let Some(text) = block.get("text") {
        marks(text, out);
    }
    if let Some(cells) = block.get("cells") {
        marks(cells, out);
    }
}

/// The distinct pull request links among `candidates`, or `None` past the page's bound.
pub(crate) fn pulls(candidates: Vec<String>) -> Option<Vec<PullLink>> {
    let mut found = Vec::new();
    for candidate in candidates {
        let canonical = candidate.split(['?', '#']).next()?.trim_end_matches('/');
        if let Some(link) = PullLink::parse(canonical)
            && !found.contains(&link)
        {
            found.push(link);
            if found.len() > 20 {
                return None;
            }
        }
    }
    Some(found)
}

/// Extract only admitted links, not guesses from titles, scripts or incidental markup.
pub fn page_links(source: &str, blocks: Option<&Value>) -> Option<Vec<PullLink>> {
    let mut candidates = crate::page_check::hrefs(source)?;
    for text in crate::page_check::visible_text(source)? {
        text_urls(&text, &mut candidates);
    }
    if let Some(Value::Object(items)) = blocks {
        for block in items
            .values()
            .filter(|block| block.get("deleted").is_none())
        {
            block_candidates(block, &mut candidates);
        }
    }
    pulls(candidates)
}

/// The pull requests one block links to, by the same rules as [`page_links`] (#6619).
pub fn block_links(block: &Value) -> Vec<PullLink> {
    let mut candidates = Vec::new();
    block_candidates(block, &mut candidates);
    pulls(candidates).unwrap_or_default()
}

#[derive(Clone, Debug)]
pub struct Fact {
    pub state: String,
    pub checks: Option<String>,
    pub released: Option<bool>,
    pub tag: Option<String>,
    pub observed_at_ms: u64,
}
impl Fact {
    pub fn status(&self) -> crate::work_index::PullRequestFact {
        use crate::work_index::PullRequestFact;
        match self.state.as_str() {
            "open" => PullRequestFact::Open,
            "merged" => PullRequestFact::Merged {
                released: self.released,
            },
            "closed" => PullRequestFact::Closed,
            _ => PullRequestFact::Unknown,
        }
    }
    pub fn json(&self) -> Value {
        json!({"state":self.state,"checks":self.checks,"released":self.released,"tag":self.tag,"observedAtMs":self.observed_at_ms})
    }
}
#[derive(Clone)]
struct TitleSearch {
    observed: Instant,
    links: Vec<PullLink>,
    state: &'static str,
}

fn work_token(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_')
}

fn title_matches(title: &str, number: &str) -> bool {
    title
        .as_bytes()
        .split(|b| !work_token(*b))
        .any(|token| token.eq_ignore_ascii_case(number.as_bytes()))
}

impl Facts {
    /// Shares the same lock and cancellation boundary as explicit PR and release reads.
    /// One search per service per minute also bounds a burst of simultaneous page opens.
    pub fn discover(
        &self,
        repo: &str,
        numbers: &[String],
        stop: &AtomicBool,
        open: &dyn Fn() -> bool,
    ) -> crate::Result<Vec<(String, Vec<PullLink>, &'static str)>> {
        self.discover_with(repo, numbers, stop, open, &gh)
    }

    fn discover_with(
        &self,
        repo: &str,
        numbers: &[String],
        stop: &AtomicBool,
        open: &dyn Fn() -> bool,
        call: &GhCall<'_>,
    ) -> crate::Result<Vec<(String, Vec<PullLink>, &'static str)>> {
        if !crate::projects::valid_repository(repo)
            || numbers
                .iter()
                .any(|n| n.is_empty() || n.len() > 64 || !n.bytes().all(work_token))
        {
            return Err("Invalid GitHub repository or work number".into());
        }
        let Ok(mut state) = self.state.try_lock() else {
            return Ok(numbers
                .iter()
                .map(|n| (n.clone(), Vec::new(), "unknown"))
                .collect());
        };
        let now = Instant::now();
        let due = Duration::from_secs(60);
        let oldest = numbers
            .iter()
            .filter(|n| {
                state
                    .searches
                    .get(&(repo.to_owned(), n.to_string()))
                    .is_none_or(|s| now.duration_since(s.observed) >= due)
            })
            .min_by_key(|n| {
                state
                    .searches
                    .get(&(repo.to_owned(), n.to_string()))
                    .map(|s| s.observed)
            });
        if let Some(number) = oldest
            && state.next_search.is_none_or(|t| t <= now)
            && open()
        {
            let args = [
                "pr",
                "list",
                "--repo",
                repo,
                "--state",
                "all",
                "--limit",
                "21",
                "--json",
                "number,title",
                "--search",
                &format!("\"{number}\" in:title"),
            ]
            .map(str::to_owned);
            let found = call(&args, stop, open)
                .and_then(|v| v.as_array().cloned())
                .filter(|rows| rows.len() <= 21);
            let mut links = Vec::new();
            let mut status = "unknown";
            if let Some(rows) = found {
                status = if rows.len() > 20 {
                    "partial"
                } else {
                    "complete"
                };
                for row in rows.iter().take(20) {
                    let (Some(title), Some(pr)) = (
                        row["title"].as_str(),
                        row["number"].as_u64().filter(|n| *n > 0),
                    ) else {
                        status = "partial";
                        continue;
                    };
                    if title_matches(title, number)
                        && let Some(link) =
                            PullLink::parse(&format!("https://github.com/{repo}/pull/{pr}"))
                    {
                        links.push(link);
                    }
                }
            }
            // Errors include rate limiting. Back off for all failures without interpreting stderr.
            state.next_search = Some(
                now + if status == "unknown" {
                    Duration::from_secs(300)
                } else {
                    due
                },
            );
            let key = (repo.to_owned(), number.clone());
            if status == "unknown"
                && let Some(old) = state.searches.get(&key)
                && !old.links.is_empty()
            {
                links.clone_from(&old.links);
                status = "partial";
            }
            if state.searches.len() >= 1024
                && !state.searches.contains_key(&key)
                && let Some(oldest) = state
                    .searches
                    .iter()
                    .min_by_key(|(_, s)| s.observed)
                    .map(|(k, _)| k.clone())
            {
                state.searches.remove(&oldest);
            }
            state.searches.insert(
                key,
                TitleSearch {
                    observed: now,
                    links,
                    state: status,
                },
            );
        }
        Ok(numbers
            .iter()
            .map(|n| {
                let Some(hit) = state.searches.get(&(repo.to_owned(), n.clone())) else {
                    return (n.clone(), Vec::new(), "unknown");
                };
                let status = if hit.state != "unknown" && now.duration_since(hit.observed) >= due {
                    "partial"
                } else {
                    hit.state
                };
                (n.clone(), hit.links.clone(), status)
            })
            .collect())
    }
}

struct PrEntry {
    due: Instant,
    fact: Option<Fact>,
    merge: Option<String>,
}
struct ReleaseEntry {
    due: Instant,
    tags: Option<Vec<String>>,
    observed_at_ms: u64,
}
#[derive(Default)]
struct State {
    searches: HashMap<(String, String), TitleSearch>,
    next_search: Option<Instant>,
    prs: HashMap<String, PrEntry>,
    releases: HashMap<String, ReleaseEntry>,
    comparisons: HashMap<(String, String, String), bool>,
}
/// One mutex is the one in-flight GitHub read per owner service. A busy or failed read is unknown.
#[derive(Default)]
pub struct Facts {
    state: Mutex<State>,
    // A small mirror can be read while the one in-flight GitHub request owns `state`.
    retained: Mutex<HashMap<String, Fact>>,
    activities: Mutex<HashMap<String, ActivityEntry>>,
    retained_activities: Mutex<HashMap<String, OwnerObservation>>,
}

pub struct FactRead {
    pub fact: Option<Fact>,
    /// No retained fact existed while another GitHub read held the shared lock.
    pub busy_unknown: bool,
}

#[derive(Clone, Debug)]
pub struct OwnerObservation {
    pub state: String,
    pub last_activity_ms: Option<u64>,
    pub observed_at_ms: u64,
}
impl OwnerObservation {
    /// The status rules' reading of this observation.
    pub fn activity(&self) -> crate::work_index::OwnerActivity {
        match self.state.as_str() {
            "working" => crate::work_index::OwnerActivity::Working {
                last_activity_ms: self.last_activity_ms,
                observed_at_ms: self.observed_at_ms,
            },
            "waiting" => crate::work_index::OwnerActivity::Waiting,
            "idle" | "ended" => crate::work_index::OwnerActivity::Other,
            _ => crate::work_index::OwnerActivity::Unknown,
        }
    }
}
struct ActivityEntry {
    cursor: Value,
    activity: OwnerObservation,
}
pub struct ActivityRead {
    pub observation: Option<OwnerObservation>,
    pub busy_unknown: bool,
}
fn core_api(operation: &str, input: Value, stop: &AtomicBool) -> Option<Value> {
    let executable = tmt_invoke::invoking_tmt().ok()?;
    let args = [OsString::from("api")];
    let input =
        serde_json::to_vec(&json!({"version":1,"operation":operation,"input":input})).ok()?;
    let output = tmt_invoke::invoke(
        tmt_invoke::Request {
            program: &executable,
            args: &args,
            input: &input,
            deadline: Instant::now() + CALL_TIMEOUT,
            max_stream_bytes: MAX_OUTPUT,
            launch: Default::default(),
        },
        Some(stop),
    )
    .ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}
impl Facts {
    /// The last observation of an owner, read nowhere: what a list answer may use (#6474).
    pub fn retained_activity(&self, owner: &str) -> Option<OwnerObservation> {
        self.retained_activities.lock().ok()?.get(owner).cloned()
    }
    /// Work home's batch (#6474): one `changes.cursor` read, then one `identities.status` read for
    /// the owners whose cached cursor differs, at most [`crate::limits::WORK_ACTIVITY_OWNERS`]. An
    /// owner the read cannot report keeps its earlier observation. Never blocks on a read another
    /// caller holds: it answers with what is retained.
    pub fn activities(
        &self,
        owners: &[String],
        stop: &AtomicBool,
    ) -> std::collections::BTreeMap<String, OwnerObservation> {
        let retained = |owners: &[String]| {
            owners
                .iter()
                .filter_map(|owner| Some((owner.clone(), self.retained_activity(owner)?)))
                .collect()
        };
        let Ok(mut cache) = self.activities.try_lock() else {
            return retained(owners);
        };
        let Some(cursor) = core_api("changes.cursor", json!({}), stop)
            .and_then(|value| value.get("cursor").cloned())
            .filter(Value::is_u64)
        else {
            return retained(owners);
        };
        let stale: Vec<&String> = owners
            .iter()
            .filter(|owner| cache.get(*owner).is_none_or(|entry| entry.cursor != cursor))
            .collect();
        let read = (!stale.is_empty())
            .then(|| core_api("identities.status", json!({"identityIds": stale}), stop))
            .flatten();
        let now = crate::registration::now_ms().unwrap_or_default();
        for row in read
            .as_ref()
            .and_then(|value| value["identities"].as_array())
            .into_iter()
            .flatten()
        {
            let Some(owner) = row["id"]
                .as_str()
                .filter(|id| stale.iter().any(|s| s == id))
            else {
                continue;
            };
            let Some(activity) = row
                .pointer("/session/activity")
                .filter(|_| row["found"] == true)
            else {
                continue;
            };
            let Some(state) = activity["state"].as_str().filter(|state| {
                matches!(*state, "unknown" | "working" | "idle" | "waiting" | "ended")
            }) else {
                continue;
            };
            let observation = OwnerObservation {
                state: state.to_owned(),
                last_activity_ms: activity["lastActivityMs"].as_u64(),
                observed_at_ms: now,
            };
            if !cache.contains_key(owner) && cache.len() >= 1024 {
                continue;
            }
            cache.insert(
                owner.to_owned(),
                ActivityEntry {
                    cursor: cursor.clone(),
                    activity: observation.clone(),
                },
            );
            if let Ok(mut retained) = self.retained_activities.lock() {
                retained.insert(owner.to_owned(), observation);
            }
        }
        drop(cache);
        retained(owners)
    }
    /// Re-read only on caller events; a cursor read alone never refreshes observation age.
    pub fn activity(&self, owner: &str, stop: &AtomicBool) -> ActivityRead {
        let mut cache = match self.activities.try_lock() {
            Ok(cache) => cache,
            Err(std::sync::TryLockError::WouldBlock) => {
                let observation = self
                    .retained_activities
                    .lock()
                    .ok()
                    .and_then(|cache| cache.get(owner).cloned());
                return ActivityRead {
                    busy_unknown: observation.is_none(),
                    observation,
                };
            }
            Err(std::sync::TryLockError::Poisoned(_)) => {
                return ActivityRead {
                    observation: None,
                    busy_unknown: true,
                };
            }
        };
        let read = || -> Option<(Value, OwnerObservation)> {
            let cursor = core_api("changes.cursor", json!({}), stop)?
                .get("cursor")?
                .clone();
            cursor.as_u64()?;
            if let Some(old) = cache.get(owner)
                && old.cursor == cursor
            {
                return Some((cursor, old.activity.clone()));
            }
            let value = core_api("identities.status", json!({"identityIds":[owner]}), stop)?;
            let row = value["identities"].as_array()?.first()?;
            if row["id"] != owner || row["found"] != true {
                return None;
            }
            let activity = row.pointer("/session/activity")?;
            let state = activity["state"].as_str()?.to_owned();
            if !matches!(
                state.as_str(),
                "unknown" | "working" | "idle" | "waiting" | "ended"
            ) {
                return None;
            }
            let last = if activity["lastActivityMs"].is_null() {
                None
            } else {
                Some(activity["lastActivityMs"].as_u64()?)
            };
            Some((
                cursor,
                OwnerObservation {
                    state,
                    last_activity_ms: last,
                    observed_at_ms: crate::registration::now_ms().ok()?,
                },
            ))
        };
        match read() {
            Some((cursor, activity)) => {
                if !cache.contains_key(owner) && cache.len() >= 1024 {
                    return ActivityRead {
                        observation: None,
                        busy_unknown: true,
                    };
                }
                cache.insert(
                    owner.to_owned(),
                    ActivityEntry {
                        cursor,
                        activity: activity.clone(),
                    },
                );
                if let Ok(mut retained) = self.retained_activities.lock() {
                    retained.insert(owner.to_owned(), activity.clone());
                }
                ActivityRead {
                    observation: Some(activity),
                    busy_unknown: false,
                }
            }
            None => ActivityRead {
                observation: cache.get(owner).map(|entry| entry.activity.clone()),
                busy_unknown: false,
            },
        }
    }
}

type GhCall<'a> = dyn Fn(&[String], &AtomicBool, &dyn Fn() -> bool) -> Option<Value> + 'a;

fn gh(args: &[String], stop: &AtomicBool, open: &dyn Fn() -> bool) -> Option<Value> {
    if !open() {
        return None;
    }
    let path = std::env::var_os("PATH")?;
    let executable: PathBuf = tmt_invoke::find_executable(OsStr::new("gh"), &path)?;
    let mut args: Vec<OsString> = args.iter().map(OsString::from).collect();
    if args.first().is_some_and(|arg| arg == "api") {
        args.splice(
            1..1,
            [OsString::from("--hostname"), OsString::from("github.com")],
        );
    }
    // Only the user's gh login/config is available; token-bearing environment variables are
    // deliberately not inherited by the child.
    let allowed: Vec<OsString> = [
        "HOME",
        "PATH",
        "XDG_CONFIG_HOME",
        "GH_CONFIG_DIR",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "NO_PROXY",
    ]
    .into_iter()
    .map(OsString::from)
    .collect();
    let output = tmt_invoke::invoke(
        tmt_invoke::Request {
            program: &executable,
            args: &args,
            input: &[],
            deadline: Instant::now() + CALL_TIMEOUT,
            max_stream_bytes: MAX_OUTPUT,
            launch: tmt_invoke::LaunchOptions {
                environment: tmt_invoke::EnvironmentPolicy::ClearAllowlist(&allowed),
                ..Default::default()
            },
        },
        Some(stop),
    )
    .ok()?;
    if !output.status.success() || !open() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}
fn arg(s: &str) -> String {
    s.to_owned()
}
fn percent(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                char::from(b).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
fn pr(
    link: &PullLink,
    stop: &AtomicBool,
    open: &dyn Fn() -> bool,
    call: &GhCall<'_>,
) -> Option<(Fact, Option<String>)> {
    // Only the rollup enum is requested; individual check names and output never enter Colab.
    let query = "query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){state mergeCommit{oid} commits(last:1){nodes{commit{statusCheckRollup{state}}}}}}}";
    let value = call(
        &[
            arg("api"),
            arg("graphql"),
            arg("-f"),
            format!("query={query}"),
            arg("-f"),
            format!("owner={}", link.owner),
            arg("-f"),
            format!("repo={}", link.repo),
            arg("-F"),
            format!("number={}", link.number),
        ],
        stop,
        open,
    )?;
    let value = value.pointer("/data/repository/pullRequest")?;
    let state = match value["state"].as_str()? {
        "OPEN" => "open",
        "MERGED" => "merged",
        "CLOSED" => "closed",
        _ => return None,
    };
    let checks = value
        .pointer("/commits/nodes/0/commit/statusCheckRollup/state")
        .and_then(Value::as_str)
        .filter(|v| matches!(*v, "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | "EXPECTED"))
        .map(str::to_owned);
    let merge = value
        .pointer("/mergeCommit/oid")
        .and_then(Value::as_str)
        .filter(|s| s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit()))
        .map(str::to_owned);
    if state == "merged" && merge.is_none() {
        return None;
    }
    Some((
        Fact {
            state: state.into(),
            checks,
            released: None,
            tag: None,
            observed_at_ms: crate::registration::now_ms().ok()?,
        },
        merge,
    ))
}
fn releases(
    link: &PullLink,
    stop: &AtomicBool,
    open: &dyn Fn() -> bool,
    call: &GhCall,
) -> Option<Vec<String>> {
    let endpoint = format!("repos/{}/{}/releases?per_page=100", link.owner, link.repo);
    let value = call(
        &[
            arg("api"),
            endpoint,
            arg("--jq"),
            arg("[.[] | select(.draft == false) | .tag_name]"),
        ],
        stop,
        open,
    )?;
    let items = value.as_array()?;
    if items.len() > 100 {
        return None;
    }
    items
        .iter()
        .map(|v| {
            v.as_str()
                .filter(|s| !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control))
                .map(str::to_owned)
        })
        .collect()
}
fn contains(
    link: &PullLink,
    tag: &str,
    sha: &str,
    stop: &AtomicBool,
    open: &dyn Fn() -> bool,
    call: &GhCall<'_>,
) -> Option<bool> {
    let endpoint = format!(
        "repos/{}/{}/compare/{}...{}",
        link.owner,
        link.repo,
        percent(tag),
        sha
    );
    let value = call(
        &[arg("api"), endpoint, arg("--jq"), arg("{status:.status}")],
        stop,
        open,
    )?;
    match value["status"].as_str()? {
        "behind" | "identical" => Some(true),
        "ahead" | "diverged" => Some(false),
        _ => None,
    }
}
impl Facts {
    /// Called only by an admitted owner page; `open` is rechecked before every external call.
    pub fn observe(
        &self,
        layout: &crate::keyring::Layout,
        link: &PullLink,
        prefix: Option<&str>,
        stop: &AtomicBool,
        open: impl Fn() -> bool,
    ) -> FactRead {
        self.observe_result(layout, link, prefix, stop, &open, &gh)
    }

    #[cfg(test)]
    fn observe_with(
        &self,
        layout: &crate::keyring::Layout,
        link: &PullLink,
        prefix: Option<&str>,
        stop: &AtomicBool,
        open: &dyn Fn() -> bool,
        call: &GhCall<'_>,
    ) -> Option<Fact> {
        self.observe_result(layout, link, prefix, stop, open, call)
            .fact
    }

    fn observe_result(
        &self,
        layout: &crate::keyring::Layout,
        link: &PullLink,
        prefix: Option<&str>,
        stop: &AtomicBool,
        open: &dyn Fn() -> bool,
        call: &GhCall<'_>,
    ) -> FactRead {
        if !open() {
            return FactRead {
                fact: None,
                busy_unknown: false,
            };
        }
        let key = format!("{}\n{}", link.url(), prefix.unwrap_or(""));
        let mut state = match self.state.try_lock() {
            Ok(state) => state,
            Err(std::sync::TryLockError::WouldBlock) => {
                let fact = self
                    .retained
                    .lock()
                    .ok()
                    .and_then(|cache| cache.get(&key).cloned());
                return FactRead {
                    busy_unknown: fact.is_none(),
                    fact,
                };
            }
            Err(std::sync::TryLockError::Poisoned(_)) => {
                return FactRead {
                    fact: None,
                    busy_unknown: true,
                };
            }
        };
        let fact = self.observe_locked(layout, link, prefix, stop, open, call, &mut state, &key);
        if let Some(fact) = &fact
            && let Ok(mut retained) = self.retained.lock()
        {
            retained.insert(key, fact.clone());
        }
        FactRead {
            fact,
            busy_unknown: false,
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn observe_locked(
        &self,
        layout: &crate::keyring::Layout,
        link: &PullLink,
        prefix: Option<&str>,
        stop: &AtomicBool,
        open: &dyn Fn() -> bool,
        call: &GhCall<'_>,
        state: &mut State,
        key: &str,
    ) -> Option<Fact> {
        let now = Instant::now();
        if !state.prs.contains_key(key) && state.prs.len() >= 1024 {
            let oldest = state
                .prs
                .iter()
                .filter(|(_, entry)| entry.due <= now)
                .min_by_key(|(_, entry)| entry.due)
                .map(|(key, _)| key.clone())?;
            state.prs.remove(&oldest);
            if let Ok(mut retained) = self.retained.lock() {
                retained.remove(&oldest);
            }
        }
        if let Some(held) = state.prs.get(key)
            && (held.due > now
                || held
                    .fact
                    .as_ref()
                    .is_some_and(|f| f.released == Some(true) || f.state == "closed"))
        {
            return held.fact.clone();
        }
        if let Some((sha, tag, observed_at_ms)) = crate::store::Store::read(layout)
            .ok()
            .and_then(|store| store.work_release_facts(&link.url()).ok())
            .and_then(|facts| {
                facts
                    .into_iter()
                    .find(|(_, tag, _)| prefix.is_none_or(|prefix| tag.starts_with(prefix)))
            })
        {
            let fact = Fact {
                state: "merged".into(),
                checks: None,
                released: Some(true),
                tag: Some(tag),
                observed_at_ms,
            };
            state.prs.insert(
                key.to_owned(),
                PrEntry {
                    due: now + PR_INTERVAL,
                    fact: Some(fact.clone()),
                    merge: Some(sha),
                },
            );
            return Some(fact);
        }
        let cached_merged = state.prs.get(key).and_then(|held| {
            held.fact
                .as_ref()
                .filter(|f| f.state == "merged")
                .cloned()
                .zip(held.merge.clone())
        });
        // Different pages may apply different tag prefixes to the same PR. Share its PR read
        // across those prefixes so it is never polled more often than the per-PR floor.
        let other_key = format!("{}\n", link.url());
        let shared = state
            .prs
            .iter()
            .find(|(candidate, held)| {
                candidate.starts_with(&other_key)
                    && (held.due > now
                        || held
                            .fact
                            .as_ref()
                            .is_some_and(|fact| fact.state == "merged"))
            })
            .map(|(_, held)| (held.due, held.fact.clone(), held.merge.clone()));
        if let Some((due, None, _)) = &shared {
            state.prs.insert(
                key.to_owned(),
                PrEntry {
                    due: *due,
                    fact: None,
                    merge: None,
                },
            );
            return None;
        }
        let result = if let Some((fact, merge)) = cached_merged {
            Some((fact, Some(merge)))
        } else if let Some((_, Some(mut fact), merge)) = shared {
            fact.released = None;
            fact.tag = None;
            Some((fact, merge))
        } else {
            pr(link, stop, open, call)
        };
        let Some((mut fact, merge)) = result else {
            state.prs.insert(
                key.to_owned(),
                PrEntry {
                    due: now + PR_INTERVAL,
                    fact: None,
                    merge: None,
                },
            );
            return None;
        };
        if let Some(sha) = merge.as_deref() {
            let repo = link.repo_key();
            if !state.releases.contains_key(&repo) && state.releases.len() >= 128 {
                let oldest = state
                    .releases
                    .iter()
                    .filter(|(_, entry)| entry.due <= now)
                    .min_by_key(|(_, entry)| entry.due)
                    .map(|(key, _)| key.clone())?;
                state.releases.remove(&oldest);
            }
            let needs = state
                .releases
                .get(&repo)
                .is_none_or(|entry| entry.due <= now);
            if needs {
                let tags = releases(link, stop, open, call);
                let observed_at_ms = crate::registration::now_ms().ok()?;
                state.releases.insert(
                    repo.clone(),
                    ReleaseEntry {
                        due: now + RELEASE_INTERVAL,
                        tags,
                        observed_at_ms,
                    },
                );
            }
            if let Some(entry) = state.releases.get(&repo) {
                fact.observed_at_ms = entry.observed_at_ms;
            }
            if let Some(tags) = state
                .releases
                .get(&repo)
                .and_then(|entry| entry.tags.as_ref())
                .filter(|tags| !tags.is_empty())
                .cloned()
            {
                let mut released = Some(false);
                for tag in tags
                    .iter()
                    .filter(|tag| prefix.is_none_or(|prefix| tag.starts_with(prefix)))
                    .take(10)
                {
                    let comparison_key = (link.url(), sha.to_owned(), tag.clone());
                    let answer = state.comparisons.get(&comparison_key).copied().or_else(|| {
                        if state.comparisons.len() >= 10_240 {
                            state.comparisons.clear(); // successful comparisons are retained in the owner store
                        }
                        let stored = crate::store::Store::read(layout)
                            .ok()?
                            .work_release_comparison(&link.url(), sha, tag)
                            .ok()?;
                        let answer = if let Some(stored) = stored {
                            stored
                        } else {
                            let answer = contains(link, tag, sha, stop, open, call)?;
                            crate::store::Store::write_existing(layout)
                                .ok()?
                                .remember_work_release_comparison(&link.url(), sha, tag, answer)
                                .ok()?;
                            answer
                        };
                        state.comparisons.insert(comparison_key, answer);
                        Some(answer)
                    });
                    match answer {
                        Some(true) => {
                            if crate::store::Store::write_existing(layout)
                                .ok()
                                .is_some_and(|store| {
                                    store
                                        .remember_work_release(
                                            &link.url(),
                                            sha,
                                            tag,
                                            fact.observed_at_ms,
                                        )
                                        .is_ok()
                                })
                            {
                                released = Some(true);
                                fact.tag = Some(tag.clone());
                            } else {
                                released = None;
                            }
                            break;
                        }
                        Some(false) => {}
                        None => {
                            released = None;
                            break;
                        }
                    }
                }
                fact.released = released;
            }
        }
        state.prs.insert(
            key.to_owned(),
            PrEntry {
                due: now + PR_INTERVAL,
                fact: Some(fact.clone()),
                merge,
            },
        );
        Some(fact)
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn title_discovery_is_bounded_and_unavailable_gh_stays_unknown() {
        let numbers = ["COLAB-128".to_owned()];
        let stop = AtomicBool::new(false);
        let data = |args: &[String], _: &AtomicBool, _: &dyn Fn() -> bool| {
            assert_eq!(
                args,
                [
                    "pr",
                    "list",
                    "--repo",
                    "example/project",
                    "--state",
                    "all",
                    "--limit",
                    "21",
                    "--json",
                    "number,title",
                    "--search",
                    "\"COLAB-128\" in:title"
                ]
            );
            Some(json!(
                (1..=21)
                    .map(|n| json!({"title":"Fix colab-128","number":n}))
                    .collect::<Vec<_>>()
            ))
        };
        let found = Facts::default()
            .discover_with("example/project", &numbers, &stop, &|| true, &data)
            .unwrap();
        assert_eq!(found[0].1.len(), 20);
        assert_eq!(found[0].2, "partial");
        let explicit = PullLink::parse("https://github.com/Example/PROJECT/pull/1").unwrap();
        assert!(found[0].1[0].same_pull(&explicit));
        let missing = Facts::default()
            .discover_with("example/project", &numbers, &stop, &|| true, &|_, _, _| {
                None
            })
            .unwrap();
        assert_eq!(missing[0].2, "unknown");
        assert!(missing[0].1.is_empty());
    }

    #[test]
    fn title_work_number_is_an_entire_ascii_token() {
        assert!(super::title_matches("Fix [colab-128]: ready", "COLAB-128"));
        for near in [
            "COLAB-1280",
            "pre-COLAB-128",
            "COLAB-128_more",
            "XCOLAB-128",
        ] {
            assert!(!super::title_matches(near, "COLAB-128"));
        }
    }

    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[test]
    fn only_explicit_page_urls_become_prs() {
        let source = r#"<script>https://github.com/a/b/pull/9</script><div hidden><a href="https://github.com/acme/app/pull/16">hidden</a></div><a href="https://github.com/acme/app/pull/12?x=1">review</a><p>https://github.com/acme/app/pull/12 and https://github.com/acme/app/pull/13.</p>"#;
        let blocks = json!({"a":{"type":"paragraph","text":{"s":"https://github.com/acme/app/pull/14","marks":[]}},"b":{"type":"paragraph","deleted":{},"text":{"s":"https://github.com/acme/app/pull/15","marks":[]}}});
        let result = page_links(source, Some(&blocks)).unwrap();
        assert_eq!(
            result.iter().map(PullLink::url).collect::<Vec<_>>(),
            vec![
                "https://github.com/acme/app/pull/12",
                "https://github.com/acme/app/pull/13",
                "https://github.com/acme/app/pull/14"
            ]
        );
        assert!(PullLink::parse("https://github.com/acme/app/pull/1/commits").is_none());
        assert!(PullLink::parse("https://github.com.evil/acme/app/pull/1").is_none());
    }

    #[test]
    fn busy_reader_uses_retained_facts_and_marks_a_missing_fact() {
        let root = std::env::temp_dir().join(format!("tmt-work-facts-busy-{}", std::process::id()));
        let layout = crate::keyring::Layout::open(&root).unwrap();
        let link = PullLink::parse("https://github.com/acme/app/pull/12").unwrap();
        let missing = PullLink::parse("https://github.com/acme/app/pull/13").unwrap();
        let facts = Facts::default();
        facts.retained.lock().unwrap().insert(
            format!("{}\n", link.url()),
            Fact {
                state: "open".into(),
                checks: Some("PENDING".into()),
                released: None,
                tag: None,
                observed_at_ms: 123,
            },
        );
        let _in_flight = facts.state.lock().unwrap();
        let stop = AtomicBool::new(false);
        let no_call = |_: &[String], _: &AtomicBool, _: &dyn Fn() -> bool| -> Option<Value> {
            panic!("a busy read must not launch another request")
        };
        let held = facts.observe_result(&layout, &link, None, &stop, &|| true, &no_call);
        assert!(!held.busy_unknown);
        assert_eq!(held.fact.unwrap().observed_at_ms, 123);
        let absent = facts.observe_result(&layout, &missing, None, &stop, &|| true, &no_call);
        assert!(absent.busy_unknown);
        assert!(absent.fact.is_none());
        facts.retained_activities.lock().unwrap().insert(
            "owner".into(),
            OwnerObservation {
                state: "working".into(),
                last_activity_ms: Some(100),
                observed_at_ms: 123,
            },
        );
        let _activity_in_flight = facts.activities.lock().unwrap();
        let held_activity = facts.activity("owner", &stop);
        assert!(!held_activity.busy_unknown);
        assert_eq!(held_activity.observation.unwrap().observed_at_ms, 123);
        let absent_activity = facts.activity("another", &stop);
        assert!(absent_activity.busy_unknown);
        assert!(absent_activity.observation.is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn owner_page_release_is_retained_and_not_polled_again() {
        let root = std::env::temp_dir().join(format!("tmt-work-facts-{}", std::process::id()));
        let layout = crate::keyring::Layout::open(&root).unwrap();
        crate::store::Store::open(&layout).unwrap().close().unwrap();
        let calls = AtomicUsize::new(0);
        let reader = |args: &[String], _: &AtomicBool, open: &dyn Fn() -> bool| {
            assert!(open());
            calls.fetch_add(1, Ordering::SeqCst);
            if args.get(1).is_some_and(|s| s == "graphql") {
                Some(
                    json!({"data":{"repository":{"pullRequest":{"state":"MERGED","mergeCommit":{"oid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"commits":{"nodes":[{"commit":{"statusCheckRollup":{"state":"SUCCESS"}}}]}}}}}),
                )
            } else if args.get(1).is_some_and(|s| s.contains("releases?")) {
                assert!(args[1].ends_with("per_page=100"));
                let mut tags: Vec<String> = (0..12).map(|n| format!("other-v{n}")).collect();
                tags.push("app-v1.0.0".into());
                Some(json!(tags))
            } else if args.get(1).is_some_and(|s| s.contains("compare/")) {
                assert!(args[1].contains("app-v1.0.0"));
                Some(json!({"status":"behind"}))
            } else {
                None
            }
        };
        let link = PullLink::parse("https://github.com/acme/app/pull/12").unwrap();
        let stop = AtomicBool::new(false);
        let facts = Facts::default();
        let found = facts
            .observe_with(&layout, &link, Some("app-v"), &stop, &|| true, &reader)
            .unwrap();
        assert_eq!(found.released, Some(true));
        assert_eq!(found.tag.as_deref(), Some("app-v1.0.0"));
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        assert!(
            facts
                .observe_with(&layout, &link, Some("app-v"), &stop, &|| true, &reader)
                .is_some()
        );
        assert!(
            Facts::default()
                .observe_with(&layout, &link, Some("app-v"), &stop, &|| true, &reader)
                .is_some()
        );
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        assert!(
            facts
                .observe_with(&layout, &link, Some("app-v"), &stop, &|| false, &reader)
                .is_none()
        );
        assert_eq!(calls.load(Ordering::SeqCst), 3);
        let unavailable = PullLink::parse("https://github.com/acme/app/pull/99").unwrap();
        let failed_calls = AtomicUsize::new(0);
        let missing_gh = |_: &[String], _: &AtomicBool, _: &dyn Fn() -> bool| {
            failed_calls.fetch_add(1, Ordering::SeqCst);
            None
        };
        assert!(
            facts
                .observe_with(&layout, &unavailable, None, &stop, &|| true, &missing_gh)
                .is_none()
        );
        assert!(
            facts
                .observe_with(&layout, &unavailable, None, &stop, &|| true, &missing_gh)
                .is_none()
        );
        assert_eq!(failed_calls.load(Ordering::SeqCst), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
}
