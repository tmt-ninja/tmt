//! Shared native installation/upgrade observations mapped to the CLI style component.
use std::{
    sync::{Arc, Mutex, PoisonError, mpsc},
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tmt_adapters::native_install::{Product, ProgressEvent};
use tmt_cli_style::{
    Interaction,
    progress::{Progress, SPINNER, SPINNER_TICK, State, Step, StepProgress, Transfer},
};

fn product_label(product: Product) -> &'static str {
    if product == Product::Cli {
        "tmt"
    } else {
        product.as_str()
    }
}

pub(crate) struct InstallProgress {
    view: Arc<Mutex<View>>,
    product: Product,
    action: &'static str,
    started: Instant,
    step: Step,
    transfer: Option<Transfer>,
    /// Only a live, colored terminal animates; pipes, `--json`, dumb terminals and
    /// `NO_COLOR` keep the still mark and their exact bytes.
    animate: bool,
    ticker: Option<Ticker>,
}

/// What both the observing thread and the spinner ticker draw, one at a time.
struct View {
    progress: Progress,
    enabled: bool,
    output_failed: bool,
    last_draw: Option<Instant>,
    /// When the spinner started turning; frames count from here.
    since: Instant,
    frame: Option<usize>,
}

impl View {
    fn draw(&mut self) {
        if self.output_failed || !self.enabled {
            return;
        }
        let mut output = tmt_cli_style::stream::stdout(false);
        let terminal = output.terminal();
        self.output_failed = self.progress.write(&mut output, terminal).is_err();
        self.last_draw = Some(Instant::now());
    }

    /// Turns the running mark to the frame `now` selects and redraws when it moved.
    /// Nothing turns once no step runs.
    fn tick(&mut self, now: Instant) -> bool {
        if !self.progress.running() {
            return false;
        }
        let frame = (now.saturating_duration_since(self.since).as_millis()
            / SPINNER_TICK.as_millis()) as usize
            % SPINNER.len();
        if self.frame == Some(frame) {
            return false;
        }
        self.frame = Some(frame);
        self.progress.frame(frame);
        self.draw();
        true
    }
}

fn lock(view: &Mutex<View>) -> std::sync::MutexGuard<'_, View> {
    view.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Redraws the spinner every tick between events. It lives only while a step may run and
/// is joined when the view settles, fails or is dropped.
struct Ticker {
    stop: mpsc::Sender<()>,
    thread: JoinHandle<()>,
}

impl Ticker {
    fn start(view: Arc<Mutex<View>>, tick: Duration) -> Option<Self> {
        let (stop, stopped) = mpsc::channel::<()>();
        lock(&view).since = Instant::now();
        let thread = std::thread::Builder::new()
            .name("tmt-progress-spinner".into())
            .spawn(move || {
                // A message or a dropped sender both end the wait at once.
                while let Err(mpsc::RecvTimeoutError::Timeout) = stopped.recv_timeout(tick) {
                    lock(&view).tick(Instant::now());
                }
            })
            .ok()?;
        Some(Self { stop, thread })
    }

    fn stop(self) {
        let _ = self.stop.send(());
        let _ = self.thread.join();
    }
}

impl InstallProgress {
    pub(crate) fn new(action: &'static str, product: Product, interaction: Interaction) -> Self {
        let live = interaction.stdout && !interaction.dumb;
        Self {
            view: Arc::new(Mutex::new(View {
                progress: Progress::new(&format!("{action} {}", product_label(product)), live),
                enabled: !interaction.json,
                output_failed: false,
                last_draw: None,
                since: Instant::now(),
                frame: None,
            })),
            product,
            action,
            started: Instant::now(),
            step: Step::Download,
            transfer: None,
            animate: live && !interaction.json && tmt_cli_style::Terminal::stdout(false).color,
            ticker: None,
        }
    }

