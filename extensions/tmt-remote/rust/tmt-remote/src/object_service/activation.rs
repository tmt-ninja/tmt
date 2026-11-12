//! Startup recovery and mount demands share one bounded setup worker and single flight.
use super::{ActivateError, ObjectService, State};
use crate::{
    limits,
    mount::{ActivationSink, IdleClock, Mounts},
};
use std::{
    collections::VecDeque,
    sync::{
        Arc, Condvar, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};

struct ActivationAttempt {
    deadline: Instant,
    native: bool,
    done: Mutex<Option<Result<(), ActivateError>>>,
    changed: Condvar,
}
impl ActivationAttempt {
    fn finish(&self, outcome: Result<(), ActivateError>) {
        *self.done.lock().unwrap_or_else(|p| p.into_inner()) = Some(outcome);
        self.changed.notify_all();
    }
    fn wait(&self, deadline: Instant) -> Option<Result<(), ActivateError>> {
        let mut done = self.done.lock().unwrap_or_else(|p| p.into_inner());
        while done.is_none() {
            let Some(left) = deadline
                .checked_duration_since(Instant::now())
                .filter(|d| !d.is_zero())
            else {
                break;
            };
            done = self
                .changed
                .wait_timeout(done, left)
                .unwrap_or_else(|p| p.into_inner())
                .0;
        }
        *done
    }
}
struct Recovery {
    at: Instant,
    delay: Duration,
}
struct ActivationDemand {
    name: &'static str,
    flight: Option<Arc<ActivationAttempt>>,
    retry_at: Option<Instant>,
    recovery: Option<Recovery>,
}
struct ActivationQueue {
    closed: bool,
    slots: Vec<ActivationDemand>,
    pending: VecDeque<(&'static str, Arc<ActivationAttempt>)>,
}
/// A static mount hook owns only setup requests and a status view, not the lease/backend.
/// Serve joins the scoped borrower before dropping ObjectService.
pub struct Reactivation {
    state: Arc<Mutex<State>>,
    queue: Mutex<ActivationQueue>,
    changed: Condvar,
    stop: Arc<AtomicBool>,
    clock: IdleClock,
    capacity: usize,
}
impl Reactivation {
    pub(super) fn new(
        service: &ObjectService<'_>,
        stop: Arc<AtomicBool>,
        clock: IdleClock,
    ) -> Arc<Self> {
        let slots = service
            .locked()
            .slots
            .iter()
            .map(|s| ActivationDemand {
                name: s.name,
                flight: None,
                retry_at: None,
                recovery: None,
            })
            .collect();
        let hook = Arc::new(Self {
            state: Arc::clone(&service.state),
            queue: Mutex::new(ActivationQueue {
                closed: false,
                slots,
                pending: VecDeque::new(),
            }),
            changed: Condvar::new(),
            stop,
            clock,
            capacity: service.bounds.buses,
        });
        *service.recovery.lock().unwrap_or_else(|p| p.into_inner()) = Arc::downgrade(&hook);
        hook
    }
    /// Register startup outcomes for recovery without another thread or control surface.
    /// Capacity refusals and stopped storage are not extension-readiness failures.
    pub fn recover_startup(&self) {
        let names: Vec<_> = {
            let state = self.state.lock().unwrap_or_else(|p| p.into_inner());
            if state.stopped || self.stop.load(Ordering::Acquire) {
                return;
            }
            state
                .slots
                .iter()
                .filter(|slot| {
                    !slot.running()
                        && slot.failure.is_some_and(|failure| {
                            !matches!(failure, ActivateError::Capacity | ActivateError::Stopped)
                        })
                })
                .map(|slot| slot.name)
                .collect()
        };
        for name in names {
            self.channel_ended(name);
        }
    }
    /// Hub reports channel loss once; stale loss events cannot replace a healthy channel.
    pub(super) fn channel_ended(&self, name: &str) {
        if self.stop.load(Ordering::Acquire) {
            return;
        }
        let mut queue = self.queue.lock().unwrap_or_else(|p| p.into_inner());
        if queue.closed {
            return;
        }
        if let Some(slot) = queue.slots.iter_mut().find(|slot| slot.name == name)
            && slot.recovery.is_none()
        {
            slot.recovery = Some(Recovery {
                at: (self.clock)() + limits::OBJECT_REACTIVATION_COOLDOWN,
                delay: limits::OBJECT_REACTIVATION_COOLDOWN,
            });
        }
        self.changed.notify_one();
    }
    fn healthy(&self, name: &str) -> bool {
        self.state
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .slots
            .iter()
            .any(|s| s.name == name && s.running())
    }
    fn next(&self) -> Option<(&'static str, Arc<ActivationAttempt>)> {
        let mut queue = self.queue.lock().unwrap_or_else(|p| p.into_inner());
        loop {
            if queue.closed || self.stop.load(Ordering::Acquire) {
                return None;
            }
            if let Some(next) = queue.pending.pop_front() {
                return Some(next);
            }
            let now = (self.clock)();
            let available =
                queue.slots.iter().filter(|s| s.flight.is_some()).count() < self.capacity;
            for index in 0..queue.slots.len() {
                let slot = &mut queue.slots[index];
                if slot.recovery.is_none()
                    || slot.flight.is_some()
                    || slot
                        .recovery
                        .as_ref()
                        .is_some_and(|recovery| recovery.at > now)
                {
                    continue;
                }
                if self.healthy(slot.name) {
                    slot.recovery = None;
                } else if available {
                    let attempt = Arc::new(ActivationAttempt {
                        deadline: Instant::now() + limits::OBJECT_REACTIVATION,
                        native: false,
                        done: Mutex::new(None),
                        changed: Condvar::new(),
                    });
                    slot.flight = Some(Arc::clone(&attempt));
                    return Some((slot.name, attempt));
                }
            }
            // Only outstanding recovery work has a timer. Healthy channels sleep until
            // Hub reports loss. Timed recovery waits also observe the shared stop flag.
            if queue.slots.iter().any(|slot| slot.recovery.is_some()) {
                let delay = queue
                    .slots
                    .iter()
                    .filter_map(|slot| {
                        slot.recovery
                            .as_ref()
                            .map(|recovery| recovery.at.saturating_duration_since(now))
                    })
                    .min()
                    .unwrap_or(limits::OBJECT_REACTIVATION_COOLDOWN)
                    .min(limits::OBJECT_REACTIVATION_COOLDOWN);
                queue = self
                    .changed
                    .wait_timeout(queue, delay)
                    .unwrap_or_else(|p| p.into_inner())
                    .0;
            } else {
                queue = self.changed.wait(queue).unwrap_or_else(|p| p.into_inner());
            }
        }
    }
    fn run(&self, service: &ObjectService<'_>, mounts: &Mounts) {
        while let Some((name, attempt)) = self.next() {
            let outcome = if self.stop.load(Ordering::Acquire) {
                Err(ActivateError::Stopped)
            } else if !attempt.native && self.healthy(name) {
                Ok(())
            } else {
                if attempt.native {
                    service
                        .activate_native_until(mounts, name, attempt.deadline)
                        .map(|_| ())
                } else {
                    service
                        .activate_until(mounts, name, attempt.deadline)
                        .map(|_| ())
                }
            };
            let failed = outcome.is_err() || !self.healthy(name);
            let mut queue = self.queue.lock().unwrap_or_else(|p| p.into_inner());
            let slot = queue
                .slots
                .iter_mut()
                .find(|s| s.name == name)
                .expect("declared demand");
            if failed && !attempt.native {
                let now = (self.clock)();
                // Preserve the existing failed-demand cooldown. Automatic backoff
                // never delays an otherwise-admissible fresh mount demand.
                slot.retry_at = Some(now + limits::OBJECT_REACTIVATION_COOLDOWN);
                if let Some(recovery) = &mut slot.recovery {
                    recovery.delay =
                        (recovery.delay * 2).min(limits::OBJECT_REACTIVATION_BACKOFF_MAX);
                    recovery.at = now + recovery.delay;
                }
            } else if !failed {
                slot.recovery = None;
                slot.retry_at = None;
            }
            // Publish completion before making a new flight possible.
            attempt.finish(outcome);
            slot.flight = None;
        }
    }
    #[cfg(test)]
    pub(super) fn recovery(&self) -> Vec<(Option<Instant>, Option<Duration>)> {
        self.changed.notify_one();
        self.queue
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .slots
            .iter()
            .map(|slot| {
                (
                    slot.recovery.as_ref().map(|r| r.at),
                    slot.recovery.as_ref().map(|r| r.delay),
                )
            })
            .collect()
    }
    #[cfg(test)]
    pub(super) fn queued(&self) -> usize {
        self.queue
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .pending
            .len()
    }
    #[cfg(test)]
    pub(super) fn idle(&self) -> bool {
        self.queue
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .slots
            .iter()
            .all(|s| s.flight.is_none())
    }
    fn disable(&self) {
        let mut queue = self.queue.lock().unwrap_or_else(|p| p.into_inner());
        queue.closed = true;
        queue.pending.clear();
        for slot in &queue.slots {
            if let Some(attempt) = &slot.flight {
                attempt.finish(Err(ActivateError::Stopped));
            }
        }
        self.changed.notify_all();
    }
}
impl ActivationSink for Reactivation {
    fn prepare(&self, name: &str, deadline: Instant) -> bool {
        if Instant::now() >= deadline || self.stop.load(Ordering::Acquire) {
            return false;
        }
        if self.healthy(name) {
            return true;
        }
        let mut queue = self.queue.lock().unwrap_or_else(|p| p.into_inner());
        if queue.closed {
            return false;
        }
        let Some(index) = queue.slots.iter().position(|s| s.name == name) else {
            return false;
        };
        if queue.slots[index]
            .retry_at
            .is_some_and(|t| (self.clock)() < t)
        {
            return false;
        }
        let attempt = if let Some(attempt) = &queue.slots[index].flight {
            Arc::clone(attempt)
        } else {
            if queue.slots.iter().filter(|s| s.flight.is_some()).count() >= self.capacity {
                return false;
            }
            let attempt = Arc::new(ActivationAttempt {
                deadline: deadline.min(Instant::now() + limits::OBJECT_REACTIVATION),
                native: false,
                done: Mutex::new(None),
                changed: Condvar::new(),
            });
            queue.slots[index].flight = Some(Arc::clone(&attempt));
            let name = queue.slots[index].name;
            queue.pending.push_back((name, Arc::clone(&attempt)));
            self.changed.notify_one();
            attempt
        };
        drop(queue);
        let _ = attempt.wait(deadline.min(attempt.deadline));
        // An unfinished candidate may already have registered its generation. Only an
        // installed live channel can supply a ticket; false never refuses forwarding.
        !self.stop.load(Ordering::Acquire) && self.healthy(name)
    }
    fn close(&self) {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).stopped = true;
        self.disable();
    }
}
/// The live native generation and its registered startup project.
#[derive(Debug)]
pub struct NativeActivationInfo {
    pub generation: String,
    pub project: String,
}
fn native_reply(slot: &super::Declared) -> Option<NativeActivationInfo> {
    let running = slot
        .active
        .as_ref()
        .filter(|running| running.ended().is_none() && running.supports_sync())?;
    Some(NativeActivationInfo {
        generation: running.generation().to_string(),
        project: slot.native.as_ref()?.project()?.to_owned(),
    })
}

/// Existing owner-only control transport uses this hook; it carries no data or
/// credentials and never registers the project-owner factory by itself.
pub trait NativeActivation: Send + Sync {
    fn activate_native(
        &self,
        name: &str,
        deadline: Instant,
    ) -> Result<NativeActivationInfo, crate::error::RemoteError>;
}
fn unavailable() -> crate::error::RemoteError {
    crate::error::RemoteError::new(
        "REMOTE_STATE_UNAVAILABLE",
        "Native sync activation is unavailable.",
    )
}
impl NativeActivation for Reactivation {
    fn activate_native(
        &self,
        name: &str,
        deadline: Instant,
    ) -> Result<NativeActivationInfo, crate::error::RemoteError> {
        if Instant::now() >= deadline || self.stop.load(Ordering::Acquire) {
            return Err(unavailable());
        }
        {
            let state = self.state.lock().unwrap_or_else(|p| p.into_inner());
            if state.stopped {
                return Err(unavailable());
            }
            let slot = state
                .slots
                .iter()
                .find(|slot| slot.name == name)
                .ok_or_else(|| {
                    crate::error::RemoteError::new(
                        "REMOTE_SCOPE_DENIED",
                        "Native sync extension is not enabled.",
                    )
                })?;
            if slot.native.is_none() {
                return Err(unavailable());
            }
            if let Some(reply) = native_reply(slot) {
                return Ok(reply);
            }
        }
        let mut queue = self.queue.lock().unwrap_or_else(|p| p.into_inner());
        if queue.closed {
            return Err(unavailable());
        }
        let index = queue
            .slots
            .iter()
            .position(|slot| slot.name == name)
            .ok_or_else(unavailable)?;
        let attempt = if let Some(attempt) = &queue.slots[index].flight {
            if !attempt.native {
                return Err(unavailable());
            }
            attempt.clone()
        } else {
            if queue
                .slots
                .iter()
                .filter(|slot| slot.flight.is_some())
                .count()
                >= self.capacity
            {
                return Err(unavailable());
            }
            let attempt = Arc::new(ActivationAttempt {
                deadline: deadline.min(Instant::now() + limits::OBJECT_REACTIVATION),
                native: true,
                done: Mutex::new(None),
                changed: Condvar::new(),
            });
            queue.slots[index].flight = Some(attempt.clone());
            let name = queue.slots[index].name;
            queue.pending.push_back((name, attempt.clone()));
            self.changed.notify_one();
            attempt
        };
        drop(queue);
        if matches!(
            attempt.wait(deadline.min(attempt.deadline)),
            Some(Err(ActivateError::Channel(
                super::Fault::UnsupportedSync
                    | super::Fault::Handshake(tmt_extension_objects::Refusal::UnsupportedVersion)
            )))
        ) {
            return Err(crate::error::RemoteError::new(
                "REMOTE_CONTROL_UNSUPPORTED",
                "Native sync carrier version is unsupported.",
            ));
        }
        let state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if !state.stopped
            && !self.stop.load(Ordering::Acquire)
            && let Some(reply) = state
                .slots
                .iter()
                .find(|slot| slot.name == name)
                .and_then(native_reply)
        {
            return Ok(reply);
        }
        Err(unavailable())
    }
}
struct ScopedReactivation<'a>(&'a Reactivation);
impl Drop for ScopedReactivation<'_> {
    fn drop(&mut self) {
        self.0.close();
    }
}
impl ObjectService<'_> {
    pub fn readiness(&self) -> super::ObjectReadiness {
        super::ObjectReadiness::live(Arc::clone(&self.state), self.budget.clone())
    }
    pub fn reactivation(&self, stop: Arc<AtomicBool>) -> Arc<Reactivation> {
        Reactivation::new(self, stop, Arc::new(Instant::now))
    }
    /// Mounts is captured by static HTTP workers and cannot hold this lease borrow.
    /// One scoped worker handles setup; closing the hook wakes it on every exit path.
    pub fn with_reactivation<T>(
        &self,
        hook: &Reactivation,
        mounts: &Mounts,
        serve: impl FnOnce() -> T,
    ) -> T {
        std::thread::scope(|scope| {
            let worker = std::thread::Builder::new()
                .name("remote-object-setup".into())
                .spawn_scoped(scope, || hook.run(self, mounts));
            if worker.is_err() {
                hook.disable();
            }
            let guard = ScopedReactivation(hook);
            let result = serve();
            drop(guard);
            if let Ok(worker) = worker {
                worker.join().expect("object setup worker panicked");
            }
            result
        })
    }
}
