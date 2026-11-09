//! `tmt colab block ...`: read and change the blocks of a structured page. Every change is one
//! batch of ops through the same entry point the browser's save uses (`page::blocks`): one
//! validator, one receipt, one history entry. Ops are granular and merge with concurrent edits;
//! none carries a revision lock. The only operation that needs a base is a whole-text replacement,
//! which carries the text `block get` returned and is merged with whatever the page holds now.
use crate::cli_management::{fail, fresh_id, resolve_page};
use clap::{Arg, ArgAction, ArgMatches, Command};
use serde_json::{Map, Value, json};
use std::{
    io::{Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tmt_cli_style::Example;
use tmt_colab::{
    Result,
    decoder::Decoder,
    keyring::{Keyring, Layout},
    limits,
    page::{self, Fault},
    store::Store,
};

const TYPES: [&str; 13] = [
    "paragraph",
    "heading",
    "list",
    "todo",
    "table",
    "card",
    "question",
    "callout",
    "code",
    "image",
    "mockup",
    "work-bundle",
    "page-view",
];
const MARKS: [&str; 6] = ["bold", "italic", "code", "link", "agent", "block"];
const TABLE_ACTIONS: [&str; 7] = [
    "add-row",
    "remove-row",
    "set-cell",
    "add-column",
    "rename-column",
    "move-column",
    "remove-column",
];

macro_rules! example {
    ($command:literal) => {
        &[Example {
            command: $command,
            note: "Run this command",
        }]
    };
}
fn spec(
    name: &'static str,
    summary: &'static str,
    details: &'static str,
    examples: &'static [Example],
) -> Command {
    crate::cli_work::spec(name, summary, details, examples)
}
fn id_arg() -> Arg {
    Arg::new("id")
        .index(2)
        .required(true)
        .value_name("BLOCK")
        .help("A block's UUID (see ls)")
}
fn flag(name: &'static str, help: &'static str) -> Arg {
    Arg::new(name)
        .long(name)
        .action(ArgAction::SetTrue)
        .help(help)
}
fn option(name: &'static str, value: &'static str, help: &'static str) -> Arg {
    Arg::new(name).long(name).value_name(value).help(help)
}
fn placement(command: Command) -> Command {
    command
        .arg(option(
            "parent",
            "BLOCK|root",
            "The card it sits in, or root for the page itself",
        ))
        .arg(option(
            "after",
            "BLOCK",
            "Place it right after this sibling; without --after or --first it goes last",
        ))
        .arg(flag("first", "Place it first").conflicts_with("after"))
}
fn page() -> Arg {
    crate::cli_grammar::page()
}

pub fn command() -> Command {
    spec(
        "block",
        "Read and change the blocks of a structured page",
        "A structured page (tmt colab page create --structured) is made of blocks, not HTML. Every command is a granular edit that merges with what others change at the same time, so none needs a revision; a batch refused because the page moved before its commit is prepared again, up to 3 more times. A whole-text replacement carries the text block get returned (--base-file) and keeps what others typed meanwhile; when your change overlaps theirs, theirs stays and the receipt lists your hunk under droppedHunks: run block get again and reapply it. Types: paragraph, heading, list, todo, table, card, question, callout, code, image, mockup, work-bundle, page-view. Read tmt colab skill blocks first.",
        example!("tmt colab block ls 10000000-0000-4000-8000-000000000001 --json"),
    )
    .subcommand_required(true)
    .subcommand(
        spec(
            "ls",
            "List the page's blocks as a tree",
            "Read only. Each block with its type, parent, props and text. Deleted blocks are listed with --all.",
            example!("tmt colab block ls 10000000-0000-4000-8000-000000000001 --json"),
        )
        .alias("list")
        .arg(page())
        .arg(flag("all", "Include deleted blocks")),
    )
    .subcommand(
        spec(
            "get",
            "Read one block, with the base for a text replacement",
            "Prints the block and, as base, its text now. Send it back with block text --base-file when you replace the whole text.",
            example!("tmt colab block get 10000000-0000-4000-8000-000000000001 20000000-0000-4000-8000-000000000002 --json"),
        )
        .arg(page())
        .arg(id_arg())
        .arg(option("cell", "COLUMN", "Read this cell of a table row instead"))
        .arg(option("write-text", "FILE", "Also write the block's text to this file")),
    )
    .subcommand(
        placement(spec(
            "insert",
            "Add a block",
            "Returns the new block's ID. The type cannot change later; delete and insert again to change it. A table's rows come from block table add-row.",
            example!("tmt colab block insert 10000000-0000-4000-8000-000000000001 --type paragraph --text 'Hello' --json"),
        ))
        .arg(page())
        .arg(Arg::new("type").long("type").required(true).value_name("TYPE").value_parser(TYPES))
        .arg(option("id", "UUID", "The new block's ID (generated when omitted)"))
        .arg(option("props", "JSON", "Props as a JSON object, checked against the type"))
        .arg(option("text", "TEXT", "The text of a block that has text"))
        .arg(option("text-file", "FILE|-", "Read the text from a file or stdin").conflicts_with("text")),
    )
    .subcommand(
        spec(
            "props",
            "Change a block's props",
            "Only the listed keys change, each checked against the type's schema. A value is read as JSON when it parses (true, 3, [\"a\"]) and as text otherwise.",
            example!("tmt colab block props 10000000-0000-4000-8000-000000000001 20000000-0000-4000-8000-000000000002 --set checked=true"),
        )
        .arg(page())
        .arg(id_arg())
        .arg(Arg::new("set").long("set").value_name("KEY=VALUE").action(ArgAction::Append))
        .arg(Arg::new("unset").long("unset").value_name("KEY").action(ArgAction::Append)),
    )
    .subcommand(
        spec(
            "text",
            "Change a block's text",
            "Replace one quoted piece (--find/--replace, which must occur once), replace the whole text (--file with --base-file: the text block get returned), or set an inline mark on a range (--mark).",
            example!("tmt colab block text 10000000-0000-4000-8000-000000000001 20000000-0000-4000-8000-000000000002 --find 'old' --replace 'new'"),
        )
        .arg(page())
        .arg(id_arg())
        .arg(option("cell", "COLUMN", "Edit this cell of a table row"))
        .arg(option("find", "TEXT", "The text to replace; it must occur exactly once").requires("replace"))
        .arg(option("replace", "TEXT", "What replaces it").requires("find"))
        .arg(option("file", "FILE|-", "The new whole text").requires("base-file"))
        .arg(option("base-file", "FILE", "The text block get returned, which the new text is merged from"))
        .arg(option("mark", "MARK", "Set an inline mark on a range").value_parser(MARKS).requires_all(["from", "to"]))
        .arg(option("from", "N", "Range start, in characters").value_parser(clap::value_parser!(u64)))
        .arg(option("to", "N", "Range end, in characters").value_parser(clap::value_parser!(u64)))
        .arg(option("value", "VALUE", "The mark's value: a link's URL, an agent's name, or a block's ID (PAGE/ID for a block on another page)"))
        .arg(flag("clear", "Remove the mark instead"))
        .group(
            clap::ArgGroup::new("change")
                .args(["find", "file", "mark"])
                .required(true)
                .multiple(false),
        ),
    )
    .subcommand(
        placement(spec(
            "move",
            "Move a block, with what is under it",
            "Within the page or into a card (a card holds no card). The last move wins when two people move one block.",
            example!("tmt colab block move 10000000-0000-4000-8000-000000000001 20000000-0000-4000-8000-000000000002 --first"),
        ))
        .arg(page())
        .arg(id_arg()),
    )
    .subcommand(
        spec(
            "delete",
            "Delete a block",
            "A deleted block keeps its history and its comments and can be restored until compaction removes it (after 7 days, sooner on a nearly full page).",
            example!("tmt colab block delete 10000000-0000-4000-8000-000000000001 20000000-0000-4000-8000-000000000002"),
        )
        .arg(page())
        .arg(id_arg()),
    )
    .subcommand(
        spec(
            "restore",
            "Bring a deleted block back",
            "Refused as not found once compaction has removed the block.",
            example!("tmt colab block restore 10000000-0000-4000-8000-000000000001 20000000-0000-4000-8000-000000000002"),
        )
        .arg(page())
        .arg(id_arg()),
    )
    .subcommand(
        spec(
            "detach",
            "Release an attachment the page no longer shows",
            "Removes the attachment from the page's list (refused while a live image or file block still names it: delete or change the block first). Detaching frees the descriptor's place in the page's list; the file itself is swept 30 days after no block on the page references it, whether or not it is detached. Add one with tmt colab attachment attach, then name it in an image block's src as colab-attachment:<ID>.",
            example!("tmt colab block detach 10000000-0000-4000-8000-000000000001 20000000-0000-4000-8000-000000000002"),
        )
        .arg(page())
        .arg(
            Arg::new("attachment")
                .index(2)
                .required(true)
                .value_name("ATTACHMENT")
                .help("The attachment's full ID, as the page lists it"),
        ),
    )
    .subcommand(
        placement(spec(
            "table",
            "Change a table's rows, cells and columns",
            "ACTION is add-row, remove-row, set-cell, add-column, rename-column, move-column or remove-column. Rows keep their IDs; a cell is plain text with inline marks.",
            example!("tmt colab block table 10000000-0000-4000-8000-000000000001 20000000-0000-4000-8000-000000000002 add-row --cell a=Alpha"),
        ))
        .arg(page())
        .arg(id_arg())
        .arg(Arg::new("action").index(3).required(true).value_name("ACTION").value_parser(TABLE_ACTIONS))
        .arg(option("row", "UUID", "The row (generated for add-row when omitted)"))
        .arg(option("column", "ID", "The column"))
        .arg(option("name", "NAME", "A column's name"))
        .arg(option("width", "auto|narrow", "A column's width").value_parser(["auto", "narrow"]))
        .arg(flag("hide-narrow", "Hide the column on a narrow screen"))
        .arg(Arg::new("cell").long("cell").value_name("COLUMN=TEXT").action(ArgAction::Append))
        .arg(option("text", "TEXT", "A cell's new text (set-cell)"))
        .arg(option("base-file", "FILE", "The cell's text as read, to merge a set-cell from")),
    )
    .subcommand(
        spec(
            "batch",
            "Make many changes at once",
            "All of them or none. FILE holds a JSON array of ops, or {\"ops\": [...]}; see tmt colab skill blocks for each op's shape.",
            example!("tmt colab block batch 10000000-0000-4000-8000-000000000001 --file ops.json --json"),
        )
        .arg(page())
        .arg(option("file", "FILE|-", "The ops").required(true)),
    )
}

fn now() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)?
        .as_millis()
        .try_into()?)
}
fn text_of<'a>(args: &'a ArgMatches, name: &str) -> Option<&'a str> {
    args.get_one::<String>(name).map(String::as_str)
}
/// A file's text, or stdin for `-`.
fn read_input(path: &str) -> Result<String> {
    let mut text = String::new();
    if path == "-" {
        std::io::stdin().read_to_string(&mut text)?;
    } else {
        text = std::fs::read_to_string(path).map_err(|error| {
            fail(
                "COLAB_INPUT_INVALID",
                &format!("Could not read {path}: {error}"),
            )
        })?;
    }
    Ok(text)
}
fn parse_value(text: &str) -> Value {
    serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.into()))
}
fn split_pair<'a>(pair: &'a str, what: &str) -> Result<(&'a str, &'a str)> {
    pair.split_once('=').ok_or_else(|| {
        fail(
            "COLAB_INPUT_INVALID",
            &format!("{what} takes KEY=VALUE, not {pair}."),
        )
    })
}

