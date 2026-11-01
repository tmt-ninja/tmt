//! Common Sender and InboxDriver behavior through a non-Firestore recording port.
use super::*;
use crate::{
    cloud_provider::{CarrierPage, Connection, Provider, test_support::RecordingProvider},
    native_sync::complete,
    objects::IoBudget,
    squads::publisher::Publication,
};
use std::{
    sync::atomic::Ordering,
    time::{Duration, Instant},
};

#[test]
fn provider_port_summary_lost_ack_restart_never_replays_and_conflicts_refuse() {
    private_child(
        "squads::store::tests::provider_port_tests::provider_port_summary_lost_ack_restart_never_replays_and_conflicts_refuse",
        |root| {
            let mut world = World::new(root);
            let recipient =
                Layout::open(&world.layout.directory.parent().unwrap().join("recipient")).unwrap();
            let key = crate::state::MachineKey::open(&recipient).unwrap();
            let keys = crate::cloud_keys::CloudKeys::new(recipient, PEER.into(), key);
            keys.maintain(world.now).unwrap();
            let descriptor = keys.advertised(world.now).unwrap();
            let prepared = Prepared::for_peer(
                &Summary::unavailable("Studio", world.now).unwrap(),
                &world.grant.authority().unwrap(),
            )
            .unwrap();
            world
                .store
                .lock()
                .unwrap()
                .summary_observed(&world.grant, &prepared, world.now)
                .unwrap();
            let pending = world
                .store
                .lock()
                .unwrap()
                .summary_pending(&world.grant, &prepared, world.now)
                .unwrap();
            let fake = Arc::new(RecordingProvider::new(PEER, world.now));
            fake.lose_ack.store(true, Ordering::Release);
            let connection = Connection::from(fake.clone() as Arc<dyn Provider>);
            let cancel = AtomicBool::new(false);
            let io = IoBudget {
                deadline: Instant::now() + Duration::from_secs(5),
                cancelled: &cancel,
            };
            let make_sender = |store| {
                crate::cloud_inbox::Sender::new(
                    connection.clone(),
                    store,
                    &world.machine,
                    crate::state::MachineKey::open(&world.layout).unwrap(),
                )
                .unwrap()
            };
            let sender = make_sender(world.store.clone());
            assert_eq!(
                complete(
                    sender.push_summary(&pending, &world.grant, &descriptor, world.now, &io),
                    &io
                )
                .unwrap()
                .unwrap_err()
                .code,
                "REMOTE_CLOUD_UNCONFIRMED"
            );
            let exact = fake.stored.lock().unwrap().as_ref().unwrap().bytes.clone();
            assert!(!String::from_utf8_lossy(&exact).contains("Studio"));
            drop(sender);
            drop(world.store);
            world.store = Arc::new(Mutex::new(Store::open(&world.lease).unwrap()));
            let restored = world
                .store
                .lock()
                .unwrap()
                .summary_pending(&world.grant, &prepared, world.now)
                .unwrap();
            assert_eq!(restored.id, pending.id);
            let sender = make_sender(world.store.clone());
            assert!(matches!(
                complete(
                    sender.push_summary(&restored, &world.grant, &descriptor, world.now, &io),
                    &io
                )
                .unwrap()
                .unwrap(),
                Publication::Stored
            ));
            let calls = fake.calls.lock().unwrap();
            assert_eq!(calls.iter().filter(|c| c.0 == "create").count(), 1);
            assert_eq!(calls[0].2, pending.id);
            assert_eq!(calls[0].3, exact);
            assert_eq!(calls.last().unwrap().0, "observe");
            assert_eq!(calls.last().unwrap().2, pending.id);
            drop(calls);
            fake.conflict.store(true, Ordering::Release);
            assert_eq!(
                complete(
                    sender.push_summary(&restored, &world.grant, &descriptor, world.now, &io),
                    &io
                )
                .unwrap()
                .unwrap_err()
                .code,
                "REMOTE_CLOUD_CONFLICT"
            );
            let count = fake.calls.lock().unwrap().len();
            cancel.store(true, Ordering::Release);
            assert_eq!(
                complete(
                    sender.push_summary(&restored, &world.grant, &descriptor, world.now, &io),
                    &io
                )
                .unwrap()
                .unwrap_err()
                .code,
                "REMOTE_CLOUD_STOPPED"
            );
            assert_eq!(fake.calls.lock().unwrap().len(), count);
        },
    );
}

#[test]
fn provider_port_driver_empty_pages_commit_only_the_common_read_watermark() {
    private_child(
        "squads::store::tests::provider_port_tests::provider_port_driver_empty_pages_commit_only_the_common_read_watermark",
        |root| {
            let world = World::new(root);
            let (receiver, _, sessions) = world.receiver_owner();
            let fake = Arc::new(RecordingProvider::new(&world.machine, world.now));
            fake.pages.lock().unwrap().extend([
                CarrierPage {
                    documents: vec![],
                    read_ms: world.now,
                    full: true,
                },
                CarrierPage {
                    documents: vec![],
                    read_ms: world.now + 1,
                    full: false,
                },
            ]);
            let connection = Connection::from(fake.clone() as Arc<dyn Provider>);
            let driver = crate::cloud_inbox::InboxDriver::new(receiver, sessions, connection);
            let cancel = AtomicBool::new(false);
            let io = IoBudget {
                deadline: Instant::now() + Duration::from_secs(5),
                cancelled: &cancel,
            };
            assert_eq!(
                complete(driver.reconcile(world.now, &io), &io)
                    .unwrap()
                    .unwrap(),
                0
            );
            assert_eq!(
                fake.calls
                    .lock()
                    .unwrap()
                    .iter()
                    .map(|c| c.0.as_str())
                    .collect::<Vec<_>>(),
                vec!["inbox", "inbox"]
            );
            let checkpoint = world
                .store
                .lock()
                .unwrap()
                .cloud_query_checkpoint(fake.as_ref())
                .unwrap()
                .unwrap();
            assert_eq!(checkpoint.completed.created_at_ms(), world.now);
            assert!(checkpoint.continuation.is_none());
        },
    );
}
