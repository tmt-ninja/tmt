//! `tmt colab design`: the published design systems of the space and what one release offers, for
//! an agent that makes a page with it (#5921). A system is a page tree whose root page holds its
//! config block; a release is the root page's bundle attachment. Both commands only read: `ls`
//! from the local store, `show` also the release bundle through the running serve.
use crate::cli_management::{fail, resolve_page};
use clap::{Arg, ArgMatches, Command};
use serde_json::{Value, json};
use std::{io::Write, path::Path};
use tmt_cli_style::{CommandSpec, Example, OutputModes};
use tmt_colab::{
    Result,
    decoder::Decoder,
    inspection,
    keyring::{Keyring, Layout},
    page::{self, Fault},
    store::Store,
};

/// The reserved project every design-system page holds (contract: Projects).
const DESIGN_SYSTEM_PROJECT: &str = "tmt:design-system";
const CONFIG_OPEN: &str = r#"<script type="application/json" data-tmt-ds="design-system">"#;
/// The built-in tmt GUI release every install can pin; the app resolves the same bytes.
const BUILT_IN_BUNDLE: &str =
    include_str!("../../../../../design/systems/tmt-gui/generated/bundle.json");

macro_rules! command_spec {
    ($name:literal,$summary:literal,$example:literal,$details:literal) => {
        tmt_cli_style::command(&CommandSpec {
            name: $name,
            summary: $summary,
            examples: &[Example {
                command: $example,
                note: $summary,
            }],
            outputs: OutputModes::HumanAndJson,
            details: $details,
        })
    };
}

pub fn command() -> Command {
    command_spec!("design","Read the space's design systems","tmt colab design show tmt-ui --json","A design system is a tree of Colab pages in the Design tab; a page names its system with <meta name=\"tmt-ds\"> and follows its live draft, or locks one published release. These commands only read. The tmt-design-system skill says how to use them.")
        .mut_arg("json", |arg| arg.global(true))
        .subcommand_required(true)
        .subcommand(command_spec!("ls","List design systems and their released versions","tmt colab design ls --json","Lists the built-in tmt GUI release, then the space's own systems from the local store. A system with no release yet is listed with latest none and cannot be pinned.").alias("list"))
        .subcommand(command_spec!("show","Show what one release offers: its pin, principles and components","tmt colab design show tmt-ui@1.0.2 --json","SYSTEM is the system ID from ls (a root page ID, unique prefix or tmt-gui), the tag prefix or the name; a space's own system wins over the built-in one. @VERSION picks a release (default: the latest). Prints the pin line to copy (follows the draft), the line that locks this release instead, and each component's tag, props, slots and examples. A space's release is read through the running serve (run tmt colab serve first); the built-in one ships in this executable.").arg(Arg::new("system").required(true).index(1).value_name("SYSTEM[@VERSION]").help("The system, optionally with @version")))
}

/// The root page's config block, parsed; the block's JSON never holds a raw `<`.
fn config(source: &str) -> Option<Value> {
    let start = source.find(CONFIG_OPEN)? + CONFIG_OPEN.len();
    let end = start + source[start..].find("</script>")?;
    serde_json::from_str(&source[start..end]).ok()
}
fn releases(config: &Value) -> Vec<&Value> {
    config["releases"]
        .as_array()
        .into_iter()
        .flatten()
        .collect()
}
/// Whether `bundle` is the release its record names: the same version, a declared hash equal to the
/// record's, and bytes that hash to it. The renderer refuses a pin whose bundle hashes differently
/// (`design-system.ts`), so `show` never prints one (#5966).
fn matches_release(bundle: &Value, release: &Value) -> bool {
    bundle["version"] == release["version"]
        && bundle["hash"] == release["bundle"]
        && bundle_hash(bundle).is_some_and(|hash| release["bundle"] == hash.as_str())
}

