//! Shared device grants, session cleanup and mounted-extension events.
//! Members commands and signed browser management share this Store owner.
use crate::{
    error::RemoteError,
    mount::Mounts,
    session::DoorSessions,
    store::{Grant, Store},
};
use serde_json::{Value, json};
use std::{
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread::{self, JoinHandle},
    time::Duration,
};

/// Successful snapshots are replayed too, so a replaced extension socket needs
/// no persistent delivery cursor or registration handshake.
const REPLAY: Duration = Duration::from_secs(5);
const RETRY_MAX: Duration = Duration::from_secs(30);

pub struct Devices {
    store: Arc<Mutex<Store>>,
    /// Live sessions to end on revocation; absent when serve is not running.
    sessions: Option<Arc<DoorSessions>>,
    changed: Mutex<bool>,
    ready: Condvar,
}
impl Devices {
    pub fn new(store: Arc<Mutex<Store>>, sessions: Option<Arc<DoorSessions>>) -> Self {
        Self {
            store,
            sessions,
            changed: Mutex::new(false),
            ready: Condvar::new(),
        }
    }
    pub fn list(&self) -> Result<Vec<Grant>, RemoteError> {
        self.store().and_then(|store| store.grants())
    }
    pub(crate) fn committed_removals(&self, clients: &[String]) {
        if let Some(sessions) = &self.sessions {
            for client in clients {
                sessions.end_device(client);
            }
        }
        self.wake();
    }
    /// Effects and receipts are already committed; release Store/live locks first.
    pub(crate) fn committed_change(&self, client_id: &str) {
        if let Some(sessions) = &self.sessions {
            sessions.end_device(client_id);
        }
        self.wake();
    }
    pub(crate) fn wake(&self) {
        if let Ok(mut changed) = self.changed.lock() {
            *changed = true;
            self.ready.notify_one();
        }
    }
    /// One joined worker delivers current grant state outside the store lock
    /// and local command acknowledgment. Failed snapshots back off 1–30 s;
    /// committed mutations wake it immediately. No effects depend on a reply.
    pub fn start_events(
        self: &Arc<Self>,
        mounts: Arc<Mounts>,
    ) -> Result<DeviceEvents, RemoteError> {
        let devices = Arc::clone(self);
        let stop = Arc::new(AtomicBool::new(false));
        let flag = Arc::clone(&stop);
        let worker = thread::Builder::new()
            .name("remote-device-events".into())
            .spawn(move || {
                let mut retry = Duration::from_secs(1);
                while !flag.load(Ordering::Acquire) {
                    let mut acknowledged = true;
                    match devices.list() {
                        Ok(grants) => {
                            for grant in grants {
                                if flag.load(Ordering::Acquire) {
                                    break;
                                }
                                acknowledged &= mounts.device_event(&event_json(&grant));
                            }
                        }
                        Err(_) => acknowledged = false,
                    }
                    let wait = if acknowledged {
                        retry = Duration::from_secs(1);
                        REPLAY
                    } else {
                        let wait = retry;
                        retry = (retry * 2).min(RETRY_MAX);
                        wait
                    };
                    let Ok(changed) = devices.changed.lock() else {
                        break;
                    };
                    let Ok((mut changed, _)) =
                        devices.ready.wait_timeout_while(changed, wait, |changed| {
                            !*changed && !flag.load(Ordering::Acquire)
                        })
                    else {
                        break;
                    };
                    *changed = false;
                }
            })
            .map_err(|e| {
                RemoteError::new("REMOTE_IO", &format!("Could not start device events: {e}."))
            })?;
        Ok(DeviceEvents {
            devices: Arc::clone(self),
            stop,
            worker: Some(worker),
        })
    }
    pub(crate) fn member_activity(
        &self,
        grants: &[Grant],
        now: u64,
    ) -> Result<Option<crate::session::DeviceActivities>, RemoteError> {
        self.sessions
            .as_ref()
            .map(|sessions| sessions.management_activity(grants, now))
            .transpose()
    }
    /// Terminal authority calls wait within their existing admission bound.
    pub(crate) fn terminal_store(
        &self,
        deadline: std::time::Instant,
    ) -> Result<std::sync::MutexGuard<'_, Store>, RemoteError> {
        crate::control::idle_lock(&self.store, deadline)?.ok_or_else(|| RemoteError::new(
            "REMOTE_MEMBER_BUSY", "Member authority is busy; no change started. Read tmt remote members and confirm again."
        ))
    }
    pub(crate) fn store(&self) -> Result<std::sync::MutexGuard<'_, Store>, RemoteError> {
        self.store.lock().map_err(|_| {
            RemoteError::new("REMOTE_STATE_UNAVAILABLE", "Remote state is unavailable.")
        })
    }
}

