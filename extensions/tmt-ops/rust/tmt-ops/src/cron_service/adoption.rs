//! Exact legacy-source adoption through Core's public immutable-file boundary.
use super::*;
use std::collections::BTreeSet;
use tmt_ops::cron::{Clock, FrozenJobs};

fn invalid_receipt() -> SquadError {
    failure(
        "SQUAD_CRON_CUTOVER_UNCONFIRMED",
        "Core did not confirm the exact frozen jobs source and mapping. The source remains frozen; no import was repeated.",
    )
}
fn matches_receipt(frozen: &FrozenJobs, receipt: &Value) -> bool {
    let Ok(source) = serde_json::from_slice::<Value>(&frozen.bytes) else {
        return false;
    };
    if receipt["sourceId"] != frozen.source_id
        || receipt["sourceDigest"] != frozen.source_digest
        || receipt["counters"] != source["counters"]
    {
        return false;
    }
    let (Some(source_jobs), Some(imported)) =
        (source["jobs"].as_array(), receipt["jobs"].as_array())
    else {
        return false;
    };
    if source_jobs.len() != imported.len() {
        return false;
    }
    let mut expected = BTreeSet::new();
    for job in source_jobs {
        let (Some(room), Some(id)) = (job["roomId"].as_str(), job["id"].as_str()) else {
            return false;
        };
        let Some(number) = id
            .strip_prefix('c')
            .and_then(|n| n.parse::<u64>().ok())
            .filter(|n| *n > 0)
        else {
            return false;
        };
        if !expected.insert((room.to_owned(), number)) {
            return false;
        }
    }
    let mut actual = BTreeSet::new();
    let mut ids = BTreeSet::new();
    let mut displays = BTreeSet::new();
    for item in imported {
        let (Some(room), Some(number), Some(id), Some(display)) = (
            item["roomId"].as_str(),
            item["cronId"].as_u64(),
            item["jobId"].as_str(),
            item["displayId"].as_str(),
        ) else {
            return false;
        };
        if !crate::config::uuid_like(id)
            || id != id.to_ascii_lowercase()
            || display
                .strip_prefix('j')
                .and_then(|n| n.parse::<u64>().ok())
                .is_none_or(|n| n == 0)
            || !actual.insert((room.to_owned(), number))
            || !ids.insert(id)
            || !displays.insert(display)
        {
            return false;
        }
    }
    actual == expected
}
fn confirm(core: &Core, store: &Store, frozen: &FrozenJobs) -> Result<(), SquadError> {
    let readback = core.json(&["orch", "job", "import-receipt", &frozen.source_id])?;
    if readback["schemaVersion"] != 1 || !matches_receipt(frozen, &readback["receipt"]) {
        return Err(invalid_receipt());
    }
    store.confirm_core_adoption(frozen)?;
    Ok(())
}
/// Called in the service's migration guard, never inside its SQLite transaction.
/// Once frozen, subsequent invocations only read back the exact receipt.
pub(super) fn ensure(core: &Core, store: &Store) -> Result<(), SquadError> {
    if store.core_redirect()?.is_some() {
        return Ok(());
    }
    let root = root(core)?;
    let clock = Clock::new(&root)?;
    let quiescent = clock.quiescent_for_cutover()?;
    if let Some(frozen) = store.frozen_for_core()? {
        return confirm(core, store, &frozen).map_err(|error| recovery(&frozen, error));
    }
    let (source_digest, bytes) = store.cutover_source()?;
    let source_id = crate::send::new_operation()?;
    let source = FrozenJobs {
        source_id,
        source_digest,
        bytes,
    };
    let path = store.export_core_source(&source)?;
    let path = path.to_str().ok_or_else(invalid_receipt)?;
    let args = [
        "orch",
        "job",
        "import",
        "--file",
        path,
        "--source-id",
        &source.source_id,
        "--digest",
        &source.source_digest,
    ];
    let preview = core.json(&args)?;
    let document: Value = serde_json::from_slice(&source.bytes).map_err(|_| invalid_receipt())?;
    if preview["schemaVersion"] != 1
        || preview["requiresConsent"] != true
        || preview["sourceId"] != source.source_id
        || preview["sourceDigest"] != source.source_digest
        || preview["jobs"].as_u64() != document["jobs"].as_array().map(|jobs| jobs.len() as u64)
    {
        return Err(invalid_receipt());
    }
    let frozen = store.freeze_for_core(&quiescent, &source.source_id, &source.source_digest)?;
    if frozen != source {
        return Err(invalid_receipt());
    }
    let mut apply = args.to_vec();
    apply.push("--yes");
    // Even an error can follow accepted work. Never infer rollback or resubmit.
    let publication = core.json(&apply);
    match confirm(core, store, &frozen) {
        Ok(()) => Ok(()),
        Err(error) => Err(recovery(&frozen, publication.err().unwrap_or(error))),
    }
}
fn recovery(frozen: &FrozenJobs, error: SquadError) -> SquadError {
    SquadError::hinted(
        "SQUAD_CRON_CUTOVER_UNCONFIRMED",
        &format!(
            "Jobs remain frozen at source {} (digest {}): {}",
            frozen.source_id, frozen.source_digest, error.message
        ),
        " ",
        &format!(
            "Inspect `tmt orch job import-receipt {} --json` and the retained cron/core-source-{}.json before any manual recovery; no automatic import is retried.",
            frozen.source_id, frozen.source_digest
        ),
    )
}