/// The bundle's own hash as `bundleHash` in `design-system.ts` and the compiler compute it: SHA-256
/// over `JSON.stringify` of the bundle without `hash`, keys in written order. `None` when a number is
/// not written as `JSON.stringify` writes it, so the two could disagree; compiled bundles never
/// hold one.
fn bundle_hash(bundle: &Value) -> Option<String> {
    use sha2::{Digest, Sha256};
    let mut body = bundle.as_object()?.clone();
    body.shift_remove("hash");
    let body = Value::Object(body);
    if !canonical_numbers(&body) {
        return None;
    }
    let digest = Sha256::digest(serde_json::to_vec(&body).ok()?);
    Some(format!(
        "sha256-{}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

/// Every number is written as `JSON.stringify` writes its value: the shortest round-trip digits,
/// without an exponent, in the range where JavaScript writes none.
fn canonical_numbers(value: &Value) -> bool {
    match value {
        Value::Number(number) => {
            let text = number.to_string();
            text.parse::<f64>().is_ok_and(|parsed| {
                let magnitude = parsed.abs();
                (magnitude == 0.0 && text == "0")
                    || ((1e-6..1e21).contains(&magnitude) && parsed.to_string() == text)
            })
        }
        Value::Array(items) => items.iter().all(canonical_numbers),
        Value::Object(members) => members.values().all(canonical_numbers),
        _ => true,
    }
}

struct System {
    id: String,
    config: Value,
    /// The release bundle when it ships with TMT rather than as a root page's attachment.
    built_in: Option<Value>,
}
fn built_in() -> Result<System> {
    let bundle: Value = serde_json::from_str(BUILT_IN_BUNDLE)?;
    Ok(System {
        id: bundle["system"].as_str().unwrap_or_default().to_owned(),
        config: json!({"name":bundle["name"],"prefix":bundle["prefix"],"components":bundle["components"],
            "releases":[{"version":bundle["version"],"bundle":bundle["hash"]}]}),
        built_in: Some(bundle),
    })
}
impl System {
    fn row(&self) -> Value {
        let versions: Vec<&str> = releases(&self.config)
            .iter()
            .filter_map(|r| r["version"].as_str())
            .collect();
        json!({"system":self.id,"name":self.config["name"],"prefix":self.config["prefix"],
            "latest":versions.last(),"versions":versions,
            "components":self.config["components"].as_array().map_or(0, Vec::len),
            "builtIn":self.built_in.is_some()})
    }
    fn matches(&self, operand: &str) -> bool {
        self.config["prefix"].as_str() == Some(operand)
            || self.config["name"]
                .as_str()
                .is_some_and(|name| name.eq_ignore_ascii_case(operand))
    }
}

/// Every design-system root page of the space, read from its own source.
fn systems(store: &Store, key: &Keyring) -> Result<Vec<System>> {
    let catalog = inspection::catalog(store, key)?;
    let mut decoder = Decoder::new(std::env::current_exe()?)?;
    let mut found = Vec::new();
    for entry in catalog["pages"].as_array().into_iter().flatten() {
        let held = entry["projects"].as_array().into_iter().flatten();
        let (Some(id), true) = (
            entry["pageId"].as_str(),
            held.clone().any(|p| p == DESIGN_SYSTEM_PROJECT),
        ) else {
            continue;
        };
        // A page that cannot be read here is not offered; it is never a reason to fail the list.
        let Ok(read) = page::read(store, key, id, &mut decoder) else {
            continue;
        };
        if let Some(config) = config(&read.source) {
            found.push(System {
                id: id.to_owned(),
                config,
                built_in: None,
            });
        }
    }
    found.push(built_in()?);
    Ok(found)
}

fn not_found(operand: &str) -> Box<dyn std::error::Error + Send + Sync> {
    fail(
        "COLAB_DESIGN_SYSTEM_NOT_FOUND",
        &format!("No design system is {operand}. Run `tmt colab design ls` to see them."),
    )
}

pub fn run(root: &Path, args: &ArgMatches) -> Result<()> {
    let (mode, args) = args.subcommand().expect("required subcommand");
    // Before the first page there is no space yet; the built-in system is still there.
    let space = match Layout::existing(root)? {
        Some(layout) => {
            let key = Keyring::read(&layout)?;
            let store = Store::read(&layout)?;
            store.require_current_schema()?;
            Some((layout, key, store))
        }
        None => None,
    };
    let all = match &space {
        Some((_, key, store)) => systems(store, key),
        None => built_in().map(|system| vec![system]),
    };
    let all = match all {
        Ok(all) => all,
        Err(error) => {
            if let Some((_, _, store)) = space {
                store.close()?;
            }
            return Err(error);
        }
    };
    let operand = args.try_get_one::<String>("system").ok().flatten();
    let (name, version) = match operand.map(|o| o.split_once('@').unwrap_or((o, ""))) {
        Some((name, version)) => (name, (!version.is_empty()).then_some(version)),
        None => ("", None),
    };
    // A page ID (or its unique prefix) names the root directly; else the prefix or the name does.
    let by_id = match (&space, operand) {
        (Some((_, key, store)), Some(_)) => resolve_page(store, key, name).ok(),
        _ => None,
    };
    let mut decoder = Decoder::new(std::env::current_exe()?)?;
    let chosen = all
        .iter()
        .find(|s| by_id.as_deref() == Some(s.id.as_str()) || s.id == name)
        .or_else(|| all.iter().find(|s| s.matches(name)));
    let reference = match (mode, chosen) {
        ("show", Some(system)) => {
            let list = releases(&system.config);
            let release = match version {
                Some(v) => list.iter().find(|r| r["version"] == v).copied(),
                None => list.last().copied(),
            }
            .ok_or_else(|| match version {
                Some(v) => fail(
                    "COLAB_DESIGN_RELEASE_NOT_FOUND",
                    &format!(
                        "{name} has no release {v}. Run `tmt colab design ls` to see its versions."
                    ),
                ),
                None => fail(
                    "COLAB_DESIGN_RELEASE_NOT_FOUND",
                    &format!(
                        "{name} has no release yet. Publish one from its page in the Design tab."
                    ),
                ),
            });
            Some(release.and_then(|release| {
                if system.built_in.is_some() {
                    return Ok((release.clone(), None));
                }
                let attachment = release["attachment"].as_str().ok_or_else(|| {
                    fail(
                        "COLAB_DESIGN_RELEASE_NOT_FOUND",
                        "This release has no bundle attachment.",
                    )
                })?;
                let (_, key, store) = space.as_ref().ok_or(Fault::Missing)?;
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
                let selector = tmt_colab::attachments::resolve(
                    store,
                    key,
                    &system.id,
                    attachment,
                    &mut decoder,
                    deadline,
                )?;
                Ok((release.clone(), Some(selector)))
            }))
        }
        _ => None,
    };
    let (layout, space_id) = match space {
        Some((layout, key, store)) => {
            store.close()?;
            (Some(layout), Some(key.space_id))
        }
        None => (None, None),
    };
    let mut rows: Vec<(&str, String)> = Vec::new();
    let value = if mode == "ls" {
        // Listed built-in first; matching above gives a space's own system the precedence.
        let all: Vec<&System> = all
            .iter()
            .filter(|s| s.built_in.is_some())
            .chain(all.iter().filter(|s| s.built_in.is_none()))
            .collect();
        for system in &all {
            let row = system.row();
            rows.push((
                "system",
                format!(
                    "{} · {} · latest {} · {}",
                    row["name"].as_str().unwrap_or(""),
                    row["prefix"].as_str().unwrap_or(""),
                    row["latest"].as_str().unwrap_or("none"),
                    system.id
                ),
            ));
        }
        if all.is_empty() {
            rows.push(("systems", "none".into()));
        }
        json!({"spaceId":space_id,"systems":all.iter().map(|s| s.row()).collect::<Vec<_>>()})
    } else {
        let system = chosen.ok_or_else(|| not_found(name))?;
        let (release, selector) = reference.expect("show resolves its release")?;
        let bundle: Value = match (&system.built_in, selector) {
            (Some(bundle), _) => bundle.clone(),
            (None, selector) => {
                let selector = selector.expect("a space's release has an attachment");
                let tmt_colab::attachments::ipc::Verified { bytes, .. } =
                    tmt_colab::attachments::ipc::read(
                        layout.as_ref().expect("a space's release has its space"),
                        &system.id,
                        &selector,
                    )?;
                serde_json::from_slice(&bytes).map_err(|_| {
                    fail(
                        "COLAB_DESIGN_RELEASE_INVALID",
                        "The release bundle is not readable JSON.",
                    )
                })?
            }
        };
        if !matches_release(&bundle, &release) {
            return Err(fail(
                "COLAB_DESIGN_RELEASE_INVALID",
                "The release bundle does not match its release record.",
            ));
        }
        let lock = format!(
            "{}@{}#{}",
            system.id,
            release["version"].as_str().unwrap_or(""),
            release["bundle"].as_str().unwrap_or("")
        );
        let components: Vec<Value> = bundle["components"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|c| json!({"tag":c["tag"],"props":c["props"],"slots":c["slots"],"examples":c["examples"].as_array().cloned().unwrap_or_default()}))
            .collect();
        rows.push((
            "system",
            format!("{} · {}", bundle["name"].as_str().unwrap_or(""), system.id),
        ));
        rows.push(("version", bundle["version"].as_str().unwrap_or("").into()));
        // The default pin follows the system's live draft (#5967); a lock fixes this release.
        let pin = &system.id;
        rows.push(("pin", format!("<meta name=\"tmt-ds\" content=\"{pin}\">")));
        rows.push(("lock", format!("<meta name=\"tmt-ds\" content=\"{lock}\">")));
        for c in &components {
            let props: Vec<String> = c["props"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(name, spec)| match spec["enum"].as_array() {
                    Some(values) => format!(
                        "{name}={}",
                        values
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join("|")
                    ),
                    None => format!("{name}:{}", spec["type"].as_str().unwrap_or("string")),
                })
                .collect();
            rows.push((
                "component",
                format!("<{}> {}", c["tag"].as_str().unwrap_or(""), props.join(" ")),
            ));
        }
        rows.push(("examples", "use --json".into()));
        json!({"spaceId":space_id,"system":system.id,"name":bundle["name"],"prefix":bundle["prefix"],
            "version":bundle["version"],"pin":pin,"meta":format!("<meta name=\"tmt-ds\" content=\"{pin}\">"),
            "lock":lock,"lockMeta":format!("<meta name=\"tmt-ds\" content=\"{lock}\">"),
            "principles":bundle["principles"],"components":components})
    };
    let mut output = tmt_cli_style::stream::stdout(args.get_flag("json"));
    if args.get_flag("json") {
        writeln!(output, "{value}")?;
    } else {
        let terminal = output.terminal();
        tmt_cli_style::detail::write(&mut output, terminal, "DESIGN SYSTEMS", &rows)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn built_in_bundle() -> Value {
        serde_json::from_str(BUILT_IN_BUNDLE).unwrap()
    }

    #[test]
    fn the_hash_is_the_compilers() {
        let bundle = built_in_bundle();
        assert_eq!(
            bundle_hash(&bundle).as_deref(),
            bundle["hash"].as_str(),
            "the built-in bundle hashes to the hash the compiler wrote"
        );
        let release = json!({"version":bundle["version"],"bundle":bundle["hash"]});
        assert!(matches_release(&bundle, &release));
    }

    #[test]
    fn a_bundle_whose_bytes_do_not_hash_to_its_pin_is_refused() {
        let bundle = built_in_bundle();
        let release = json!({"version":bundle["version"],"bundle":bundle["hash"]});
        // Changed content under the declared hash: the record and the declared hash still agree.
        let mut edited = bundle.clone();
        edited["name"] = json!("Someone else");
        assert!(!matches_release(&edited, &release));
        // Reordered keys hash differently, as in the renderer.
        let mut reordered = serde_json::Map::new();
        let members = bundle.as_object().unwrap();
        for (key, value) in members.iter().rev() {
            reordered.insert(key.clone(), value.clone());
        }
        assert!(!matches_release(&Value::Object(reordered), &release));
        // A declared hash that differs from the record.
        let mut declared = bundle.clone();
        declared["hash"] = json!("sha256-00");
        assert!(!matches_release(&declared, &release));
    }

    #[test]
    fn numbers_hash_only_as_javascript_writes_them() {
        for (text, canonical) in [
            ("1", true),
            ("0", true),
            ("-2", true),
            ("0.5", true),
            ("1.0", false),
            ("-0", true),
            ("1e3", false),
            ("1e21", false),
            ("12345678901234567890", false),
        ] {
            // `-0` is read as 0 and written `0`, as JavaScript writes it.
            let value: Value = serde_json::from_str(&format!("{{\"n\":{text}}}")).unwrap();
            assert_eq!(canonical_numbers(&value), canonical, "{text}");
        }
    }
}