/// Shutdown wakes the backoff wait and joins the bounded socket attempt before
/// releasing remote state. Dropping during failed startup has the same cleanup.
pub struct DeviceEvents {
    devices: Arc<Devices>,
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}
impl Drop for DeviceEvents {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.devices.wake();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

/// Level-triggered wire state: the latest name or a permanent revoked tombstone.
pub fn event_json(grant: &Grant) -> Value {
    let mut event = json!({
        "type": if grant.disabled { "device.revoked" } else { "device.renamed" },
        "deviceId": grant.client_id,
        "grantRevision": grant.revision,
    });
    if !grant.disabled {
        event["name"] = json!(grant.name);
    }
    event
}
#[cfg(test)]
mod person_tests {
    use super::*;
    fn sending(devices: &Devices, reference: &str, enabled: bool) -> Result<Value, RemoteError> {
        let read = crate::members::terminal::read(
            devices,
            &crate::members::observations::NoMemberObservations,
            &crate::members::terminal::MemberTerminalRead::Resolve {
                reference: reference.into(),
            },
        )?;
        let target = serde_json::from_value(read["target"].clone()).unwrap();
        crate::members::terminal::mutate(
            devices,
            &crate::members::terminal::MemberTerminalMutation::Sending { target, enabled },
        )
    }

