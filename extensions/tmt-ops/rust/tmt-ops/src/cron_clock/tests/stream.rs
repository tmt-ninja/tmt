//! Real child-process evidence for the public Core stream and cleanup boundary.
use super::*;
use crate::test_support::{Scratch, write_ready_executable};
use std::fs;
struct Fixture {
    root: Scratch,
    core: Core,
}
impl Fixture {
    fn new(mode: &str) -> Self {
        let root = Scratch::new("core-clock-stream");
        fs::write(root.join("mode"), mode).unwrap();
        let program = root.join("core.py");
        write_ready_executable(
            &program,
            r#"#!/usr/bin/python3
import json,os,pathlib,select,signal,subprocess,sys
root=pathlib.Path(__file__).parent; mode=(root/'mode').read_text()
if sys.argv[1:]==['api']:
 request=json.load(sys.stdin);(root/'request.json').write_text(json.dumps(request))
 assert request['operation']=='tick.status'
 print((root/'status.json').read_text());sys.exit(0)
assert sys.argv[1:] in [['tick','run','--json'],['tick','--json']]
(root/'argv.json').write_text(json.dumps(sys.argv[1:]))
if mode=='refuse':
 print(json.dumps({'error':{'code':'TICK_CLOCK_RUNNING','message':'Another clock holds the lease (process 42).'}}));sys.exit(5)
if mode=='eof':sys.exit(0)
def report(accepted,complete=True):
 return json.dumps({'schemaVersion':1,'jobs':{'accepted':accepted,'failures':[]},'complete':complete,'stopped':False})
if mode in ['finite','incomplete']:
 print(report(3,mode!='incomplete'));sys.exit(0 if mode=='finite' else 1)
children=[]
def cleanup(signum,frame):
 for child in children:
  try:os.killpg(child.pid,signal.SIGTERM)
  except ProcessLookupError:pass
  child.wait(timeout=5)
 (root/'cleaned').write_text('nested child reaped')
 sys.exit(0)
signal.signal(signal.SIGTERM,cleanup);signal.signal(signal.SIGINT,cleanup)
blocked=signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGTERM,signal.SIGINT})
child=subprocess.Popen(['/bin/sleep','300'],start_new_session=True);children.append(child)
(root/'nested.pid').write_text(str(child.pid))
signal.pthread_sigmask(signal.SIG_SETMASK,blocked)
(root/'core.pid').write_text(str(os.getpid()))
if mode=='malformed':print('not json',flush=True)
elif mode=='oversized':print('x'*(1024*1024+1),flush=True)
elif mode=='coalesced':sys.stdout.write(report(1)+'\n'+report(2)+'\n');sys.stdout.flush()
else:print(report(1),flush=True)
while True:
 ready,_,_=select.select([sys.stdin],[],[],1)
 if ready:
  data=os.read(0,4096)
  if data:(root/'unexpected-input').write_bytes(data)
"#,
        );
        Self {
            root,
            core: Core::at(program),
        }
    }
    fn pid(&self, name: &str) -> Option<i32> {
        fs::read_to_string(self.root.join(name)).ok()?.parse().ok()
    }
    fn ready(&self) -> (i32, i32) {
        wait(|| Some((self.pid("core.pid")?, self.pid("nested.pid")?)))
    }
    fn cleaned(&self, core: i32, nested: i32) {
        assert_eq!(
            fs::read_to_string(self.root.join("cleaned")).unwrap(),
            "nested child reaped"
        );
        for pid in [core, nested] {
            assert_eq!(
                nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None),
                Err(nix::errno::Errno::ESRCH)
            );
        }
    }
}
#[track_caller]
fn wait<T>(mut read: impl FnMut() -> Option<T>) -> T {
    let until = Instant::now() + Duration::from_secs(10);
    loop {
        if let Some(value) = read() {
            return value;
        }
        assert!(
            Instant::now() < until,
            "private Core fixture did not reach readiness"
        );
        std::thread::sleep(Duration::from_millis(10));
    }
}
#[test]
fn run_reads_coalesced_reports_without_input_and_gracefully_joins_nested_cleanup() {
    let f = Fixture::new("coalesced");
    let mut feed = core_clock::Feed::spawn(&f.core, true).unwrap();
    let (core, nested) = f.ready();
    let report = wait(|| {
        let (report, ended) = feed.take();
        assert!(ended.is_none());
        report.filter(|report| report["accepted"] == 2)
    });
    assert_eq!(report["action"], "tick");
    assert_eq!(
        serde_json::from_slice::<Value>(&fs::read(f.root.join("argv.json")).unwrap()).unwrap(),
        json!(["tick", "run", "--json"])
    );
    let started = Instant::now();
    feed.stop().unwrap();
    assert!(started.elapsed() < Duration::from_secs(5));
    f.cleaned(core, nested);
    assert!(!f.root.join("unexpected-input").exists());
}
#[test]
fn malformed_and_oversized_reports_are_failures_only_after_owned_cleanup() {
    for mode in ["malformed", "oversized"] {
        let f = Fixture::new(mode);
        let mut feed = core_clock::Feed::spawn(&f.core, true).unwrap();
        let (core, nested) = f.ready();
        let ended = wait(|| feed.take().1);
        assert_eq!(ended.unwrap_err().code, "SQUAD_CRON_CLOCK_FAILED");
        f.cleaned(core, nested);
        feed.stop().unwrap();
    }
}
#[test]
fn finite_tick_preserves_success_and_incomplete_reports_without_second_invocation() {
    for mode in ["finite", "incomplete"] {
        let f = Fixture::new(mode);
        let mut feed = core_clock::Feed::spawn(&f.core, false).unwrap();
        let mut report = None;
        wait(|| {
            let (latest, ended) = feed.take();
            if latest.is_some() {
                report = latest;
            }
            ended
        })
        .unwrap();
        assert_eq!(report.as_ref().unwrap()["accepted"], 3);
        assert_eq!(report.unwrap()["complete"], mode == "finite");
        assert_eq!(
            serde_json::from_slice::<Value>(&fs::read(f.root.join("argv.json")).unwrap()).unwrap(),
            json!(["tick", "--json"])
        );
        feed.stop().unwrap();
        assert!(!f.root.join("nested.pid").exists());
    }
}
#[test]
fn a_competing_clock_and_early_eof_are_not_treated_as_success_or_restarted() {
    for (mode, code) in [
        ("refuse", "TICK_CLOCK_RUNNING"),
        ("eof", "SQUAD_CRON_CLOCK_FAILED"),
    ] {
        let f = Fixture::new(mode);
        let mut feed = core_clock::Feed::spawn(&f.core, true).unwrap();
        let ended = wait(|| feed.take().1);
        assert_eq!(ended.unwrap_err().code, code);
        feed.stop().unwrap();
        assert!(!f.root.join("nested.pid").exists());
    }
}
#[test]
fn dropping_the_stream_during_unwind_still_reaps_both_owned_processes() {
    let f = Fixture::new("stream");
    let pids = std::cell::Cell::new(None);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _feed = core_clock::Feed::spawn(&f.core, true).unwrap();
        pids.set(Some(f.ready()));
        panic!("controlled caller panic");
    }));
    assert!(result.is_err());
    let (core, nested) = pids.get().unwrap();
    f.cleaned(core, nested);
}
#[test]
fn status_uses_only_the_public_read_and_preserves_full_holder_evidence() {
    let f = Fixture::new("status");
    let public = json!({"schemaVersion":1,"state":"running","holder":{"pid":42,"pane":"%7","startedAtMs":100,"expiresAtMs":30100,"build":"test"}});
    fs::write(f.root.join("status.json"), public.to_string()).unwrap();
    assert_eq!(
        status_document(status(&f.core)),
        json!({"state":"running","pid":42,"pane":"%7","sinceMs":100,"expiresMs":30100})
    );
    let request: Value =
        serde_json::from_slice(&fs::read(f.root.join("request.json")).unwrap()).unwrap();
    assert_eq!(request["operation"], "tick.status");
    for public in [
        json!({"schemaVersion":1,"state":"stopped","holder":null}),
        json!({"schemaVersion":1,"state":"unconfirmed","holder":null}),
        json!({"schemaVersion":2,"state":"running","holder":{}}),
    ] {
        fs::write(f.root.join("status.json"), public.to_string()).unwrap();
        assert_eq!(
            status(&f.core),
            if public["state"] == "stopped" {
                ClockStatus::NoClock
            } else {
                ClockStatus::Unknown
            }
        );
    }
    assert!(!f.root.join("ops").exists());
    assert!(!f.root.join("argv.json").exists());
}
