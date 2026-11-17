use super::*;
use crate::process::{CommandError, CommandFailure, CommandOutput, CommandRequest};
use std::{cell::RefCell, collections::VecDeque};

const SESSION: &str = "11111111-1111-4111-8111-111111111111";
const OUTER_SESSION: &str = "22222222-2222-4222-8222-222222222222";
const INNER_SESSION: &str = "33333333-3333-4333-8333-333333333333";

struct Probe {
    outputs: RefCell<VecDeque<Result<String, CommandFailure>>>,
    calls: RefCell<Vec<(Vec<OsString>, Instant)>>,
}

impl Probe {
    fn new(outputs: impl IntoIterator<Item = Result<&'static str, CommandFailure>>) -> Self {
        Self {
            outputs: RefCell::new(outputs.into_iter().map(|v| v.map(str::to_owned)).collect()),
            calls: RefCell::new(Vec::new()),
        }
    }

    fn identify(
        &self,
        session: Option<&str>,
        coding_agent: Option<&str>,
        ai_agent: Option<&str>,
    ) -> ActionResult<RuntimeCaller, AncestryError> {
        PiCaller::new(
            self,
            CallerEnvironment {
                session_id: session.map(OsString::from),
                coding_agent: coding_agent.map(OsString::from),
                ai_agent: ai_agent.map(OsString::from),
                process_id: 42,
            },
        )
        .identify_caller()
    }
}

impl CommandRunner for Probe {
    fn execute(&self, request: CommandRequest<'_>) -> Result<CommandOutput, CommandError> {
        assert_eq!(request.program, "/usr/bin/env");
        assert_eq!(request.args[0], "LC_ALL=C");
        assert_eq!(request.args[1], "TZ=UTC");
        assert!(request.input.is_empty());
        assert!(request.max_output_bytes == 4 * 1024 * 1024 || request.max_output_bytes == 16384);
        self.calls
            .borrow_mut()
            .push((request.args.to_vec(), request.deadline));
        self.outputs
            .borrow_mut()
            .pop_front()
            .expect("unexpected probe")
            .map(|text| CommandOutput {
                stdout: text.into_bytes(),
                stderr: vec![],
            })
            .map_err(CommandError::new)
    }
}

#[test]
fn ancestry_proven_independent_case_preserves_valid_session_hint() {
    for session in [Some(SESSION), None, Some("   "), Some("bad\nline")] {
        let probe = Probe::new([
            Ok("42 41 /bin/sh\n41 40 pi\n40 1 /bin/zsh\n"),
            Ok("pi --extension /tmp/tmt-pi-extension.mjs\n"),
        ]);
        let ActionResult::Completed(caller) = probe.identify(session, Some("true"), Some("pi"))
        else {
            panic!("ancestry-proven pi must complete");
        };
        assert_eq!(caller.harness.as_str(), "pi");
        assert!(caller.permits_host_fallback());
        assert_eq!(
            caller.session.as_ref().map(ProviderSessionId::as_str),
            session.filter(|value| *value == SESSION)
        );
        let calls = probe.calls.borrow();
        assert_eq!(calls.len(), 2);
        assert_eq!(
            &calls[0].0[3..],
            ["-A", "-o", "pid=,ppid=,comm="].map(OsString::from)
        );
        assert!(probe.outputs.borrow().is_empty());
    }
}

#[test]
fn marker_without_matching_ancestry_is_refused() {
    for (session, coding_agent, ai_agent) in [
        (Some(SESSION), None, None),
        (None, Some("true"), None),
        (None, None, Some("pi")),
        (Some(SESSION), Some("true"), Some("pi")),
    ] {
        // An unrelated `pi` process (pid 99) outside caller 42's parent chain is not proof.
        let probe = Probe::new([Ok("42 41 /bin/zsh\n41 1 -zsh\n99 1 pi\n")]);
        assert!(
            matches!(
                probe.identify(session, coding_agent, ai_agent),
                ActionResult::Failed(AncestryError::Unavailable)
            ),
            "marker without pi ancestry must be refused, not accepted"
        );
        assert_eq!(probe.calls.borrow().len(), 1);
    }

    // Without markers or ancestry, plain shells remain Unsupported.
    let plain = Probe::new([Ok("42 41 /bin/zsh\n41 1 -zsh\n99 1 pi\n")]);
    assert!(matches!(
        plain.identify(None, None, None),
        ActionResult::Unsupported
    ));
}

