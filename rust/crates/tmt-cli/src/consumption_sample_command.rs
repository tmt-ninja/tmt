//! Foreground-owned supervised sampling; no new provider hook or daemon.
use std::{
    ffi::{OsStr, OsString},
    io::{self, Write},
    time::{Duration, Instant},
};
use tmt_adapters::runtime::sampling::SamplingRequest;
use tmt_adapters::{
    config::ConfigPaths,
    drivers::Registry,
    host::{Host, OperationOptions},
    process::{
        CommandRequest, CommandRunner, SupervisedProbeRunner, UnixCommandRunner,
        runtime::observe_runtime_process,
    },
    response_input::read_stdin_bounded,
    runtime::RuntimeRegistry,
    setup::usage_consented,
    skill_installation::ProviderEnvironment,
    storage::{RuntimeObservation, Storage},
};
use tmt_core::{
    binding::{
        BindingEvidence, evaluate_binding,
        session::{RuntimeLiveness, RuntimeState},
    },
    endpoint::{EndpointProbe, ProcessIncarnation},
};

const BUDGET: Duration = Duration::from_secs(2);
const SAMPLE_DEBUG: &str = "TMT_SAMPLE_DEBUG";

pub(super) fn debug_ticks() -> u8 {
    if std::env::var_os(SAMPLE_DEBUG).as_deref() == Some(OsStr::new("1")) {
        4
    } else {
        0
    }
}

#[derive(Debug)]
enum SampleOutcome {
    Skipped,
    CommitDeclined,
    NoCounter,
    CounterCommitted,
}

/// The wait callback delegates all potentially slow source/storage work to the
/// existing hard-deadline process owner; it never changes the command's result.
pub fn tick(identity: &str, binding: &str, owner: &ProcessIncarnation, debug: bool) {
    if debug {
        let at = tmt_adapters::request_runtime::wall_time_ms();
        let _ = writeln!(tmt_cli_style::stream::stderr(), "tmt: sampler tick at {at}");
    }
    let Ok(executable) = std::env::current_exe() else {
        if debug {
            let _ = writeln!(
                tmt_cli_style::stream::stderr(),
                "tmt: sampler executable unavailable"
            );
        }
        return;
    };
    let input=serde_json::json!({"identityId":identity,"bindingId":binding,"ownerPid":owner.pid(),"ownerStart":owner.start_identity()}).to_string();
    let request = CommandRequest {
        program: executable.as_os_str(),
        args: &[OsString::from("__consumption-sample")],
        input: input.as_bytes(),
        deadline: Instant::now() + BUDGET,
        max_output_bytes: 4096,
    };
    if debug {
        let result = UnixCommandRunner
            .execute_with_environment(request, &[(SAMPLE_DEBUG.into(), "worker".into())]);
        let mut stderr = tmt_cli_style::stream::stderr();
        match result {
            Ok(output) => {
                let outcome = match output.stdout.as_slice() {
                    b"Skipped" => "skipped",
                    b"CommitDeclined" => "commit declined",
                    b"NoCounter" => "commit without a counter",
                    b"CounterCommitted" => "counter committed",
                    _ => "worker exited without a report",
                };
                let _ = writeln!(stderr, "tmt: sampler {outcome}");
            }
            Err(error) => {
                let _ = writeln!(stderr, "tmt: sampler worker {:?}", error.kind);
            }
        }
    } else {
        let _ = UnixCommandRunner.execute(request);
    }
}

pub fn execute() -> io::Result<u8> {
    match sample(Instant::now() + BUDGET - Duration::from_millis(200)) {
        Ok(outcome) => {
            if std::env::var_os(SAMPLE_DEBUG).as_deref() == Some(OsStr::new("worker")) {
                let _ = write!(tmt_cli_style::stream::stdout(true), "{outcome:?}");
            }
            Ok(0)
        }
        Err(()) => {
            let _ = SupervisedProbeRunner::abort_worker_group();
            Ok(1)
        }
    }
}

