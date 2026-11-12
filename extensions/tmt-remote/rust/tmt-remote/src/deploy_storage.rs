//! Paid Storage inputs and captured evidence. Pure data/validation, never a provider or journal.
use serde::{Deserialize, Serialize};

pub const DISCLOSURE_VERSION: u8 = 1;
/// Published only for the explicitly selected bucket's release; grants no object access.
pub const DENY_ALL_POLICY: &str = "rules_version = '2';\nservice firebase.storage {\n  match /b/{bucket}/o {\n    match /{allPaths=**} { allow read, write: if false; }\n  }\n}\n";
pub const PAID_PROMPT: &str =
    "Allow this paid Blaze Storage operation for the displayed bucket and location? [y/N]";
pub const DISCLOSURE: &str = "Blaze, pay as you go, applies to the whole project. Link an active billing account yourself in the provider console; TMT never changes billing. Bucket location is permanent and independent of the Firestore region. Storage, operations, downloads/network and retention/soft-delete can incur charges. No-cost eligibility is conditional, not a zero-cost guarantee. The v1 deny-all policy blocks all current object access on this bucket. Object-access Rules require a future separately designed adapter. Budget alerts do not cap Storage spending. Pricing: https://cloud.google.com/storage/pricing";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageIntent {
    pub bucket: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
}
impl StorageIntent {
    pub fn valid(&self) -> bool {
        (self.bucket == "default" || bucket_ok(&self.bucket))
            && self.location.as_deref().is_none_or(location_ok)
            && (self.bucket != "default" || self.location.is_some())
    }
}
pub fn bucket_ok(value: &str) -> bool {
    (3..=222).contains(&value.len())
        && value
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .as_bytes()
            .last()
            .is_some_and(u8::is_ascii_alphanumeric)
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"-_.".contains(&b))
        && !value.contains("..")
        && !value.contains("google")
        && !value.split('.').all(|part| part.parse::<u8>().is_ok())
}
pub fn location_ok(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoragePlan {
    pub disclosure_version: u8,
    pub intent: StorageIntent,
    pub bucket: String,
    pub location: String,
    /// Only a fingerprint crosses the credential helper; never the billing account name.
    pub billing_fingerprint: String,
    /// Frozen metadata/policy evidence; not a claim of object authority.
    pub metadata_digest: String,
    pub bucket_metadata: serde_json::Value,
    pub bucket_was_present: bool,
    pub policy: String,
    pub policy_digest: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub replaced_policy_digest: Option<String>,
}
impl StoragePlan {
    pub fn valid(&self) -> bool {
        let mut metadata = self.bucket_metadata.clone();
        metadata.sort_all_objects();
        serde_json::to_vec(&metadata)
            .expect("metadata serializes")
            .len()
            <= crate::limits::DEPLOY_STORAGE_METADATA_BYTES
            && self.metadata_digest
                == crate::deploy_plan::sha256_hex(
                    &serde_json::to_vec(&metadata).expect("metadata serializes"),
                )
            && self.disclosure_version == DISCLOSURE_VERSION
            && self.intent.valid()
            && self.policy == DENY_ALL_POLICY
            && self.policy_digest == crate::deploy_plan::sha256_hex(self.policy.as_bytes())
            && bucket_ok(&self.bucket)
            && (self.intent.bucket == "default" || self.intent.bucket == self.bucket)
            && location_ok(&self.location)
            && self
                .intent
                .location
                .as_ref()
                .is_none_or(|l| l == &self.location)
            && [
                self.billing_fingerprint.as_str(),
                self.metadata_digest.as_str(),
                self.policy_digest.as_str(),
            ]
            .into_iter()
            .chain(self.replaced_policy_digest.as_deref())
            .all(digest)
    }
}
fn digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StorageCapability {
    pub version: u8,
    pub bucket: String,
    pub location: String,
}
impl StorageCapability {
    pub fn valid(&self) -> bool {
        self.version == 1 && bucket_ok(&self.bucket) && location_ok(&self.location)
    }
}

/// The existing deploy record retains the exact Storage operation, never a second journal.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StorageCheckpoint {
    pub plan: StoragePlan,
    pub ruleset: Option<String>,
    pub metadata_digest: Option<String>,
    #[serde(default)]
    pub verified: bool,
    #[serde(default)]
    pub bucket_attempted: bool,
}
impl StorageCheckpoint {
    pub fn new(plan: StoragePlan) -> Self {
        Self {
            plan,
            ruleset: None,
            metadata_digest: None,
            verified: false,
            bucket_attempted: false,
        }
    }
    pub fn valid(&self, project: &str) -> bool {
        self.plan.valid()
            && self.metadata_digest.as_deref().is_none_or(digest)
            && self.ruleset.as_deref().is_none_or(|name| {
                name.strip_prefix(&format!("projects/{project}/rulesets/"))
                    .is_some_and(|id| {
                        !id.is_empty()
                            && id.len() <= 256
                            && !id.contains('/')
                            && id
                                .bytes()
                                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
                    })
            })
            && (!self.verified || (self.ruleset.is_some() && self.metadata_digest.is_some()))
    }
    pub fn capability(&self) -> Option<StorageCapability> {
        self.verified.then(|| StorageCapability {
            version: 1,
            bucket: self.plan.bucket.clone(),
            location: self.plan.location.clone(),
        })
    }
}