#[test]
fn nested_spawn_session_id_reset_and_outer_rpc_fence() {
    // Nested interactive Pi resets PI_SESSION_ID to the inner session; outer session is never kept.
    let nested_reset = Probe::new([
        Ok("42 41 /bin/sh\n41 40 pi\n40 39 /bin/sh\n39 38 pi\n38 1 /bin/zsh\n"),
        Ok("pi --extension /state/inner.mjs\n"),
        Ok("pi --extension /state/outer.mjs\n"),
    ]);
    assert_ne!(OUTER_SESSION, INNER_SESSION);
    let ActionResult::Completed(caller) =
        nested_reset.identify(Some(INNER_SESSION), Some("true"), Some("pi"))
    else {
        panic!("nested independent pi should complete");
    };
    assert_eq!(caller.harness.as_str(), "pi");
    assert!(caller.permits_host_fallback());
    assert_eq!(
        caller.session.as_ref().map(ProviderSessionId::as_str),
        Some(INNER_SESSION)
    );
    assert_eq!(nested_reset.calls.borrow().len(), 3);

    // Nested Pi spawned with exposeSessionEnvironment=false strips PI_SESSION_ID cleanly.
    let nested_cleared = Probe::new([
        Ok("42 41 /bin/sh\n41 40 pi\n40 39 /bin/sh\n39 38 pi\n38 1 /bin/zsh\n"),
        Ok("pi\n"),
        Ok("pi\n"),
    ]);
    let ActionResult::Completed(caller) = nested_cleared.identify(None, Some("true"), Some("pi"))
    else {
        panic!("nested pi with cleared session env should still resolve ancestry");
    };
    assert!(caller.permits_host_fallback());
    assert_eq!(caller.session, None);

    // An outer `pi --mode rpc` still fences an inner interactive `pi` after PI_SESSION_ID reset.
    let nested_under_rpc = Probe::new([
        Ok("42 41 /bin/sh\n41 40 pi\n40 39 /bin/sh\n39 38 pi\n38 1 /bin/zsh\n"),
        Ok("pi --extension /state/inner.mjs\n"),
        Ok("pi --mode rpc --no-session\n"),
    ]);
    let ActionResult::Completed(caller) =
        nested_under_rpc.identify(Some(INNER_SESSION), Some("true"), Some("pi"))
    else {
        panic!("outer rpc ancestor should still return Completed Ambiguous");
    };
    assert!(!caller.permits_host_fallback());
    assert_eq!(
        caller.session.as_ref().map(ProviderSessionId::as_str),
        Some(INNER_SESSION)
    );
}

#[test]
fn pi_rpc_and_mode_rpc_are_ambiguous_while_trailing_dash_dash_text_is_not() {
    let rpc_comm = Probe::new([Ok("42 41 /bin/sh\n41 1 pi-rpc\n")]);
    let ActionResult::Completed(caller) =
        rpc_comm.identify(Some(SESSION), Some("true"), Some("pi"))
    else {
        panic!("pi-rpc should complete as Ambiguous");
    };
    assert!(!caller.permits_host_fallback());
    assert_eq!(rpc_comm.calls.borrow().len(), 1);

    for args in ["pi --mode=rpc", "pi --provider anthropic --mode rpc"] {
        let probe = Probe::new([Ok("42 41 /bin/sh\n41 1 pi\n"), Ok(args)]);
        let ActionResult::Completed(caller) = probe.identify(Some(SESSION), Some("true"), None)
        else {
            panic!("rpc flag should complete as Ambiguous: {args}");
        };
        assert!(!caller.permits_host_fallback(), "{args}");
    }

    let prompt_literal = Probe::new([
        Ok("42 41 /bin/sh\n41 1 pi\n"),
        Ok("pi --provider anthropic -- inspect --mode rpc"),
    ]);
    let ActionResult::Completed(caller) =
        prompt_literal.identify(Some(SESSION), Some("true"), None)
    else {
        panic!("prompt text after -- must remain Independent");
    };
    assert!(caller.permits_host_fallback());
}

#[test]
fn failed_ancestry_probes_fail_closed_only_when_marker_is_present() {
    for output in [
        Err(CommandFailure::Timeout),
        Err(CommandFailure::OutputLimit),
        Ok(""),
        Ok("invalid"),
        Ok("42 42 /bin/zsh"),
    ] {
        assert!(matches!(
            Probe::new([output]).identify(Some(SESSION), Some("true"), Some("pi")),
            ActionResult::Failed(_)
        ));
        assert!(matches!(
            Probe::new([output]).identify(None, None, None),
            ActionResult::Unsupported
        ));
    }

    let args_timeout = Probe::new([Ok("42 41 /bin/sh\n41 1 pi\n"), Err(CommandFailure::Timeout)]);
    assert!(matches!(
        args_timeout.identify(Some(SESSION), Some("true"), None),
        ActionResult::Failed(AncestryError::Command(error))
            if error.kind == CommandFailure::Timeout
    ));
}
