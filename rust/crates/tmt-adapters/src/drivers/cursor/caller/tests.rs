//! Documentation-derived synthetic process observations, not live Cursor captures.
use super::*;
use crate::process::{CommandError, CommandFailure, CommandOutput, CommandRequest, CommandRunner};
use std::time::{Duration, Instant};
use std::{cell::RefCell, collections::VecDeque, ffi::OsString};

struct Probe {
    outputs: RefCell<VecDeque<Result<Vec<u8>, CommandFailure>>>,
    calls: RefCell<Vec<(Vec<OsString>, Instant)>>,
}
impl Probe {
    fn new(outputs: impl IntoIterator<Item = Result<&'static str, CommandFailure>>) -> Self {
        Self {
            outputs: RefCell::new(
                outputs
                    .into_iter()
                    .map(|s| s.map(|s| s.as_bytes().to_vec()))
                    .collect(),
            ),
            calls: RefCell::new(Vec::new()),
        }
    }
    fn identify(&self) -> ActionResult<RuntimeCaller, AncestryError> {
        match CallerSnapshot::capture(self, 42, Instant::now() + Duration::from_secs(3)) {
            Ok(snapshot) => identify_caller(&snapshot),
            Err(error) => ActionResult::Failed(error),
        }
    }
}
impl CommandRunner for Probe {
    fn execute(&self, request: CommandRequest<'_>) -> Result<CommandOutput, CommandError> {
        assert_eq!(request.program, "/usr/bin/env");
        assert_eq!(
            &request.args[..3],
            ["LC_ALL=C", "TZ=UTC", "/bin/ps"].map(OsString::from)
        );
        assert!(request.input.is_empty());
        assert!(matches!(request.max_output_bytes, 16384 | 4194304));
        self.calls
            .borrow_mut()
            .push((request.args.to_vec(), request.deadline));
        self.outputs
            .borrow_mut()
            .pop_front()
            .expect("unexpected process probe")
            .map(|stdout| CommandOutput {
                stdout,
                stderr: vec![],
            })
            .map_err(CommandError::new)
    }
}
const CHAIN: &str = "42 41 /bin/sh\n41 40 /fixture/bin/cursor-agent\n40 1 /bin/zsh\n";
#[test]
fn dedicated_interactive_ancestry_permits_only_normal_host_verification() {
    for args in [
        "cursor-agent",
        "/fixture/bin/cursor-agent",
        "cursor-agent agent fix tests",
        "cursor-agent resume",
        "cursor-agent --continue",
        "cursor-agent --resume=chat-id",
        "cursor-agent --resume=-1",
        "cursor-agent --resume chat-id --model fixture-model --mode plan",
        "cursor-agent --workspace=/fixture/project --sandbox enabled --plan",
    ] {
        let probe = Probe::new([Ok(CHAIN), Ok(args)]);
        let ActionResult::Completed(caller) = probe.identify() else {
            panic!("{args}");
        };
        assert_eq!(caller.harness.as_str(), "cursor-agent");
        assert_eq!(
            caller.session, None,
            "no inherited conversation or hook ID manufactured"
        );
        assert!(caller.permits_host_fallback(), "{args}");
        let calls = probe.calls.borrow();
        assert_eq!(
            &calls[1].0[3..],
            ["-o", "args=", "-p", "41"].map(OsString::from)
        );
        assert_eq!(calls[0].1, calls[1].1, "one absolute deadline");
        assert!(probe.outputs.borrow().is_empty());
    }
}
#[test]
fn shared_unknown_and_conflicting_invocations_refuse_inherited_panes() {
    for args in [
        "cursor-agent acp",
        "cursor-agent worker start",
        "cursor-agent --print fix",
        "cursor-agent -p fix",
        "cursor-agent --background",
        "cursor-agent --mode=rpc",
        "cursor-agent --mode",
        "cursor-agent --model=",
        "cursor-agent --model --print",
        "cursor-agent --resume=",
        "cursor-agent --sandbox=unknown",
        "cursor-agent --unknown",
        "cursor-agent status",
        "cursor-agent fix tests",
        "cursor-agent -- agent",
        "cursor-agent agent --print fix",
        "cursor-agent agent worker start",
        "cursor-agent-server",
        "agent",
        "unrelated-program",
    ] {
        let probe = Probe::new([Ok(CHAIN), Ok(args)]);
        let ActionResult::Completed(caller) = probe.identify() else {
            panic!("{args}");
        };
        assert_eq!(caller.host, HostAttribution::Ambiguous, "{args}");
        assert!(
            !caller.permits_host_fallback(),
            "wrong inherited pane fenced: {args}"
        );
        assert_eq!(caller.session, None);
    }
    let nested = Probe::new([Ok(
        "42 41 /bin/sh\n41 40 cursor-agent\n40 39 /bin/sh\n39 1 cursor-agent\n",
    )]);
    let ActionResult::Completed(caller) = nested.identify() else {
        panic!("nested caller");
    };
    assert!(!caller.permits_host_fallback());
    assert_eq!(nested.calls.borrow().len(), 1);
}
#[test]
fn unrelated_agent_alias_or_process_outside_ancestry_is_unsupported() {
    for chain in [
        "42 41 /bin/sh\n41 1 agent\n",
        "42 41 /bin/sh\n41 1 cursor-agent-server\n",
        "42 41 /bin/sh\n41 1 /bin/zsh\n99 1 cursor-agent\n",
    ] {
        let probe = Probe::new([Ok(chain)]);
        assert!(matches!(probe.identify(), ActionResult::Unsupported));
        assert_eq!(probe.calls.borrow().len(), 1);
    }
}
#[test]
fn observation_failure_is_typed_and_never_host_fallback() {
    for failure in [CommandFailure::Timeout, CommandFailure::OutputLimit] {
        for outputs in [vec![Err(failure)], vec![Ok(CHAIN), Err(failure)]] {
            let ActionResult::Failed(AncestryError::Command(error)) =
                Probe::new(outputs).identify()
            else {
                panic!("process failure kind must survive the driver boundary");
            };
            assert_eq!(error.kind, failure);
        }
    }
    for output in ["", "invalid"] {
        assert!(matches!(
            Probe::new([Ok(output)]).identify(),
            ActionResult::Failed(AncestryError::Unavailable)
        ));
    }
    assert!(matches!(
        Probe::new([Ok(CHAIN), Ok("")]).identify(),
        ActionResult::Failed(AncestryError::Unavailable)
    ));
    let probe = Probe::new([Ok(CHAIN)]);
    probe.outputs.borrow_mut().push_back(Ok(vec![0xff]));
    assert!(matches!(
        probe.identify(),
        ActionResult::Failed(AncestryError::Unavailable)
    ));
}
