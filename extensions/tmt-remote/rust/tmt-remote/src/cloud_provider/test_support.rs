//! Recording transport fake for common caller tests; no Auth, REST or provider parser.
use super::*;
use crate::{error::RemoteError, objects::IoBudget};
use std::sync::{
    Mutex,
    atomic::{AtomicBool, Ordering},
};

pub(crate) struct RecordingProvider {
    pub machine: String,
    pub now: u64,
    pub calls: Mutex<Vec<(String, Stream, String, Vec<u8>)>>,
    pub stored: Mutex<Option<CarrierDocument>>,
    pub lose_ack: AtomicBool,
    pub conflict: AtomicBool,
    pub pages: Mutex<std::collections::VecDeque<CarrierPage>>,
}
impl RecordingProvider {
    pub fn new(machine: &str, now: u64) -> Self {
        Self {
            machine: machine.into(),
            now,
            calls: Mutex::new(vec![]),
            stored: Mutex::new(None),
            lose_ack: AtomicBool::new(false),
            conflict: AtomicBool::new(false),
            pages: Mutex::new(Default::default()),
        }
    }
    fn checked(io: &IoBudget<'_>) -> Result<(), RemoteError> {
        io.check()
            .map_err(|_| RemoteError::new("REMOTE_CLOUD_STOPPED", "Cloud transport stopped."))
    }
}
impl ContinuationCodec for RecordingProvider {
    fn validate_continuation(&self, _: &Continuation) -> Result<(), RemoteError> {
        Ok(())
    }
}
impl Provider for RecordingProvider {
    fn binding(&self) -> ProviderBinding<'_> {
        ProviderBinding {
            backend: "test-provider",
            deployment: "opaque",
            principal: "fixture",
        }
    }
    fn machine(&self) -> &str {
        &self.machine
    }
    fn now(&self) -> crate::firebase_auth::Time {
        crate::firebase_auth::Time {
            wall_ms: self.now,
            monotonic_ms: self.now,
        }
    }
    fn jitter(&self, _max: u64) -> u64 {
        panic!("unexpected provider call")
    }
    fn wait(&self, _io: &IoBudget<'_>, _ms: u64) -> Result<(), RemoteError> {
        panic!("unexpected provider call")
    }
    fn get<'a>(
        &'a self,
        _peer: &'a str,
        _stream: Stream,
        _id: &'a str,
        _io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<CarrierDocument>> {
        panic!("unexpected provider call")
    }
    fn create<'a>(
        &'a self,
        peer: &'a str,
        stream: Stream,
        id: &'a str,
        bytes: &'a [u8],
        claim: Claim<'a>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<CarrierDocument>> {
        Box::pin(async move {
            Self::checked(io)?;
            assert!(
                claim().map_err(|_| RemoteError::new("REMOTE_SCOPE_DENIED", "Claim refused."))?
            );
            self.calls
                .lock()
                .unwrap()
                .push(("create".into(), stream, id.into(), bytes.to_vec()));
            *self.stored.lock().unwrap() = Some(CarrierDocument {
                peer: peer.into(),
                id: id.into(),
                created_ms: self.now,
                bytes: bytes.to_vec(),
                cursor: Cursor(serde_json::json!({"opaque":"test"})),
            });
            if self.lose_ack.swap(false, Ordering::AcqRel) {
                return Err(RemoteError::new(
                    "REMOTE_CLOUD_UNCONFIRMED",
                    "Unconfirmed write.",
                ));
            }
            self.observe(peer, stream, id, io).await
        })
    }
    fn observe<'a>(
        &'a self,
        peer: &'a str,
        stream: Stream,
        id: &'a str,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<CarrierDocument>> {
        Box::pin(async move {
            Self::checked(io)?;
            self.calls
                .lock()
                .unwrap()
                .push(("observe".into(), stream, id.into(), vec![]));
            let stored = self.stored.lock().unwrap();
            Ok(stored.as_ref().map(|d| CarrierDocument {
                peer: peer.into(),
                id: id.into(),
                created_ms: d.created_ms,
                bytes: if self.conflict.load(Ordering::Acquire) {
                    b"conflicting bytes".to_vec()
                } else {
                    d.bytes.clone()
                },
                cursor: d.cursor.clone(),
            }))
        })
    }
    fn inbox<'a>(
        &'a self,
        _: u64,
        _: usize,
        _: Option<&'a Cursor>,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, CarrierPage> {
        Box::pin(async move {
            Self::checked(io)?;
            self.calls
                .lock()
                .unwrap()
                .push(("inbox".into(), Stream::Inbox, String::new(), vec![]));
            Ok(self
                .pages
                .lock()
                .unwrap()
                .pop_front()
                .expect("explicit page fixture"))
        })
    }
    fn delete<'a>(
        &'a self,
        _peer: &'a str,
        _stream: Stream,
        _id: &'a str,
        _io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()> {
        panic!("unexpected provider call")
    }
    fn publish_invite_gate<'a>(
        &'a self,
        _offer: &'a str,
        _hash: &'a [u8; 32],
        _expires_at_ms: u64,
        _io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()> {
        panic!("unexpected provider call")
    }
    fn invite_gate<'a>(
        &'a self,
        _offer: &'a str,
        _io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<InviteGate>> {
        panic!("unexpected provider call")
    }
    fn delete_invite<'a>(&'a self, _offer: &'a str, _io: &'a IoBudget<'a>) -> Pending<'a, ()> {
        panic!("unexpected provider call")
    }
    fn expired_invite<'a>(
        &'a self,
        _now: u64,
        _io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<String>> {
        panic!("unexpected provider call")
    }
    fn enrollment_get<'a>(
        &'a self,
        _id: &'a str,
        _io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<EnrollmentDocument>> {
        panic!("unexpected provider call")
    }
    fn enrollment_create<'a>(
        &'a self,
        _id: &'a str,
        _principal: &'a str,
        _kind: &'a str,
        _body: &'a [u8],
        _proof: Option<EnrollmentProof<'a>>,
        _io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()> {
        panic!("unexpected provider call")
    }
    fn enrollment_delete<'a>(&'a self, _id: &'a str, _io: &'a IoBudget<'a>) -> Pending<'a, ()> {
        panic!("unexpected provider call")
    }
    fn enrollment_next<'a>(
        &'a self,
        _from: u64,
        _after: Option<&'a Cursor>,
        _io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<EnrollmentDocument>> {
        panic!("unexpected provider call")
    }
    fn machine_metadata<'a>(
        &'a self,
        io: &'a IoBudget<'a>,
    ) -> Pending<'a, Option<MachineMetadata>> {
        Box::pin(async move {
            Self::checked(io)?;
            self.calls.lock().unwrap().push((
                "machine_metadata".into(),
                Stream::Inbox,
                self.machine.clone(),
                vec![],
            ));
            Ok(Some(MachineMetadata {
                principal: "fixture".into(),
                authentication_key: vec![0; 31],
                descriptor: Some(b"malformed descriptor".to_vec()),
                inviting_owner: None,
            }))
        })
    }
    fn register_machine<'a>(
        &'a self,
        _key: &'a [u8; 32],
        _descriptor: &'a [u8],
        _inviting_owner: Option<&'a str>,
        _io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()> {
        panic!("unexpected provider call")
    }
    fn publish_routes<'a>(
        &'a self,
        _rows: &'a [Route],
        _invited_machine: Option<&'a str>,
        _io: &'a IoBudget<'a>,
    ) -> Pending<'a, ()> {
        panic!("unexpected provider call")
    }
}
