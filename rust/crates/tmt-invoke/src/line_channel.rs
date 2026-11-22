//! Ordered newline frames over one owned child. Protocol admission belongs to callers.

use crate::{FailureKind, InvokeError, LaunchOptions, Output, Phase, Stream, process};
use nix::{
    errno::Errno,
    fcntl::{FcntlArg, FdFlag, OFlag, fcntl},
    poll::{PollFd, PollFlags, PollTimeout, poll},
};
use std::{
    ffi::OsString,
    fs::File,
    io::{self, Read, Write},
    os::fd::AsFd,
    path::Path,
    time::{Duration, Instant},
};

const LIFELINE_GRACE: Duration = Duration::from_secs(2);
type ResponseFrame<'a> = dyn FnMut(&[u8]) -> io::Result<bool> + 'a;

enum ExchangeMode {
    Ordinary,
    Lifeline,
    DrainOnStop(Option<Instant>),
}

pub struct LineChannelOptions<'a> {
    pub program: &'a Path,
    pub args: &'a [OsString],
    pub deadline: Instant,
    /// Payload bound excluding the newline; stderr has the same cumulative bound.
    pub max_frame_bytes: usize,
    pub launch: LaunchOptions<'a>,
}

/// No idle thread or timer. Each exchange writes one frame and reads one frame.
/// A failed started exchange closes the channel; it never resubmits a request.
pub struct LineChannel {
    child: Option<process::Child>,
    stdin: Option<File>,
    stdout: Option<File>,
    stderr: Option<File>,
    stderr_bytes: Vec<u8>,
    pending: Vec<u8>,
    limit: usize,
    check_before_request: bool,
}

fn io_failure(cause: io::Error) -> InvokeError {
    process::failure(FailureKind::Io(Phase::Communicate), Some(cause))
}

fn unexpected_response() -> InvokeError {
    io_failure(io::Error::new(
        io::ErrorKind::InvalidData,
        "unexpected output outside the response frame",
    ))
}

fn nonblocking(file: &File) -> io::Result<()> {
    let flags = fcntl(file, FcntlArg::F_GETFL).map_err(io::Error::from)?;
    fcntl(
        file,
        FcntlArg::F_SETFL(OFlag::from_bits_truncate(flags) | OFlag::O_NONBLOCK),
    )
    .map_err(io::Error::from)?;
    Ok(())
}

impl LineChannel {
    pub fn start(
        options: LineChannelOptions<'_>,
        stopped: impl Fn() -> bool,
    ) -> Result<Self, InvokeError> {
        process::budget(options.deadline, stopped())?;
        let mut child = process::start(options.program, options.args, &options.launch, None)?;
        let pipes = (|| {
            let take = |pipe: Option<File>| {
                pipe.ok_or_else(|| io::Error::other("child did not expose its pipe"))
            };
            let stdin = take(child.job.stdin.take())?;
            let stdout = take(child.job.stdout.take())?;
            let stderr = take(child.job.stderr.take())?;
            for pipe in [&stdin, &stdout, &stderr] {
                nonblocking(pipe)?;
                let flags = fcntl(pipe, FcntlArg::F_GETFD).map_err(io::Error::from)?;
                fcntl(
                    pipe,
                    FcntlArg::F_SETFD(FdFlag::from_bits_truncate(flags) | FdFlag::FD_CLOEXEC),
                )
                .map_err(io::Error::from)?;
            }
            Ok::<_, io::Error>((stdin, stdout, stderr))
        })();
        let (stdin, stdout, stderr) = match pipes {
            Ok(pipes) => pipes,
            Err(cause) => {
                let mut error = process::failure(FailureKind::Io(Phase::OpenPipes), Some(cause));
                error.cleanup = child.cleanup();
                child.finished = true;
                return Err(error);
            }
        };
        Ok(Self {
            child: Some(child),
            stdin: Some(stdin),
            stdout: Some(stdout),
            stderr: Some(stderr),
            stderr_bytes: Vec::new(),
            pending: Vec::new(),
            limit: options.max_frame_bytes,
            check_before_request: false,
        })
    }

    /// Rejects invalid local frames before touching the channel. After I/O starts,
    /// cancellation or failure can leave effects uncertain and always ends it.
    pub fn exchange(
        &mut self,
        payload: &[u8],
        deadline: Instant,
        stopped: impl Fn() -> bool,
    ) -> Result<Vec<u8>, InvokeError> {
        self.exchange_inner(
            payload,
            deadline,
            stopped,
            ExchangeMode::Ordinary,
            || {},
            None,
        )
    }