    pub(crate) fn observe(&mut self, event: ProgressEvent<'_>) {
        let mut view = lock(&self.view);
        let (step, state, transfer, detail) = match event {
            ProgressEvent::Selected {
                version,
                archive_bytes,
            } => {
                view.progress.title(&format!(
                    "{} {} {version}",
                    self.action,
                    product_label(self.product)
                ));
                self.started = Instant::now();
                (
                    Step::Download,
                    State::Running,
                    Some(Transfer {
                        received_bytes: 0,
                        total_bytes: Some(archive_bytes),
                        elapsed: Duration::ZERO,
                    }),
                    String::new(),
                )
            }
            ProgressEvent::Download {
                received_bytes,
                total_bytes,
            } => (
                Step::Download,
                State::Running,
                Some(Transfer {
                    received_bytes,
                    total_bytes: total_bytes
                        .or_else(|| self.transfer.and_then(|transfer| transfer.total_bytes)),
                    elapsed: self.started.elapsed(),
                }),
                String::new(),
            ),
            ProgressEvent::Downloaded => (
                Step::Download,
                State::Done,
                self.transfer,
                "archive downloaded".into(),
            ),
            ProgressEvent::Verifying => (
                Step::Verify,
                State::Running,
                None,
                "checking release record and archive".into(),
            ),
            ProgressEvent::Verified => (
                Step::Verify,
                State::Done,
                None,
                "checksum matches the release record; archive checked".into(),
            ),
            ProgressEvent::Activating => (
                Step::Activate,
                State::Running,
                None,
                "publishing verified release".into(),
            ),
            ProgressEvent::Activated => (
                Step::Activate,
                State::Running,
                None,
                "settling bundled agent skills".into(),
            ),
        };
        self.step = step;
        if step == Step::Download {
            self.transfer = transfer;
        }
        view.progress.update(StepProgress {
            step,
            state,
            transfer,
            detail: &detail,
        });
        let throttled = matches!(event, ProgressEvent::Download { .. })
            && view
                .last_draw
                .is_some_and(|last| last.elapsed() < Duration::from_millis(100));
        if !throttled {
            view.draw();
        }
        let running = view.progress.running();
        drop(view);
        if self.animate && running && self.ticker.is_none() {
            self.ticker = Ticker::start(Arc::clone(&self.view), SPINNER_TICK);
        }
    }

    pub(crate) fn settled(&mut self, warning: bool) {
        self.stop_ticker();
        let mut view = lock(&self.view);
        view.progress.update(StepProgress {
            step: Step::Activate,
            state: if warning { State::Warning } else { State::Done },
            transfer: None,
            detail: if warning {
                "installed; skills need attention"
            } else {
                "release and bundled skills ready"
            },
        });
        view.draw();
    }

    pub(crate) fn failed(&mut self) {
        self.stop_ticker();
        let mut view = lock(&self.view);
        view.progress.update(StepProgress {
            step: self.step,
            state: State::Failed,
            transfer: None,
            detail: "stopped; inspect the reported installation outcome",
        });
        view.draw();
    }

    fn stop_ticker(&mut self) {
        if let Some(ticker) = self.ticker.take() {
            ticker.stop();
        }
    }
}

impl Drop for InstallProgress {
    fn drop(&mut self) {
        self.stop_ticker();
    }
}

/// Private new-CLI observations. The final stdout document remains the legacy protocol.
pub(crate) mod child {
    use super::*;
    use serde_json::{Value, json};
    use std::io::Write;

    pub(crate) const CAPABILITY: &[u8] = b"{\"upgradeProgress\":1}\n";
    pub(crate) const LIMIT: usize = 1024 * 1024;
    const LINE_LIMIT: usize = 1024;

