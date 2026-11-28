//! One bounded request to the existing owned serve socket. Never retries or falls back.
//! A published batch is one `LocalWrite` and one retained original-operation outcome.
use super::{Fault, FrozenPublication, PublicationRecord, Published};
use crate::{
    Result,
    keyring::{Keyring, Layout},
    limits,
    publication::{LocalWrite, Outcome, WriteAction},
};
use serde::{Deserialize, Serialize};
use tmt_colab_model::values;
pub const PATH: &str = "/.tmt/colab/local/page-publish";
/// Version three identifies the bounded semantic intent on the version-two publish route.
pub(crate) const RECOVERY_VERSION: u32 = 3;
const RECOVERY_BYTES: usize = crate::publication::LOCAL_WRITE_BYTES;
const RECOVERY_REPLY: std::time::Duration =
    limits::PUBLISH_REPLY.saturating_add(crate::decoder::DEADLINE.saturating_mul(8));

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecoveryWrite {
    version: u32,
    intent: super::compact::RecoveryIntent,
    signature: String,
}

fn recovery_signature_input(intent: &super::compact::RecoveryIntent) -> Result<Vec<u8>> {
    Ok(tmt_colab_model::framing::frame(&[
        b"tmt-colab-local-recovery-intent-v3",
        &intent.canonical()?,
    ])?)
}

pub(crate) fn recovery_version(body: &[u8]) -> bool {
    #[derive(Deserialize)]
    struct Version {
        version: u32,
    }
    serde_json::from_slice::<Version>(body).is_ok_and(|header| header.version == RECOVERY_VERSION)
}

impl RecoveryWrite {
    pub(crate) fn parse(
        body: &[u8],
        local_author: &[u8; 32],
    ) -> Result<super::compact::RecoveryIntent> {
        if body.len() > RECOVERY_BYTES {
            return Err(Fault::Capacity.into());
        }
        let write: Self = serde_json::from_slice(body).map_err(|_| Fault::Invalid)?;
        if write.version != RECOVERY_VERSION {
            return Err(Fault::ServerMismatch.into());
        }
        let signature = values::binary(&write.signature, 64).map_err(|_| Fault::Denied)?;
        let input = recovery_signature_input(&write.intent)?;
        tmt_colab_model::crypto::verify_signature(local_author, &input, &signature)
            .map_err(|_| Fault::Denied)?;
        Ok(write.intent)
    }
}