fn place(args: &ArgMatches, op: &mut Value) {
    if let Some(parent) = text_of(args, "parent") {
        op["parent"] = json!(parent);
    }
    if args.get_flag("first") {
        op["after"] = Value::Null;
    } else if let Some(after) = text_of(args, "after") {
        op["after"] = json!(after);
    }
}

fn ops_for(verb: &str, args: &ArgMatches) -> Result<Value> {
    let id = text_of(args, "id").unwrap_or_default();
    Ok(match verb {
        "insert" => {
            let mut op = json!({
                "op": "insert",
                "id": text_of(args, "id").map_or_else(fresh_id, |id| Ok(id.to_owned()))?,
                "type": text_of(args, "type"),
            });
            place(args, &mut op);
            if let Some(props) = text_of(args, "props") {
                op["props"] = serde_json::from_str(props)
                    .map_err(|_| fail("COLAB_INPUT_INVALID", "--props takes a JSON object."))?;
            }
            if let Some(text) = text_of(args, "text") {
                op["text"] = json!(text);
            } else if let Some(path) = text_of(args, "text-file") {
                op["text"] = json!(read_input(path)?);
            }
            json!([op])
        }
        "props" => {
            let mut op = json!({"op": "props", "id": id});
            let mut set = Map::new();
            for pair in args.get_many::<String>("set").into_iter().flatten() {
                let (key, value) = split_pair(pair, "--set")?;
                set.insert(key.into(), parse_value(value));
            }
            if !set.is_empty() {
                op["set"] = Value::Object(set);
            }
            if let Some(keys) = args.get_many::<String>("unset") {
                op["unset"] = json!(keys.collect::<Vec<_>>());
            }
            json!([op])
        }
        "text" => {
            let mut op = json!({"op": "text", "id": id});
            if let Some(cell) = text_of(args, "cell") {
                op["cell"] = json!(cell);
            }
            if let Some(find) = text_of(args, "find") {
                op["replace"] = json!({"find": find, "with": text_of(args, "replace")});
            } else if let Some(file) = text_of(args, "file") {
                op["set"] = json!(read_input(file)?);
                op["base"] = json!(read_input(text_of(args, "base-file").unwrap_or_default())?);
            } else {
                let mark = text_of(args, "mark").unwrap_or_default();
                let flag_mark = matches!(mark, "bold" | "italic" | "code");
                let value = match (flag_mark, args.get_flag("clear")) {
                    (true, clear) => json!(!clear),
                    (false, true) => Value::Null,
                    (false, false) => json!(text_of(args, "value").ok_or_else(|| {
                        fail(
                            "COLAB_INPUT_INVALID",
                            "This mark needs --value (or --clear).",
                        )
                    })?),
                };
                op["format"] = json!({
                    "from": args.get_one::<u64>("from"),
                    "to": args.get_one::<u64>("to"),
                    "mark": mark,
                    "value": value,
                });
            }
            json!([op])
        }
        "move" => {
            let mut op = json!({"op": "move", "id": id});
            place(args, &mut op);
            json!([op])
        }
        "delete" | "restore" => json!([{"op": verb, "id": id}]),
        "table" => json!([table_op(args)?]),
        _ => unreachable!("clap admits only the block verbs"),
    })
}

