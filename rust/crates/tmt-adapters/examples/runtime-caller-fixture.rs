//! Deterministic process-shape fixture, not a provider or a delivery adapter.
//! The Docker image copies this executable as `codex` so real ps observations
//! exercise the shared/independent runtime boundary without credentials or AI.
//! Native test support also uses its neutral modes to remove runtime ancestry.

use std::io::{self, Read, Write};
use std::os::unix::{net::UnixStream, process::CommandExt, process::ExitStatusExt};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use nix::unistd::getppid;

fn main() {
    let mut args = std::env::args_os().skip(1);
    let mode = args.next().expect("fixture mode");
    #[cfg(target_os = "linux")]
    if mode == "neutral-stop-residents" {
        if let Err(error) = stop_residents(args) {
            eprintln!("Nested CLI process cleanup: {error}");
            std::process::exit(1);
        }
        return;
    }
    if mode == "neutral-setup" {
        let result = Command::new(std::env::current_exe().expect("fixture executable"))
            .arg("neutral-supervise")
            .arg(std::process::id().to_string())
            .args(args)
            .spawn();
        if let Err(error) = result {
            eprintln!("Start neutral supervisor: {error}");
            std::process::exit(1);
        }
        // The supervisor retains stdout/stderr in this owned launcher group.
        // Exiting removes the runtime ancestor before any selected CLI starts.
        return;
    }
    if mode == "neutral-supervise" {
        let parent = args.next().expect("setup PID");
        let socket = args.next().expect("control socket");
        let mut control = UnixStream::connect(&socket).expect("connect supervisor control");
        let result: io::Result<()> = (|| {
            let parent = parent
                .to_string_lossy()
                .parse::<i32>()
                .map_err(io::Error::other)?;
            let deadline = Instant::now() + Duration::from_secs(1);
            while getppid().as_raw() == parent {
                if Instant::now() >= deadline {
                    return Err(io::Error::other("Neutral parent was not adopted."));
                }
                std::thread::sleep(Duration::from_millis(1));
            }
            if getppid().as_raw() != 1 {
                return Err(io::Error::other(
                    "Neutral parent requires adoption by PID 1.",
                ));
            }
            let status = Command::new(std::env::current_exe()?)
                .arg("neutral-execute")
                .arg(socket)
                .args(args)
                .stdin(Stdio::null())
                .process_group(0)
                .status()?;
            let signal = status
                .signal()
                .map(nix::sys::signal::Signal::try_from)
                .transpose()
                .map_err(io::Error::other)?
                .map(|signal| format!("{signal:?}"));
            report(
                &mut control,
                serde_json::json!({"status": status.code(), "signal": signal}),
            )
        })();
        if let Err(error) = result {
            report_error(&mut control, &error);
        }
        return;
    }
    if mode == "neutral-execute" {
        let socket = args.next().expect("control socket");
        let input = args.next().expect("input mode");
        let executable = args.next().expect("selected executable");
        let mut control = UnixStream::connect(socket).expect("connect bootstrap control");
        let result: io::Result<()> = (|| {
            report(
                &mut control,
                serde_json::json!({"group": std::process::id()}),
            )?;
            acknowledge(&mut control)?;
            let stdin = if input == "input" {
                Stdio::from(std::os::fd::OwnedFd::from(control.try_clone()?))
            } else if input == "ignore" {
                Stdio::null()
            } else {
                return Err(io::Error::other("Invalid neutral-parent input mode."));
            };
            // Rust-owned Unix streams are close-on-exec. Only the input clone
            // mapped to fd 0 survives, after the exact acknowledgement is read.
            Err(Command::new(executable).args(args).stdin(stdin).exec())
        })();
        if let Err(error) = result {
            report_error(&mut control, &error);
        }
        return;
    }
    assert!(mode == "app-server" || mode == "--no-daemon" || mode == "orphan");
    let command = args.next().expect("selected CLI executable");
    let mut child = std::process::Command::new(command);
    child
        .args(args)
        .env("CODEX_THREAD_ID", "11111111-1111-4111-8111-111111111111");
    if mode == "orphan" {
        // Preserve the leaked marker but leave no Codex process ancestor.
        panic!("exec fixture: {}", child.exec());
    }
    let status = child.status().expect("start selected CLI");
    std::process::exit(status.code().unwrap_or(1));
}

