//! Firestore interpretation behind the typed provider port.
use super::{Provider, document};
use crate::{cloud_provider::port::*, error::RemoteError, objects::IoBudget};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::Value;

fn invalid() -> RemoteError {
    crate::cloud_pairing::wire::invalid()
}
fn stream(value: Stream) -> &'static str {
    match value {
        Stream::Inbox => "inbox",
        Stream::Responses => "responses",
    }
}
fn enrollment(value: super::EnrollmentDocument) -> EnrollmentDocument {
    EnrollmentDocument {
        id: value.id,
        principal: value.uid,
        kind: value.kind,
        body: value.body,
        created_ms: value.created_ms,
        cursor: Cursor(value.cursor),
        token: value.token,
    }
}
fn metadata(row: Value, machine: &str) -> Result<MachineMetadata, RemoteError> {
    let fields = row["fields"]
        .as_object()
        .filter(|f| {
            (f.len() == 3
                || (f.len() == 4
                    && f.get("invitingOwner").is_some_and(|v| {
                        v["stringValue"]
                            .as_str()
                            .is_some_and(|id| crate::canonical::is_core_id(id) && id != machine)
                    })))
                && f.get("uid").is_some_and(|v| {
                    v["stringValue"]
                        .as_str()
                        .is_some_and(crate::cloud_pairing::uid_ok)
                })
        })
        .ok_or_else(invalid)?;
    let decode = |name: &str| {
        fields
            .get(name)
            .and_then(|v| v["bytesValue"].as_str())
            .and_then(|v| STANDARD.decode(v).ok())
            .ok_or_else(invalid)
    };
    Ok(MachineMetadata {
        principal: fields["uid"]["stringValue"]
            .as_str()
            .ok_or_else(invalid)?
            .into(),
        authentication_key: decode("authenticationKey")?,
        descriptor: fields
            .get("descriptor")
            .and_then(|v| v["bytesValue"].as_str())
            .and_then(|v| STANDARD.decode(v).ok()),
        inviting_owner: fields
            .get("invitingOwner")
            .and_then(|v| v["stringValue"].as_str())
            .map(str::to_owned),
    })
}
impl crate::cloud_provider::Provider for Provider {
    fn binding(&self) -> ProviderBinding<'_> {
        ProviderBinding {
            backend: "firestore",
            deployment: &self.identity().project,
            principal: self.uid(),
        }
    }
    fn machine(&self) -> &str {
        Provider::machine(self)
    }
    fn now(&self) -> crate::firebase_auth::Time {
        Provider::now(self)
    }
    fn jitter(&self, max: u64) -> u64 {
        Provider::jitter(self, max)
    }
    fn wait(&self, io: &IoBudget<'_>, ms: u64) -> Result<(), RemoteError> {
        Provider::wait(self, io, ms)
    }
    fn get<'a>(
        &'a self,
        peer: &'a str,
        which: Stream,
        id: &'a str,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<CarrierDocument>> {
        Box::pin(async move { Provider::get(self, peer, stream(which), id, io).await })
    }
    fn create<'a>(
        &'a self,
        peer: &'a str,
        which: Stream,
        id: &'a str,
        bytes: &'a [u8],
        claim: Claim<'a>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<CarrierDocument>> {
        Box::pin(
            async move { Provider::create(self, peer, stream(which), id, bytes, claim, io).await },
        )
    }
    fn observe<'a>(
        &'a self,
        peer: &'a str,
        which: Stream,
        id: &'a str,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<CarrierDocument>> {
        Box::pin(async move { Provider::observe(self, peer, stream(which), id, io).await })
    }
    fn inbox<'a>(
        &'a self,
        from_ms: u64,
        limit: usize,
        after: Option<&'a Cursor>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, CarrierPage> {
        Box::pin(async move {
            let page = Provider::inbox(self, from_ms, limit, after, io).await?;
            Ok(CarrierPage {
                documents: page.documents,
                read_ms: page.read_ms,
                full: page.full,
            })
        })
    }
    fn delete<'a>(
        &'a self,
        peer: &'a str,
        which: Stream,
        id: &'a str,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()> {
        Box::pin(async move { Provider::delete(self, peer, stream(which), id, io).await })
    }
    fn publish_invite_gate<'a>(
        &'a self,
        offer: &'a str,
        hash: &'a [u8; 32],
        expires_at_ms: u64,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()> {
        Box::pin(async move {
            Provider::publish_invite_gate(self, offer, hash, expires_at_ms, io).await
        })
    }
    fn invite_gate<'a>(
        &'a self,
        offer: &'a str,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<InviteGate>> {
        Box::pin(async move {
            Provider::invite_gate(self, offer, io).await.map(|v| {
                v.map(|v| InviteGate {
                    token_hash: v.token_hash,
                    expires_at_ms: v.expires_at_ms,
                })
            })
        })
    }
    fn delete_invite<'a>(&'a self, offer: &'a str, io: &'a IoBudget<'a>) -> Pending<'a, ()> {
        Box::pin(async move { Provider::delete_invite(self, offer, io).await })
    }
    fn expired_invite<'a>(&'a self, now: u64, io: &'a IoBudget<'a>) -> Pending<'a, Option<String>> {
        Box::pin(async move { Provider::expired_invite(self, now, io).await })
    }
    fn enrollment_get<'a>(
        &'a self,
        id: &'a str,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<EnrollmentDocument>> {
        Box::pin(async move {
            Provider::enrollment_get(self, id, io)
                .await
                .map(|v| v.map(enrollment))
        })
    }
    fn enrollment_create<'a>(
        &'a self,
        id: &'a str,
        principal: &'a str,
        kind: &'a str,
        body: &'a [u8],
        proof: Option<EnrollmentProof<'a>>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()> {
        Box::pin(async move {
            let proof = proof.map(|v| match v {
                EnrollmentProof::Invite(v) => super::EnrollmentProof::Invite(v),
                EnrollmentProof::Reroute { peer, token } => {
                    super::EnrollmentProof::Reroute { peer, token }
                }
            });
            Provider::enrollment_create(self, id, principal, kind, body, proof, io).await
        })
    }
    fn enrollment_delete<'a>(&'a self, id: &'a str, io: &'a IoBudget<'a>) -> Pending<'a, ()> {
        Box::pin(async move { Provider::enrollment_delete(self, id, io).await })
    }
    fn enrollment_next<'a>(
        &'a self,
        from: u64,
        after: Option<&'a Cursor>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<EnrollmentDocument>> {
        Box::pin(async move {
            Provider::enrollment_next(self, from, after.map(|v| &v.0), io)
                .await
                .map(|v| v.map(enrollment))
        })
    }
    fn machine_metadata<'a>(
        &'a self,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<MachineMetadata>> {
        Box::pin(async move {
            Provider::machine_metadata(self, io)
                .await?
                .map(|v| metadata(v, self.machine()))
                .transpose()
        })
    }
    fn register_machine<'a>(
        &'a self,
        key: &'a [u8; 32],
        descriptor: &'a [u8],
        inviting_owner: Option<&'a str>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()> {
        Box::pin(async move {
            Provider::register_machine(self, key, descriptor, inviting_owner, io).await
        })
    }
    fn publish_routes<'a>(
        &'a self,
        rows: &'a [Route],
        invited_machine: Option<&'a str>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()> {
        Box::pin(async move {
            let rows = rows
                .iter()
                .map(|r| crate::cloud_pairing::RouteChange {
                    project: r.deployment.clone(),
                    uid: r.principal.clone(),
                    peer: r.peer.clone(),
                    generation: r.generation,
                    revoked: r.revoked,
                    reroute_hash: r.reroute_hash,
                    member: None,
                })
                .collect::<Vec<_>>();
            Provider::publish_routes(self, &rows, invited_machine, io).await
        })
    }
}

impl From<Provider> for Connection {
    fn from(provider: Provider) -> Self {
        Self::from(
            std::sync::Arc::new(provider) as std::sync::Arc<dyn crate::cloud_provider::Provider>
        )
    }
}

impl crate::cloud_provider::ContinuationCodec for Provider {
    fn validate_continuation(&self, progress: &Continuation) -> Result<(), RemoteError> {
        crate::cloud_provider::ContinuationCodec::validate_continuation(
            &document::ContinuationCodec,
            progress,
        )
    }
}