    #[derive(Debug)]
    pub(crate) enum UpgradeProgress {
        Selected {
            version: String,
            archive_bytes: u64,
        },
        Download {
            received_bytes: u64,
            total_bytes: Option<u64>,
        },
        Downloaded,
        Verifying,
        Verified,
        Activating,
        Activated,
        Settled {
            warning: bool,
        },
        Failed,
    }
    impl UpgradeProgress {
        fn from_observation(event: ProgressEvent<'_>) -> Self {
            match event {
                ProgressEvent::Selected {
                    version,
                    archive_bytes,
                } => Self::Selected {
                    version: version.into(),
                    archive_bytes,
                },
                ProgressEvent::Download {
                    received_bytes,
                    total_bytes,
                } => Self::Download {
                    received_bytes,
                    total_bytes,
                },
                ProgressEvent::Downloaded => Self::Downloaded,
                ProgressEvent::Verifying => Self::Verifying,
                ProgressEvent::Verified => Self::Verified,
                ProgressEvent::Activating => Self::Activating,
                ProgressEvent::Activated => Self::Activated,
            }
        }
        pub(crate) fn present(&self, progress: &mut InstallProgress) {
            progress.observe(match self {
                Self::Selected {
                    version,
                    archive_bytes,
                } => ProgressEvent::Selected {
                    version,
                    archive_bytes: *archive_bytes,
                },
                Self::Download {
                    received_bytes,
                    total_bytes,
                } => ProgressEvent::Download {
                    received_bytes: *received_bytes,
                    total_bytes: *total_bytes,
                },
                Self::Downloaded => ProgressEvent::Downloaded,
                Self::Verifying => ProgressEvent::Verifying,
                Self::Verified => ProgressEvent::Verified,
                Self::Activating => ProgressEvent::Activating,
                Self::Activated => ProgressEvent::Activated,
                Self::Settled { warning } => return progress.settled(*warning),
                Self::Failed => return progress.failed(),
            });
        }
    }

    fn event_document(event: UpgradeProgress) -> Value {
        match event {
            UpgradeProgress::Selected {
                version,
                archive_bytes,
            } => json!({"kind":"selected","version":version,"archive_bytes":archive_bytes}),
            UpgradeProgress::Download {
                received_bytes,
                total_bytes,
            } => {
                json!({"kind":"download","received_bytes":received_bytes,"total_bytes":total_bytes})
            }
            UpgradeProgress::Settled { warning } => json!({"kind":"settled","warning":warning}),
            UpgradeProgress::Downloaded => json!({"kind":"downloaded"}),
            UpgradeProgress::Verifying => json!({"kind":"verifying"}),
            UpgradeProgress::Verified => json!({"kind":"verified"}),
            UpgradeProgress::Activating => json!({"kind":"activating"}),
            UpgradeProgress::Activated => json!({"kind":"activated"}),
            UpgradeProgress::Failed => json!({"kind":"failed"}),
        }
    }

    fn parse(bytes: &[u8]) -> Option<(Product, UpgradeProgress)> {
        let record: Value = serde_json::from_slice(bytes).ok()?;
        if record.as_object()?.len() != 3 || record["version"].as_u64() != Some(1) {
            return None;
        }
        let product = Product::ALL.into_iter().find(|p| {
            *p != Product::Cli && p.as_str() == record["product"].as_str().unwrap_or("")
        })?;
        let event = &record["event"];
        let fields = event.as_object()?.len();
        let parsed = match event["kind"].as_str()? {
            "selected" if fields == 3 => {
                let version = event["version"].as_str()?;
                if version.is_empty() || version.len() > 128 {
                    return None;
                }
                UpgradeProgress::Selected {
                    version: version.into(),
                    archive_bytes: event["archive_bytes"].as_u64()?,
                }
            }
            "download" if fields == 3 => UpgradeProgress::Download {
                received_bytes: event["received_bytes"].as_u64()?,
                total_bytes: if event["total_bytes"].is_null() && event.get("total_bytes").is_some()
                {
                    None
                } else {
                    Some(event["total_bytes"].as_u64()?)
                },
            },
            "settled" if fields == 2 => UpgradeProgress::Settled {
                warning: event["warning"].as_bool()?,
            },
            "downloaded" if fields == 1 => UpgradeProgress::Downloaded,
            "verifying" if fields == 1 => UpgradeProgress::Verifying,
            "verified" if fields == 1 => UpgradeProgress::Verified,
            "activating" if fields == 1 => UpgradeProgress::Activating,
            "activated" if fields == 1 => UpgradeProgress::Activated,
            "failed" if fields == 1 => UpgradeProgress::Failed,
            _ => return None,
        };
        Some((product, parsed))
    }

