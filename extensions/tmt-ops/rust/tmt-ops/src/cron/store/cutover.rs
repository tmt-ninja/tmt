//! Retain exact legacy bytes and fence old writers before the public Core import.
use super::*;
use crate::cron::QuiescentClock;
use rusqlite::{OptionalExtension, params};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrozenJobs {
    pub source_id: String,
    pub source_digest: String,
    pub bytes: Vec<u8>,
}
fn digest(bytes: &[u8]) -> String {
    let mut hash = Sha256::new();
    hash.update(b"tmt:orchestration:legacy-jobs:v1\0");
    hash.update((bytes.len() as u64).to_be_bytes());
    hash.update(bytes);
    hash.finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn source(bytes: Option<&[u8]>) -> Result<Vec<u8>, Error> {
    match bytes {
        Some(bytes) => {
            decode(Some(bytes))?;
            Ok(bytes.to_vec())
        }
        None => serde_json::to_vec(&Jobs::default().document()).map_err(io),
    }
}
fn conflict() -> Error {
    Error::new(
        "SQUAD_CRON_CUTOVER_CONFLICT",
        "Cron changed during adoption. Inspect the current source before starting a new import.",
    )
}
fn marker(bytes: &[u8]) -> Result<Option<Value>, Error> {
    let value: Value = serde_json::from_slice(bytes).map_err(|error| corrupt(error.to_string()))?;
    if value["version"].as_u64().is_some_and(|v| v < 3) {
        return Ok(None);
    }
    let id = value["sourceId"].as_str().ok_or_else(conflict)?;
    let hash = value["sourceDigest"].as_str().ok_or_else(conflict)?;
    if value["version"] != 3
        || value["owner"] != "core.jobs"
        || !matches!(value["phase"].as_str(), Some("frozen" | "adopted"))
        || !crate::operation::uuid_like(id)
        || id != id.to_ascii_lowercase()
        || hash.len() != 64
        || !hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(conflict());
    }
    Ok(Some(value))
}
impl Store {
    /// Only a confirmed Core receipt permits the caller to publish this redirect.
    /// No Core bytes are read here; the source fence remains an Ops transaction.
    pub fn confirm_core_adoption(&self, frozen: &FrozenJobs) -> Result<(), Error> {
        let slot = self.slot();
        let mut database = Database::open(&self.root).map_err(refused)?;
        database
            .update(
                &slot,
                |bytes| {
                    let mut value = marker(bytes.ok_or_else(conflict)?)?.ok_or_else(conflict)?;
                    if value["sourceId"] != frozen.source_id
                        || value["sourceDigest"] != frozen.source_digest
                        || digest(&frozen.bytes) != frozen.source_digest
                    {
                        return Err(conflict());
                    }
                    let changed = value["phase"] != "adopted";
                    value["phase"] = json!("adopted");
                    Ok((
                        if changed {
                            Some(serde_json::to_vec(&value).map_err(io)?)
                        } else {
                            None
                        },
                        (),
                    ))
                },
                |_, tx| {
                    let retained: Vec<u8> = tx
                        .query_row(
                            "SELECT body FROM documents WHERE kind='cron-cutover-source' AND key=?",
                            [&frozen.source_id],
                            |r| r.get(0),
                        )
                        .map_err(io)?;
                    if retained != frozen.bytes {
                        return Err(conflict());
                    }
                    Ok(())
                },
            )
            .map_err(failed)
    }
    pub fn core_redirect(&self) -> Result<Option<(String, String)>, Error> {
        let slot = self.slot();
        let Some(mut database) =
            Database::open_existing(&self.root, &slot.legacy).map_err(refused)?
        else {
            return Ok(None);
        };
        database
            .inspect(&slot, |bytes| {
                let Some(bytes) = bytes else {
                    return Ok(None);
                };
                let Some(value) = marker(bytes)? else {
                    return Ok(None);
                };
                Ok((value["phase"] == "adopted").then(|| {
                    (
                        value["sourceId"].as_str().unwrap().to_owned(),
                        value["sourceDigest"].as_str().unwrap().to_owned(),
                    )
                }))
            })
            .map_err(failed)
    }
    /// One durable export per exact content digest, including before freeze.
    /// Repeated refused preflights cannot accumulate a copy for every attempt.
    /// A pre-existing unknown file is never replaced or removed.
    pub fn export_core_source(&self, frozen: &FrozenJobs) -> Result<PathBuf, Error> {
        use std::{
            io::Read,
            os::unix::fs::{MetadataExt, PermissionsExt},
        };
        if !crate::operation::uuid_like(&frozen.source_id)
            || frozen.source_id != frozen.source_id.to_ascii_lowercase()
            || frozen.bytes.len() as u64 > LIMIT
            || digest(&frozen.bytes) != frozen.source_digest
        {
            return Err(conflict());
        }
        let layout = tmt_extension_state::Layout::open(&self.root, "cron", &[])
            .map_err(|e| io(format!("Cannot open private cron export directory: {e:?}")))?;
        let path = layout
            .directory
            .join(format!("core-source-{}.json", frozen.source_digest));
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(nix::fcntl::OFlag::O_NOFOLLOW.bits())
            .open(&path)
        {
            Ok(mut file) => {
                file.write_all(&frozen.bytes)
                    .and_then(|()| file.sync_all())
                    .map_err(io)?;
                layout.sync().map_err(io)?;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let file = std::fs::OpenOptions::new()
                    .read(true)
                    .custom_flags(
                        (nix::fcntl::OFlag::O_NOFOLLOW | nix::fcntl::OFlag::O_NONBLOCK).bits(),
                    )
                    .open(&path)
                    .map_err(io)?;
                let metadata = file.metadata().map_err(io)?;
                if !metadata.is_file()
                    || metadata.len() > LIMIT
                    || metadata.permissions().mode() & 0o077 != 0
                    || metadata.uid() != nix::unistd::geteuid().as_raw()
                {
                    return Err(conflict());
                }
                let mut bytes = Vec::new();
                file.take(LIMIT + 1).read_to_end(&mut bytes).map_err(io)?;
                if bytes != frozen.bytes {
                    return Err(conflict());
                }
            }
            Err(error) => return Err(io(error)),
        }
        Ok(path)
    }
    /// Preflight observes the exact source without freezing or archiving it.
    /// Core validates this immutable document before the freeze hash CAS.
    pub fn cutover_source(&self) -> Result<(String, Vec<u8>), Error> {
        let slot = self.slot();
        let bytes = match Database::open_existing(&self.root, &slot.legacy).map_err(refused)? {
            Some(mut database) => database.inspect(&slot, source).map_err(failed)?,
            None => source(None)?,
        };
        Ok((digest(&bytes), bytes))
    }
    pub fn freeze_for_core(
        &self,
        guard: &QuiescentClock,
        source_id: &str,
        expected_digest: &str,
    ) -> Result<FrozenJobs, Error> {
        if !guard.covers(&self.root)
            || !crate::operation::uuid_like(source_id)
            || source_id != source_id.to_ascii_lowercase()
        {
            return Err(conflict());
        }
        let slot = self.slot();
        let mut database = Database::open(&self.root).map_err(refused)?;
        database.update(&slot,|bytes| {
            let bytes=source(bytes)?;
            let source_digest=digest(&bytes);
            if source_digest!=expected_digest { return Err(conflict()); }
            let marker=json!({"version":3,"owner":"core.jobs","phase":"frozen","sourceId":source_id,"sourceDigest":source_digest});
            Ok((Some(serde_json::to_vec(&marker).map_err(io)?),FrozenJobs{source_id:source_id.into(),source_digest,bytes}))
        },|frozen,transaction| {
            // One Ops transaction publishes both the old-reader refusal and
            // the byte-preserving recovery source; neither can survive alone.
            transaction.execute("INSERT INTO documents(kind,key,body) VALUES('cron-cutover-source',?1,?2)",params![frozen.source_id,frozen.bytes]).map_err(io)?;
            Ok(())
        }).map_err(failed)
    }
    /// Read the immutable recovery source. The caller confirms its Core receipt
    /// or resumes the same source import after confirmed absence; never thaw it.
    pub fn frozen_for_core(&self) -> Result<Option<FrozenJobs>, Error> {
        let slot = self.slot();
        let Some(mut database) =
            Database::open_existing(&self.root, &slot.legacy).map_err(refused)?
        else {
            return Ok(None);
        };
        // Keep document-validation failures typed inside the same read snapshot;
        // converting them to InvalidQuery would misreport corruption as store I/O.
        let row = database
            .snapshot(|transaction| {
                let stored: Option<Option<Vec<u8>>> = transaction.query_row(
                    "SELECT CASE WHEN length(body)<=16777216 THEN body END FROM documents WHERE kind='cron' AND key=''",
                    [], |row| row.get(0),
                ).optional()?;
                let Some(stored) = stored else { return Ok(Ok(None)); };
                let Some(bytes) = stored else { return Ok(Err(corrupt("Cron marker exceeds 16 MiB."))); };
                let value = match marker(&bytes) {
                    Ok(Some(value)) => value,
                    Ok(None) => return Ok(Ok(None)),
                    Err(error) => return Ok(Err(error)),
                };
                let id = value["sourceId"].as_str().expect("validated marker").to_owned();
                let hash = value["sourceDigest"].as_str().expect("validated marker").to_owned();
                let retained: Option<Option<Vec<u8>>> = transaction.query_row(
                    "SELECT CASE WHEN length(body)<=16777216 THEN body END FROM documents WHERE kind='cron-cutover-source' AND key=?",
                    [&id], |row| row.get(0),
                ).optional()?;
                let bytes = match retained {
                    Some(Some(bytes)) => bytes,
                    Some(None) => return Ok(Err(corrupt("Frozen cron source exceeds 16 MiB."))),
                    None => return Ok(Err(corrupt("Frozen cron source is missing."))),
                };
                Ok(Ok(Some(FrozenJobs {source_id:id, source_digest:hash, bytes})))
            })
            .map_err(refused)??;
        if let Some(frozen) = &row {
            if frozen.bytes.len() as u64 > LIMIT || digest(&frozen.bytes) != frozen.source_digest {
                return Err(corrupt("Frozen cron source does not match its digest."));
            }
            decode(Some(&frozen.bytes))?;
        }
        Ok(row)
    }
}

#[cfg(test)]
mod tests;
