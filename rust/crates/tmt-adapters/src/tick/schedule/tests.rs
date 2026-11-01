use super::*;
use tmt_core::orchestration::jobs::{HeldJobSlot, JobSchedule};
fn job() -> TickJob {
    TickJob {
        routine_hold: false,
        job: JobListRow {
            id: "11111111-1111-4111-8111-111111111111".into(),
            number: 1,
            revision: 1,
            owner_id: Some("22222222-2222-4222-8222-222222222222".into()),
            owner_name: Some("member".into()),
            room_id: None,
            title: None,
            message_preview: "message".into(),
            schedule: JobSchedule::Every {
                zone: "UTC".into(),
                seconds: 10,
                anchor_ms: 0,
                from: None,
            },
            pause: None,
            pending: None,
            legacy: None,
            owner_retired: false,
            owner_available: true,
        },
    }
}
struct Port {
    rows: Vec<TickJob>,
    calls: Vec<i64>,
    stop_after: usize,
    wake_after: u64,
    fail: bool,
    response: Value,
}
impl Port {
    fn new() -> Self {
        Self {
            rows: vec![job()],
            calls: vec![],
            stop_after: usize::MAX,
            wake_after: 0,
            fail: false,
            response: json!({"outcome":"accepted","created":true}),
        }
    }
}
impl TickPort for Port {
    fn ready(&self) -> bool {
        self.calls.len() < self.stop_after
    }
    fn page(&mut self, _: u64, _: u64) -> Result<TickPage, TickError> {
        Ok(TickPage {
            jobs: self.rows.clone(),
            next_after: None,
        })
    }
    fn next_wake_admission(&mut self) -> Result<u64, TickError> {
        Ok(self.wake_after)
    }
    fn execute(&mut self, _: &JobListRow, slot: i64) -> Result<Value, TickError> {
        self.calls.push(slot);
        if self.fail {
            Err(TickError::LeaseLost)
        } else {
            Ok(self.response.clone())
        }
    }
}
#[test]
fn active_subminute_slots_rollback_and_standalone_windows_keep_shipped_semantics() {
    let mut w = TickWindow::new(100_000, false);
    let mut p = Port::new();
    assert_eq!(w.pass(135_000, &mut p).unwrap().accepted, 3);
    assert_eq!(p.calls, vec![110_000, 120_000, 130_000]);
    p.calls.clear();
    w.pass(125_000, &mut p).unwrap();
    assert!(p.calls.is_empty());
    let mut p = Port::new();
    let mut w = TickWindow::new(135_000, true);
    w.pass(135_000, &mut p).unwrap();
    assert_eq!(
        p.calls,
        vec![80_000, 90_000, 100_000, 110_000, 120_000, 130_000]
    );
}
#[test]
fn active_gaps_cap_at_five_minutes_and_new_lifetimes_never_reconstruct_absence() {
    let mut p = Port::new();
    let mut window = TickWindow::new(1, false);
    window.pass(1_000_000, &mut p).unwrap();
    assert_eq!(p.calls, (71..=100).map(|n| n * 10_000).collect::<Vec<_>>());
    for start in [10_000i64, 60_000, 300_000, 10_000_000] {
        let mut p = Port::new();
        let mut window = TickWindow::new(start, false);
        window.pass(start as u64, &mut p).unwrap();
        assert!(
            p.calls.is_empty(),
            "a new lifetime baselines without absent-clock history"
        );
        window.pass((start + 10_000) as u64, &mut p).unwrap();
        assert_eq!(p.calls, vec![start + 10_000]);
    }
}

#[test]
fn deadline_and_uncertain_failure_stop_new_calls_and_do_not_retry_in_the_minute() {
    let mut w = TickWindow::new(100_000, false);
    let mut p = Port::new();
    p.stop_after = 1;
    let r = w.pass(135_000, &mut p).unwrap();
    assert!(!r.complete);
    assert_eq!(p.calls, vec![110_000]);
    let mut w = TickWindow::new(100_000, false);
    let mut p = Port::new();
    p.fail = true;
    let r = w.pass(135_000, &mut p).unwrap();
    assert_eq!(r.failures.len(), 1);
    w.pass(145_000, &mut p).unwrap();
    assert_eq!(p.calls, vec![110_000]);
}
#[test]
fn pending_hold_uses_no_child_until_release_and_shared_spacing_then_catches_up_once() {
    let mut w = TickWindow::new(100_000, false);
    let mut p = Port::new();
    p.rows[0].job.pending = Some(HeldJobSlot {
        revision: 1,
        at_ms: 90_000,
    });
    p.rows[0].routine_hold = true;
    w.pass(135_000, &mut p).unwrap();
    assert!(p.calls.is_empty());
    p.rows[0].routine_hold = false;
    p.wake_after = 150_000;
    w.pass(145_000, &mut p).unwrap();
    assert!(p.calls.is_empty());
    w.pass(155_000, &mut p).unwrap();
    assert_eq!(p.calls, vec![155_000]);
}

#[test]
fn acceptance_requires_explicit_creation_and_recovery_is_not_a_second_acceptance() {
    let mut w = TickWindow::new(100_000, false);
    let mut p = Port::new();
    p.response = json!({"outcome":"accepted"});
    let report = w.pass(115_000, &mut p).unwrap();
    assert!(!report.complete);
    assert_eq!(report.accepted, 0);
    assert_eq!(report.failures[0]["code"], "TICK_PROTOCOL_INVALID");
    p.response = json!({"outcome":"accepted","created":false});
    assert!(w.begin_minute(125_000));
    let report = w.pass(125_000, &mut p).unwrap();
    assert_eq!(report.recovered, 1);
    assert_eq!(report.accepted, 0);
    assert!(report.complete);
}

#[test]
fn one_minute_gate_prevents_component_replay_and_preserves_failed_work_on_rollback() {
    let mut window = TickWindow::new(59_999, false);
    let mut admitted = Vec::new();
    for now in [60_000, 60_001, 119_999, 59_999, 1, 119_999] {
        if window.begin_minute(now) {
            admitted.push(now);
        }
        window.failed.insert("uncertain job".into());
    }
    assert_eq!(
        admitted,
        vec![60_000],
        "jobs, Digest and capture share one admission, not a retry after rollback"
    );
    assert!(window.failed.contains("uncertain job"));
    assert!(
        window.begin_minute(180_000),
        "a jump admits only the current minute"
    );
    assert!(window.failed.is_empty());
    assert!(!window.begin_minute(120_000));
    assert!(!window.begin_minute(180_000));
}