/// Send once. A missing or unrecognized reply can be resolved only through local status.
pub fn recover_edit(
    layout: &Layout,
    key: &Keyring,
    intent: &super::compact::RecoveryIntent,
) -> Result<Option<super::compact::RecoveredEdit>> {
    let signature =
        values::encode_binary(&key.sign_recovery_intent(&recovery_signature_input(intent)?)?);
    let body = serde_json::to_vec(
        &serde_json::json!({"version":RECOVERY_VERSION,"intent":intent,"signature":signature}),
    )?;
    if body.len() > RECOVERY_BYTES {
        return Err(Fault::Capacity.into());
    }
    let socket = match crate::ipc::send(layout, PATH, &body) {
        Ok(socket) => socket,
        Err(error) => {
            return Err(match error.downcast_ref::<crate::ipc::EarlyReply>() {
                Some(early) => {
                    refusal(early.code, &early.body).unwrap_or(Fault::Unavailable.into())
                }
                None => Fault::Unavailable.into(),
            });
        }
    };
    let Ok(reply) = crate::ipc::receive_up_to(
        socket,
        RECOVERY_REPLY,
        super::compact::RECOVERY_OUTCOME_BYTES,
    ) else {
        return Ok(None);
    };
    if reply.code != 200 {
        return match refusal(reply.code, &reply.body) {
            Some(error) => Err(error),
            None => Ok(None),
        };
    }
    Ok(serde_json::from_slice(&reply.body).ok())
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WriteError {
    error: Detail,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Detail {
    code: String,
    message: String,
    #[serde(default, skip_serializing_if = "Option::is_none", rename = "usage")]
    usage: Option<crate::attachments::UsageDetails>,
}
impl WriteError {
    pub fn usage(&self) -> Option<&crate::attachments::UsageDetails> {
        self.error.usage.as_ref()
    }
    pub fn code(&self) -> &'static str {
        self.known_code()
            .unwrap_or_else(|| Fault::Unavailable.code())
    }
    fn known_code(&self) -> Option<&'static str> {
        [
            Fault::StaleBase,
            Fault::Invalid,
            Fault::Capacity,
            Fault::Missing,
            Fault::Inactive,
            Fault::Denied,
            Fault::Unavailable,
            Fault::ServerMismatch,
        ]
        .into_iter()
        .map(|fault| fault.code())
        .find(|code| *code == self.error.code)
    }
    pub(crate) fn status(&self) -> u16 {
        match self.code() {
            "COLAB_DENIED" => 403,
            "COLAB_STALE_BASE"
            | "COLAB_PAGE_INACTIVE"
            | "COLAB_STATE_MISSING"
            | "COLAB_SERVER_MISMATCH" => 409,
            "COLAB_CAPACITY" => 413,
            "COLAB_INPUT_INVALID" => 400,
            _ => 503,
        }
    }
    pub(crate) fn from_error(error: &(dyn std::error::Error + 'static)) -> Self {
        Self {
            error: Detail {
                code: if error.is::<crate::attachments::CapacityRefusal>() {
                    Fault::Capacity.code().into()
                } else {
                    error
                        .downcast_ref::<Fault>()
                        .unwrap_or(&Fault::Unavailable)
                        .code()
                        .into()
                },
                message: error.to_string(),
                usage: error
                    .downcast_ref::<crate::attachments::CapacityRefusal>()
                    .map(|value| value.0.clone()),
            },
        }
    }
}
impl std::fmt::Display for WriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.error.message)
    }
}
impl std::error::Error for WriteError {}
/// The 200 body of a publish: the exact retained outcome bytes, plus the page revision read by
/// the serve under the lock that excludes every other writer.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Reply {
    outcome: Box<serde_json::value::RawValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    revision: Option<String>,
}
pub(crate) fn reply_json(published: &Published) -> Result<Vec<u8>> {
    let outcome = std::str::from_utf8(&published.record.bytes)?.to_owned();
    Ok(serde_json::to_vec(&Reply {
        outcome: serde_json::value::RawValue::from_string(outcome)?,
        revision: published.revision.clone(),
    })?)
}
/// A definite refusal in a non-200 answer to the publish request, or `None` when the answer
/// leaves the outcome in doubt. A typed refusal carries its own code. An untyped 404 (the route
/// does not exist) or 413 (the body is over its cap) is the server's router or header check
/// answering before it reads the job, so the server is another build and nothing was published.
/// Every other untyped answer, and a typed one with a code this build does not know, may come
/// from any stage and stays in doubt.
fn refusal(code: u16, response: &[u8]) -> Option<Box<dyn std::error::Error + Send + Sync>> {
    match serde_json::from_slice::<WriteError>(response) {
        Ok(failure) if failure.known_code().is_some() => Some(failure.into()),
        Ok(_) => None,
        Err(_) if matches!(code, 404 | 413) => Some(Fault::ServerMismatch.into()),
        Err(_) => None,
    }
}
/// The exact request body that publishes one frozen publication through the serve's writer,
/// whether it is posted to the socket or handed to the serve's own writer in process.
pub(crate) fn local_write_body(key: &Keyring, frozen: &FrozenPublication) -> Result<Vec<u8>> {
    Ok(LocalWrite {
        version: crate::publication::LOCAL_WRITE_VERSION,
        action: WriteAction::Write,
        signed_job: frozen.job().clone(),
        packet: values::encode_binary(frozen.packet()),
        chain: values::encode_binary(frozen.chain()),
    }
    .to_json(&key.local_writer()?.1)?)
}
/// Posts one frozen publication. `Ok(Some)` is the answered publish (committed or rejected);
/// `Err` is a refusal the server reported before any effect. `Ok(None)` is doubt after the
/// request may have been sent: the caller resolves it by original-operation status, never by a
/// resend or an offline writer.
pub fn publish(
    layout: &Layout,
    key: &Keyring,
    frozen: &FrozenPublication,
) -> Result<Option<Published>> {
    let original = frozen.job().key()?;
    let body = local_write_body(key, frozen)?;
    // Nothing was sent: the server acts only on a complete body, so this is a plain refusal.
    // Either that, or the server refused the request before reading it all.
    let socket = match crate::ipc::send(layout, PATH, &body) {
        Ok(socket) => socket,
        Err(error) => {
            return Err(match error.downcast_ref::<crate::ipc::EarlyReply>() {
                Some(early) => {
                    refusal(early.code, &early.body).unwrap_or(Fault::Unavailable.into())
                }
                None => Fault::Unavailable.into(),
            });
        }
    };
    let Ok((code, response)) = crate::ipc::receive(socket, limits::PUBLISH_REPLY) else {
        return Ok(None);
    };
    if code != 200 {
        return match refusal(code, &response) {
            Some(error) => Err(error),
            None => Ok(None),
        };
    }
    let Ok(reply) = serde_json::from_slice::<Reply>(&response) else {
        return Ok(None);
    };
    let bytes = reply.outcome.get().as_bytes().to_vec();
    let valid_revision = reply
        .revision
        .as_deref()
        .is_none_or(crate::publication::valid_revision);
    Ok(Outcome::from_json(&bytes, &original, Some(frozen.job()))
        .ok()
        .filter(|outcome| !matches!(outcome, Outcome::Unknown { .. }) && valid_revision)
        .map(|outcome| Published {
            record: PublicationRecord { outcome, bytes },
            revision: reply.revision,
        }))
}