fn table_op(args: &ArgMatches) -> Result<Value> {
    let action = text_of(args, "action").unwrap_or_default();
    let mut op = json!({"op": "table", "id": text_of(args, "id"), "action": action});
    let need = |name: &str| -> Result<String> {
        text_of(args, name)
            .map(str::to_owned)
            .ok_or_else(|| fail("COLAB_INPUT_INVALID", &format!("{action} needs --{name}.")))
    };
    let after = |op: &mut Value| {
        if args.get_flag("first") {
            op["after"] = Value::Null;
        } else if let Some(after) = text_of(args, "after") {
            op["after"] = json!(after);
        }
    };
    match action {
        "add-row" => {
            op["row"] =
                json!(text_of(args, "row").map_or_else(fresh_id, |row| Ok(row.to_owned()))?);
            after(&mut op);
            let mut cells = Map::new();
            for pair in args.get_many::<String>("cell").into_iter().flatten() {
                let (column, text) = split_pair(pair, "--cell")?;
                cells.insert(column.into(), json!(text));
            }
            if !cells.is_empty() {
                op["cells"] = Value::Object(cells);
            }
        }
        "remove-row" => op["row"] = json!(need("row")?),
        "set-cell" => {
            op["row"] = json!(need("row")?);
            op["column"] = json!(need("column")?);
            op["text"] = json!(need("text")?);
            if let Some(base) = text_of(args, "base-file") {
                op["base"] = json!(read_input(base)?);
            }
        }
        "add-column" => {
            let mut column = json!({"id": need("column")?, "name": need("name")?});
            if let Some(width) = text_of(args, "width") {
                column["width"] = json!(width);
            }
            if args.get_flag("hide-narrow") {
                column["hideNarrow"] = json!(true);
            }
            op["column"] = column;
            after(&mut op);
        }
        "rename-column" => {
            op["column"] = json!(need("column")?);
            op["name"] = json!(need("name")?);
        }
        "move-column" => {
            op["column"] = json!(need("column")?);
            after(&mut op);
        }
        _ => op["column"] = json!(need("column")?),
    }
    Ok(op)
}