    #[derive(Default)]
    pub(crate) struct Sender {
        written: usize,
        disabled: bool,
        last_download: Option<Instant>,
        pending_download: Option<(u64, Option<u64>)>,
    }
    impl Sender {
        pub(crate) fn observe(&mut self, product: Product, event: ProgressEvent<'_>) {
            self.observe_to(
                product,
                event,
                &mut tmt_cli_style::stream::stderr(),
                Instant::now(),
            );
        }
        fn observe_to(
            &mut self,
            product: Product,
            event: ProgressEvent<'_>,
            output: &mut impl Write,
            now: Instant,
        ) {
            if matches!(event, ProgressEvent::Selected { .. }) {
                self.pending_download = None;
                self.last_download = None;
            }
            if let ProgressEvent::Download {
                received_bytes,
                total_bytes,
            } = event
            {
                self.pending_download = Some((received_bytes, total_bytes));
                if total_bytes != Some(received_bytes)
                    && self.last_download.is_some_and(|last| {
                        now.saturating_duration_since(last) < Duration::from_millis(100)
                    })
                {
                    return;
                }
                self.last_download = Some(now);
                self.pending_download = None;
            } else {
                self.flush_download(product, output);
            }
            self.send_to(product, UpgradeProgress::from_observation(event), output);
        }
        fn flush_download(&mut self, product: Product, output: &mut impl Write) {
            if let Some((received_bytes, total_bytes)) = self.pending_download.take() {
                self.send_to(
                    product,
                    UpgradeProgress::Download {
                        received_bytes,
                        total_bytes,
                    },
                    output,
                );
            }
        }
        pub(crate) fn send(&mut self, product: Product, event: UpgradeProgress) {
            let mut output = tmt_cli_style::stream::stderr();
            self.flush_download(product, &mut output);
            self.send_to(product, event, &mut output);
        }
        fn send_to(&mut self, product: Product, event: UpgradeProgress, output: &mut impl Write) {
            if self.disabled {
                return;
            }
            let record =
                json!({"version":1,"product":product.as_str(),"event":event_document(event)});
            let Ok(mut bytes) = serde_json::to_vec(&record) else {
                self.disabled = true;
                return;
            };
            bytes.push(b'\n');
            if bytes.len() > LINE_LIMIT || self.written + bytes.len() > LIMIT {
                self.disabled = true;
                return;
            }
            self.written += bytes.len();
            if output
                .write_all(&bytes)
                .and_then(|_| output.flush())
                .is_err()
            {
                self.disabled = true;
            }
        }
    }