    /// A lifeline request gives its child time to clean up after the pipe closes.
    pub fn exchange_lifeline(
        &mut self,
        payload: &[u8],
        deadline: Instant,
        stopped: impl Fn() -> bool,
        before_cleanup: impl FnOnce(),
    ) -> Result<Vec<u8>, InvokeError> {
        self.exchange_inner(
            payload,
            deadline,
            stopped,
            ExchangeMode::Lifeline,
            before_cleanup,
            None,
        )
    }

    /// After Stop on a submitted request, close input and retain the response
    /// only if the child publishes one complete frame and exits cleanly within
    /// the lifeline grace. The channel is closed after a drain.
    pub fn exchange_lifeline_drain(
        &mut self,
        payload: &[u8],
        deadline: Instant,
        stopped: impl Fn() -> bool,
    ) -> Result<Vec<u8>, InvokeError> {
        self.exchange_inner(
            payload,
            deadline,
            stopped,
            ExchangeMode::DrainOnStop(None),
            || {},
            None,
        )
    }

    /// Send once, accepting progress until the callback identifies the final
    /// frame. Stop closes stdin and requires the final frame and a clean exit.
    pub fn exchange_lifeline_frames(
        &mut self,
        payload: &[u8],
        deadline: Instant,
        stopped: impl Fn() -> bool,
        mut frame: impl FnMut(&[u8]) -> io::Result<bool>,
    ) -> Result<Vec<u8>, InvokeError> {
        self.exchange_inner(
            payload,
            deadline,
            stopped,
            ExchangeMode::DrainOnStop(None),
            || {},
            Some(&mut frame),
        )
    }