/// The tree of a block map: depth and ID in page order, deleted blocks only when asked for.
fn tree(blocks: &Value, all: bool) -> Vec<(usize, String)> {
    let map = blocks.as_object().cloned().unwrap_or_default();
    fn children<'a>(map: &'a Map<String, Value>, parent: &str, all: bool) -> Vec<&'a str> {
        let mut kids: Vec<(&str, &str)> = map
            .iter()
            .filter(|(_, b)| b["parent"] == parent && (all || b.get("deleted").is_none()))
            .map(|(id, b)| (b["pos"].as_str().unwrap_or_default(), id.as_str()))
            .collect();
        kids.sort_unstable();
        kids.into_iter().map(|(_, id)| id).collect()
    }
    let mut out = Vec::new();
    let mut stack: Vec<(usize, String)> = children(&map, "root", all)
        .into_iter()
        .rev()
        .map(|id| (0, id.to_owned()))
        .collect();
    while let Some((depth, id)) = stack.pop() {
        stack.extend(
            children(&map, &id, all)
                .into_iter()
                .rev()
                .map(|c| (depth + 1, c.to_owned())),
        );
        out.push((depth, id));
    }
    out
}
fn preview(block: &Value) -> String {
    let text = block["text"]["s"]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| {
            block["cells"]
                .as_object()
                .map(|cells| {
                    cells
                        .values()
                        .filter_map(|c| c["s"].as_str())
                        .collect::<Vec<_>>()
                        .join(" | ")
                })
                .or_else(|| block["props"]["title"].as_str().map(str::to_owned))
                .unwrap_or_default()
        });
    let one: String = text
        .chars()
        .map(|c| if c == '\n' { ' ' } else { c })
        .take(60)
        .collect();
    one
}

