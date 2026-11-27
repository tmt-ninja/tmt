//! The price file's validation, fallback order and fetch, against a loopback
//! server and a private directory; nothing here touches the network.

use super::{
    BUILT_IN, Lookup, Resolved, Table, Tokens, built_in, cache,
    fetch::{self, Target},
};
use serde_json::{Value, json};
use std::{
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

const NOW: u64 = 1_800_000_000_000;
static NEXT: AtomicU64 = AtomicU64::new(0);

struct Temp(PathBuf);
impl Temp {
    fn new() -> Self {
        // The private-path rule refuses symlinks, and macOS's temp dir is under `/var`.
        let root = fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!(
                "tmt-digest-pricing-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
        fs::create_dir(&root).unwrap();
        Self(root)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

#[derive(Clone)]
enum Answer {
    Body(Vec<u8>),
    Status(u16),
    Redirect,
    Stall,
}

struct Server {
    address: SocketAddr,
    hits: Arc<AtomicUsize>,
    requests: Arc<Mutex<Vec<String>>>,
    stopped: Arc<AtomicBool>,
}
impl Server {
    fn answering(answer: Answer) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let hits = Arc::new(AtomicUsize::new(0));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let stopped = Arc::new(AtomicBool::new(false));
        let (seen, heads, done) = (hits.clone(), requests.clone(), stopped.clone());
        std::thread::spawn(move || {
            for mut stream in listener.incoming().flatten() {
                if done.load(Ordering::SeqCst) {
                    return;
                }
                seen.fetch_add(1, Ordering::SeqCst);
                let mut head = [0u8; 4096];
                let read = stream.read(&mut head).unwrap_or(0);
                heads
                    .lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&head[..read]).into_owned());
                let answer = answer.clone();
                std::thread::spawn(move || match answer {
                    Answer::Body(body) => reply(&mut stream, "200 OK", "", &body),
                    Answer::Status(code) => reply(&mut stream, &format!("{code} Nope"), "", b"{}"),
                    Answer::Redirect => reply(
                        &mut stream,
                        "301 Moved Permanently",
                        "Location: /elsewhere\r\n",
                        b"",
                    ),
                    Answer::Stall => std::thread::sleep(Duration::from_secs(6)),
                });
            }
        });
        Self {
            address,
            hits,
            requests,
            stopped,
        }
    }

    fn hits(&self) -> usize {
        self.hits.load(Ordering::SeqCst)
    }

    fn target(&self) -> Target {
        Target::local(format!("http://{}/pricing-v2.json", self.address))
    }
}
impl Drop for Server {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::SeqCst);
        let _ = TcpStream::connect(self.address);
    }
}
fn reply(stream: &mut TcpStream, status: &str, extra: &str, body: &[u8]) {
    let head = format!(
        "HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(head.as_bytes());
    let _ = stream.write_all(body);
}

/// The old single-class call shape: `n` tokens of uncached input, as the quote's JSON.
trait QuoteInput {
    fn quote_input(&self, model: &str, observed_at: u64, n: u64) -> Option<Value>;
}
impl QuoteInput for Table {
    fn quote_input(&self, model: &str, observed_at: u64, n: u64) -> Option<Value> {
        self.quote(model, observed_at, Tokens::uncached_input(n))
            .ok()
            .map(|quote| quote.json().clone())
    }
}

fn base() -> Value {
    serde_json::from_str(BUILT_IN).unwrap()
}
fn bytes(file: &Value) -> Vec<u8> {
    serde_json::to_vec(file).unwrap()
}
/// The built-in file after `edit`, as bytes.
fn edited(edit: impl FnOnce(&mut Value)) -> Vec<u8> {
    let mut file = base();
    edit(&mut file);
    bytes(&file)
}
/// A later version with one changed price.
fn newer() -> Value {
    let mut file = base();
    file["version"] = json!("2026-12-01");
    file["models"][0]["usdMicrosPerMillion"]["input"] = json!(5_000_000);
    file
}
/// An older version: no row may be verified after its file's version.
fn backdate(file: &mut Value, date: &str) {
    file["version"] = json!(date);
    for row in file["models"].as_array_mut().unwrap() {
        row["asOf"] = json!(date);
    }
}
fn table(file: &Value) -> Table {
    Table::parse(&bytes(file)).unwrap()
}
fn state(file: &Value, attempted: u64) -> cache::State {
    cache::State {
        attempted_at_ms: attempted,
        fetched_at_ms: Some(attempted),
        file: Some(table(file)),
    }
}
fn price(resolved: &Resolved, model: &str) -> u64 {
    resolved.document()["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["modelId"] == model)
        .unwrap()["usdMicrosPerMillion"]["input"]
        .as_u64()
        .unwrap()
}

#[test]
fn the_embedded_file_is_the_documented_table() {
    let document = Resolved::built_in().document();
    assert_eq!(document["version"], "2026-11-27");
    assert_eq!(document["asOf"], "2026-11-27");
    assert_eq!(document["basis"], "standard-list");
    assert_eq!(document["origin"], "built-in");
    assert!(document.get("fetchedAtMs").is_none());
    let models: Vec<_> = document["models"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["modelId"].as_str().unwrap())
        .collect();
    // A dated row follows the row it replaces.
    assert_eq!(
        models,
        [
            "claude-opus-5-5",
            "claude-sonnet-5-5",
            "gpt-6-astra",
            "gpt-6-sol",
            "gpt-6.1-sol",
            "gpt-6.1-terra",
            "gpt-6.2-sol",
            "gpt-6.2-astra",
            "gemini-3-flash-preview",
            "gemini-3.1-flash-lite",
            "gemini-3.1-pro-preview",
            "gemini-3.5-flash-lite",
            "gemini-3.6-flash",
            "gemini-3.6-flash",
            "gemini-3.8-flash",
            "gemini-3.8-flash",
            "gemini-4-argon",
            "gemini-4-argon",
            "gemini-3.8-flash-low",
            "gemini-3.8-flash-low",
            "gemini-3.8-flash-medium",
            "gemini-3.8-flash-medium",
            "gemini-3.8-flash-high",
            "gemini-3.8-flash-high",
            "gemini-4-argon-low",
            "gemini-4-argon-low",
            "gemini-4-argon-medium",
            "gemini-4-argon-medium",
            "gemini-4-argon-high",
            "gemini-4-argon-high",
            "gemini-4-hydrogen",
            "gemini-4-hydrogen-low",
            "gemini-4-hydrogen-medium",
            "gemini-4-hydrogen-high",
            "codex-auto-review",
        ]
    );
    // The file on disk is what the build embeds; the release asset is checked against it.
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../pricing/pricing-v2.json");
    assert_eq!(fs::read_to_string(path).unwrap(), BUILT_IN);
    assert_eq!(built_in(), &Table::parse(BUILT_IN.as_bytes()).unwrap());
}

#[test]
fn every_malformed_file_is_dropped() {
    let text = BUILT_IN.to_owned();
    let cases: Vec<(&str, Vec<u8>)> = vec![
        ("extra top-level key", edited(|f| f["extra"] = json!(1))),
        (
            "missing key",
            edited(|f| {
                f["models"][0].as_object_mut().unwrap().remove("asOf");
            }),
        ),
        (
            "wrong schema",
            edited(|f| f["schema"] = json!("tmt-digest-pricing-v1")),
        ),
        (
            "impossible date",
            edited(|f| f["version"] = json!("2026-02-30")),
        ),
        (
            "month 13",
            edited(|f| f["models"][0]["asOf"] = json!("2026-13-01")),
        ),
        ("short date", edited(|f| f["version"] = json!("26-10-14"))),
        (
            "unknown basis",
            edited(|f| f["basis"] = json!("cached-input")),
        ),
        ("no models", edited(|f| f["models"] = json!([]))),
        (
            "an effectiveFrom left out instead of null",
            edited(|f| {
                f["models"][0]
                    .as_object_mut()
                    .unwrap()
                    .remove("effectiveFrom");
            }),
        ),
        (
            "an impossible effectiveFrom",
            edited(|f| f["models"][0]["effectiveFrom"] = json!("2026-11-31")),
        ),
        (
            "a model's dated rows out of order",
            edited(|f| {
                let rows = f["models"].as_array_mut().unwrap();
                let at = rows
                    .iter()
                    .position(|row| row["effectiveFrom"] == "2026-12-01")
                    .unwrap();
                rows.swap(at - 1, at);
            }),
        ),
        (
            "two rows of one model with the same start",
            edited(|f| {
                let mut again = f["models"][0].clone();
                again["usdMicrosPerMillion"]["input"] = json!(1);
                f["models"].as_array_mut().unwrap().push(again);
            }),
        ),
        (
            "a root asOf, as v1 had",
            edited(|f| f["asOf"] = json!("2026-11-27")),
        ),
        (
            "a row verified after the version",
            edited(|f| f["models"][0]["asOf"] = json!("2026-11-28")),
        ),
        (
            "a null input rate",
            edited(|f| f["models"][0]["usdMicrosPerMillion"]["input"] = json!(null)),
        ),
        (
            "a class left out instead of null",
            edited(|f| {
                f["models"][0]["usdMicrosPerMillion"]
                    .as_object_mut()
                    .unwrap()
                    .remove("cacheWrite");
            }),
        ),
        (
            "an unknown class",
            edited(|f| f["models"][0]["usdMicrosPerMillion"]["reasoning"] = json!(1)),
        ),
        (
            "an output rate above the safe integer",
            edited(|f| {
                f["models"][0]["usdMicrosPerMillion"]["output"] = json!(9_007_199_254_740_992u64)
            }),
        ),
        (
            "duplicate model",
            edited(|f| {
                let first = f["models"][0].clone();
                f["models"].as_array_mut().unwrap().push(first);
            }),
        ),
        (
            "model id with a space",
            edited(|f| f["models"][0]["modelId"] = json!("a b")),
        ),
        (
            "empty model id",
            edited(|f| f["models"][0]["modelId"] = json!("")),
        ),
        (
            "negative price",
            edited(|f| f["models"][0]["usdMicrosPerMillion"]["input"] = json!(-1)),
        ),
        (
            "fractional price",
            edited(|f| f["models"][0]["usdMicrosPerMillion"]["input"] = json!(1.5)),
        ),
        (
            "price above the safe integer",
            edited(|f| {
                f["models"][0]["usdMicrosPerMillion"]["input"] = json!(9_007_199_254_740_992u64)
            }),
        ),
        (
            "price as text",
            edited(|f| f["models"][0]["usdMicrosPerMillion"]["input"] = json!("4000000")),
        ),
        (
            "plain http source",
            edited(|f| f["models"][0]["source"] = json!("http://example.com/prices")),
        ),
        (
            "source with a space",
            edited(|f| f["models"][0]["source"] = json!("https://example.com/a b")),
        ),
        (
            "source over 256 bytes",
            edited(|f| {
                f["models"][0]["source"] = json!(format!("https://example.com/{}", "a".repeat(250)))
            }),
        ),
        (
            "unknown model key",
            edited(|f| f["models"][0]["cached"] = json!(1)),
        ),
        (
            "65 models",
            edited(|f| {
                f["models"] = (0..65)
                    .map(|index| {
                        json!({"modelId":format!("m{index}"),"effectiveFrom":null,
                            "usdMicrosPerMillion":{"input":1,"cachedInput":null,
                                "cacheWrite":null,"output":null},
                            "source":"https://example.com/p","asOf":"2026-11-27"})
                    })
                    .collect()
            }),
        ),
        ("trailing text", format!("{text} x").into_bytes()),
        (
            "byte order mark",
            [b"\xef\xbb\xbf".as_slice(), text.as_bytes()].concat(),
        ),
        ("not UTF-8", [text.as_bytes(), b"\xff"].concat()),
        (
            "duplicate key",
            text.replacen("\"version\"", "\"version\": \"2026-11-05\", \"version\"", 1)
                .into_bytes(),
        ),
        (
            "over 32 KiB",
            format!("{text}{}", " ".repeat(32 * 1024)).into_bytes(),
        ),
        ("empty", Vec::new()),
        ("an array", b"[]".to_vec()),
    ];
    assert!(Table::parse(text.as_bytes()).is_some());
    for (name, body) in cases {
        assert!(Table::parse(&body).is_none(), "{name} must be dropped");
    }
}

#[test]
fn a_version_is_one_table_and_never_older_than_what_is_known() {
    let known = table(&base());
    let mut repriced = base();
    repriced["models"][1]["usdMicrosPerMillion"]["input"] = json!(2_000_001);
    let mut re_sourced = base();
    re_sourced["models"][1]["source"] = json!("https://example.com/other");
    let mut older = base();
    backdate(&mut older, "2026-10-13");
    assert!(known.follows(&known), "the same table again");
    assert!(
        table(&newer()).follows(&known),
        "a later version may differ"
    );
    assert!(
        !table(&repriced).follows(&known),
        "a known version with other prices"
    );
    assert!(
        !table(&re_sourced).follows(&known),
        "a known version with other content"
    );
    assert!(
        !table(&older).follows(&known),
        "an older version never rolls back"
    );
}

#[test]
fn quotes_use_the_table_in_hand() {
    let fetched = table(&newer());
    let quote = fetched.quote_input("claude-opus-5-5", 7, 1_000).unwrap();
    assert_eq!(quote["pricingVersion"], "2026-12-01");
    assert_eq!(quote["usdMicrosPerMillion"]["input"], 5_000_000);
    assert_eq!(quote["usdMicros"], 5_000);
    let old = built_in().quote_input("claude-opus-5-5", 7, 1_000).unwrap();
    assert_eq!(old["pricingVersion"], "2026-11-27");
    assert_eq!(old["usdMicros"], 4_000);
    assert!(fetched.quote_input("unknown-model", 7, 1).is_none());
    let root = Temp::new();
    assert_eq!(
        Resolved::read_only(&root.0).document()["origin"],
        "built-in"
    );
    assert!(
        !root.0.join("digest").exists(),
        "a usage read never creates a cache"
    );
    cache::write(
        &root.0,
        &cache::State {
            attempted_at_ms: 7,
            fetched_at_ms: Some(7),
            file: Some(fetched),
        },
    )
    .unwrap();
    let file = root.0.join("digest/pricing/fetched-v1.json");
    let before = fs::read(&file).unwrap();
    let resolved = Resolved::read_only(&root.0);
    assert_eq!(resolved.document()["origin"], "cached");
    assert_eq!(
        resolved
            .table()
            .quote_input("claude-opus-5-5", 7, 1000)
            .unwrap()["usdMicros"],
        5000
    );
    assert_eq!(
        fs::read(file).unwrap(),
        before,
        "reading prices leaves cache bytes intact"
    );
}

#[test]
fn the_address_override_admits_https_and_this_machine_only() {
    for url in [
        "https://example.com/p.json",
        "http://127.0.0.1/p.json",
        "http://127.0.0.1:8080/p.json",
        "http://localhost:1/x",
        "http://[::1]:9/x",
        "http://[::1]",
    ] {
        assert!(fetch::admit(url).is_some(), "{url}");
    }
    for url in [
        "",
        "off",
        "http://example.com/p.json",
        "http://127.0.0.1.example.com/p.json",
        "http://localhost@example.com/p.json",
        "http://localhostx/p.json",
        "ftp://127.0.0.1/p.json",
        "file:///etc/passwd",
        "https://exa mple.com/p.json",
        "https://example.com/p.json\n",
    ] {
        assert!(fetch::admit(url).is_none(), "{url:?}");
    }
    let unset = std::env::VarError::NotPresent;
    assert_eq!(fetch::target_from(Err(unset)).unwrap().url(), fetch::URL);
    assert!(fetch::target_from(Ok("off".into())).is_none());
    assert!(fetch::target_from(Ok(String::new())).is_none());
    assert!(fetch::target_from(Err(std::env::VarError::NotUnicode("x".into()))).is_none());
}

#[test]
fn the_default_address_is_the_raw_main_url_of_the_embedded_file() {
    assert_eq!(
        fetch::URL,
        "https://raw.githubusercontent.com/pj-tmt/tmt/main/extensions/tmt-digest/pricing/pricing-v2.json"
    );
    let default = fetch::target_from(Err(std::env::VarError::NotPresent)).unwrap();
    assert!(!default.is_loopback());
}

#[test]
fn a_valid_fetch_is_used_and_cached_privately() {
    let temp = Temp::new();
    let server = Server::answering(Answer::Body(bytes(&newer())));
    let resolved = Lookup::begin(&temp.0, NOW, Some(server.target())).finish();
    let document = resolved.document();
    assert_eq!(document["version"], "2026-12-01");
    assert_eq!(document["origin"], "fetched");
    assert_eq!(document["fetchedAtMs"], NOW);
    assert_eq!(price(&resolved, "claude-opus-5-5"), 5_000_000);
    let request = server.requests.lock().unwrap().join("\n").to_lowercase();
    assert!(request.starts_with("get /pricing-v2.json http/1.1"));
    assert!(request.contains("user-agent: tmt-digest/"));
    for header in ["authorization", "cookie", "x-github", "referer"] {
        assert!(!request.contains(header), "{header} was sent");
    }
    let stored = temp.0.join("digest/pricing/fetched-v1.json");
    let mode = |path: &Path| fs::metadata(path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&stored), 0o600);
    assert_eq!(mode(&temp.0.join("digest/pricing")), 0o700);
    assert_eq!(mode(&temp.0.join("digest")), 0o700);
    let kept = cache::read(&temp.0).unwrap();
    assert_eq!(kept.attempted_at_ms, NOW);
    assert_eq!(kept.fetched_at_ms, Some(NOW));
    assert_eq!(kept.file, Some(table(&newer())));
    assert_eq!(
        fs::read_dir(temp.0.join("digest/pricing")).unwrap().count(),
        1
    );
    // The next status inside the spacing reads the cache and says so.
    let again = Lookup::begin(&temp.0, NOW + 1_000, Some(server.target())).finish();
    assert_eq!(again.document()["origin"], "cached");
    assert_eq!(again.document()["fetchedAtMs"], NOW);
    assert_eq!(server.hits(), 1);
}

#[test]
fn an_unusable_answer_falls_back_to_the_cache_and_then_the_built_in_table() {
    let mut bad_schema = newer();
    bad_schema["schema"] = json!("x");
    let older = edited(|f| backdate(f, "2026-10-13"));
    let repriced = edited(|f| f["models"][0]["usdMicrosPerMillion"]["input"] = json!(1));
    let answers = [
        ("not found", Answer::Status(404)),
        ("server error", Answer::Status(500)),
        ("redirect", Answer::Redirect),
        ("garbage", Answer::Body(b"<html>".to_vec())),
        ("oversized", Answer::Body(vec![b' '; 17 * 1024])),
        ("wrong schema", Answer::Body(bytes(&bad_schema))),
        ("older than the built-in", Answer::Body(older)),
        ("built-in version, other prices", Answer::Body(repriced)),
    ];
    for (name, answer) in answers {
        let server = Server::answering(answer);
        let temp = Temp::new();
        let resolved = Lookup::begin(&temp.0, NOW, Some(server.target())).finish();
        assert_eq!(resolved.document()["origin"], "built-in", "{name}");
        assert_eq!(price(&resolved, "claude-opus-5-5"), 4_000_000, "{name}");
        let kept = cache::read(&temp.0).unwrap();
        assert_eq!((kept.attempted_at_ms, kept.file), (NOW, None), "{name}");

        let temp = Temp::new();
        cache::write(&temp.0, &state(&newer(), NOW - 60_000)).unwrap();
        let resolved = Lookup::begin(&temp.0, NOW, Some(server.target())).finish();
        let document = resolved.document();
        assert_eq!(document["origin"], "cached", "{name}");
        assert_eq!(document["version"], "2026-12-01", "{name}");
        assert_eq!(document["fetchedAtMs"], NOW - 60_000, "{name}");
        let kept = cache::read(&temp.0).unwrap();
        assert_eq!(
            kept.attempted_at_ms, NOW,
            "{name}: the failed attempt counts"
        );
        assert_eq!(
            kept.file,
            Some(table(&newer())),
            "{name}: the cache keeps its file"
        );
    }
}

#[test]
fn a_fetched_file_cannot_change_the_prices_of_a_known_version() {
    // Known from the cache: the same version with other prices is dropped.
    let temp = Temp::new();
    cache::write(&temp.0, &state(&newer(), NOW - 60_000)).unwrap();
    let mut conflicting = newer();
    conflicting["models"][2]["usdMicrosPerMillion"]["input"] = json!(9);
    let server = Server::answering(Answer::Body(bytes(&conflicting)));
    let resolved = Lookup::begin(&temp.0, NOW, Some(server.target())).finish();
    assert_eq!(resolved.document()["origin"], "cached");
    assert_eq!(price(&resolved, "gpt-6-sol"), 2_000_000);

    // The same file again is the same table and is simply fetched.
    let server = Server::answering(Answer::Body(bytes(&newer())));
    let resolved = Lookup::begin(&temp.0, NOW + 60_000, Some(server.target())).finish();
    assert_eq!(resolved.document()["origin"], "fetched");
    assert_eq!(resolved.document()["fetchedAtMs"], NOW + 60_000);

    // Known from the built-in table: its own bytes are accepted, other prices are not.
    let temp = Temp::new();
    let server = Server::answering(Answer::Body(BUILT_IN.as_bytes().to_vec()));
    let resolved = Lookup::begin(&temp.0, NOW, Some(server.target())).finish();
    assert_eq!(resolved.document()["origin"], "fetched");
    assert_eq!(resolved.table(), built_in());
}

#[test]
fn a_fetched_file_older_than_the_cached_one_is_dropped() {
    // Newer than the built-in table, older than the cache: valid, but it would roll back.
    let mut between = newer();
    between["version"] = json!("2026-11-29");
    between["models"][0]["usdMicrosPerMillion"]["input"] = json!(4_500_000);
    let server = Server::answering(Answer::Body(bytes(&between)));

    let temp = Temp::new();
    let resolved = Lookup::begin(&temp.0, NOW, Some(server.target())).finish();
    assert_eq!(
        resolved.document()["origin"],
        "fetched",
        "alone it is usable"
    );
    assert_eq!(resolved.document()["version"], "2026-11-29");

    let temp = Temp::new();
    cache::write(&temp.0, &state(&newer(), NOW - 60_000)).unwrap();
    let resolved = Lookup::begin(&temp.0, NOW, Some(server.target())).finish();
    let document = resolved.document();
    assert_eq!(document["origin"], "cached");
    assert_eq!(document["version"], "2026-12-01");
    assert_eq!(price(&resolved, "claude-opus-5-5"), 5_000_000);
    let kept = cache::read(&temp.0).unwrap();
    assert_eq!(kept.attempted_at_ms, NOW, "the attempt counts");
    assert_eq!(kept.fetched_at_ms, Some(NOW - 60_000));
    assert_eq!(kept.file, Some(table(&newer())), "the cache keeps its file");
}

#[test]
fn the_next_cache_write_removes_only_stale_temporary_files() {
    let temp = Temp::new();
    let directory = temp.0.join("digest/pricing");
    cache::write(&temp.0, &state(&newer(), NOW - 60_000)).unwrap();
    let aged = |path: &Path, seconds: u64| {
        fs::OpenOptions::new()
            .write(true)
            .open(path)
            .unwrap()
            .set_modified(std::time::SystemTime::now() - Duration::from_secs(seconds))
            .unwrap();
    };
    let make = |name: &str, seconds: u64| {
        let path = directory.join(name);
        fs::write(&path, b"leftover").unwrap();
        aged(&path, seconds);
        path
    };
    let stale = make(".fetched-v1.json.4242", 120);
    let fresh = make(".fetched-v1.json.4343", 5);
    let other_name = make(".fetched-v1.json.old", 120);
    let unrelated = make("notes.txt", 120);
    let not_a_file = directory.join(".fetched-v1.json.4444");
    fs::create_dir(&not_a_file).unwrap();
    let target = temp.0.join("elsewhere");
    fs::write(&target, b"mine").unwrap();
    aged(&target, 120);
    let link = directory.join(".fetched-v1.json.4545");
    symlink(&target, &link).unwrap();

    // An attempt that fails still writes the cache, and that write sweeps.
    let server = Server::answering(Answer::Status(500));
    Lookup::begin(&temp.0, NOW, Some(server.target())).finish();

    assert!(!stale.exists(), "a leftover older than a minute is removed");
    assert!(fresh.exists(), "a concurrent writer's file is never taken");
    assert!(other_name.exists(), "only a writer's pid-named files");
    assert!(unrelated.exists(), "only temporary files");
    assert!(not_a_file.is_dir(), "only plain files");
    assert!(link.symlink_metadata().is_ok(), "a link is left alone");
    assert_eq!(fs::read(&target).unwrap(), b"mine");
    assert!(cache::read(&temp.0).is_some(), "the cache itself is intact");
}

#[test]
fn a_stalled_server_ends_at_the_deadline_and_the_attempt_counts() {
    let temp = Temp::new();
    let server = Server::answering(Answer::Stall);
    let started = Instant::now();
    let resolved = Lookup::begin(&temp.0, NOW, Some(server.target())).finish();
    let waited = started.elapsed();
    assert_eq!(resolved.document()["origin"], "built-in");
    assert!(waited >= Duration::from_millis(1_800), "{waited:?}");
    assert!(waited < Duration::from_millis(3_200), "{waited:?}");
    assert_eq!(cache::read(&temp.0).unwrap().attempted_at_ms, NOW);
    assert_eq!(server.hits(), 1);
}

#[test]
fn attempts_are_thirty_seconds_apart_and_a_failed_one_counts() {
    let temp = Temp::new();
    let server = Server::answering(Answer::Status(500));
    Lookup::begin(&temp.0, NOW, Some(server.target())).finish();
    assert_eq!(server.hits(), 1);
    let soon = Lookup::begin(&temp.0, NOW + 29_999, Some(server.target())).finish();
    assert_eq!(soon.document()["origin"], "built-in");
    assert_eq!(server.hits(), 1, "no second attempt inside the spacing");
    Lookup::begin(&temp.0, NOW + 30_000, Some(server.target())).finish();
    assert_eq!(server.hits(), 2);
    // A clock that moved back is not a reason to wait.
    Lookup::begin(&temp.0, NOW, Some(server.target())).finish();
    assert_eq!(server.hits(), 3);
}

#[test]
fn with_the_fetch_off_the_cache_still_serves_and_nothing_is_written() {
    let temp = Temp::new();
    let none = Lookup::begin(&temp.0, NOW, None).finish();
    assert_eq!(none.document()["origin"], "built-in");
    assert!(!temp.0.join("digest").exists());
    cache::write(&temp.0, &state(&newer(), NOW - 60_000)).unwrap();
    let path = temp.0.join("digest/pricing/fetched-v1.json");
    let before = fs::read(&path).unwrap();
    let cached = Lookup::begin(&temp.0, NOW, None).finish();
    assert_eq!(cached.document()["origin"], "cached");
    assert_eq!(price(&cached, "claude-opus-5-5"), 5_000_000);
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn a_cache_that_no_longer_follows_the_built_in_table_is_ignored() {
    let mut older = base();
    backdate(&mut older, "2026-10-13");
    let mut repriced = base();
    repriced["models"][0]["usdMicrosPerMillion"]["input"] = json!(1);
    for (name, file) in [("older", older), ("same version, other prices", repriced)] {
        let temp = Temp::new();
        cache::write(&temp.0, &state(&file, NOW - 60_000)).unwrap();
        let resolved = Lookup::begin(&temp.0, NOW, None).finish();
        assert_eq!(resolved.document()["origin"], "built-in", "{name}");
        assert_eq!(price(&resolved, "claude-opus-5-5"), 4_000_000, "{name}");
        // A failed attempt does not carry the stale file forward.
        let server = Server::answering(Answer::Status(500));
        Lookup::begin(&temp.0, NOW, Some(server.target())).finish();
        assert_eq!(cache::read(&temp.0).unwrap().file, None, "{name}");
    }
}

#[test]
fn the_cache_is_private_and_untrusted_on_read() {
    let temp = Temp::new();
    let directory = temp.0.join("digest/pricing");
    let path = directory.join("fetched-v1.json");
    let fresh = || {
        cache::write(&temp.0, &state(&newer(), NOW)).unwrap();
        fs::read_to_string(&path).unwrap()
    };
    let chmod = |path: &Path, mode| fs::set_permissions(path, fs::Permissions::from_mode(mode));
    let valid = fresh();
    assert!(cache::read(&temp.0).is_some());

    chmod(&path, 0o644).unwrap();
    assert!(cache::read(&temp.0).is_none(), "group/world readable file");
    fresh();
    chmod(&directory, 0o755).unwrap();
    assert!(cache::read(&temp.0).is_none(), "open directory");
    chmod(&directory, 0o700).unwrap();

    let elsewhere = temp.0.join("elsewhere.json");
    fs::write(&elsewhere, &valid).unwrap();
    chmod(&elsewhere, 0o600).unwrap();
    fs::remove_file(&path).unwrap();
    symlink(&elsewhere, &path).unwrap();
    assert!(cache::read(&temp.0).is_none(), "symlink");
    fs::remove_file(&path).unwrap();

    let file: Value = serde_json::from_str(&valid).unwrap();
    let broken = |name: &str, edit: &dyn Fn(&mut Value)| {
        let mut changed = file.clone();
        edit(&mut changed);
        fs::write(&path, changed.to_string()).unwrap();
        chmod(&path, 0o600).unwrap();
        assert!(cache::read(&temp.0).is_none(), "{name}");
        fs::remove_file(&path).unwrap();
    };
    broken("unknown key", &|f| f["extra"] = json!(1));
    broken("the version-1 cache", &|f| f["version"] = json!(1));
    broken("time without a file", &|f| f["file"] = Value::Null);
    broken("file without a time", &|f| f["fetchedAtMs"] = Value::Null);
    broken("unsafe time", &|f| {
        f["attemptedAtMs"] = json!(9_007_199_254_740_992u64)
    });
    broken("invalid price file", &|f| f["file"]["basis"] = json!("x"));
    broken("over its size bound", &|f| {
        f["padding"] = json!("x".repeat(70 * 1024))
    });
    fs::write(&path, "{").unwrap();
    chmod(&path, 0o600).unwrap();
    assert!(cache::read(&temp.0).is_none(), "truncated");

    // A bad cache is replaced by the next valid write.
    fresh();
    assert!(cache::read(&temp.0).is_some());
}

#[test]
fn exact_gemini_rows_have_the_verified_base_rate_and_unlisted_aliases_stay_unknown() {
    for (model, rate) in [
        ("gemini-3-flash-preview", 500_000),
        ("gemini-3.1-flash-lite", 250_000),
        ("gemini-3.1-pro-preview", 2_000_000),
        ("gemini-3.5-flash-lite", 300_000),
        ("gemini-3.6-flash", 750_000),
        ("gemini-3.8-flash", 750_000),
        ("gemini-4-argon", 2_000_000),
        ("gemini-3.8-flash-low", 750_000),
        ("gemini-3.8-flash-medium", 750_000),
        ("gemini-3.8-flash-high", 750_000),
        ("gemini-4-argon-low", 2_000_000),
        ("gemini-4-argon-medium", 2_000_000),
        ("gemini-4-argon-high", 2_000_000),
        ("gemini-4-hydrogen", 1_500_000),
        ("gemini-4-hydrogen-low", 1_500_000),
        ("gemini-4-hydrogen-medium", 1_500_000),
        ("gemini-4-hydrogen-high", 1_500_000),
    ] {
        let quote = built_in().quote_input(model, 1000, 1_000_000).unwrap();
        assert_eq!(quote["usdMicros"], rate, "{model}");
        assert_eq!(quote["usdMicrosPerMillion"]["input"], rate, "{model}");
        assert_eq!(
            built_in().quote_input(model, 1000, 0).unwrap()["usdMicros"],
            0
        );
    }
    for unknown in [
        "gemini-3.7-flash",
        "gemini-3.5-flash",
        "gemini-3-pro",
        "gemini-4-argon-turbo",
    ] {
        assert!(
            built_in().quote_input(unknown, 1000, 1).is_none(),
            "{unknown}"
        );
        assert!(
            built_in().quote_input(unknown, 1000, 0).is_none(),
            "unknown is not zero"
        );
    }
}

#[test]
fn unbilled_models_are_zero_and_unknown_models_stay_unpriced() {
    // A Codex seat's day: Terra input plus auto-review input values to Terra's share alone.
    let terra = built_in()
        .quote_input("gpt-6.1-terra", 1000, 3_000_000)
        .unwrap();
    let review = built_in()
        .quote_input("codex-auto-review", 1000, 2_000_000)
        .unwrap();
    assert_eq!(terra["usdMicros"], 3_000_000);
    assert_eq!(review["usdMicros"], 0);
    assert_eq!(review["usdMicrosPerMillion"]["input"], 0);
    assert_eq!(review["pricingVersion"], terra["pricingVersion"]);
    assert_eq!(
        built_in()
            .quote_input("gpt-6-astra", 1000, 1_000_000)
            .unwrap()["usdMicros"],
        10_000_000
    );
    // The status table lists the zero row with the rule as its source.
    let document = Resolved::built_in().document();
    let row = document["models"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["modelId"] == "codex-auto-review")
        .unwrap();
    assert_eq!(row["usdMicrosPerMillion"]["input"], 0);
    assert!(
        row["source"]
            .as_str()
            .unwrap()
            .ends_with("digest-v1.md#unbilled-models")
    );
    // Only the named model is unbilled: any other unknown model still blocks a price.
    for unknown in ["codex-auto-review-2", "gpt-6.2-terra", "auto-review"] {
        assert!(
            built_in().quote_input(unknown, 1000, 0).is_none(),
            "{unknown}"
        );
    }
    // A table that prices the model wins over the rule.
    let mut file: Value = serde_json::from_str(BUILT_IN).unwrap();
    file["version"] = json!("2026-12-01");
    file["models"].as_array_mut().unwrap().push(json!({
        "modelId": "codex-auto-review",
        "effectiveFrom": null,
        "usdMicrosPerMillion": {"input": 1_000_000, "cachedInput": null,
            "cacheWrite": null, "output": null},
        "source": "https://example.com/price",
        "asOf": "2026-12-01"
    }));
    let priced = table(&file);
    assert_eq!(
        priced
            .quote_input("codex-auto-review", 1000, 1_000_000)
            .unwrap()["usdMicros"],
        1_000_000
    );
}

fn tokens(input: u64, cached: u64, cache_write: Option<u64>, output: u64) -> Tokens {
    Tokens {
        input,
        cached,
        cache_write,
        output,
    }
}

#[test]
fn each_class_is_priced_at_its_own_rate_and_the_sum_is_rounded_once() {
    // Opus 5.5: $4 input, $0.20 cache hit, $5 5-minute write, $20 output per million.
    let quote = built_in()
        .quote(
            "claude-opus-5-5",
            1000,
            tokens(1_000_000, 600_000, Some(100_000), 50_000),
        )
        .unwrap();
    assert_eq!(quote.usd_micros, 1_200_000 + 120_000 + 500_000 + 1_000_000);
    assert!(!quote.lower_bound);
    let json = quote.json();
    assert_eq!(
        json["tokens"],
        json!({"uncachedInput": 300_000, "cachedInput": 600_000, "cacheWrite": 100_000,
            "output": 50_000})
    );
    assert_eq!(
        json["usdMicrosPerMillion"],
        json!({"input": 4_000_000, "cachedInput": 200_000, "cacheWrite": 5_000_000,
            "output": 20_000_000})
    );
    assert_eq!(json["lowerBound"], false);
    assert_eq!(json["lowerBoundReason"], Value::Null);
    // Flash-Lite: 2 uncached (0.5 µ$) and 20 cached (0.5 µ$) tokens are one micro-dollar
    // together; rounding each class first would give two.
    let small = built_in()
        .quote("gemini-3.1-flash-lite", 1000, tokens(22, 20, Some(0), 0))
        .unwrap();
    assert_eq!(small.usd_micros, 1);
}

#[test]
fn a_class_with_tokens_needs_a_rate_and_an_empty_class_does_not() {
    let mut file = base();
    file["version"] = json!("2026-12-01");
    file["models"][0]["usdMicrosPerMillion"]["output"] = json!(null);
    let table = table(&file);
    let priced = table
        .quote("claude-opus-5-5", 1000, tokens(1_000, 0, Some(0), 0))
        .unwrap();
    assert_eq!(priced.usd_micros, 4_000);
    assert_eq!(priced.json()["usdMicrosPerMillion"]["output"], Value::Null);
    assert_eq!(
        table.quote("claude-opus-5-5", 1000, tokens(1_000, 0, Some(0), 1)),
        Err(super::Unpriced::ClassPriceMissing)
    );
    assert_eq!(
        super::Unpriced::ClassPriceMissing.reason(),
        "class_price_missing"
    );
    assert_eq!(
        built_in().quote("gpt-7", 1000, tokens(0, 0, Some(0), 0)),
        Err(super::Unpriced::NoPrice)
    );
}

#[test]
fn unreported_cache_writes_are_a_floor_only_where_the_provider_bills_them() {
    // OpenAI bills writes at 1.25x input; Codex reports no count: input rate, marked a floor.
    let floor = built_in()
        .quote("gpt-6.2-sol", 1000, tokens(1_000_000, 400_000, None, 0))
        .unwrap();
    assert_eq!(floor.usd_micros, 1_200_000 + 40_000);
    assert!(floor.lower_bound);
    assert_eq!(floor.json()["lowerBound"], true);
    assert_eq!(floor.json()["lowerBoundReason"], "cache_write_unreported");
    assert_eq!(floor.json()["tokens"]["cacheWrite"], Value::Null);
    // Gemini bills no separate write: nothing is missing, so no floor.
    let gemini = built_in()
        .quote("gemini-4-argon", 1000, tokens(1_000_000, 0, None, 0))
        .unwrap();
    assert_eq!(gemini.usd_micros, 2_000_000);
    assert!(!gemini.lower_bound);
    // Reported writes use their own rate, and an input that is all cache hits had no writes.
    for counts in [
        tokens(1_000_000, 0, Some(1_000_000), 0),
        tokens(1_000, 1_000, None, 5),
    ] {
        assert!(
            !built_in()
                .quote("claude-opus-5-5", 1000, counts)
                .unwrap()
                .lower_bound
        );
    }
}

#[test]
fn counts_that_do_not_add_up_are_unsafe_and_unbilled_models_are_zero_in_every_class() {
    for counts in [
        tokens(10, 11, Some(0), 0),
        tokens(10, 5, Some(6), 0),
        tokens(9_007_199_254_740_992, 0, Some(0), 0),
        tokens(0, 0, Some(0), 9_007_199_254_740_992),
    ] {
        assert_eq!(
            built_in().quote("claude-opus-5-5", 1000, counts),
            Err(super::Unpriced::Unsafe),
            "{counts:?}"
        );
    }
    let review = built_in()
        .quote("codex-auto-review", 1000, tokens(1_000, 500, None, 1_000))
        .unwrap();
    assert_eq!(review.usd_micros, 0);
    assert!(!review.lower_bound);
}

#[test]
fn every_dated_boundary_prices_each_side_at_its_own_row() {
    const DECEMBER: u64 = 1_796_083_200_000; // 2026-12-01T00:00:00Z
    const JANUARY: u64 = 1_798_761_600_000; // 2027-01-01T00:00:00Z
    let argon = [
        "gemini-4-argon",
        "gemini-4-argon-low",
        "gemini-4-argon-medium",
        "gemini-4-argon-high",
    ];
    let flash = [
        "gemini-3.6-flash",
        "gemini-3.8-flash",
        "gemini-3.8-flash-low",
        "gemini-3.8-flash-medium",
        "gemini-3.8-flash-high",
    ];
    let cases = argon
        .iter()
        .map(|model| (*model, DECEMBER, 2_000_000, 4_000_000))
        .chain(
            flash
                .iter()
                .map(|model| (*model, JANUARY, 750_000, 1_500_000)),
        );
    for (model, boundary, before, after) in cases {
        let at = |ms: u64| {
            built_in()
                .quote(model, ms, Tokens::uncached_input(1_000_000))
                .unwrap()
                .usd_micros
        };
        assert_eq!(at(boundary - 1), before, "{model} before");
        assert_eq!(at(boundary), after, "{model} from");
    }
    // Every dated row is one of these, so no boundary goes untested.
    let dated = base()["models"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|row| !row["effectiveFrom"].is_null())
        .count();
    assert_eq!(dated, argon.len() + flash.len());
}

#[test]
fn a_dated_row_prices_from_its_utc_day_and_a_model_not_yet_started_has_no_price() {
    const DECEMBER: u64 = 1_796_083_200_000; // 2026-12-01T00:00:00Z
    let input = |at: u64| {
        built_in()
            .quote("gemini-4-argon-high", at, Tokens::uncached_input(1_000_000))
            .unwrap()
    };
    assert_eq!(input(DECEMBER - 1).usd_micros, 2_000_000);
    assert_eq!(input(DECEMBER - 1).json()["effectiveFrom"], Value::Null);
    assert_eq!(input(DECEMBER).usd_micros, 4_000_000);
    assert_eq!(input(DECEMBER).json()["effectiveFrom"], "2026-12-01");
    // Only a row that starts later: nothing prices the earlier day.
    let mut file = base();
    file["version"] = json!("2026-12-01");
    file["models"]
        .as_array_mut()
        .unwrap()
        .retain(|row| row["modelId"] != "gemini-4-argon" || row["effectiveFrom"] != Value::Null);
    let later = table(&file);
    assert_eq!(
        later.quote("gemini-4-argon", DECEMBER - 1, Tokens::uncached_input(1)),
        Err(super::Unpriced::NoPrice)
    );
    assert!(
        later
            .quote("gemini-4-argon", DECEMBER, Tokens::uncached_input(1))
            .is_ok()
    );
    for (ms, day) in [
        (0, "1970-01-01"),
        (951_782_400_000, "2000-02-29"),
        (DECEMBER - 1, "2026-11-30"),
        (1_798_761_600_000, "2027-01-01"),
    ] {
        assert_eq!(super::utc_day(ms), day);
    }
}
