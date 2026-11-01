//! CLI selectors and presentation over the shared job read/write owners.
use super::*;
use crate::{identity_context, invocation::OrchWriteOperation};
use tmt_adapters::orchestration::{JobDefinitionDocument, OrchMutationDocument, OrchReadFailure};
fn failure(e: impl Into<OrchReadFailure>) -> Failure {
    let e = e.into();
    Failure::new(e.code(), e.message(), e.exit()).caused_by(e)
}
fn file(path: &std::path::Path) -> Result<Box<JobDefinitionDocument>, Failure> {
    let bytes = tmt_adapters::bounded_file::read_no_follow(path, tmt_adapters::api::INPUT_LIMIT)
        .map_err(|e| {
            Failure::new(
                "ORCH_INPUT_INVALID",
                "Could not read a bounded regular job definition file.",
                1,
            )
            .caused_by(e)
        })?;
    serde_json::from_slice(&bytes).map(Box::new).map_err(|e| {
        Failure::new("ORCH_INPUT_INVALID", "Invalid job definition JSON.", 1).caused_by(e)
    })
}
pub(super) fn mutation(
    op: OrchWriteOperation,
    s: &mut Storage,
) -> Result<OrchMutationDocument, Failure> {
    use OrchWriteOperation::*;
    if let AddJob { file: path } = op {
        return Ok(OrchMutationDocument::AddJob {
            candidate: file(&path)?,
        });
    }
    let selector = match &op {
        EditJob { job, .. }
        | PauseJob { job }
        | ResumeJob { job }
        | RemoveJob { job }
        | ReassignJob { job, .. } => job,
        _ => unreachable!("job write"),
    };
    let current = s.resolve_orchestration_job(selector).map_err(failure)?;
    let job_id = current.id.clone();
    let revision = current.revision;
    Ok(match op {
        EditJob { file: path, .. } => OrchMutationDocument::SetJob {
            job_id,
            revision,
            candidate: file(&path)?,
        },
        PauseJob { .. } => OrchMutationDocument::PauseJob {
            job_id,
            revision,
            by: "manual".into(),
        },
        ResumeJob { .. } => OrchMutationDocument::ResumeJob { job_id, revision },
        RemoveJob { .. } => OrchMutationDocument::RemoveJob { job_id, revision },
        ReassignJob { member, .. } => {
            let owner = identity_context::resolve(s, identity_context::Selector::Explicit(member))?;
            let mut candidate = JobDefinitionDocument::from_job(&current);
            candidate.owner_identity_id = Some(owner.id);
            OrchMutationDocument::SetJob {
                job_id,
                revision,
                candidate: Box::new(candidate),
            }
        }
        _ => unreachable!("job write"),
    })
}
pub(super) fn read(op: OrchOperation) -> Result<Vec<u8>, Failure> {
    let (_paths, mut s) = open_storage()?;
    let result = (|| {
        let query = match op {
            OrchOperation::Jobs {
                owner,
                room,
                limit,
                cursor,
            } => OrchReadQuery::Jobs {
                owner_identity_id: owner
                    .map(|name| {
                        identity_context::resolve(
                            &mut s,
                            identity_context::Selector::Explicit(name),
                        )
                        .map(|i| i.id)
                    })
                    .transpose()?,
                squad_room_id: room,
                job_id: None,
                limit: Some(limit),
                cursor,
            },
            OrchOperation::ShowJob { job } => OrchReadQuery::Job {
                job_id: s.resolve_orchestration_job(&job).map_err(failure)?.id,
            },
            _ => unreachable!("job read"),
        };
        orchestration::orchestration_read(&s, query, tmt_adapters::request_runtime::wall_time_ms())
            .map_err(failure)
    })();
    after_cleanup(result, || s.close())
}
pub(super) fn human(
    out: &mut impl Write,
    terminal: tmt_cli_style::Terminal,
    v: &Value,
) -> io::Result<()> {
    use tmt_cli_style::table::{Cell, Column, Table};
    if let Some(rows) = v["jobs"].as_array() {
        let mut table = Table::new(&[Column::Fixed, Column::Name, Column::Fixed, Column::Name]);
        for row in rows {
            table.row([
                Cell::from(text(&row["displayId"])),
                Cell::from(row["target"]["identityName"].as_str().unwrap_or("no owner")),
                Cell::from(text(&row["state"])),
                Cell::from(text(&row["title"])),
            ]);
        }
        table.write(out, terminal)?;
        if !v["nextCursor"].is_null() {
            tmt_cli_style::detail::write(
                out,
                terminal,
                "More jobs",
                &[("cursor", text(&v["nextCursor"]))],
            )?;
        }
        return Ok(());
    }
    if v.get("after").is_some() {
        return tmt_cli_style::detail::write(
            out,
            terminal,
            "Job preview",
            &[
                ("operation", text(&v["mutation"]["kind"])),
                ("job", text(&v["before"]["displayId"])),
                ("before", v["before"].to_string()),
                ("after", v["after"].to_string()),
                ("saved", "false".into()),
            ],
        );
    }
    let row = &v["job"];
    tmt_cli_style::detail::write(
        out,
        terminal,
        "Job",
        &[
            ("id", text(&row["displayId"])),
            ("owner", text(&row["target"]["identityName"])),
            ("state", text(&row["state"])),
            ("definition", row["definition"].to_string()),
            ("next run", text(&row["nextRunAtMs"])),
            ("last run", row["lastRun"].to_string()),
        ],
    )
}