struct Opened {
    page_id: String,
    read: page::BlocksPage,
}
fn read(root: &Path, page_arg: &str) -> Result<Opened> {
    let layout = Layout::existing(root)?.ok_or(Fault::Missing)?;
    let key = Keyring::read(&layout)?;
    let store = Store::read(&layout)?;
    store.require_current_schema()?;
    let page_id = resolve_page(&store, &key, page_arg)?;
    let mut decoder = Decoder::new(std::env::current_exe()?)?;
    let read = page::read_blocks(&store, &key, &page_id, &mut decoder)?;
    Ok(Opened { page_id, read })
}

fn show_block(id: &str, block: &Value, depth: usize) -> Value {
    let mut value = block.clone();
    value["id"] = json!(id);
    value["depth"] = json!(depth);
    value
}

fn list(root: &Path, args: &ArgMatches) -> Result<()> {
    let opened = read(root, text_of(args, "page").unwrap_or_default())?;
    let all = args.get_flag("all");
    let rows = tree(&opened.read.blocks, all);
    let json_output = args.get_flag("json");
    let mut output = tmt_cli_style::stream::stdout(json_output);
    if json_output {
        let blocks: Vec<Value> = rows
            .iter()
            .map(|(depth, id)| show_block(id, &opened.read.blocks[id], *depth))
            .collect();
        let value = json!({"pageId": opened.page_id, "title": opened.read.title,
            "revision": opened.read.revision, "blocks": blocks});
        writeln!(output, "{value}")?;
        return Ok(());
    }
    writeln!(
        output,
        "{}  {}  revision {}",
        opened.page_id, opened.read.title, opened.read.revision
    )?;
    for (depth, id) in rows {
        let block = &opened.read.blocks[&id];
        writeln!(
            output,
            "{}{}  {}{}  {}",
            "  ".repeat(depth),
            id,
            block["type"].as_str().unwrap_or_default(),
            if block.get("deleted").is_some() {
                " (deleted)"
            } else {
                ""
            },
            preview(block)
        )?;
    }
    Ok(())
}

