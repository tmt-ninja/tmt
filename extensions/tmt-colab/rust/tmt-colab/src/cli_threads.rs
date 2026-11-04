//! Thin native CLI projection and local status publication; no agent dispatch.
use clap::{Arg, ArgMatches, Command};
use serde_json::json;
use std::{
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
use tmt_cli_style::{CommandSpec, Example, OutputModes};
use tmt_colab::{
    Result, core,
    decoder::Decoder,
    discussion::{self, StatusEdit},
    keyring::{Keyring, Layout},
    page::{self, Fault},
    store::Store,
};
fn id(name: &'static str) -> Arg {
    Arg::new(name).required(true).value_parser(|value: &str| {
        tmt_colab_model::values::generated_id(value)
            .map(|_| value.to_owned())
            .map_err(|e| e.to_string())
    })
}
macro_rules! cmd {
    ($name:literal, $summary:literal, $example:literal, $details:literal) => {
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
    cmd!("threads", "Read page discussions or change a thread's status", "tmt colab threads 10000000-0000-4000-8000-000000000001 --json",
        "Reads authenticated discussions for the current epoch without creating or migrating state. Labels and times are asserted by writers. Resolve and Reopen publish one immutable local-device status action; creation, deletion and comment edits remain writer-owned. Agent CLI actions never notify other agents.")
        .mut_arg("json", |arg| arg.global(true))
        .args_conflicts_with_subcommands(true).subcommand_negates_reqs(true)
        .arg(crate::cli_grammar::page())
        .arg(
            Arg::new("thread")
                .long("thread")
                .value_name("THREAD")
                .help("Read only this thread (its comments and the asks about it)")
                .value_parser(|value: &str| {
                    tmt_colab_model::values::generated_id(value)
                        .map(|_| value.to_owned())
                        .map_err(|e| e.to_string())
                }),
        )
        .subcommand(cmd!("resolve", "Resolve a live annotation thread", "tmt colab threads resolve 10000000-0000-4000-8000-000000000001 20000000-0000-4000-8000-000000000001",
            "Publishes only status, through the running owner service or its offline lifecycle lock. The caller name is a display label, never authority. Already resolved is a no-op; ambiguous, deleted and Chat threads are refused. No notifications or automatic retry.").arg(crate::cli_grammar::page()).arg(id("thread").index(2)))
        .subcommand(cmd!("reopen", "Reopen a resolved annotation thread", "tmt colab threads reopen 10000000-0000-4000-8000-000000000001 20000000-0000-4000-8000-000000000001",
            "Uses the same immutable status stream and publication fences as Resolve. Already open is a no-op. No notifications or automatic retry.").arg(crate::cli_grammar::page()).arg(id("thread").index(2)))
}
pub fn run(root: &Path, args: &ArgMatches) -> Result<()> {
    let (mode, args) = args.subcommand().unwrap_or(("list", args));
    let layout = Layout::existing(root)?.ok_or(Fault::Missing)?;
    let key = Keyring::read(&layout)?;
    let store = Store::read(&layout)?;
    store.require_current_schema()?;
    let mut decoder = Decoder::new(std::env::current_exe()?)?;
    let page_id = crate::cli_management::resolve_page(
        &store,
        &key,
        args.get_one::<String>("page").expect("required page"),
    )?;
    let catalog = tmt_colab::inspection::catalog(&store, &key)?;
    let ids = catalog["pageIds"]
        .as_array()
        .ok_or(Fault::Invalid)?
        .iter()
        .map(|row| {
            row["pageId"]
                .as_str()
                .map(str::to_owned)
                .ok_or(Fault::Invalid)
        })
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let reach = crate::reach::Reach::gather().with_pages(&ids);
    let path = crate::reach::Reach::path(&key.space_id, &page_id);

    let json_output = args.get_flag("json");
    let mut output = tmt_cli_style::stream::stdout(json_output);
    if mode == "list" {
        let view = discussion::read(&store, &key, &page_id, &mut decoder);
        let closed = store.close();
        let mut view = view?;
        closed?;
        let only = args.get_one::<String>("thread");
        if let Some(only) = only {
            view.conversations
                .threads
                .retain(|thread| &thread.id == only);
            if view.conversations.threads.is_empty() {
                return Err(Fault::Missing.into());
            }
            let thread = &view.conversations.threads[0];
            let comments: Vec<(&str, &str)> = thread
                .comments
                .iter()
                .map(|comment| (comment.writer.as_str(), comment.id.as_str()))
                .collect();
            let keep: Vec<bool> = view
                .conversations
                .asks
                .iter()
                .map(|ask| {
                    asks_about(
                        &ask.thread,
                        &ask.writer,
                        &ask.message_ids,
                        &thread.id,
                        &comments,
                    )
                })
                .collect();
            let mut keep = keep.into_iter();
            view.conversations
                .asks
                .retain(|_| keep.next().unwrap_or(false));
        }
        if json_output {
            let mut value = serde_json::to_value(&view)?;
            reach.annotate(&mut value, &path);
            writeln!(output, "{value}")?;
        } else {
            let mut rows = vec![
                ("page", page_id.clone()),
                ("link", reach.text(&path)),
                ("title", view.conversations.title),
                ("epoch", view.conversations.epoch),
            ];
            for thread in view.conversations.threads {
                let state = if thread.deleted {
                    "deleted"
                } else if thread.resolved {
                    "resolved"
                } else {
                    "open"
                };
                let actor = thread
                    .status
                    .as_ref()
                    .map(|status| {
                        status
                            .action
                            .agent_name
                            .as_deref()
                            .unwrap_or(&status.action.device_name)
                    })
                    .unwrap_or(&thread.device_name);
                let quote = thread
                    .anchor
                    .as_ref()
                    .map(|a| a.exact.as_str())
                    .unwrap_or("Page comment");
                rows.push((
                    "thread",
                    format!("{} · {state} · {actor} · {quote}", thread.id),
                ));
                if only.is_none() {
                    continue;
                }
                // One thread reads as its conversation: each comment, then the replies asked about it.
                for comment in thread.comments.iter().filter(|comment| !comment.deleted) {
                    rows.push((
                        "comment",
                        format!("{}: {}", comment.device_name, comment.body),
                    ));
                    for ask in &view.conversations.asks {
                        if let Some(reply) = ask
                            .reply
                            .as_ref()
                            .filter(|_| ask.message_ids.contains(&comment.id))
                        {
                            rows.push(("reply", format!("{}: {}", ask.agent_name, reply.body)));
                        }
                    }
                }
            }
            let terminal = output.terminal();
            tmt_cli_style::detail::write(&mut output, terminal, "PAGE THREADS", &rows)?;
        }
    } else {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)?
            .as_millis()
            .try_into()?;
        let agent_name = core::publisher_agent();
        let thread = args.get_one::<String>("thread").expect("required thread");
        let resolved = mode == "resolve";
        let prepared = discussion::prepare_status(
            &store,
            &key,
            &page_id,
            StatusEdit {
                thread,
                resolved,
                agent_name: agent_name.as_deref(),
            },
            &mut decoder,
            now,
        );
        let closed = store.close();
        let prepared = prepared?;
        closed?;
        let changed = prepared.is_some();
        let (action, operation_id) = if let Some((frozen, action)) = prepared {
            let published =
                crate::publish_write(&layout, &key, &page_id, &frozen, &mut decoder, now)?;
            let receipt = page::publication_receipt(frozen.job(), &published.record)?;
            (Some(action), receipt.publication.map(|v| v.operation_id))
        } else {
            (None, None)
        };
        if json_output {
            let mut value = json!({"spaceId":key.space_id,"pageId":page_id,"threadId":thread,"resolved":resolved,"changed":changed,"operationId":operation_id,"action":action});
            reach.annotate(&mut value, &path);
            writeln!(output, "{value}")?;
        } else {
            let terminal = output.terminal();
            tmt_cli_style::detail::write(
                &mut output,
                terminal,
                if resolved {
                    "THREAD RESOLVED"
                } else {
                    "THREAD REOPENED"
                },
                &[
                    ("page", page_id.clone()),
                    ("link", reach.text(&path)),
                    ("thread", thread.clone()),
                    ("changed", changed.to_string()),
                    ("notifications", "none (agent CLI status only)".into()),
                ],
            )?;
        }
    }
    Ok(())
}

/// Whether an Ask is about one thread: an Ask names its own thread, and a batch Ask (several answer
/// comments, #2875) is also about each comment it lists in another of the group's threads, but only
/// a comment its own writer wrote. The browser's `asksAbout` keeps the same rule (#6012).
fn asks_about(
    ask_thread: &str,
    ask_writer: &str,
    message_ids: &[String],
    thread: &str,
    comments: &[(&str, &str)],
) -> bool {
    ask_thread == thread
        || (message_ids.len() > 1
            && comments.iter().any(|(writer, id)| {
                *writer == ask_writer && message_ids.iter().any(|message| message == id)
            }))
}

#[cfg(test)]
mod tests {
    use super::asks_about;

    #[test]
    fn a_batch_ask_reads_with_every_answer_thread_it_lists() {
        let ids = |v: &[&str]| v.iter().map(|id| id.to_string()).collect::<Vec<_>>();
        let batch = ids(&["first", "second"]);
        // The canonical thread is the first answer's; the second answer's thread still shows it.
        assert!(asks_about("one", "me", &batch, "one", &[("me", "first")]));
        assert!(asks_about("one", "me", &batch, "two", &[("me", "second")]));
        // Another writer's comment with a listed ID, or a single Ask, does not reach another thread.
        assert!(!asks_about(
            "one",
            "me",
            &batch,
            "two",
            &[("you", "second")]
        ));
        assert!(!asks_about(
            "one",
            "me",
            &ids(&["second"]),
            "two",
            &[("me", "second")]
        ));
        assert!(!asks_about(
            "one",
            "me",
            &batch,
            "three",
            &[("me", "other")]
        ));
    }
}
