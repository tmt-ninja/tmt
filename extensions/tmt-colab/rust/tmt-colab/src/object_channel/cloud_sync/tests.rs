//! The worker against a scripted Remote on the real bus: activation, binding, publication of
//! the active page and the bounds on retrying.
use super::{
    Activation, ActivationFailure, ActivePage, Bound, Channels, CloudSync, Inbound, MakeInbound,
    PageRef, Parts, Refusal,
    fixture::{BINDING, DIGEST, OneUpdate, SPACE, ScriptedRemote, activated, friendly, peer},
    publisher::{Fault, Local},
};
use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use tmt_extension_objects::sync::{self, Method};

const FIRST: &str = "10000000-0000-4000-8000-000000000001";
const SECOND: &str = "10000000-0000-4000-8000-000000000002";

fn until(what: &str, mut ready: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !ready() {
        assert!(Instant::now() < deadline, "timed out: {what}");
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn page(page: &str, epoch: u64) -> PageRef {
    PageRef {
        space: SPACE.into(),
        page: page.into(),
        epoch,
    }
}
struct Rig {
    sync: Option<CloudSync>,
    activity: ActivePage,
    reports: Arc<Mutex<Vec<String>>>,
    activations: Arc<AtomicUsize>,
}
fn start(
    channels: Arc<super::fixture::FixedChannel>,
    activate: impl Fn() -> Result<Activation, ActivationFailure> + Send + Sync + 'static,
) -> Rig {
    start_following(channels, activate, None)
}
fn start_following(
    channels: Arc<super::fixture::FixedChannel>,
    activate: impl Fn() -> Result<Activation, ActivationFailure> + Send + Sync + 'static,
    inbound: Option<MakeInbound>,
) -> Rig {
    start_with(
        channels,
        activate,
        inbound,
        Arc::new(move |_| Some(Box::new(OneUpdate { next: 1 }))),
    )
}
fn start_with(
    channels: Arc<super::fixture::FixedChannel>,
    activate: impl Fn() -> Result<Activation, ActivationFailure> + Send + Sync + 'static,
    inbound: Option<MakeInbound>,
    local: Arc<dyn Fn(Bound) -> Option<Box<dyn Local + Send>> + Send + Sync>,
) -> Rig {
    let activity = ActivePage::default();
    let reports = Arc::new(Mutex::new(Vec::new()));
    let activations = Arc::new(AtomicUsize::new(0));
    let (sink, count) = (Arc::clone(&reports), Arc::clone(&activations));
    let sync = CloudSync::start(Parts {
        channels,
        activity: activity.clone(),
        activate: Arc::new(move |_| {
            count.fetch_add(1, Ordering::SeqCst);
            activate()
        }),
        report: Arc::new(move |line| sink.lock().unwrap().push(line.to_owned())),
        declaration_digest: DIGEST.into(),
        space: SPACE.into(),
        local,
        inbound,
    })
    .unwrap();
    Rig {
        sync: Some(sync),
        activity,
        reports,
        activations,
    }
}

#[test]
fn the_worker_binds_then_publishes_the_active_page_once_per_touch() {
    let mut peer = peer();
    let firestore = super::fixture::Firestore::default();
    let answer = firestore.clone();
    let remote = ScriptedRemote::serve(peer.remote.take().unwrap(), move |call, id| {
        answer.answer(call, id)
    });
    let mut rig = start(Arc::clone(&peer.channels), activated);
    until("bind", || remote.methods().first() == Some(&Method::Bind));
    // Nothing is published before a page is touched.
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(remote.methods(), [Method::Bind]);
    rig.activity.touch(page(FIRST, 1));
    until("first pass", || {
        remote.methods() == [Method::Bind, Method::Publish]
    });
    // The page is current: waking without a new touch sends nothing more.
    std::thread::sleep(Duration::from_millis(150));
    assert_eq!(remote.methods().len(), 2);
    rig.sync.take().unwrap().stop();
    let calls = remote.calls.lock().unwrap();
    let sync::Call::Bind {
        project,
        extension,
        declaration_digest,
        space,
    } = &calls[0]
    else {
        panic!("bind first")
    };
    assert_eq!(
        (
            project.as_str(),
            extension.as_str(),
            declaration_digest.as_str(),
            space.as_str()
        ),
        ("fixture", "colab", DIGEST, SPACE)
    );
    let sync::Call::Publish { binding, .. } = &calls[1] else {
        panic!("publish second")
    };
    assert_eq!(binding, BINDING);
    assert!(rig.reports.lock().unwrap().is_empty());
    assert!(
        peer.channel.active(),
        "stopping the worker keeps the channel"
    );
}

#[test]
fn a_page_row_refused_by_rules_is_reported_once_and_stops_that_pages_pass() {
    let mut peer = peer();
    let remote = ScriptedRemote::serve(peer.remote.take().unwrap(), |call, id| match call {
        sync::Call::Publish { .. } => sync::Outcome::Error {
            error: sync::Error {
                code: sync::Code::Denied,
                state: None,
                reset_at_ms: None,
                retry_after_ms: None,
            },
        },
        other => friendly(other, id),
    });
    let rig = start(Arc::clone(&peer.channels), activated);
    until("bind", || remote.methods().first() == Some(&Method::Bind));
    rig.activity.touch(page(FIRST, 1));
    until("one report", || rig.reports.lock().unwrap().len() == 1);
    assert_eq!(
        rig.reports.lock().unwrap()[0],
        format!(
            "Cloud sync stopped for page {FIRST}. The cloud refused sync for this page. Edits continue on this machine."
        )
    );
    let publishes = || {
        remote
            .methods()
            .iter()
            .filter(|m| **m == Method::Publish)
            .count()
    };
    // Every later touch of the same page and epoch neither retries it nor shows the line again.
    for _ in 0..3 {
        rig.activity.touch(page(FIRST, 1));
        std::thread::sleep(Duration::from_millis(150));
    }
    assert_eq!(publishes(), 1, "a stopped page is not retried");
    assert_eq!(rig.reports.lock().unwrap().len(), 1);
    // Another epoch of the page is another entry, and another page is unaffected.
    rig.activity.touch(page(FIRST, 2));
    until("the next epoch is tried", || publishes() == 2);
    rig.activity.touch(page(SECOND, 1));
    until("another page is tried", || publishes() == 3);
}

#[test]
fn a_native_unavailable_verdict_is_silent_and_holds_until_remote_restarts() {
    let peer = peer();
    let rig = start(Arc::clone(&peer.channels), || {
        Err(ActivationFailure::Remote(Refusal {
            code: "REMOTE_STATE_UNAVAILABLE".into(),
            state: None,
        }))
    });
    until("the first attempt", || {
        rig.activations.load(Ordering::SeqCst) == 1
    });
    // Nudges and ticks are not triggers: the verdict holds and nothing is shown.
    rig.activity.nudge();
    std::thread::sleep(Duration::from_millis(400));
    assert_eq!(rig.activations.load(Ordering::SeqCst), 1);
    assert!(rig.reports.lock().unwrap().is_empty());
    // A channel nobody here activated means Remote restarted, which resolves its project
    // again: the earlier verdict is dropped and activation is asked once more.
    peer.channels.started.fetch_add(1, Ordering::SeqCst);
    until("a fresh attempt", || {
        rig.activations.load(Ordering::SeqCst) == 2
    });
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(rig.activations.load(Ordering::SeqCst), 2);
    assert!(rig.reports.lock().unwrap().is_empty());
}

#[test]
fn a_deadline_or_missing_door_keeps_retrying_past_the_first_waits_without_a_warning() {
    let peer = peer();
    let rig = start(Arc::clone(&peer.channels), || Err(ActivationFailure::Local));
    // Past the two short waits the worker keeps a steady pace instead of idling (#6142), and
    // waits between attempts rather than spinning: at 100, 200 then 300 ms apart, a second and
    // a half holds at most seven.
    let started = Instant::now();
    until("five attempts", || {
        rig.activations.load(Ordering::SeqCst) >= 5
    });
    std::thread::sleep(Duration::from_millis(1500).saturating_sub(started.elapsed()));
    assert!(rig.activations.load(Ordering::SeqCst) <= 7, "no busy loop");
    // Attempts are silent: no line per attempt.
    assert!(rig.reports.lock().unwrap().is_empty());
}

#[test]
fn retrying_activation_ends_with_the_worker_and_on_a_remote_verdict() {
    // Shutdown: the worker's thread is joined, so no attempt follows.
    let peer = peer();
    let mut rig = start(Arc::clone(&peer.channels), || Err(ActivationFailure::Local));
    until("steady attempts", || {
        rig.activations.load(Ordering::SeqCst) >= 4
    });
    rig.sync.take().unwrap().stop();
    let stopped = rig.activations.load(Ordering::SeqCst);
    std::thread::sleep(Duration::from_millis(700));
    assert_eq!(rig.activations.load(Ordering::SeqCst), stopped);
    // A Remote verdict after attempt-shaped failures holds: retries end until Remote restarts.
    let other = super::fixture::peer();
    let tries = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&tries);
    let rig = start(Arc::clone(&other.channels), move || {
        if seen.fetch_add(1, Ordering::SeqCst) < 3 {
            Err(ActivationFailure::Local)
        } else {
            Err(ActivationFailure::Remote(Refusal {
                code: "REMOTE_SERVE_OUTDATED".into(),
                state: None,
            }))
        }
    });
    until("the verdict", || {
        rig.activations.load(Ordering::SeqCst) == 4
    });
    std::thread::sleep(Duration::from_millis(700));
    assert_eq!(rig.activations.load(Ordering::SeqCst), 4);
    assert!(rig.reports.lock().unwrap().is_empty());
}

/// One update per page, recording each page whose update was confirmed, in order.
struct PageUpdates {
    pages: std::collections::HashMap<String, OneUpdate>,
    confirmed: Arc<Mutex<Vec<String>>>,
    /// A later local edit of a page: its next update's sequence number.
    edits: Arc<Mutex<std::collections::HashMap<String, u64>>>,
}
impl PageUpdates {
    fn of(&mut self, page: &PageRef) -> &mut OneUpdate {
        let edit = self.edits.lock().unwrap().remove(&page.page);
        let update = self
            .pages
            .entry(page.page.clone())
            .or_insert(OneUpdate { next: 1 });
        if let Some(next) = edit {
            update.next = next;
        }
        update
    }
}
/// Each confirmed page, in order, and the pages given a later edit with its sequence number.
type Confirmed = Arc<Mutex<Vec<String>>>;
type Edits = Arc<Mutex<std::collections::HashMap<String, u64>>>;
/// A rig whose Store holds one update per page and records each confirmed one.
fn start_pages(
    channels: Arc<super::fixture::FixedChannel>,
    activate: impl Fn() -> Result<Activation, ActivationFailure> + Send + Sync + 'static,
) -> (Rig, Confirmed, Edits) {
    let confirmed = Arc::new(Mutex::new(Vec::new()));
    let edits = Arc::new(Mutex::new(std::collections::HashMap::new()));
    let (record, edited) = (Arc::clone(&confirmed), Arc::clone(&edits));
    let rig = start_with(
        channels,
        activate,
        None,
        Arc::new(move |_| {
            Some(Box::new(PageUpdates {
                pages: Default::default(),
                confirmed: Arc::clone(&record),
                edits: Arc::clone(&edited),
            }))
        }),
    );
    (rig, confirmed, edits)
}
impl Local for PageUpdates {
    fn preamble(&mut self, page: &PageRef) -> Result<Vec<super::publisher::Row>, Fault> {
        self.of(page).preamble(page)
    }
    fn next(&mut self, page: &PageRef) -> Result<Option<super::publisher::Data>, Fault> {
        self.of(page).next(page)
    }
    fn confirm(
        &mut self,
        page: &PageRef,
        confirm: &super::publisher::Confirm,
    ) -> Result<(), Fault> {
        self.confirmed.lock().unwrap().push(page.page.clone());
        self.of(page).confirm(page, confirm)
    }
    fn page_row_confirmed(&mut self, page: &PageRef, expires_ms: u64) -> Result<(), Fault> {
        self.of(page).page_row_confirmed(page, expires_ms)
    }
    fn retirements(&mut self, page: &PageRef) -> Result<Vec<super::publisher::Retirement>, Fault> {
        self.of(page).retirements(page)
    }
    fn retired(&mut self, page: &PageRef, link: &str) -> Result<(), Fault> {
        self.of(page).retired(page, link)
    }
}

#[test]
fn a_page_left_for_another_reaches_the_cloud_without_another_touch() {
    // Page A is edited and left for page B, and nothing touches A again (#6158).
    let mut peer = peer();
    let firestore = super::fixture::Firestore::default();
    let answer = firestore.clone();
    let remote = ScriptedRemote::serve(peer.remote.take().unwrap(), move |call, id| {
        answer.answer(call, id)
    });
    let (mut rig, confirmed, edits) = start_pages(Arc::clone(&peer.channels), activated);
    rig.activity.touch(page(FIRST, 1));
    until("the first page is published", || {
        *confirmed.lock().unwrap() == [FIRST]
    });
    // A later edit of A, then B becomes active before the worker looks at A again.
    edits.lock().unwrap().insert(FIRST.into(), 2);
    rig.activity.touch(page(FIRST, 1));
    rig.activity.touch(page(SECOND, 1));
    until(
        "the active page, then the edit of the page left behind",
        || *confirmed.lock().unwrap() == [FIRST, SECOND, FIRST],
    );
    // Nothing more is due: the queue is drained and the worker waits.
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(confirmed.lock().unwrap().len(), 3);
    let publishes = remote
        .methods()
        .into_iter()
        .filter(|m| *m == Method::Publish)
        .count();
    assert_eq!(publishes, 3, "one publish per update, none repeated");
    assert!(rig.reports.lock().unwrap().is_empty());
    rig.sync.take().unwrap().stop();
}

#[test]
fn the_queue_of_touched_pages_is_bounded_and_keeps_each_page_once() {
    let mut pages = Vec::new();
    for n in 0..(super::QUEUED_PAGES + 10) {
        super::remember(&mut pages, page(&format!("p-{n}"), 1));
    }
    assert_eq!(pages.len(), super::QUEUED_PAGES);
    assert_eq!(
        pages[0].page, "p-10",
        "the oldest pages are forgotten first"
    );
    super::remember(&mut pages, page("p-10", 1));
    assert_eq!(pages.len(), super::QUEUED_PAGES);
    assert_eq!(
        pages.last().unwrap().page,
        "p-10",
        "a touch moves a page to the end"
    );
    assert_eq!(pages.iter().filter(|known| known.page == "p-10").count(), 1);
}

#[test]
fn a_slow_door_converges_without_a_second_trigger() {
    // Remote activates only on its fifth attempt, after the old three-attempt budget, and no
    // channel restart or mount wakes the worker in between (#6142).
    let mut peer = peer();
    let firestore = super::fixture::Firestore::default();
    let answer = firestore.clone();
    let remote = ScriptedRemote::serve(peer.remote.take().unwrap(), move |call, id| {
        answer.answer(call, id)
    });
    let tries = Arc::new(AtomicUsize::new(0));
    let seen = Arc::clone(&tries);
    let started = peer.channels.started.load(Ordering::SeqCst);
    let (mut rig, confirmed, _) = start_pages(Arc::clone(&peer.channels), move || {
        if seen.fetch_add(1, Ordering::SeqCst) < 4 {
            Err(ActivationFailure::Local)
        } else {
            activated()
        }
    });
    // Two pages are touched before the session. Once it is up, the most recently active page
    // is published first and the other one after it, with no touch in between (#6158).
    rig.activity.touch(page(SECOND, 1));
    rig.activity.touch(page(FIRST, 1));
    until("both touched pages are published", || {
        *confirmed.lock().unwrap() == [FIRST, SECOND]
    });
    assert_eq!(
        remote.methods(),
        [Method::Bind, Method::Publish, Method::Publish]
    );
    assert_eq!(rig.activations.load(Ordering::SeqCst), 5);
    assert_eq!(
        peer.channels.started.load(Ordering::SeqCst),
        started,
        "no second trigger"
    );
    assert!(rig.reports.lock().unwrap().is_empty());
    rig.sync.take().unwrap().stop();
}

#[test]
fn a_bind_that_disagrees_with_the_frozen_inputs_is_refused_and_ends_the_generation() {
    let mut peer = peer();
    let remote = ScriptedRemote::serve(peer.remote.take().unwrap(), |call, id| {
        match friendly(call, id) {
            sync::Outcome::Binding { mut context } => {
                context.space = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".into();
                sync::Outcome::Binding { context }
            }
            other => other,
        }
    });
    let rig = start(Arc::clone(&peer.channels), activated);
    until("bind attempted", || remote.methods() == [Method::Bind]);
    rig.activity.touch(page(FIRST, 1));
    std::thread::sleep(Duration::from_millis(300));
    assert_eq!(
        remote.methods(),
        [Method::Bind],
        "no interest is registered on a refused bind"
    );
    assert!(
        peer.channels
            .client()
            .unwrap()
            .sealed_request(
                sync::Call::Cancel {
                    binding: BINDING.into(),
                    subscription_id: "1".into()
                },
                super::fixture::within()
            )
            .is_err(),
        "a disagreeing bind ends the generation"
    );
}

/// A Store side that follows no stream but counts how often a pass prepared to admit.
struct Follow {
    prepared: Arc<AtomicUsize>,
}
impl Inbound for Follow {
    fn membership(&mut self, _: &PageRef, _: &[Vec<u8>]) -> Result<(), super::publisher::Fault> {
        Ok(())
    }
    fn begin(
        &mut self,
        _: &PageRef,
        _: &[Vec<u8>],
    ) -> Result<Vec<String>, super::publisher::Fault> {
        self.prepared.fetch_add(1, Ordering::SeqCst);
        Ok(Vec::new())
    }
    fn head(&mut self, _: &PageRef, _: &str) -> Result<u64, super::publisher::Fault> {
        Ok(0)
    }
    fn admit(
        &mut self,
        _: &PageRef,
        _: &[u8],
    ) -> Result<super::inbound::Applied, super::inbound::Reject> {
        Err(super::inbound::Reject::Retry)
    }
}

#[test]
fn the_worker_watches_exactly_the_active_page_and_reads_again_on_a_hint_and_on_a_switch() {
    let mut peer = peer();
    let firestore = super::fixture::Firestore::default();
    let answer = firestore.clone();
    let remote = ScriptedRemote::serve(peer.remote.take().unwrap(), move |call, id| {
        answer.answer(call, id)
    });
    let prepared = Arc::new(AtomicUsize::new(0));
    let counter = Arc::clone(&prepared);
    let mut rig = start_following(
        Arc::clone(&peer.channels),
        activated,
        Some(Arc::new(move |_| {
            Some(Box::new(Follow {
                prepared: Arc::clone(&counter),
            }))
        })),
    );
    rig.activity.touch(page(FIRST, 1));
    until("first read and three interests", || {
        prepared.load(Ordering::SeqCst) >= 1 && remote.subscribed.lock().unwrap().len() == 3
    });
    // A wake from the cloud reads again.
    let first_group = remote.subscribed.lock().unwrap().clone();
    remote.changed(&first_group[0]);
    until("a read after a hint", || {
        prepared.load(Ordering::SeqCst) >= 2
    });
    // Another page cancels all three interests before it registers any.
    rig.activity.touch(page(SECOND, 1));
    until("second group", || {
        remote.subscribed.lock().unwrap().len() == 6
    });
    let methods = remote.methods();
    let subscribes: Vec<usize> = methods
        .iter()
        .enumerate()
        .filter(|(_, m)| **m == Method::Subscribe)
        .map(|(i, _)| i)
        .collect();
    let cancels: Vec<usize> = methods
        .iter()
        .enumerate()
        .filter(|(_, m)| **m == Method::Cancel)
        .map(|(i, _)| i)
        .collect();
    assert_eq!(subscribes.len(), 6);
    assert_eq!(cancels.len(), 3);
    assert!(
        cancels
            .iter()
            .all(|c| *c > subscribes[2] && *c < subscribes[3])
    );
    // Stopping joins the live interests.
    rig.sync.take().unwrap().stop();
    assert_eq!(
        remote
            .methods()
            .iter()
            .filter(|m| **m == Method::Cancel)
            .count(),
        6
    );
    assert!(rig.reports.lock().unwrap().is_empty());
}

/// A Store side whose membership comparison refuses while `stopped` is set.
struct Gate {
    stopped: Arc<AtomicBool>,
    passes: Arc<AtomicUsize>,
}
impl Inbound for Gate {
    fn membership(&mut self, _: &PageRef, _: &[Vec<u8>]) -> Result<(), super::publisher::Fault> {
        self.passes.fetch_add(1, Ordering::SeqCst);
        if self.stopped.load(Ordering::SeqCst) {
            Err(super::publisher::Fault::Stuck(
                "The cloud has newer sharing changes than this machine.",
            ))
        } else {
            Ok(())
        }
    }
    fn begin(
        &mut self,
        _: &PageRef,
        _: &[Vec<u8>],
    ) -> Result<Vec<String>, super::publisher::Fault> {
        Ok(Vec::new())
    }
    fn head(&mut self, _: &PageRef, _: &str) -> Result<u64, super::publisher::Fault> {
        Ok(0)
    }
    fn admit(
        &mut self,
        _: &PageRef,
        _: &[u8],
    ) -> Result<super::inbound::Applied, super::inbound::Reject> {
        Err(super::inbound::Reject::Retry)
    }
}

#[test]
fn a_stopped_page_is_announced_once_when_it_stops_and_once_when_it_recovers() {
    let mut peer = peer();
    let firestore = super::fixture::Firestore::default();
    let answer = firestore.clone();
    let remote = ScriptedRemote::serve(peer.remote.take().unwrap(), move |call, id| {
        answer.answer(call, id)
    });
    let (stopped, passes) = (
        Arc::new(AtomicBool::new(true)),
        Arc::new(AtomicUsize::new(0)),
    );
    let (gate, counter) = (Arc::clone(&stopped), Arc::clone(&passes));
    let rig = start_following(
        Arc::clone(&peer.channels),
        activated,
        Some(Arc::new(move |_| {
            Some(Box::new(Gate {
                stopped: Arc::clone(&gate),
                passes: Arc::clone(&counter),
            }))
        })),
    );
    rig.activity.touch(page(FIRST, 1));
    until("the stopping read", || {
        rig.reports.lock().unwrap().len() == 1
    });
    let lines = || rig.reports.lock().unwrap().clone();
    assert!(lines()[0].starts_with(&format!("Cloud sync stopped for page {FIRST}.")));
    assert!(lines()[0].contains("newer sharing changes"));
    // More reads find the same condition and say nothing more. The membership is compared
    // again when the authority interest notices (the third of the page's interests).
    let group = remote.subscribed.lock().unwrap().clone();
    for round in 2..=4 {
        remote.changed(&group[2]);
        until("another read", || passes.load(Ordering::SeqCst) >= round);
    }
    assert_eq!(lines().len(), 1);
    // The condition clears: one recovery line, then quiet again.
    stopped.store(false, Ordering::SeqCst);
    remote.changed(&group[2]);
    until("the recovery", || lines().len() == 2);
    assert_eq!(lines()[1], format!("Cloud sync resumed for page {FIRST}."));
    let seen = passes.load(Ordering::SeqCst);
    remote.changed(&group[2]);
    until("a read after the recovery", || {
        passes.load(Ordering::SeqCst) > seen
    });
    assert_eq!(lines().len(), 2);
}

/// A Store side that follows one writer with nothing to apply, so every pass asks the cloud for
/// that writer's tail.
struct Writer;
impl Inbound for Writer {
    fn membership(&mut self, _: &PageRef, _: &[Vec<u8>]) -> Result<(), super::publisher::Fault> {
        Ok(())
    }
    fn begin(
        &mut self,
        _: &PageRef,
        _: &[Vec<u8>],
    ) -> Result<Vec<String>, super::publisher::Fault> {
        Ok(vec![FIRST.to_owned()])
    }
    fn head(&mut self, _: &PageRef, _: &str) -> Result<u64, super::publisher::Fault> {
        Ok(0)
    }
    fn admit(
        &mut self,
        _: &PageRef,
        _: &[u8],
    ) -> Result<super::inbound::Applied, super::inbound::Reject> {
        Err(super::inbound::Reject::Retry)
    }
}
/// How many reads of each shape the cloud has been asked for: the membership records, the
/// device chains, and a writer's tail.
#[derive(Debug, Default, PartialEq, Eq, Clone, Copy)]
struct Reads {
    membership: usize,
    chains: usize,
    tails: usize,
}
fn reads(remote: &ScriptedRemote) -> Reads {
    let mut found = Reads::default();
    for call in remote.calls.lock().unwrap().iter() {
        let sync::Call::Query { query, .. } = call else {
            continue;
        };
        match query {
            sync::Query::Stream { .. } => found.tails += 1,
            sync::Query::Discovery { scope, .. } => match scope
                .get("kind")
                .and_then(|kind| kind["stringValue"].as_str())
            {
                Some("membership") => found.membership += 1,
                Some("chain") => found.chains += 1,
                _ => {}
            },
        }
    }
    found
}
fn following_a_writer() -> (Rig, ScriptedRemote, super::fixture::Peer) {
    let mut peer = peer();
    let firestore = super::fixture::Firestore::default();
    let answer = firestore.clone();
    let remote = ScriptedRemote::serve(peer.remote.take().unwrap(), move |call, id| {
        answer.answer(call, id)
    });
    let rig = start_following(
        Arc::clone(&peer.channels),
        activated,
        Some(Arc::new(|_| Some(Box::new(Writer)))),
    );
    rig.activity.touch(page(FIRST, 1));
    until("the first read", || {
        remote.subscribed.lock().unwrap().len() == 3 && reads(&remote).tails == 1
    });
    (rig, remote, peer)
}

#[test]
fn a_local_touch_publishes_and_reads_nothing_from_the_cloud() {
    let (mut rig, remote, _peer) = following_a_writer();
    let first = reads(&remote);
    assert_eq!(
        first,
        Reads {
            membership: 1,
            chains: 1,
            tails: 1
        }
    );
    // Every local write touches the page. The page is published, and the cloud is not asked.
    for _ in 0..4 {
        rig.activity.touch(page(FIRST, 1));
        std::thread::sleep(Duration::from_millis(80));
    }
    assert_eq!(reads(&remote), first);
    rig.sync.take().unwrap().stop();
}

#[test]
fn a_log_notice_reads_tails_and_never_the_membership_and_the_chains_wait_their_spacing() {
    let (mut rig, remote, _peer) = following_a_writer();
    let group = remote.subscribed.lock().unwrap().clone();
    // A burst of log and checkpoint notices, as one's own appends cause.
    for round in 0..6 {
        remote.changed(&group[round % 2]);
        std::thread::sleep(Duration::from_millis(15));
    }
    until(
        "the chains are read again once their spacing has passed",
        || reads(&remote).chains == 2,
    );
    // Nothing more is read without another notice, and the membership was never read again.
    std::thread::sleep(super::inbound::CHAIN_RECHECK * 2);
    let after = reads(&remote);
    assert_eq!(after.membership, 1);
    assert_eq!(after.chains, 2);
    assert!(after.tails >= 2, "the tails are read after a notice");
    rig.sync.take().unwrap().stop();
}

#[test]
fn an_authority_notice_reads_the_membership_and_the_chains_at_once() {
    let (mut rig, remote, _peer) = following_a_writer();
    let group = remote.subscribed.lock().unwrap().clone();
    remote.changed(&group[2]);
    until("the authority is read again", || {
        reads(&remote)
            == Reads {
                membership: 2,
                chains: 2,
                tails: 2,
            }
    });
    rig.sync.take().unwrap().stop();
}