pub(super) fn send(operation: OrchOperation, mode: OutputMode) -> io::Result<u8> {
    let OrchOperation::SendJob {
        job,
        identity,
        operation_id,
        yes,
    } = operation
    else {
        unreachable!("job send")
    };
    let operation_id = operation_id.unwrap_or_else(tmt_core::operation::new_operation_id);
    let mut out = tmt_cli_style::stream::stdout(mode.json);
    let result = (|| {
        if !tmt_core::dispatch::canonical_id(&operation_id) {
            return Err(Failure::new(
                "ORCH_INPUT_INVALID",
                "Operation ID must be a non-nil UUID.",
                1,
            ));
        }
        let (paths, mut s) = open_storage()?;
        let pending = (|| {
            let settings = tmt_adapters::config::ConfigFiles { paths }
                .load()
                .map_err(Failure::from)?
                .settings;
            let job = s.resolve_orchestration_job(&job).map_err(failure)?;
            let sender = identity_context::optional(
                &mut s,
                || crate::caller_context::host(&tmt_adapters::host::CallerEnvironment::current()),
                identity.as_deref(),
            )?;
            let originator = sender.map_or(tmt_core::request::Originator::Unknown, |i| {
                if identity.is_some() {
                    tmt_core::request::Originator::Explicit(i.id)
                } else {
                    tmt_core::request::Originator::Verified(i.id)
                }
            });
            let preview = serde_json::json!({"schemaVersion":1,"requiresConsent":true,"jobId":job.id,"revision":job.revision,"operationId":operation_id,"effect":"sendOnce","message":job.message});
            if !mode.json {
                let terminal = out.terminal();
                tmt_cli_style::detail::write(
                    &mut out,
                    terminal,
                    "Send job once",
                    &[
                        ("job", job.display_id()),
                        ("operation", operation_id.clone()),
                        (
                            "message",
                            serde_json::to_string(&job.message).expect("exact message JSON"),
                        ),
                    ],
                )
                .map_err(|e| {
                    Failure::new("OUTPUT_ERROR", "Could not print the send preview.", 1)
                        .caused_by(e)
                })?;
            }
            if !yes && !crate::consent::interactive(mode, &out) {
                return Ok(serde_json::to_vec(&preview).expect("job preview JSON"));
            }
            let accepted = crate::consent::ask(
                &mut out,
                yes,
                mode,
                crate::consent::Consent {
                    code: "ORCH_CONSENT_REQUIRED",
                    refusal: "Sending requires explicit consent; inspect the preview and repeat with --yes.",
                    question: "Send this job once (its manual pause stays)",
                    declined: "Not sent.",
                },
                |e| Failure::new("OUTPUT_ERROR", "Could not read send consent.", 1).caused_by(e),
            )?;
            if !accepted {
                return Ok(serde_json::to_vec(&preview).expect("job preview JSON"));
            }
            let now = tmt_adapters::request_runtime::wall_time_ms();
            orchestration::execute_job(
                &mut s,
                tmt_adapters::storage::JobRunInput {
                    job_id: job.id,
                    expected_revision: job.revision,
                    slot_ms: now as i64,
                    manual_operation_id: Some(operation_id.clone()),
                    originator,
                },
                &settings,
                tmt_adapters::request_runtime::wall_time_ms,
            )
            .map_err(failure)
        })();
        after_cleanup(pending, || s.close())
    })();
    match result {
        Ok(bytes)=>{if mode.json {out.write_all(&bytes)?;writeln!(out)?;}else{let v:Value=serde_json::from_slice(&bytes).expect("job result JSON");if v["requiresConsent"]!=true {let terminal=out.terminal();tmt_cli_style::detail::write(&mut out,terminal,"Job accepted",&[("operation",operation_id),("run",text(&v["runId"]))])?;}}Ok(0)},
        Err(e)=>e.suggestion(format!("Retain operation ID {operation_id}; recover its canonical dispatch receipt before retrying.")).publish(mode)
    }
}
