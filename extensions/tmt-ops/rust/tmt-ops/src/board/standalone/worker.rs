//! The dedicated API session holds Core's staged result until Keep or Close.

use super::{Completed, Task};
use crate::{
    board::BoardEvent,
    core::{Core, SquadError},
};
use std::{
    cell::RefCell,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{Sender, channel},
    },
};

enum SessionTask {
    Run {
        input: serde_json::Value,
        stopped: Arc<AtomicBool>,
    },
    Keep(String),
    Discard,
}

/// Only this worker owns the request pipe between Run and Keep.
pub(in crate::board) struct Worker {
    requests: Sender<SessionTask>,
    latest_run: RefCell<Option<Arc<AtomicBool>>>,
}

impl Worker {
    pub(in crate::board) fn spawn(core: Core, events: Sender<BoardEvent>) -> Self {
        let (requests, queue) = channel();
        std::thread::spawn(move || {
            let mut session = None;
            for task in queue {
                let completed = match task {
                    SessionTask::Run { input, stopped } => {
                        drop(session.take());
                        let outcome = core.standalone_session(&stopped).and_then(|mut opened| {
                            let response = opened.run(input, &stopped);
                            if response.is_ok() {
                                session = Some(opened);
                            }
                            response
                        });
                        Completed::Run(outcome)
                    }
                    SessionTask::Keep(run_id) => {
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
                    SessionTask::Discard => {
                        drop(session.take());
                        continue;
                    }
                };
                if events.send(BoardEvent::Standalone(completed)).is_err() {
                    break;
                }
            }
        });
        Self {
            requests,
            latest_run: RefCell::new(None),
        }
    }

    pub(in crate::board) fn submit(&self, task: Task) {
        let request = match task {
            Task::Run(input) => {
                let stopped = Arc::new(AtomicBool::new(false));
                // A queued invocation keeps its flag when the next Run is submitted.
                self.latest_run.replace(Some(stopped.clone()));
                SessionTask::Run { input, stopped }
            }
            Task::Keep(run_id) => SessionTask::Keep(run_id),
            Task::Discard => SessionTask::Discard,
            Task::Stop => {
                self.stop();
                return;
            }
            Task::Target(_) | Task::Saved(_) => unreachable!("not a session request"),
        };
        let _ = self.requests.send(request);
    }

    fn stop(&self) {
        if let Some(stopped) = self.latest_run.borrow().as_ref() {
            stopped.store(true, Ordering::Release);
        }
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn stopping_a_run_does_not_cancel_or_get_reset_by_the_next_run() {
        let (requests, queue) = channel();
        let worker = Worker {
            requests,
            latest_run: RefCell::new(None),
        };

        worker.submit(Task::Run(json!({"command": "first"})));
        let SessionTask::Run { stopped: first, .. } = queue.try_recv().unwrap() else {
            panic!("expected the first Run");
        };

        worker.submit(Task::Stop);
        assert!(first.load(Ordering::Acquire));

        worker.submit(Task::Run(json!({"command": "second"})));
        let SessionTask::Run {
            stopped: second, ..
        } = queue.try_recv().unwrap()
        else {
            panic!("expected the second Run");
        };
        assert!(
            first.load(Ordering::Acquire),
            "the first Run loses its Stop"
        );
        assert!(
            !second.load(Ordering::Acquire),
            "the second Run inherits Stop"
        );

        worker.submit(Task::Stop);
        assert!(second.load(Ordering::Acquire));
    }
}
