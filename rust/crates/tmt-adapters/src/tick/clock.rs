//! One foreground lifetime; scoped children finish before the lease is released.
use super::{JobPort, Lease, TickError, TickReport, TickWindow};
use crate::{
    config::ConfigPaths,
    interrupt::Interrupt,
    process::{CommandRequest, CommandRunner, UnixCommandRunner},
    storage::Storage,
};
use serde_json::{Value, json};
use std::{
    path::Path,
    time::{Duration, Instant},
};

fn now() -> u64 {
    crate::request_runtime::wall_time_ms()
}
fn component(
    executable: &Path,
    args: &[std::ffi::OsString],
    input: &[u8],
    deadline: Instant,
    interrupt: &Interrupt,
) -> Value {
    match UnixCommandRunner.execute_cancellable(
        CommandRequest {
            program: executable.as_os_str(),
            args,
            input,
            deadline,
            max_output_bytes: 1024 * 1024,
        },
        8192,
        &mut |_| {},
        interrupt,
    ) {
        Ok(output) => match serde_json::from_slice::<Value>(&output.stdout) {
            Ok(value) => json!({"state":"completed","result":value}),
            Err(_) if output.stdout.is_empty() => json!({"state":"completed"}),
            Err(_) => json!({"state":"failed","code":"TICK_PROTOCOL_INVALID"}),
        },
        Err(error) => {
            json!({"state":"failed","code":"TICK_COMPONENT_UNCONFIRMED","cleanupConfirmed":!error.cleanup_failed()})
        }
    }
}
fn merge(target: &mut TickReport, part: TickReport) {
    target.accepted += part.accepted;
    target.recovered += part.recovered;
    target.held += part.held;
    target.waiting += part.waiting;
    target.complete &= part.complete;
    target.omitted_failures += part.omitted_failures;
    for failure in part.failures {
        if target.failures.len() < 32 {
            target.failures.push(failure);
        } else {
            target.omitted_failures += 1;
        }
    }
}

/// `foreground` keeps only this lifetime's previous interval. A new invocation
/// never reconstructs absent-clock history. Emit one bounded report per minute.
pub fn run(
    paths: &ConfigPaths,
    executable: &Path,
    foreground: bool,
    mut emit: impl FnMut(Value) -> std::io::Result<()>,
) -> Result<bool, TickError> {
    let mut interrupt = Interrupt::install_termination()?;
    interrupt.defer_emergency_exit();
    let mut lease = Lease::acquire(
        &paths.global_dir,
        if foreground { "run" } else { "once" },
        now(),
    )?;
    let mut storage = Storage::open(&paths.database)?;
    let result = run_owned(
        &storage, &mut lease, executable, foreground, &interrupt, &mut emit,
    );
    // Both cleanups run even when work failed. Never report a stopped clock
    // while its private metadata or storage cleanup is unconfirmed.
    let closed = storage.close();
    let released = lease.release();
    match (result, closed, released) {
        (_, _, Err(error)) => Err(error),
        (_, Err(error), _) => Err(error.into()),
        (result, Ok(()), Ok(())) => result,
    }
}
fn run_owned(
    storage: &Storage,
    lease: &mut Lease,
    executable: &Path,
    foreground: bool,
    interrupt: &Interrupt,
    emit: &mut impl FnMut(Value) -> std::io::Result<()>,
) -> Result<bool, TickError> {
    let mut window = TickWindow::new(
        i64::try_from(now()).map_err(|_| TickError::Invalid)?,
        !foreground,
    );
    let digest_installed =
        crate::extension_command::resolve("digest", &std::env::var_os("PATH").unwrap_or_default())?
            .is_some();
    loop {
        if interrupt.is_interrupted() {
            return Ok(true);
        }
        lease.renew(now())?;
        let entered = now();
        let remaining = 60_000 - entered % 60_000;
        let boundary_ms = entered.checked_add(remaining).ok_or(TickError::Invalid)?;
        let boundary = Instant::now() + Duration::from_millis(remaining);
        window.begin_minute();
        let mut report = TickReport {
            complete: true,
            ..Default::default()
        };
        let mut capture = json!({"state":"not_started"});
        let digest_args = [
            "digest".into(),
            "tick".into(),
            "--component-lease".into(),
            lease.token().into(),
            "--component-until-ms".into(),
            boundary_ms.to_string().into(),
        ];
        let minute_result = std::thread::scope(|scope| {
            let digest = digest_installed.then(|| {
                scope.spawn(|| {
                    component(
                        executable,
                        &digest_args,
                        b"",
                        boundary + Duration::from_secs(15),
                        interrupt,
                    )
                })
            });
            let work = (|| {
                // This executable advertises workspace.capture; the child is
                // bounded and cancellable even when a host endpoint stalls.
                if !interrupt.is_interrupted() && Instant::now() < boundary && now() < boundary_ms {
                    capture = component(
                        executable,
                        &["api".into()],
                        br#"{"version":1,"operation":"workspace.capture","input":{}}"#,
                        (Instant::now() + Duration::from_secs(5))
                            .min(boundary + Duration::from_secs(5)),
                        interrupt,
                    );
                }
                let mut heartbeat = Instant::now();
                while !interrupt.is_interrupted()
                    && Instant::now() < boundary
                    && now() < boundary_ms
                {
                    if heartbeat.elapsed() >= Duration::from_secs(10) {
                        lease.renew(now())?;
                        heartbeat = Instant::now();
                    }
                    let mut port = JobPort {
                        storage,
                        lease,
                        interrupt,
                        runner: &UnixCommandRunner,
                        executable,
                        boundary,
                        boundary_ms,
                    };
                    merge(&mut report, window.pass(now(), &mut port)?);
                    lease.verify()?;
                    interrupt
                        .wait_until((Instant::now() + Duration::from_secs(1)).min(boundary))?;
                }
                Ok::<_, TickError>(())
            })();
            if work.is_err() {
                interrupt.cancel()?;
            }
            let digest = match digest {
                Some(child) => child.join().map_err(|_| TickError::Protocol)?,
                None => json!({"state":"not_installed"}),
            };
            work?;
            Ok::<_, TickError>(digest)
        });
        let digest = minute_result?;
        let complete =
            report.complete && digest["state"] != "failed" && capture["state"] != "failed";
        emit(
            json!({"schemaVersion":1,"startedAtMs":entered,"endedAtMs":now(),"jobs":report.document(),"digest":digest,"workspaceCapture":capture,"complete":complete,"stopped":interrupt.is_interrupted()}),
        )?;
        if !foreground || interrupt.is_interrupted() {
            return Ok(complete || interrupt.is_interrupted());
        }
    }
}
