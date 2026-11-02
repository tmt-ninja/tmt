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
    command_spec!("design","Read the space's design systems","tmt colab design show tmt-ui --json","A design system is a tree of Colab pages in the Design tab; each published version is a release a page pins with <meta name=\"tmt-ds\">. These commands only read. The tmt-design-system skill says how to use them.")
        .mut_arg("json", |arg| arg.global(true))
        .subcommand_required(true)
        .subcommand(command_spec!("ls","List design systems and their released versions","tmt colab design ls --json","Reads the local store; a system with no release yet is listed with latest none and cannot be pinned.").alias("list"))
        .subcommand(command_spec!("show","Show what one release offers: its pin, principles and components","tmt colab design show tmt-ui@1.0.2 --json","SYSTEM is the root page ID (a unique prefix works), the tag prefix or the name; @VERSION picks a release (default: the latest). Prints the pin line to copy and each component's tag, props, slots and examples. Reads the release bundle through the running serve: run tmt colab serve first.").arg(Arg::new("system").required(true).index(1).value_name("SYSTEM[@VERSION]").help("The system, optionally with @version")))
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
struct System {
    id: String,
    config: Value,
}
impl System {
    fn row(&self) -> Value {
        let versions: Vec<&str> = releases(&self.config)
            .iter()
            .filter_map(|r| r["version"].as_str())
            .collect();
        json!({"system":self.id,"name":self.config["name"],"prefix":self.config["prefix"],
            "latest":versions.last(),"versions":versions,
            "components":self.config["components"].as_array().map_or(0, Vec::len)})
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
            });
        }
    }
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
    let layout = Layout::existing(root)?.ok_or(Fault::Missing)?;
    let key = Keyring::read(&layout)?;
    let store = Store::read(&layout)?;
    store.require_current_schema()?;
    let all = match systems(&store, &key) {
        Ok(all) => all,
        Err(error) => {
            store.close()?;
            return Err(error);
        }
    };
    let operand = args.get_one::<String>("system");
    let (name, version) = match operand.map(|o| o.split_once('@').unwrap_or((o, ""))) {
        Some((name, version)) => (name, (!version.is_empty()).then_some(version)),
        None => ("", None),
    };
    // A page ID (or its unique prefix) names the root directly; else the prefix or the name does.
    let by_id = operand.and_then(|_| resolve_page(&store, &key, name).ok());
    let mut decoder = Decoder::new(std::env::current_exe()?)?;
    let chosen = all
        .iter()
        .find(|s| by_id.as_deref() == Some(s.id.as_str()))
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
                let attachment = release["attachment"].as_str().ok_or_else(|| {
                    fail(
                        "COLAB_DESIGN_RELEASE_NOT_FOUND",
                        "This release has no bundle attachment.",
                    )
                })?;
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
                let selector = tmt_colab::attachments::resolve(
                    &store,
                    &key,
                    &system.id,
                    attachment,
                    &mut decoder,
                    deadline,
                )?;
                Ok((release.clone(), selector))
            }))
        }
        _ => None,
    };
    store.close()?;
    let mut rows: Vec<(&str, String)> = Vec::new();
    let value = if mode == "ls" {
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
        json!({"spaceId":key.space_id,"systems":all.iter().map(System::row).collect::<Vec<_>>()})
    } else {
        let system = chosen.ok_or_else(|| not_found(name))?;
        let (release, selector) = reference.expect("show resolves its release")?;
        let tmt_colab::attachments::ipc::Verified { bytes, .. } =
            tmt_colab::attachments::ipc::read(&layout, &system.id, &selector)?;
        let bundle: Value = serde_json::from_slice(&bytes).map_err(|_| {
            fail(
                "COLAB_DESIGN_RELEASE_INVALID",
                "The release bundle is not readable JSON.",
            )
        })?;
        if bundle["hash"] != release["bundle"] || bundle["version"] != release["version"] {
            return Err(fail(
                "COLAB_DESIGN_RELEASE_INVALID",
                "The release bundle does not match its release record.",
            ));
        }
        let pin = format!(
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
        rows.push(("pin", format!("<meta name=\"tmt-ds\" content=\"{pin}\">")));
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
        json!({"spaceId":key.space_id,"system":system.id,"name":bundle["name"],"prefix":bundle["prefix"],
            "version":bundle["version"],"pin":pin,"meta":format!("<meta name=\"tmt-ds\" content=\"{pin}\">"),
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