    #[derive(Default)]
    pub(crate) struct Decoder {
        pending: Vec<u8>,
        invalid: bool,
        received: usize,
    }
    impl Decoder {
        pub(crate) fn feed(
            &mut self,
            bytes: &[u8],
            observe: &mut dyn FnMut(Product, UpgradeProgress),
        ) {
            self.received = self.received.saturating_add(bytes.len());
            if self.received > LIMIT {
                self.invalid = true;
            }
            if self.invalid {
                return;
            }
            for &byte in bytes {
                self.pending.push(byte);
                if self.pending.len() > LINE_LIMIT {
                    self.invalid = true;
                    return;
                }
                if byte == b'\n' {
                    let Some((product, event)) = parse(&self.pending) else {
                        self.invalid = true;
                        return;
                    };
                    self.pending.clear();
                    observe(product, event);
                }
            }
        }
        pub(crate) fn complete(&self) -> bool {
            !self.invalid && self.pending.is_empty()
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn a_throttled_unknown_length_transfer_flushes_actual_final_bytes_before_downloaded() {
            let mut sender = Sender::default();
            let mut output = Vec::new();
            let now = Instant::now();
            sender.observe_to(
                Product::Ops,
                ProgressEvent::Selected {
                    version: "1.2.3",
                    archive_bytes: 4,
                },
                &mut output,
                now,
            );
            sender.observe_to(
                Product::Ops,
                ProgressEvent::Download {
                    received_bytes: 2,
                    total_bytes: None,
                },
                &mut output,
                now,
            );
            sender.last_download = Some(now);
            sender.observe_to(
                Product::Ops,
                ProgressEvent::Download {
                    received_bytes: 4,
                    total_bytes: None,
                },
                &mut output,
                now,
            );
            assert_eq!(sender.pending_download, Some((4, None)));
            sender.observe_to(Product::Ops, ProgressEvent::Downloaded, &mut output, now);
            let mut decoder = Decoder::default();
            let mut observed = Vec::new();
            decoder.feed(&output, &mut |_, event| {
                observed.push(match event {
                    UpgradeProgress::Selected { .. } => ("selected", 0),
                    UpgradeProgress::Download { received_bytes, .. } => ("bytes", received_bytes),
                    UpgradeProgress::Downloaded => ("downloaded", 0),
                    _ => panic!("unexpected progress"),
                });
            });
            assert!(decoder.complete());
            assert_eq!(
                observed,
                [
                    ("selected", 0),
                    ("bytes", 2),
                    ("bytes", 4),
                    ("downloaded", 0)
                ]
            );
        }
        #[test]
        fn many_valid_records_cannot_exceed_the_stream_bound() {
            let bytes = b"{\"version\":1,\"product\":\"ops\",\"event\":{\"kind\":\"verified\"}}\n";
            let mut decoder = Decoder::default();
            for _ in 0..LIMIT / bytes.len() {
                decoder.feed(bytes, &mut |_, _| {});
            }
            assert!(decoder.complete());
            decoder.feed(bytes, &mut |_, _| panic!("over-bound record"));
            assert!(!decoder.complete());
        }
        #[test]
        fn records_arrive_across_arbitrary_chunks_and_bad_records_stay_invalid() {
            let bytes = b"{\"version\":1,\"product\":\"ops\",\"event\":{\"kind\":\"download\",\"received_bytes\":2,\"total_bytes\":4}}\n";
            for width in [1, 3, bytes.len()] {
                let mut decoder = Decoder::default();
                let mut seen = 0;
                for chunk in bytes.chunks(width) {
                    decoder.feed(chunk, &mut |p, e| {
                        assert_eq!(p, Product::Ops);
                        assert!(matches!(
                            e,
                            UpgradeProgress::Download {
                                received_bytes: 2,
                                total_bytes: Some(4)
                            }
                        ));
                        seen += 1;
                    });
                }
                assert_eq!(seen, 1);
                assert!(decoder.complete());
            }
            for bytes in [
                b"bad\n".as_slice(),
                b"{}\n",
                b"{\"version\":2}\n",
                b"partial",
                &vec![b'x'; LINE_LIMIT + 1],
            ] {
                let mut decoder = Decoder::default();
                decoder.feed(bytes, &mut |_, _| panic!("invalid record"));
                assert!(!decoder.complete());
            }
        }
    }
}

#[cfg(test)]
mod presentation_tests {
    use super::*;

    fn quiet() -> Interaction {
        Interaction {
            json: true,
            stdin: false,
            stdout: false,
            stderr: false,
            dumb: true,
        }
    }

    fn plain(view: &Mutex<View>) -> String {
        let mut bytes = Vec::new();
        lock(view)
            .progress
            .write(&mut bytes, tmt_cli_style::Terminal::PLAIN)
            .unwrap();
        String::from_utf8(bytes).unwrap()
    }

    #[test]
    fn the_running_mark_turns_on_the_clock_without_new_events_and_stops_when_settled() {
        let progress = InstallProgress::new("Upgrading", Product::Cli, quiet());
        let view = Arc::clone(&progress.view);
        let start = Instant::now();
        lock(&view).since = start;
        lock(&view).progress.update(StepProgress {
            step: Step::Verify,
            state: State::Running,
            transfer: None,
            detail: "checking release record and archive",
        });
        let at = |ms: u64| start + Duration::from_millis(ms);
        let mut marks = Vec::new();
        for (ms, moved) in [(0, true), (40, false), (80, true), (160, true), (900, true)] {
            assert_eq!(lock(&view).tick(at(ms)), moved, "{ms} ms");
            let text = plain(&view);
            let row = text.lines().find(|l| l.contains("Verify")).unwrap();
            marks.push(row.trim_start().chars().next().unwrap());
        }
        // One frame per tick from the clock alone; 900 ms is frame 11, which wraps to 1.
        assert_eq!(marks, ['⠋', '⠋', '⠙', '⠹', '⠙']);
        lock(&view).progress.update(StepProgress {
            step: Step::Verify,
            state: State::Done,
            transfer: None,
            detail: "checked",
        });
        assert!(
            !lock(&view).tick(at(2_000)),
            "nothing turns once no step runs"
        );
    }

