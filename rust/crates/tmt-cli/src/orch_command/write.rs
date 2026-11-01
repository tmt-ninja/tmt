use super::*;
use crate::{consent, identity_context, invocation::OrchWriteOperation};
use tmt_adapters::orchestration::{OrchMutationDocument, OrchReadFailure, OrchWriteQuery};

fn mutation(
    operation: OrchWriteOperation,
    storage: &mut Storage,
    now: u64,
) -> Result<OrchMutationDocument, Failure> {
    Ok(match operation {
        op @ (OrchWriteOperation::AddJob { .. }
        | OrchWriteOperation::EditJob { .. }
        | OrchWriteOperation::PauseJob { .. }
        | OrchWriteOperation::ResumeJob { .. }
        | OrchWriteOperation::RemoveJob { .. }
        | OrchWriteOperation::ReassignJob { .. }) => super::jobs::mutation(op, storage)?,
        OrchWriteOperation::AddPlan { file } => OrchMutationDocument::AddPlan {
            candidate: Box::new(orchestration::orch_candidate_file(&file).map_err(policy_failure)?),
        },
        OrchWriteOperation::SetPlan { plan, file } => OrchMutationDocument::SetPlan {
            plan,
            candidate: Box::new(orchestration::orch_candidate_file(&file).map_err(policy_failure)?),
        },
        OrchWriteOperation::RemovePlan { plan } => OrchMutationDocument::RemovePlan { plan },
        OrchWriteOperation::Focus {
            member,
            duration_ms,
        } => {
            let identity =
                identity_context::resolve(storage, identity_context::Selector::Explicit(member))?;
            match duration_ms {
                Some(ms) => OrchMutationDocument::SetFocus {
                    identity_id: identity.id,
                    start_ms: now,
                    end_ms: now
                        .checked_add(ms)
                        .filter(|v| *v <= tmt_core::limits::MAX_JS_SAFE_INTEGER)
                        .ok_or_else(|| policy_failure(OrchError::Invalid))?,
                },
                None => OrchMutationDocument::ClearFocus {
                    identity_id: identity.id,
                },
            }
        }
        OrchWriteOperation::SetLeads { members, identity } => OrchMutationDocument::SetLeads {
            actor_id: actor(storage, identity.as_deref())?,
            identity_ids: members
                .into_iter()
                .map(|name| member(storage, name))
                .collect::<Result<_, _>>()?,
        },
        OrchWriteOperation::AllowRoute {
            from,
            to,
            duration_ms,
            identity,
        } => {
            let actor_id = actor(storage, identity.as_deref())?;
            let from_id = member(storage, from)?;
            let to_id = member(storage, to)?;
            let until_ms = match duration_ms {
                Some(ms) => now.saturating_add(ms),
                None => slot_end(storage, &from_id, now)?,
            };
            OrchMutationDocument::AllowRoute {
                from_id,
                to_id,
                until_ms,
                actor_id,
            }
        }
        OrchWriteOperation::ResumeTalks {
            first,
            second,
            identity,
        } => OrchMutationDocument::ResumeTalks {
            actor_id: actor(storage, identity.as_deref())?,
            a_id: member(storage, first)?,
            b_id: member(storage, second)?,
        },
    })
}
fn member(storage: &mut Storage, name: String) -> Result<String, Failure> {
    Ok(identity_context::resolve(storage, identity_context::Selector::Explicit(name))?.id)
}
/// The verified caller (or `--identity`) is the actor; none means a person at a terminal.
fn actor(storage: &mut Storage, explicit: Option<&str>) -> Result<Option<String>, Failure> {
    Ok(identity_context::optional(
        storage,
        || crate::caller_context::host(&tmt_adapters::host::CallerEnvironment::current()),
        explicit,
    )?
    .map(|identity| identity.id))
}
/// The default grant ends with the sender's current slot, and lasts at most 24 hours.
fn slot_end(storage: &mut Storage, sender: &str, now: u64) -> Result<u64, Failure> {
    let read = |e| {
        Failure::new(
            "ORCH_STORAGE_UNAVAILABLE",
            "Could not read orchestration storage.",
            1,
        )
        .caused_by(e)
    };
    let state = storage.orchestration_snapshot(None).map_err(read)?;
    let zone = orchestration::OrchZone::load(state.time_zone.as_deref()).map_err(policy_failure)?;
    let cap = now.saturating_add(tmt_core::orchestration::sending::ORCH_MAX_GRANT_MS);
    Ok(
        tmt_core::orchestration::effective(&state.snapshot, sender, now, &zone)
            .map_err(policy_failure)?
            .next_change_at_ms
            .map_or(cap, |end| end.min(cap)),
    )
}
fn failure(error: OrchReadFailure, paths: &ConfigPaths) -> Failure {
    match error {
        OrchReadFailure::Job(tmt_adapters::storage::JobStoreError::Storage(error)) => {
            Failure::storage_access(
                error,
                &paths.global_dir,
                "The job write could not be confirmed. Inspect its current revision before retrying.",
                "ORCH_STORAGE_UNAVAILABLE",
                "Could not publish job configuration.",
            )
        }
        error @ OrchReadFailure::Job(_) => {
            Failure::new(error.code(), error.message(), error.exit()).caused_by(error)
        }
        OrchReadFailure::Policy(e) => policy_failure(e),
        OrchReadFailure::Storage(e) => Failure::storage_access(
            e,
            &paths.global_dir,
            "The orchestration write could not be confirmed. Inspect its configuration revision before retrying.",
            "ORCH_STORAGE_UNAVAILABLE",
            "Could not publish orchestration configuration.",
        ),
    }
}
pub(super) fn execute(
    operation: OrchWriteOperation,
    yes: bool,
    mode: OutputMode,
) -> io::Result<u8> {
    let (paths, mut storage) = match open_storage() {
        Ok(v) => v,
        Err(e) => return e.publish(mode),
    };
    let mut out = tmt_cli_style::stream::stdout(mode.json);
    let result = (|| {
        let now = tmt_adapters::request_runtime::wall_time_ms();
        let mutation = mutation(operation, &mut storage, now)?;
        let preview = orchestration::orchestration_write(
            &mut storage,
            OrchWriteQuery::Preview {
                mutation: mutation.clone(),
            },
            || now,
        )
        .map_err(|e| failure(e, &paths))?;
        let value: Value = serde_json::from_slice(&preview).expect("shared write preview JSON");
        if !mode.json {
            let terminal = out.terminal();
            write_human(&mut out, terminal, &value).map_err(|e| {
                Failure::new("OUTPUT_ERROR", "Could not print orchestration preview.", 1)
                    .caused_by(e)
            })?;
        }
        if !yes && !consent::interactive(mode, &out) {
            return Ok(preview);
        }
        let accepted = consent::ask(
            &mut out,
            yes,
            mode,
            consent::Consent {
                code: "ORCH_CONSENT_REQUIRED",
                refusal: "Saving requires explicit consent; inspect the preview and repeat with --yes.",
                question: "Save this orchestration change",
                declined: "Not saved.",
            },
            |e| {
                Failure::new("OUTPUT_ERROR", "Could not read orchestration consent.", 1)
                    .caused_by(e)
            },
        )?;
        if !accepted {
            return Ok(preview);
        }
        let result = orchestration::orchestration_write(
            &mut storage,
            OrchWriteQuery::Apply {
                mutation: serde_json::from_value(value["mutation"].clone())
                    .expect("normalized shared mutation"),
                expected_configuration_revision: value["configurationRevision"]
                    .as_u64()
                    .expect("preview revision"),
                preview_at_ms: value["previewAtMs"].as_u64().expect("preview instant"),
                preview_digest: value["previewDigest"]
                    .as_str()
                    .expect("preview digest")
                    .into(),
                consent: true,
            },
            tmt_adapters::request_runtime::wall_time_ms,
        )
        .map_err(|e| failure(e, &paths))?;
        if !mode.json {
            let saved: Value = serde_json::from_slice(&result).expect("shared write result JSON");
            let terminal = out.terminal();
            let mut fields = match saved["released"].as_array() {
                Some(released) => vec![("released requests", released.len().to_string())],
                None => vec![("configuration revision",text(&saved["configurationRevision"]))],
            };
            if let Some(job) = saved.get("job").filter(|job| !job.is_null()) {
                fields.push(("job", text(&job["displayId"])));
                fields.push(("revision", text(&job["revision"])));
            }
            tmt_cli_style::detail::write(&mut out, terminal, "Orchestration saved", &fields)
                .map_err(|e| Failure::new("OUTPUT_ERROR", "Could not print orchestration result.", 1).caused_by(e))?;
        }
        Ok(result)
    })();
    match after_cleanup(result, || storage.close()) {
        Ok(bytes) => {
            if mode.json {
                out.write_all(&bytes)?;
                writeln!(out)?;
            }
            Ok(0)
        }
        Err(e) => e.publish(mode),
    }
}
