//! Failure-only runner stall evidence for a readiness wait that timed out (#6313, #6329).
//!
//! On Linux it records the kernel's pressure-stall totals when the wait starts and when it fails,
//! and the state of this test's live descendants at the failure: whether a second-long stall on
//! the runner (I/O journal commit or CPU) overlapped the wait. Read-only `/proc` reads, bounded in
//! size and count; nothing is signalled. Other platforms record nothing.

/// The pressure totals sampled when a wait starts; compared with a second sample at failure.
pub(super) struct Sample(#[cfg(target_os = "linux")] [String; 2]);

pub(super) fn start() -> Sample {
    #[cfg(target_os = "linux")]
    {
        Sample(pressure())
    }
    #[cfg(not(target_os = "linux"))]
    {
        Sample()
    }
}

impl Sample {
    /// The evidence lines for a failed wait, or an empty string where `/proc` does not exist.
    pub(super) fn report(&self) -> String {
        #[cfg(target_os = "linux")]
        {
            let [io_start, cpu_start] = &self.0;
            let [io_end, cpu_end] = pressure();
            format!(
                "\nrunner io pressure at wait start: {io_start:?}\nrunner io pressure at failure: {io_end:?}\nrunner cpu pressure at wait start: {cpu_start:?}\nrunner cpu pressure at failure: {cpu_end:?}\ntest descendants (pid ppid state utime+stime comm wchan):{}",
                descendants()
            )
        }
        #[cfg(not(target_os = "linux"))]
        {
            String::new()
        }
    }
}

#[cfg(target_os = "linux")]
const MAX_DESCENDANTS: usize = 32;

#[cfg(target_os = "linux")]
fn bounded(path: &std::path::Path, limit: u64) -> String {
    use std::io::Read;
    let mut bytes = Vec::new();
    match std::fs::File::open(path).and_then(|file| file.take(limit).read_to_end(&mut bytes)) {
        Ok(_) => String::from_utf8_lossy(&bytes).trim_end().to_owned(),
        Err(error) => format!("unavailable: {error}"),
    }
}

#[cfg(target_os = "linux")]
fn pressure() -> [String; 2] {
    let proc = std::path::Path::new("/proc/pressure");
    [
        bounded(&proc.join("io"), 512),
        bounded(&proc.join("cpu"), 512),
    ]
}

/// `(ppid, state, utime + stime, comm)` from one `/proc/<pid>/stat`; the command name may hold
/// spaces and parentheses, so the fields are read after its last `)`.
#[cfg(target_os = "linux")]
fn stat(pid: u32) -> Option<(u32, char, u64, String)> {
    let text = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let open = text.find('(')?;
    let close = text.rfind(')')?;
    let comm = text.get(open + 1..close)?.to_owned();
    let fields: Vec<&str> = text.get(close + 2..)?.split(' ').collect();
    let state = fields.first()?.chars().next()?;
    let ppid = fields.get(1)?.parse().ok()?;
    let utime: u64 = fields.get(11)?.parse().ok()?;
    let stime: u64 = fields.get(12)?.parse().ok()?;
    Some((ppid, state, utime + stime, comm))
}

/// This test process's live descendants, breadth first, at most [`MAX_DESCENDANTS`].
#[cfg(target_os = "linux")]
fn descendants() -> String {
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return " unavailable".to_owned();
    };
    let rows: Vec<(u32, (u32, char, u64, String))> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().to_str()?.parse::<u32>().ok())
        .filter_map(|pid| Some((pid, stat(pid)?)))
        .collect();
    let mut parents = vec![std::process::id()];
    let mut lines = String::new();
    let mut shown = 0;
    while let Some(parent) = parents.pop() {
        for (pid, (ppid, state, ticks, comm)) in &rows {
            if *ppid != parent {
                continue;
            }
            if shown == MAX_DESCENDANTS {
                lines.push_str("\n  (more not shown)");
                return lines;
            }
            shown += 1;
            let wchan = bounded(std::path::Path::new(&format!("/proc/{pid}/wchan")), 64);
            lines.push_str(&format!(
                "\n  {pid} {ppid} {state} {ticks} {comm:?} {wchan:?}"
            ));
            parents.push(*pid);
        }
    }
    if lines.is_empty() {
        lines.push_str(" none");
    }
    lines
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    #[test]
    fn a_failed_wait_names_pressure_and_a_live_child_with_its_state() {
        let sample = super::start();
        let mut child = std::process::Command::new("sleep")
            .arg("5")
            .spawn()
            .unwrap();
        let pid = child.id();
        let report = sample.report();
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(
            report.contains("runner io pressure at failure: "),
            "{report}"
        );
        assert!(
            report.contains("runner cpu pressure at wait start: "),
            "{report}"
        );
        let row = report
            .lines()
            .find(|line| {
                line.trim_start()
                    .starts_with(&format!("{pid} {} ", std::process::id()))
            })
            .unwrap_or_else(|| panic!("no row for the child {pid}: {report}"));
        assert!(row.contains("\"sleep\""), "{row}");
    }
}