    #[test]
    fn only_a_live_colored_terminal_animates_and_still_output_keeps_its_mark() {
        for interaction in [
            quiet(),
            Interaction {
                json: false,
                ..quiet()
            },
            Interaction {
                json: false,
                stdout: true,
                dumb: true,
                ..quiet()
            },
        ] {
            let mut progress = InstallProgress::new("Upgrading", Product::Cli, interaction);
            assert!(!progress.animate);
            // Keep this check's frames off the test's own stdout.
            lock(&progress.view).enabled = false;
            progress.observe(ProgressEvent::Verifying);
            assert!(progress.ticker.is_none());
            assert!(plain(&progress.view).contains("⠹ Verify"));
        }
    }

    #[test]
    fn the_ticker_lives_only_while_a_step_runs_and_leaves_nothing_behind() {
        // Settled and failed join the ticker and release its share of the view.
        for settle in [true, false] {
            let mut progress = InstallProgress::new("Upgrading", Product::Ops, quiet());
            progress.animate = true;
            progress.observe(ProgressEvent::Verifying);
            assert!(progress.ticker.is_some());
            assert_eq!(Arc::strong_count(&progress.view), 2);
            if settle {
                progress.settled(false);
            } else {
                progress.failed();
            }
            assert!(progress.ticker.is_none());
            assert_eq!(Arc::strong_count(&progress.view), 1);
        }
        // Dropping a view mid-step joins its ticker too.
        let mut progress = InstallProgress::new("Upgrading", Product::Ops, quiet());
        progress.animate = true;
        progress.observe(ProgressEvent::Activating);
        let view = Arc::clone(&progress.view);
        assert_eq!(Arc::strong_count(&view), 3);
        drop(progress);
        assert_eq!(Arc::strong_count(&view), 1);
        // A ticker that never ticked stops at once; its wait is never a sleep.
        let ticker = Ticker::start(Arc::clone(&view), Duration::from_secs(3_600)).unwrap();
        ticker.stop();
        assert_eq!(Arc::strong_count(&view), 1);
    }
    #[test]
    fn observed_install_and_upgrade_share_bounded_plain_frames() {
        for action in ["Installing", "Upgrading"] {
            let mut view = InstallProgress::new(
                action,
                Product::Cli,
                Interaction {
                    json: true,
                    stdin: false,
                    stdout: false,
                    stderr: false,
                    dumb: true,
                },
            );
            // JSON suppresses writes while retaining the exact presentation model for this check.
            for event in [
                ProgressEvent::Selected {
                    version: "1.2.3",
                    archive_bytes: 4,
                },
                ProgressEvent::Download {
                    received_bytes: 4,
                    total_bytes: None,
                },
                ProgressEvent::Downloaded,
                ProgressEvent::Verifying,
                ProgressEvent::Verified,
                ProgressEvent::Activating,
                ProgressEvent::Activated,
            ] {
                view.observe(event);
            }
            view.settled(false);
            for width in [20, 40, 80] {
                let mut bytes = Vec::new();
                lock(&view.view)
                    .progress
                    .write(
                        &mut bytes,
                        tmt_cli_style::Terminal {
                            width: Some(width),
                            ..tmt_cli_style::Terminal::PLAIN
                        },
                    )
                    .unwrap();
                let text = String::from_utf8(bytes).unwrap();
                assert!(!text.contains('\x1b'));
                assert_eq!(text.lines().count(), 4);
                assert!(
                    text.lines()
                        .all(|l| l.chars().count() <= usize::from(width)),
                    "{text}"
                );
                if width == 80 {
                    assert!(text.contains("4 B of 4 B"), "{text}");
                    assert!(text.contains("bundled skills ready"));
                    eprintln!("{action} plain frame:\n{text}");
                }
            }
        }
    }
}
