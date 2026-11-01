//! Typed cloud transport boundary. Provider metadata is never operation authority.
use crate::{error::RemoteError, firebase_auth::Time, objects::IoBudget, sealed_sync::SyncError};
use std::{future::Future, pin::Pin, sync::Arc};

pub type Pending<'a, T> = Pin<Box<dyn Future<Output = Result<T, RemoteError>> + Send + 'a>>;
pub type Claim<'a> = Box<dyn FnOnce() -> Result<bool, SyncError> + Send + 'a>;

/// A provider's bounded continuation, retained without interpreting its fields.
#[derive(Clone, serde::Serialize)]
#[serde(transparent)]
pub struct Cursor(pub(super) serde_json::Value);

impl<'de> serde::Deserialize<'de> for Cursor {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct Object;
        impl<'de> serde::de::Visitor<'de> for Object {
            type Value = Cursor;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("an opaque continuation object without duplicate fields")
            }
            fn visit_map<M: serde::de::MapAccess<'de>>(
                self,
                mut map: M,
            ) -> Result<Cursor, M::Error> {
                let mut value = serde_json::Map::new();
                while let Some((key, item)) = map.next_entry::<String, serde_json::Value>()? {
                    if value.insert(key, item).is_some() {
                        return Err(serde::de::Error::custom("duplicate continuation field"));
                    }
                }
                Ok(Cursor(serde_json::Value::Object(value)))
            }
        }
        deserializer.deserialize_map(Object)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stream {
    Inbox,
    Responses,
}

pub struct CarrierDocument {
    pub peer: String,
    pub id: String,
    pub created_ms: u64,
    pub bytes: Vec<u8>,
    pub cursor: Cursor,
}
pub struct CarrierPage {
    pub documents: Vec<CarrierDocument>,
    pub read_ms: u64,
    pub full: bool,
}

/// Durable query progress. Serialization keeps the existing stored field order.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Continuation {
    pub from_ms: u64,
    pub read_ms: u64,
    pub cursor: Cursor,
}

/// Rules capability only; possession and generation checks remain in pairing.
pub enum EnrollmentProof<'a> {
    Invite(&'a [u8; 32]),
    Reroute { peer: &'a str, token: &'a [u8; 32] },
}
pub struct EnrollmentDocument {
    pub id: String,
    pub principal: String,
    pub kind: String,
    pub body: Vec<u8>,
    pub created_ms: u64,
    pub cursor: Cursor,
    pub token: Option<[u8; 32]>,
}
pub struct InviteGate {
    pub token_hash: [u8; 32],
    pub expires_at_ms: u64,
}
pub struct MachineMetadata {
    pub principal: String,
    pub authentication_key: Vec<u8>,
    pub descriptor: Option<Vec<u8>>,
    pub inviting_owner: Option<String>,
}
pub struct Route {
    pub deployment: String,
    pub principal: String,
    pub peer: String,
    pub revoked: bool,
    pub generation: u64,
    pub reroute_hash: Option<[u8; 32]>,
}

/// One admitted connection, sharing its serving owner's Auth, budget and stop fence.
/// No REST root, arbitrary query or credential owner is exposed to callers.
pub trait Provider: ContinuationCodec + Send + Sync {
    fn binding(&self) -> ProviderBinding<'_>;
    fn machine(&self) -> &str;
    fn now(&self) -> Time;
    fn jitter(&self, max: u64) -> u64;
    fn wait(&self, io: &IoBudget<'_>, ms: u64) -> Result<(), RemoteError>;
    fn get<'a>(
        &'a self,
        peer: &'a str,
        stream: Stream,
        id: &'a str,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<CarrierDocument>>;
    fn create<'a>(
        &'a self,
        peer: &'a str,
        stream: Stream,
        id: &'a str,
        bytes: &'a [u8],
        claim: Claim<'a>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<CarrierDocument>>;
    fn observe<'a>(
        &'a self,
        peer: &'a str,
        stream: Stream,
        id: &'a str,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<CarrierDocument>>;
    fn inbox<'a>(
        &'a self,
        from_ms: u64,
        limit: usize,
        after: Option<&'a Cursor>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, CarrierPage>;
    fn delete<'a>(
        &'a self,
        peer: &'a str,
        stream: Stream,
        id: &'a str,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()>;
    fn publish_invite_gate<'a>(
        &'a self,
        offer: &'a str,
        hash: &'a [u8; 32],
        expires_at_ms: u64,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()>;
    fn invite_gate<'a>(
        &'a self,
        offer: &'a str,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<InviteGate>>;
    fn delete_invite<'a>(&'a self, offer: &'a str, io: &'a IoBudget<'a>) -> Pending<'a, ()>;
    fn expired_invite<'a>(&'a self, now: u64, io: &'a IoBudget<'a>) -> Pending<'a, Option<String>>;
    fn enrollment_get<'a>(
        &'a self,
        id: &'a str,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<EnrollmentDocument>>;
    fn enrollment_create<'a>(
        &'a self,
        id: &'a str,
        principal: &'a str,
        kind: &'a str,
        body: &'a [u8],
        proof: Option<EnrollmentProof<'a>>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()>;
    fn enrollment_delete<'a>(&'a self, id: &'a str, io: &'a IoBudget<'a>) -> Pending<'a, ()>;
    fn enrollment_next<'a>(
        &'a self,
        from: u64,
        after: Option<&'a Cursor>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<EnrollmentDocument>>;
    fn machine_metadata<'a>(&'a self, io: &'a IoBudget<'a>)
    -> Pending<'a, Option<MachineMetadata>>;
    fn register_machine<'a>(
        &'a self,
        key: &'a [u8; 32],
        descriptor: &'a [u8],
        inviting_owner: Option<&'a str>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()>;
    fn publish_routes<'a>(
        &'a self,
        rows: &'a [Route],
        invited_machine: Option<&'a str>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()>;
}

#[derive(Clone, Copy)]
pub enum Purpose {
    ExistingConnection,
    /// The existing caller has already admitted the explicit pairing action.
    ExplicitPairing,
}
pub trait Factory: Send + Sync {
    fn open(
        &self,
        config: &serde_json::Value,
        machine: &str,
        purpose: Purpose,
    ) -> Result<Arc<dyn Provider>, RemoteError>;
}

/// Borrowed public binding metadata; these opaque values are not credentials.
pub struct ProviderBinding<'a> {
    pub backend: &'a str,
    pub deployment: &'a str,
    pub principal: &'a str,
}

/// Shared handle whose lifecycle is still owned by the serving project.
#[derive(Clone)]
pub struct Connection(Arc<dyn Provider>);
impl From<Arc<dyn Provider>> for Connection {
    fn from(provider: Arc<dyn Provider>) -> Self {
        Self(provider)
    }
}
impl std::ops::Deref for Connection {
    type Target = dyn Provider;
    fn deref(&self) -> &Self::Target {
        self.0.as_ref()
    }
}
pub trait ContinuationCodec: Send + Sync {
    /// Validate provider-specific opaque data before any token acquisition or HTTP.
    fn validate_continuation(&self, progress: &Continuation) -> Result<(), RemoteError>;
}