fn get(root: &Path, args: &ArgMatches) -> Result<()> {
    let opened = read(root, text_of(args, "page").unwrap_or_default())?;
    let id = text_of(args, "id").unwrap_or_default();
    let block =
        opened.read.blocks.get(id).ok_or_else(|| {
            Box::<dyn std::error::Error + Send + Sync>::from(Fault::BlockNotFound)
        })?;
    let cell = text_of(args, "cell");
    let text = match cell {
        Some(column) => block["cells"][column]["s"].as_str().unwrap_or_default(),
        None => block["text"]["s"].as_str().unwrap_or_default(),
    };
    if let Some(path) = text_of(args, "write-text") {
        std::fs::write(path, text)?;
    }
    let json_output = args.get_flag("json");
    let mut output = tmt_cli_style::stream::stdout(json_output);
    let mut shown = show_block(id, block, 0);
    shown["base"] = json!(text);
    if json_output {
        let value =
            json!({"pageId": opened.page_id, "revision": opened.read.revision, "block": shown});
        writeln!(output, "{value}")?;
        return Ok(());
    }
    let terminal = output.terminal();
    tmt_cli_style::detail::write(
        &mut output,
        terminal,
        "BLOCK",
        &[
            ("page", opened.page_id.clone()),
            ("block", id.to_owned()),
            (
                "type",
                block["type"].as_str().unwrap_or_default().to_owned(),
            ),
            (
                "parent",
                block["parent"].as_str().unwrap_or_default().to_owned(),
            ),
            ("props", block["props"].to_string()),
            ("text", text.to_owned()),
        ],
    )?;
    Ok(())
}

/// One batch of ops through the shared entry point, as the owner device. The batch carries no
/// revision and its ops address blocks by ID, so a page that moved between the snapshot and the
/// commit (the commit then refuses `COLAB_STALE_BASE`, writing nothing) is no reason to fail: the
/// batch is prepared again from a fresh snapshot, at most `SAVE_EVALUATIONS` more times, as
/// `page patch` does. Only that confirmed refusal is retried; an outcome in doubt and every other
/// refusal end the command (#6220).
pub(crate) fn write_blocks(
    root: &Path,
    page_arg: &str,
    ops: &Value,
    attachments: Option<&tmt_colab_model::attachment::DocumentChange>,
) -> Result<(page::Receipt, Value)> {
    page::blocks::validate(ops, attachments)?;
    retry_stale(|| write_blocks_once(root, page_arg, ops, attachments))
}

/// `attempt` again after a confirmed `COLAB_STALE_BASE`, at most `SAVE_EVALUATIONS` more times.
fn retry_stale<T>(mut attempt: impl FnMut() -> Result<T>) -> Result<T> {
    let mut retries = 0;
    loop {
        match attempt() {
            Err(error)
                if retries < limits::SAVE_EVALUATIONS
                    && crate::error_code(error.as_ref()) == Fault::StaleBase.code() =>
            {
                retries += 1;
            }
            done => return done,
        }
    }
}