    fn exchange_inner(
        &mut self,
        payload: &[u8],
        deadline: Instant,
        stopped: impl Fn() -> bool,
        mut mode: ExchangeMode,
        before_cleanup: impl FnOnce(),
        response: Option<&mut ResponseFrame<'_>>,
    ) -> Result<Vec<u8>, InvokeError> {
        process::budget(deadline, stopped())?;
        if !self.pending.is_empty() {
            return Err(io_failure(io::Error::new(
                io::ErrorKind::InvalidInput,
                "read pending stream frames before sending a request",
            )));
        }
        if payload.len() > self.limit || payload.contains(&b'\n') {
            return Err(io_failure(io::Error::new(
                io::ErrorKind::InvalidInput,
                "one bounded newline-free frame is required",
            )));
        }
        if self.child.is_none() {
            return Err(io_failure(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "channel is closed",
            )));
        }
        let framed = response.is_some();
        let ready = if std::mem::take(&mut self.check_before_request) {
            self.reject_unexpected_output()
        } else {
            Ok(())
        };
        let result = ready.and_then(|()| {
            self.communicate(Some(payload), deadline, &stopped, &mut mode, response)
        });
        if let ExchangeMode::DrainOnStop(Some(drain_deadline)) = mode
            && let Ok(frame) = result
        {
            before_cleanup();
            let output = self.close_inner(drain_deadline, || false)?;
            if output.status.success() && output.stdout.is_empty() {
                return Ok(frame);
            }
            return Err(io_failure(io::Error::new(
                io::ErrorKind::InvalidData,
                "lifeline child did not finish with one response and a clean exit",
            )));
        }
        if let Err(mut error) = result {
            before_cleanup();
            self.stdin.take();
            self.stdout.take();
            self.stderr.take();
            let mut child = self.child.take().expect("exchange owns a child");
            if matches!(
                mode,
                ExchangeMode::Lifeline | ExchangeMode::DrainOnStop(None)
            ) {
                let _ = child.terminate_owned();
                if matches!(child.job.wait_timeout(LIFELINE_GRACE), Ok(Some(_))) {
                    child.finished = true;
                    error.cleanup = crate::Cleanup::Confirmed;
                    return Err(error);
                }
            }
            error.cleanup = child.cleanup();
            child.finished = true;
            return Err(error);
        }
        self.check_before_request = framed;
        result
    }

    fn communicate(
        &mut self,
        payload: Option<&[u8]>,
        deadline: Instant,
        stopped: &impl Fn() -> bool,
        mode: &mut ExchangeMode,
        mut response: Option<&mut ResponseFrame<'_>>,
    ) -> Result<Vec<u8>, InvokeError> {
        let streaming = payload.is_none();
        let mut input = payload.unwrap_or_default().to_vec();
        if !streaming {
            input.push(b'\n');
        }
        let mut written = 0;
        let mut output = Vec::new();
        if streaming && !self.pending.is_empty() {
            if let Some(end) = self.pending.iter().position(|byte| *byte == b'\n') {
                if end > self.limit {
                    return Err(process::failure(
                        FailureKind::OutputLimit(Stream::Stdout),
                        None,
                    ));
                }
                let frame = self.pending.drain(..=end).collect::<Vec<_>>();
                return Ok(frame[..end].to_vec());
            }
            output = std::mem::take(&mut self.pending);
            if output.len() > self.limit {
                return Err(process::failure(
                    FailureKind::OutputLimit(Stream::Stdout),
                    None,
                ));
            }
        }
        loop {
            let stop = stopped();
            if let ExchangeMode::DrainOnStop(drain @ None) = mode
                && stop
                && written == input.len()
            {
                *drain = Some(Instant::now() + LIFELINE_GRACE);
                self.stdin.take();
            }
            let left = match mode {
                ExchangeMode::DrainOnStop(Some(until)) => process::budget(*until, false),
                _ => process::budget(deadline, stop),
            }?
            .min(process::PULSE);
            let (readable, error_ready, writable) = {
                let stdout = self.stdout.as_ref().expect("open output");
                let mut fds = vec![PollFd::new(stdout.as_fd(), PollFlags::POLLIN)];
                let error_index = self.stderr.as_ref().map(|stderr| {
                    let index = fds.len();
                    fds.push(PollFd::new(stderr.as_fd(), PollFlags::POLLIN));
                    index
                });
                let input_index = (written < input.len()).then(|| {
                    let index = fds.len();
                    fds.push(PollFd::new(
                        self.stdin.as_ref().expect("open input").as_fd(),
                        PollFlags::POLLOUT,
                    ));
                    index
                });
                let timeout = PollTimeout::try_from(left).expect("pulse fits poll timeout");
                match poll(&mut fds, timeout) {
                    Ok(_) => {}
                    Err(Errno::EINTR) => continue,
                    Err(cause) => return Err(io_failure(cause.into())),
                }
                let ready =
                    |index: usize| fds[index].revents().is_some_and(|flags| !flags.is_empty());
                (
                    ready(0),
                    error_index.is_some_and(ready),
                    input_index.is_some_and(ready),
                )
            };
            if error_ready {
                let mut bytes = [0; 8192];
                match self.stderr.as_mut().expect("open stderr").read(&mut bytes) {
                    Ok(0) => {
                        self.stderr.take();
                    }
                    Ok(read) => {
                        if read > self.limit.saturating_sub(self.stderr_bytes.len()) {
                            return Err(process::failure(
                                FailureKind::OutputLimit(Stream::Stderr),
                                None,
                            ));
                        }
                        self.stderr_bytes.extend_from_slice(&bytes[..read]);
                    }
                    Err(error)
                        if matches!(
                            error.kind(),
                            io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                        ) => {}
                    Err(error) => return Err(io_failure(error)),
                }
            }
            if writable {
                match self
                    .stdin
                    .as_mut()
                    .expect("open input")
                    .write(&input[written..])
                {
                    Ok(0) => return Err(io_failure(io::ErrorKind::WriteZero.into())),
                    Ok(count) => written += count,
                    Err(error)
                        if matches!(
                            error.kind(),
                            io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                        ) => {}
                    Err(error) => return Err(io_failure(error)),
                }
            }
            if readable {
                let mut bytes = [0; 8192];
                match self.stdout.as_mut().expect("open output").read(&mut bytes) {
                    Ok(0) => return Err(io_failure(io::ErrorKind::UnexpectedEof.into())),
                    Ok(count) => {
                        if let Some(response) = response.as_deref_mut() {
                            let mut frames = bytes[..count]
                                .split_inclusive(|byte| *byte == b'\n')
                                .peekable();
                            while let Some(part) = frames.next() {
                                let body = part.strip_suffix(b"\n").unwrap_or(part);
                                if body.len() > self.limit.saturating_sub(output.len()) {
                                    return Err(process::failure(
                                        FailureKind::OutputLimit(Stream::Stdout),
                                        None,
                                    ));
                                }
                                output.extend_from_slice(body);
                                if body.len() == part.len() {
                                    break;
                                }
                                if written != input.len() {
                                    return Err(unexpected_response());
                                }
                                if response(&output).map_err(io_failure)? {
                                    if frames.peek().is_some() {
                                        return Err(unexpected_response());
                                    }
                                    self.reject_unexpected_output()?;
                                    return Ok(output);
                                }
                                output.clear();
                            }
                            continue;
                        }
                        let frame = &bytes[..count];
                        let newline = frame.iter().position(|byte| *byte == b'\n');
                        let payload = newline.map_or(frame, |end| &frame[..end]);
                        if payload.len() > self.limit.saturating_sub(output.len()) {
                            return Err(process::failure(
                                FailureKind::OutputLimit(Stream::Stdout),
                                None,
                            ));
                        }
                        output.extend_from_slice(payload);
                        if let Some(end) = newline {
                            if written != input.len() || !streaming && end + 1 != count {
                                return Err(unexpected_response());
                            }
                            if streaming {
                                self.pending.extend_from_slice(&frame[end + 1..]);
                            }
                            return Ok(output);
                        }
                    }
                    Err(error)
                        if matches!(
                            error.kind(),
                            io::ErrorKind::WouldBlock | io::ErrorKind::Interrupted
                        ) => {}
                    Err(error) => return Err(io_failure(error)),
                }
            }
        }
    }

    fn reject_unexpected_output(&mut self) -> Result<(), InvokeError> {
        let mut byte = [0];
        loop {
            match self.stdout.as_mut().expect("open output").read(&mut byte) {
                Ok(0) => return Ok(()),
                Ok(_) => return Err(unexpected_response()),
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => return Ok(()),
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) => return Err(io_failure(error)),
            }
        }
    }

    /// Read one bounded unsolicited newline frame without writing stdin.
    /// Unlike a request exchange, a stream failure leaves shutdown to its owner,
    /// which can terminate a supervising child gracefully before forced cleanup.
    pub fn receive(
        &mut self,
        deadline: Instant,
        stopped: impl Fn() -> bool,
    ) -> Result<Vec<u8>, InvokeError> {
        process::budget(deadline, stopped())?;
        if self.child.is_none() {
            return Err(io_failure(io::ErrorKind::BrokenPipe.into()));
        }
        self.communicate(None, deadline, &stopped, &mut ExchangeMode::Ordinary, None)
    }

    /// Signal only this channel's owned group, then drain/reap within the caller's
    /// existing cleanup allowance. Failure falls through the same forced owner.
    pub fn terminate(mut self, deadline: Instant) -> Result<Output, InvokeError> {
        let signal = self
            .child
            .as_ref()
            .map(|child| child.terminate_owned())
            .transpose();
        let result = self.close_inner(deadline, || false);
        match result {
            Ok(output) => Ok(output), // A child already gone also confirms shutdown.
            Err(mut error) => {
                if error.cause.is_none()
                    && let Err(cause) = signal
                {
                    error.cause = Some(cause);
                }
                Err(error)
            }
        }
    }

    /// PID of the still-owned child, before close or failed exchange reaps it.
    pub fn pid(&self) -> Option<u32> {
        self.child.as_ref().map(|child| child.job.pid())
    }

    pub fn stderr(&self) -> &[u8] {
        &self.stderr_bytes
    }

    /// Close input and drain/reap within the supplied budget. Nonzero exits are
    /// data; a started cleanup failure retains the ordinary invocation evidence.
    pub fn close(
        mut self,
        deadline: Instant,
        stopped: impl Fn() -> bool,
    ) -> Result<Output, InvokeError> {
        self.close_inner(deadline, stopped)
    }

    fn close_inner(
        &mut self,
        deadline: Instant,
        stopped: impl Fn() -> bool,
    ) -> Result<Output, InvokeError> {
        self.stdin.take();
        let Some(mut child) = self.child.take() else {
            return Err(io_failure(io::Error::new(
                io::ErrorKind::BrokenPipe,
                "channel is closed",
            )));
        };
        child.job.stdout = self.stdout.take();
        child.job.stderr = self.stderr.take();
        let result = process::observe_with_stop(
            &mut child.job,
            deadline,
            self.limit.saturating_sub(self.stderr_bytes.len()),
            stopped,
        );
        let result = match result {
            Ok(mut output) => {
                self.stderr_bytes.append(&mut output.stderr);
                output.stderr = std::mem::take(&mut self.stderr_bytes);
                Ok(output)
            }
            Err(mut error) => {
                error.cleanup = child.cleanup();
                Err(error)
            }
        };
        child.finished = true;
        result
    }
}

impl Drop for LineChannel {
    fn drop(&mut self) {
        if self.child.is_some() {
            let _ = self.close_inner(Instant::now() + process::CLEANUP, || false);
        }
    }
}

#[cfg(test)]
#[path = "line_channel_tests.rs"]
mod tests;