fn sample(deadline: Instant) -> Result<SampleOutcome, ()> {
    let input = read_stdin_bounded(deadline.saturating_duration_since(Instant::now()), 4096)
        .map_err(|_| ())?;
    let request: SamplingRequest = serde_json::from_str(&input).map_err(|_| ())?;
    if !tmt_core::dispatch::canonical_id(&request.identity_id)
        || !tmt_core::dispatch::canonical_id(&request.binding_id)
    {
        return Err(());
    }
    let owner = ProcessIncarnation::new(request.owner_pid, &request.owner_start).map_err(|_| ())?;
    let paths = ConfigPaths::discover().map_err(|_| ())?;
    let now = tmt_adapters::request_runtime::wall_time_ms();
    let Some(stored) =
        Storage::context_by_identity(&paths.database, &request.identity_id, now).map_err(|_| ())?
    else {
        return Ok(SampleOutcome::Skipped);
    };
    let Some(binding) = stored.entry.binding.as_ref() else {
        return Ok(SampleOutcome::Skipped);
    };
    if binding.id != request.binding_id
        || binding.session.launch_owner.as_ref() != Some(&owner)
        || binding.session.state != RuntimeState::Running
    {
        return Ok(SampleOutcome::Skipped);
    }
    let Some(key) = binding.session.key.as_ref() else {
        return Ok(SampleOutcome::Skipped);
    };
    let Some(remembered) =
        stored.preferences.remembered.as_ref().filter(|remembered| {
            key.provider_session.as_ref() == Some(&remembered.provider_session)
        })
    else {
        return Ok(SampleOutcome::Skipped);
    };
    let registry = RuntimeRegistry::first_party();
    let Some(lifecycle) = registry.lifecycle(&remembered.harness) else {
        return Ok(SampleOutcome::Skipped);
    };
    if !Registry::builtin()
        .find(remembered.harness.as_str())
        .is_some_and(usage_consented)
    {
        return Ok(SampleOutcome::Skipped);
    }
    for process in [&owner, &key.incarnation] {
        if observe_runtime_process(&SupervisedProbeRunner, process.pid(), deadline)
            .map_err(|_| ())?
            .matches(process)
            != RuntimeLiveness::Alive
        {
            return Ok(SampleOutcome::Skipped);
        }
    }
    let host = Host::for_server_with(&binding.server, SupervisedProbeRunner)
        .with_drivers(tmt_adapters::host::external::approved());
    let snapshot = host
        .observe_snapshot(OperationOptions {
            deadline: Some(deadline),
            pane_ids: Some(std::slice::from_ref(&binding.pane_id)),
        })
        .map_err(|_| ())?;
    if !matches!(
        evaluate_binding(&stored.entry, &EndpointProbe::Live(snapshot)),
        BindingEvidence::Active(_)
    ) {
        return Ok(SampleOutcome::Skipped);
    }
    let environment = ProviderEnvironment::capture()
        .map_err(|_| ())?
        .with_data_root(&paths.global_dir);
    let mut storage = Storage::open_hook(&paths.database, deadline).map_err(|_| ())?;
    let locator = storage
        .consumption_locator(
            &binding.identity_id,
            &binding.id,
            remembered.harness.as_str(),
            remembered.provider_session.as_str(),
        )
        .map_err(|_| ())?;
    // The started sessions' rows are read here, with the locator, so the source
    // work below runs with SQLite closed. An unreadable family is replaced.
    let family = storage.consumption_family(&binding.identity_id);
    let others = storage
        .other_bound_sessions(&binding.identity_id, remembered.harness.as_str())
        .map_err(|_| ())?;
    // Source reads occur with SQLite closed and are then committed against the
    // entire snapshot. A concurrent hook makes this attempt a harmless loser.
    storage.close().map_err(|_| ())?;
    let turn = lifecycle.sampling_turn(
        &remembered.provider_session,
        locator.as_deref(),
        &environment,
        deadline,
    );
    let source = turn
        .as_ref()
        .and_then(|turn| turn.transcript.as_ref())
        .and_then(|path| {
            let payload = serde_json::json!({"transcript_path":path}).to_string();
            lifecycle.consumption_locator(payload.as_bytes(), &environment)
        });
    // The started sessions get a share of the budget; the session's own read
    // keeps the rest, and a family that does not finish is reported incomplete.
    let family = turn.as_ref().and_then(|turn| {
        let share = deadline.saturating_duration_since(Instant::now()) / 2;
        lifecycle.family_tick(
            turn,
            &remembered.provider_session,
            &environment,
            tmt_adapters::runtime::consumption::family::Input {
                corrupt: family.is_err(),
                stored: family.ok().flatten(),
                others,
            },
            now,
            Instant::now() + share,
        )
    });
    let next = turn.as_ref().and_then(|turn| {
        lifecycle.turn_state_with_family(
            turn,
            &environment,
            remembered.state.as_ref(),
            family.as_ref().map(|family| &family.contribution),
            now,
            deadline,
        )
    });
    let next_counted = next.is_some();
    let consumption = next
        .as_ref()
        .and_then(|state| lifecycle.sampled_consumption(state, &environment));
    let has_counter = consumption.is_some();
    let mut preferences = stored.preferences.clone();
    if let Some(next) = next {
        preferences.remembered.as_mut().ok_or(())?.state = Some(next);
    }
    // Source work may outlive the foreground. Revalidate the actual runtime
    // before opening the write transaction; the full stored snapshot fences
    // rebinding/session changes separately.
    for process in [&owner, &key.incarnation] {
        if observe_runtime_process(&SupervisedProbeRunner, process.pid(), deadline)
            .map_err(|_| ())?
            .matches(process)
            != RuntimeLiveness::Alive
        {
            return Ok(SampleOutcome::Skipped);
        }
    }
    if Instant::now() + Duration::from_millis(100) >= deadline {
        return Err(());
    }
    let mut storage = Storage::open_hook(&paths.database, deadline).map_err(|_| ())?;
    let pending = storage
        .commit_runtime_observation(RuntimeObservation {
            expected: &stored,
            preferences: &preferences,
            remember_source: true,
            locator: source.as_deref(),
            sampled: true,
            consumption,
            // Written only with a state that counted it: rows and totals move together.
            family: family.filter(|_| next_counted).map(|family| family.write),
            response: None,
            boundary: None,
            now_ms: tmt_adapters::request_runtime::wall_time_ms(),
            deadline,
        })
        .map_err(|_| ());
    let closed = storage.close().map_err(|_| ());
    let committed = pending?;
    closed?;
    Ok(match (committed, has_counter) {
        (false, _) => SampleOutcome::CommitDeclined,
        (true, false) => SampleOutcome::NoCounter,
        (true, true) => SampleOutcome::CounterCommitted,
    })
}