/// One preparation from a fresh snapshot and its commit.
fn write_blocks_once(
    root: &Path,
    page_arg: &str,
    ops: &Value,
    attachments: Option<&tmt_colab_model::attachment::DocumentChange>,
) -> Result<(page::Receipt, Value)> {
    let layout = Layout::existing(root)?.ok_or(Fault::Missing)?;
    let lock = crate::write_owner(&layout)?;
    let key = Keyring::read(&layout)?;
    let store = Store::read(&layout)?;
    store.require_current_schema()?;
    let page_id = resolve_page(&store, &key, page_arg)?;
    let mut decoder = Decoder::new(std::env::current_exe()?)?;
    let display_agent = crate::core::caller_snapshot().map(|caller| {
        let mut value = json!({"name": caller.name});
        if let Some(id) = caller.agent_id {
            value["id"] = json!(id);
        }
        value
    });
    let body = page::blocks::body(ops, attachments);
    let prepared = page::prepare_blocks_publication(
        &store,
        &key,
        &page_id,
        page::blocks::action(&body, display_agent, None),
        &mut decoder,
        &now,
    );
    let closed = store.close();
    let (prepared, receipt) = prepared?;
    closed?;
    let published = crate::publish_structured_owned(
        &layout,
        &key,
        &page_id,
        prepared,
        &mut decoder,
        now,
        lock.as_ref(),
    )?;
    Ok((published, receipt))
}

