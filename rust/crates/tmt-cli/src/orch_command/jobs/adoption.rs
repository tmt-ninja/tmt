//! Bounded immutable-file handoff; Core never opens the Ops database.
use super::*;
use crate::consent;
use serde_json::json;
use tmt_core::{content_digest, dispatch::canonical_id};
const LIMIT: usize = 16 * 1024 * 1024;
fn invalid() -> Failure {
    Failure::new(
        "ORCH_INPUT_INVALID",
        "Expected an exact source UUID, SHA-256 digest and bounded regular legacy jobs file.",
        1,
    )
}
pub(in crate::orch_command) fn execute(
    operation: OrchOperation,
    mode: OutputMode,
) -> io::Result<u8> {
    let mut out = tmt_cli_style::stream::stdout(mode.json);
    let result = (|| match operation {
        OrchOperation::ImportReceipt { source_id } => {
            if !canonical_id(&source_id) {
                return Err(invalid());
            }
            let (_, mut storage) = open_storage()?;
            let receipt = storage
                .orchestration_job_import_receipt(&source_id)
                .map_err(failure)
                .and_then(|receipt| {
                    receipt.ok_or_else(|| {
                        Failure::new(
                            "ORCH_JOB_IMPORT_NOT_FOUND",
                            "No accepted import receipt is recorded for this source.",
                            3,
                        )
                    })
                });
            let receipt = after_cleanup(receipt, || storage.close())?;
            Ok(json!({"schemaVersion":1,"receipt":receipt}))
        }
        OrchOperation::ImportJobs {
            file,
            source_id,
            digest,
            yes,
        } => {
            if !canonical_id(&source_id) || !content_digest::is_sha256(&digest) {
                return Err(invalid());
            }
            let bytes =
                tmt_adapters::bounded_file::read_no_follow(&file, LIMIT).map_err(|_| invalid())?;
            let (observed, count) =
                tmt_adapters::storage::preview_job_import(&bytes).map_err(failure)?;
            if observed != digest {
                return Err(Failure::new(
                    "ORCH_CONFLICT",
                    "The immutable import source does not match its expected digest.",
                    5,
                ));
            }
            let preview = json!({"schemaVersion":1,"sourceId":source_id,"sourceDigest":digest,"jobs":count,"requiresConsent":true});
            if !mode.json {
                let terminal = out.terminal();
                tmt_cli_style::detail::write(
                    &mut out,
                    terminal,
                    "Job adoption preview",
                    &[
                        ("source", source_id.clone()),
                        ("jobs", count.to_string()),
                        ("digest", digest.clone()),
                    ],
                )
                .map_err(|e| {
                    Failure::new("OUTPUT_ERROR", "Could not print adoption preview.", 1)
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
                    refusal: "Adoption requires consent; inspect the preview and repeat with --yes.",
                    question: "Adopt this exact frozen jobs source",
                    declined: "Not adopted.",
                },
                |e| {
                    Failure::new("OUTPUT_ERROR", "Could not read adoption consent.", 1).caused_by(e)
                },
            )?;
            if !accepted {
                return Ok(preview);
            }
            let (_, mut storage) = open_storage()?;
            let receipt = storage
                .import_orchestration_jobs(
                    &source_id,
                    &digest,
                    &bytes,
                    tmt_adapters::request_runtime::wall_time_ms() as i64,
                )
                .map_err(failure);
            let receipt = after_cleanup(receipt, || storage.close())?;
            Ok(json!({"schemaVersion":1,"requiresConsent":false,"receipt":receipt}))
        }
        _ => Err(invalid()),
    })();
    match result {
        Err(error) => error.publish(mode),
        Ok(value) => {
            if mode.json {
                serde_json::to_writer(&mut out, &value)?;
                writeln!(out)?;
            } else if value["receipt"].is_object() {
                let terminal = out.terminal();
                tmt_cli_style::detail::write(
                    &mut out,
                    terminal,
                    "Job adoption receipt",
                    &[
                        (
                            "source",
                            value["receipt"]["sourceId"]
                                .as_str()
                                .unwrap_or("unknown")
                                .to_owned(),
                        ),
                        (
                            "digest",
                            value["receipt"]["sourceDigest"]
                                .as_str()
                                .unwrap_or("unknown")
                                .to_owned(),
                        ),
                    ],
                )?;
            }
            Ok(0)
        }
    }
}
