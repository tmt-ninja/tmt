//! The dedicated API session holds Core's staged result until Keep or Close.

use super::{Completed, Task};
use crate::{
    board::BoardEvent,
    core::{Core, SquadError},
};
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
    mpsc::{Sender, channel},
};

/// Only this worker owns the request pipe between Run and Keep.
pub(in crate::board) struct Worker {
    requests: Sender<Task>,
    stopped: Arc<AtomicBool>,
}

impl Worker {
    pub(in crate::board) fn spawn(core: Core, events: Sender<BoardEvent>) -> Self {
        let (requests, queue) = channel();
        let stopped = Arc::new(AtomicBool::new(false));
        let cancellation = stopped.clone();
        std::thread::spawn(move || {
            let mut session = None;
            for task in queue {
                let completed = match task {
                    Task::Run(input) => {
                        drop(session.take());
                        let outcome =
                            core.standalone_session(&cancellation)
                                .and_then(|mut opened| {
                                    let response = opened.run(input, &cancellation);
                                    if response.is_ok() {
                                        session = Some(opened);
                                    }
                                    response
                                });
                        Completed::Run(outcome)
                    }
                    Task::Keep(run_id) => {
                        let outcome = session
                            .as_mut()
                            .ok_or_else(|| {
                                SquadError::new("API_UNAVAILABLE", "The result session has closed.")
                            })
                            .and_then(|opened| opened.keep(&run_id));
                        if outcome.is_ok() {
                            drop(session.take());
                        }
                        Completed::Keep(outcome)
                    }
                    Task::Discard => {
                        drop(session.take());
                        continue;
                    }
                    Task::Target(_) | Task::Saved(_) | Task::Stop => {
                        unreachable!("not a session request")
                    }
                };
                if events.send(BoardEvent::Standalone(completed)).is_err() {
                    break;
                }
            }
        });
        Self { requests, stopped }
    }

    pub(in crate::board) fn submit(&self, task: Task) {
        match task {
            Task::Stop => self.stopped.store(true, Ordering::Release),
            task => {
                if matches!(task, Task::Run(_)) {
                    self.stopped.store(false, Ordering::Release);
                }
                let _ = self.requests.send(task);
            }
        }
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.stopped.store(true, Ordering::Release);
    }
}