pub fn run(root: &Path, args: &ArgMatches) -> Result<()> {
    let (verb, args) = args.subcommand().expect("required block command");
    match verb {
        "ls" => return list(root, args),
        "get" => return get(root, args),
        _ => {}
    }
    // A detach is a batch of no ops that removes one descriptor (#6190).
    let detach = (verb == "detach")
        .then(|| -> Result<tmt_colab_model::attachment::DocumentChange> {
            let id = text_of(args, "attachment").unwrap_or_default();
            tmt_colab_model::values::generated_id(id).map_err(|_| {
                fail(
                    "COLAB_INPUT_INVALID",
                    "The attachment must be a full attachment ID, as the page lists it.",
                )
            })?;
            Ok(serde_json::from_value(json!({ "remove": [id] }))?)
        })
        .transpose()?;
    let ops = if detach.is_some() {
        json!([])
    } else if verb == "batch" {
        let parsed: Value =
            serde_json::from_str(&read_input(text_of(args, "file").unwrap_or_default())?)
                .map_err(|_| fail("COLAB_INPUT_INVALID", "The ops file is not JSON."))?;
        match parsed {
            Value::Array(_) => parsed,
            Value::Object(mut object) => object
                .remove("ops")
                .filter(|ops| ops.is_array() && object.is_empty())
                .ok_or_else(|| {
                    fail(
                        "COLAB_INPUT_INVALID",
                        "Use a JSON array of ops, or {\"ops\": [...]}.",
                    )
                })?,
            _ => {
                return Err(fail(
                    "COLAB_INPUT_INVALID",
                    "Use a JSON array of ops, or {\"ops\": [...]}.",
                ));
            }
        }
    } else {
        ops_for(verb, args)?
    };
    let (receipt, blocks) = write_blocks(
        root,
        text_of(args, "page").unwrap_or_default(),
        &ops,
        detach.as_ref(),
    )?;
    let inserted: Vec<&str> = blocks["ops"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|op| matches!(op["op"].as_str(), Some("insert" | "table.add-row")))
        .filter_map(|op| op["id"].as_str())
        .collect();
    let json_output = args.get_flag("json");
    let mut output = tmt_cli_style::stream::stdout(json_output);
    if json_output {
        let mut value = serde_json::to_value(&receipt)?;
        value["ops"] = blocks["ops"].clone();
        value["droppedHunks"] = blocks["droppedHunks"].clone();
        value["blockIds"] = json!(inserted);
        if blocks.get("attachments").is_some() {
            value["attachments"] = blocks["attachments"].clone();
        }
        writeln!(output, "{value}")?;
        return Ok(());
    }
    let terminal = output.terminal();
    let dropped = blocks["droppedHunks"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    let mut rows = vec![
        ("page", receipt.page_id.clone()),
        ("revision", receipt.revision.clone()),
        (
            "ops",
            blocks["ops"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|op| op["op"].as_str().unwrap_or_default())
                .collect::<Vec<_>>()
                .join(" "),
        ),
    ];
    if !inserted.is_empty() {
        rows.push(("block", inserted.join(" ")));
    }
    if let Some(removed) = blocks["attachments"]["remove"].as_array() {
        for id in removed.iter().filter_map(Value::as_str) {
            rows.push(("detached", id.to_owned()));
        }
    }
    for hunk in &dropped {
        rows.push((
            "not applied",
            format!(
                "{}: your change to {}..{} overlapped a newer edit, which stays; run block get {} and apply it again",
                hunk["id"].as_str().unwrap_or_default(),
                hunk["from"],
                hunk["to"],
                hunk["id"].as_str().unwrap_or_default()
            ),
        ));
    }
    tmt_cli_style::detail::write(
        &mut output,
        terminal,
        if receipt.changed {
            "BLOCKS UPDATED"
        } else {
            "BLOCKS UNCHANGED"
        },
        &rows,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::retry_stale;
    use tmt_colab::{
        Result,
        page::{Fault, OutcomeUnknown},
    };

    /// An attempt that refuses as `fault` for its first `refusals` calls and then succeeds.
    fn attempts(fault: impl Fn() -> Fault, refusals: usize) -> (usize, Result<usize>) {
        let mut calls = 0;
        let done = retry_stale(|| {
            calls += 1;
            if calls <= refusals {
                Err(fault().into())
            } else {
                Ok(calls)
            }
        });
        (calls, done)
    }

    #[test]
    fn a_batch_the_page_moved_under_is_prepared_again_and_then_succeeds() {
        // A competing commit between the snapshot and the commit refuses once; the next
        // preparation sees the page as it is now.
        let (calls, done) = attempts(|| Fault::StaleBase, 1);
        assert_eq!(calls, 2);
        assert_eq!(done.unwrap(), 2);
        // The last of the three retries still counts.
        let (calls, done) = attempts(|| Fault::StaleBase, 3);
        assert_eq!(calls, 4);
        assert_eq!(done.unwrap(), 4);
    }

    #[test]
    fn four_stale_refusals_in_a_row_end_with_the_stale_base() {
        let (calls, done) = attempts(|| Fault::StaleBase, usize::MAX);
        assert_eq!(calls, 4, "one attempt and three more");
        let error = done.unwrap_err();
        assert_eq!(crate::error_code(error.as_ref()), Fault::StaleBase.code());
    }

    #[test]
    fn no_other_refusal_is_prepared_again() {
        for fault in [
            Fault::Invalid,
            Fault::Capacity,
            Fault::Denied,
            Fault::Unavailable,
        ] {
            let mut calls = 0;
            let done: Result<()> = retry_stale(|| {
                calls += 1;
                Err(fault.into())
            });
            assert_eq!(calls, 1, "{}", fault.code());
            assert_eq!(crate::error_code(done.unwrap_err().as_ref()), fault.code());
        }
    }

    #[test]
    fn an_outcome_in_doubt_is_never_prepared_again() {
        let mut calls = 0;
        let done: Result<()> = retry_stale(|| {
            calls += 1;
            Err(OutcomeUnknown {
                operation_id: "10000000-0000-4000-8000-000000000001".into(),
            }
            .into())
        });
        assert_eq!(calls, 1);
        assert_eq!(
            crate::error_code(done.unwrap_err().as_ref()),
            "COLAB_OUTCOME_UNKNOWN"
        );
    }
}
