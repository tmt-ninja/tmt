//! A task-owned private tmux server for opt-in real-tmux tests; every command
//! selects its own socket.
use super::*;
use crate::test_support::TestDirectory;
use std::path::Path;

pub(super) struct PrivateServer {
    directory: Option<TestDirectory>,
    pub(super) socket: String,
}

impl PrivateServer {
    /// A server socket named `name` inside the test's own directory, proven private first.
    pub(super) fn new(directory: TestDirectory, name: &str) -> Self {
        let socket = directory.path.join(name);
        crate::test_support::assert_private_socket(&socket, &directory.path);
        Self {
            socket: socket.to_str().unwrap().to_owned(),
            directory: Some(directory),
        }
    }

    pub(super) fn command(&self, args: &[&str]) -> Result<String, TmuxError> {
        // Every command, kill-server included, re-proves the socket before tmux runs.
        let root = &self.directory.as_ref().expect("fixture directory").path;
        crate::test_support::assert_private_socket(Path::new(&self.socket), root);
        let mut selected = socket_args(Some(&self.socket));
        selected.extend(args.iter().map(|arg| (*arg).into()));
        Tmux::default().execute(selected, OperationOptions::default(), TmuxFailure::Command)
    }
}

impl Drop for PrivateServer {
    fn drop(&mut self) {
        let _ = self.command(&["kill-server"]);
        let stopped = self.command(&["list-sessions"]);
        let absent = stopped.as_ref().err().is_some_and(|error| {
            !error.cleanup_failed()
                && error.cause.as_ref().is_some_and(|cause| {
                    matches!(
                        cause.kind,
                        CommandFailure::Exit {
                            code: Some(1),
                            signal: None
                        }
                    ) && cause.output.as_ref().is_some_and(|output| {
                        std::str::from_utf8(&output.stderr).is_ok_and(|text| {
                            text.starts_with("no server running on ")
                                || (text.starts_with("error connecting to ")
                                    && text.trim_end().ends_with("(No such file or directory)"))
                        })
                    })
                })
        });
        if !absent {
            // Retain the directory if cleanup cannot be confirmed.
            let directory = self.directory.take().unwrap();
            let path = directory.path.clone();
            std::mem::forget(directory);
            eprintln!("Private tmux cleanup unconfirmed: {}", path.display());
            if !std::thread::panicking() {
                panic!("private tmux server cleanup failed");
            }
        }
    }
}
