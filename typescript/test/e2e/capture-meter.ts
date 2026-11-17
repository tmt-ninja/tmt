/**
 * The meter that the workspace capture-cost probe runs inside a tmux pane: it calls the real
 * `workspace.capture` API, checks topology reads, and leaves its
 * progress and any failure in files the probe reads, so a stalled or failed run is named.
 */
export function captureMeterScript(options: {
  directory: string;
  result: string;
  trace: string;
  globalDir: string;
  command: string[];
}): string {
  return `
import json, os, pathlib, subprocess, sys, time
mode=sys.argv[1]
started=time.monotonic()
deadline=started+float(sys.argv[2])
root=pathlib.Path(${JSON.stringify(options.directory)})
result=pathlib.Path(${JSON.stringify(options.result)})
positive=pathlib.Path(str(result)+'.positive')
trace=pathlib.Path(${JSON.stringify(options.trace)})
env=dict(os.environ)
env.pop('TMUX',None);env.pop('TMUX_PANE',None)
env['TMT_HOME']=${JSON.stringify(options.globalDir)}
command=${JSON.stringify(options.command)}
request=json.dumps({'version':1,'operation':'workspace.capture','input':{}})
def publish(path,text):
    stage=pathlib.Path(str(path)+'.tmp');stage.write_text(text);stage.replace(path)
def note(**fields):
    # Where this run is, readable by the test while the run is still going.
    publish(pathlib.Path(str(result)+'.progress'),json.dumps(dict(fields,mode=mode,elapsedMs=round(1000*(time.monotonic()-started)))))
def call():
    left=deadline-time.monotonic()
    assert left>0,'the stage allowance was spent before the next capture call'
    return subprocess.run(command,input=request,text=True,capture_output=True,env=env,timeout=min(3,left))
def topology_reads():
    # The wrapper logs before it execs tmux, so a finished attempt's reads are already here.
    return sum(1 for line in trace.read_text().splitlines() if line.startswith('list-panes\\t'))
def changed():
    note(step='changed-layout capture call')
    completed=call()
    assert completed.returncode==0,(completed.returncode,completed.stdout,completed.stderr)
    assert completed.stderr=='',completed.stderr
    assert json.loads(completed.stdout)=={'attempted':1,'published':1,'skipped':0},completed.stdout
    publish(positive,completed.stdout)
def unchanged_capture():
    note(step='unchanged capture')
    stamp=root/'capture-attempt.json'
    if stamp.exists():
        value=json.loads(stamp.read_text());value['attemptedAtMs']=0
        stamp.write_text(json.dumps(value))
    reads=topology_reads()
    completed=call()
    assert completed.returncode==0,(completed.returncode,completed.stdout,completed.stderr)
    assert completed.stderr=='',completed.stderr
    report=json.loads(completed.stdout)
    assert report=={'attempted':1,'published':0,'skipped':0,'reasons':{'unchanged':1}},'unchanged capture must succeed without publication: %s'%completed.stdout
    taken=topology_reads()-reads
    assert taken==1,'unchanged capture took %d topology reads, expected exactly 1'%taken
    publish(result,json.dumps(report))
try:
    changed() if mode=='changed' else unchanged_capture()
except BaseException as error:
    # A failed run says why in a file the test reads, instead of only in the meter pane.
    text='%s: %s'%(type(error).__name__,error)
    publish(pathlib.Path(str(result)+'.failure'),text)
    if mode=='changed': publish(positive,json.dumps({'error':text}))
    raise SystemExit(1)
`;
}