    #[test]
    fn one_member_sending_fans_out_to_associated_machines() {
        let root = std::env::temp_dir().join(format!(
            "tmt-member-devices-{}",
            crate::store::uuid_v4().unwrap()
        ));
        let serving = crate::state::Layout::open(&root)
            .unwrap()
            .serve_lock()
            .unwrap();
        let mut store = Store::open(&serving).unwrap();
        let mut grants = Vec::new();
        for n in [1u8, 2] {
            let grant = Grant {
                client_id: crate::store::uuid_v4().unwrap(),
                public_key: ed25519_dalek::SigningKey::from_bytes(&[n; 32])
                    .verifying_key()
                    .to_bytes(),
                kind: "cli".into(),
                origin: "cli".into(),
                name: "Person".into(),
                agents: "all".into(),
                scopes: crate::store::DEFAULT_SCOPES.map(str::to_owned).into(),
                mode: "hold".into(),
                issued_at_ms: 1,
                expires_at_ms: None,
                revision: 1,
                disabled: false,
            };
            store.insert_grant(&grant).unwrap();
            grants.push(grant);
        }
        let member = store
            .member_for_client(&grants[0].client_id)
            .unwrap()
            .unwrap();
        store
            .associate_member(
                crate::members::Owner::LocalOwner,
                &crate::members::Association {
                    operation_id: crate::store::uuid_v4().unwrap(),
                    remote_id: member.remote_id,
                    member_id: member.member_id,
                    member_revision: member.revision,
                    client_id: grants[1].client_id.clone(),
                    grant_revision: 1,
                },
                10,
            )
            .unwrap();
        let store = Arc::new(Mutex::new(store));
        let devices = Devices::new(Arc::clone(&store), None);
        let member_id = devices
            .store()
            .unwrap()
            .member_for_client(&grants[0].client_id)
            .unwrap()
            .unwrap()
            .member_id;
        sending(&devices, &member_id, true).unwrap();
        for grant in &grants {
            let current = store
                .lock()
                .unwrap()
                .grant(&grant.client_id)
                .unwrap()
                .unwrap();
            assert!(current.permits_scope("talk"));
            assert_eq!(current.mode, "hold");
        }
        sending(&devices, &member_id, false).unwrap();
        assert!(
            store
                .lock()
                .unwrap()
                .grants()
                .unwrap()
                .iter()
                .all(|g| !g.permits_scope("talk"))
        );
        drop(devices);
        drop(store);
        drop(serving);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn member_names_refuse_ambiguity_and_machine_effects_require_exact_ids() {
        let root =
            std::env::temp_dir().join(format!("tmt-person-{}", crate::store::uuid_v4().unwrap()));
        let serving = crate::state::Layout::open(&root)
            .unwrap()
            .serve_lock()
            .unwrap();
        let mut store = Store::open(&serving).unwrap();
        let mut grants = Vec::new();
        for (index, name) in ["Alex", "Sam", "Sam"].into_iter().enumerate() {
            let grant = Grant {
                client_id: crate::store::uuid_v4().unwrap(),
                public_key: ed25519_dalek::SigningKey::from_bytes(&[index as u8 + 1; 32])
                    .verifying_key()
                    .to_bytes(),
                kind: "cli".into(),
                origin: "cli".into(),
                name: name.into(),
                agents: "all".into(),
                scopes: crate::store::DEFAULT_SCOPES.map(str::to_owned).into(),
                mode: "hold".into(),
                issued_at_ms: 1,
                expires_at_ms: None,
                revision: 1,
                disabled: false,
            };
            store.insert_grant(&grant).unwrap();
            grants.push(grant);
        }
        let devices = Devices::new(Arc::new(Mutex::new(store)), None);
        sending(&devices, "Alex", true).unwrap();
        let enabled = devices
            .list()
            .unwrap()
            .into_iter()
            .find(|g| g.client_id == grants[0].client_id)
            .unwrap();
        assert!(enabled.permits_scope("talk"));
        assert_eq!(enabled.mode, "hold");
        let before = devices.list().unwrap();
        assert_eq!(
            sending(&devices, "Sam", true).unwrap_err().code,
            "REMOTE_MEMBER_AMBIGUOUS"
        );
        assert_eq!(
            crate::members::terminal_machines::resolve(&devices.store().unwrap(), "Sam")
                .unwrap_err()
                .code,
            "REMOTE_MACHINE_NOT_FOUND"
        );
        assert_eq!(devices.list().unwrap(), before);
        for grant in &grants[..2] {
            let target = crate::members::terminal_machines::resolve(
                &devices.store().unwrap(),
                &grant.client_id,
            )
            .unwrap();
            let removed = crate::members::terminal_machines::mutate(
                &devices,
                &crate::members::terminal_machines::MemberMachineMutation::Remove { target },
                None,
            )
            .unwrap();
            assert_eq!(removed["machine"]["clientId"], grant.client_id);
            assert_eq!(removed["machine"]["revoked"], true);
        }
        let target = crate::members::terminal_machines::resolve(
            &devices.store().unwrap(),
            &grants[0].client_id,
        )
        .unwrap();
        let again = crate::members::terminal_machines::mutate(
            &devices,
            &crate::members::terminal_machines::MemberMachineMutation::Remove { target },
            None,
        )
        .unwrap();
        assert_eq!(again["changed"], false);
        assert_eq!(again["machine"]["revoked"], true);
        // Name ambiguity remains a person property even when a machine is removed.
        assert_eq!(
            sending(&devices, "Sam", true).unwrap_err().code,
            "REMOTE_MEMBER_AMBIGUOUS"
        );
        let member = devices
            .store()
            .unwrap()
            .member_for_client(&grants[2].client_id)
            .unwrap()
            .unwrap();
        sending(&devices, &member.member_id, true).unwrap();
        assert!(
            devices
                .list()
                .unwrap()
                .iter()
                .find(|g| g.client_id == grants[2].client_id)
                .unwrap()
                .permits_scope("talk")
        );
        assert_eq!(
            sending(&devices, "missing", true).unwrap_err().code,
            "REMOTE_MEMBER_NOT_FOUND"
        );
        drop(devices);
        drop(serving);
        std::fs::remove_dir_all(root).unwrap();
    }
}