#[cfg(target_os = "linux")]
fn stop_residents(mut args: impl Iterator<Item = std::ffi::OsString>) -> io::Result<()> {
    use rustix::{
        event::{PollFd, PollFlags, Timespec, poll},
        io::Errno,
        process::{Pid, PidfdFlags, Signal, geteuid, pidfd_open, pidfd_send_signal},
    };
    use std::{fs, os::unix::fs::MetadataExt, path::PathBuf};

    let input_error = || io::Error::new(io::ErrorKind::InvalidInput, "Invalid cleanup request.");
    let mut next = || args.next().ok_or_else(input_error);
    let root = PathBuf::from(next()?);
    let session = next()?.into_string().map_err(|_| input_error())?;
    let budget: u64 = next()?
        .to_string_lossy()
        .parse()
        .map_err(|_| input_error())?;
    if !root.is_absolute() || budget == 0 || budget > 1000 {
        return Err(input_error());
    }
    let deadline = Instant::now() + Duration::from_millis(budget);
    let mut targets = Vec::new();
    for candidate in args {
        let text = candidate.to_str().ok_or_else(input_error)?;
        let (pid, start) = text.split_once(':').ok_or_else(input_error)?;
        let pid = pid
            .parse()
            .ok()
            .and_then(Pid::from_raw)
            .filter(|pid| pid.as_raw_nonzero().get() > 1)
            .ok_or_else(input_error)?;
        let fd = match pidfd_open(pid, PidfdFlags::empty()) {
            Ok(fd) => fd,
            Err(Errno::SRCH) => continue,
            Err(error) => return Err(error.into()),
        };
        let proc = PathBuf::from(format!("/proc/{}", pid.as_raw_nonzero()));
        let verify = || {
            let stat = fs::read_to_string(proc.join("stat"))?;
            let (_, fields) = stat.rsplit_once(") ").ok_or_else(input_error)?;
            let fields = fields.split_whitespace().collect::<Vec<_>>();
            let matches = fields.get(3) == Some(&session.as_str())
                && fields.get(19) == Some(&start)
                && fs::metadata(&proc)?.uid() == geteuid().as_raw()
                && fs::read_link(proc.join("cwd"))?.starts_with(&root);
            Ok::<_, io::Error>(matches)
        };
        match verify() {
            Ok(true) => targets.push(fd),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let mut probe = [PollFd::new(&fd, PollFlags::IN)];
                let zero = Timespec {
                    tv_sec: 0,
                    tv_nsec: 0,
                };
                poll(&mut probe, Some(&zero))?;
                if !probe[0]
                    .revents()
                    .intersects(PollFlags::IN | PollFlags::HUP)
                {
                    return Err(error);
                }
            }
            Ok(false) => return Err(io::Error::other("Resident identity no longer matches.")),
            Err(error) => return Err(error),
        }
    }
    for target in &targets {
        match pidfd_send_signal(target, Signal::KILL) {
            Ok(()) | Err(Errno::SRCH) => {}
            Err(error) => return Err(error.into()),
        }
    }
    for target in &targets {
        let mut fd = [PollFd::new(target, PollFlags::IN)];
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(io::Error::new(
                    io::ErrorKind::TimedOut,
                    "Resident is still live.",
                ));
            }
            let timeout = Timespec {
                tv_sec: 0,
                tv_nsec: i64::try_from(remaining.as_nanos().min(999_999_999))
                    .expect("bounded nanoseconds"),
            };
            match poll(&mut fd, Some(&timeout)) {
                Ok(_) if fd[0].revents().intersects(PollFlags::IN | PollFlags::HUP) => break,
                Ok(_) | Err(Errno::INTR) => {}
                Err(error) => return Err(error.into()),
            }
        }
    }
    Ok(())
}

fn report(control: &mut UnixStream, value: serde_json::Value) -> io::Result<()> {
    let mut bytes = serde_json::to_vec(&value)?;
    bytes.push(b'\n');
    control.write_all(&bytes)
}

fn report_error(control: &mut UnixStream, error: &io::Error) {
    let code = error
        .raw_os_error()
        .map(nix::errno::Errno::from_raw)
        .map(|errno| format!("{errno:?}"))
        .unwrap_or_else(|| "NEUTRAL_PARENT_FAILED".into());
    let _ = report(
        control,
        serde_json::json!({"error": {"message": error.to_string(), "code": code}}),
    );
    std::process::exit(1);
}

fn acknowledge(control: &mut UnixStream) -> io::Result<()> {
    // The harness execution deadline owns this wait and can stop the whole
    // group. Socket options on a peer-closed macOS Unix stream can fail even
    // when the complete acknowledgement and input are already buffered.
    let mut acknowledgement = [0; 6];
    control.read_exact(&mut acknowledgement)?;
    if &acknowledgement != b"ready\n" {
        return Err(io::Error::other("Invalid CLI group acknowledgement."));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acknowledgement_leaves_the_input_bytes_untouched() {
        let (mut reader, mut writer) = UnixStream::pair().unwrap();
        writer.write_all(b"ready\ninput\0bytes").unwrap();
        drop(writer);
        acknowledge(&mut reader).unwrap();
        let mut input = Vec::new();
        reader.read_to_end(&mut input).unwrap();
        assert_eq!(input, b"input\0bytes");
    }

    #[test]
    fn acknowledgement_refuses_invalid_and_incomplete_protocol() {
        for bytes in [b"wrong\n".as_slice(), b"ready"] {
            let (mut reader, mut writer) = UnixStream::pair().unwrap();
            writer.write_all(bytes).unwrap();
            drop(writer);
            assert!(acknowledge(&mut reader).is_err());
        }
    }
}
