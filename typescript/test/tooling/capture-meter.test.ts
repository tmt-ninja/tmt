import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import { captureMeterScript } from '../e2e/capture-meter.js';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-meter-'));
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const unchanged = '{"attempted":1,"published":0,"skipped":0,"reasons":{"unchanged":1}}';
const published = '{"attempted":1,"published":1,"skipped":0}';

/** A stand-in for `tmt api`: it logs a topology read, as the tmux wrapper would, then answers. */
function stubApi(body: string): string[] {
  const file = path.join(root, 'api.sh');
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return [file];
}

const reads = (name: string) =>
  `printf 'list-panes\\t%s\\n' ${name} >> ${path.join(root, 'trace')}`;

function runMeter(mode: 'unchanged' | 'changed', seconds: number, command: string[]) {
  fs.writeFileSync(path.join(root, 'trace'), '');
  const script = path.join(root, 'meter.py');
  fs.writeFileSync(
    script,
    captureMeterScript({
      directory: root,
      result: path.join(root, 'result.json'),
      trace: path.join(root, 'trace'),
      globalDir: path.join(root, 'home'),
      command,
    })
  );
  const started = Date.now();
  const run = spawnSync('python3', [script, mode, String(seconds)], { encoding: 'utf8' });
  return { run, elapsedMs: Date.now() - started };
}

const countCall = () => `echo call >> ${path.join(root, 'calls')}`;
const callCount = () => fs.readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n').length;
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8');
const exists = (name: string) => fs.existsSync(path.join(root, name));

describe('capture meter', () => {
  it('checks one unchanged capture and leaves progress behind', () => {
    const { run } = runMeter('unchanged', 5, stubApi(`${reads('a')}\necho '${unchanged}'`));
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(read('result.json'))).toEqual(JSON.parse(unchanged));
    expect(JSON.parse(read('result.json.progress'))).toMatchObject({
      mode: 'unchanged',
      step: 'unchanged capture',
    });
    expect(exists('result.json.failure')).toBe(false);
  });

  it('fails an unchanged capture that took two topology reads and names the count', () => {
    const { run } = runMeter(
      'unchanged',
      5,
      stubApi(`${reads('a')}\n${reads('b')}\necho '${unchanged}'`)
    );
    expect(run.status).toBe(1);
    expect(read('result.json.failure')).toContain(
      'unchanged capture took 2 topology reads, expected exactly 1'
    );
    expect(exists('result.json')).toBe(false);
  });

  it('fails an unchanged answer that made no topology read', () => {
    const { run } = runMeter('unchanged', 5, stubApi(`${countCall()}\necho '${unchanged}'`));
    expect(run.status).toBe(1);
    expect(read('result.json.failure')).toContain(
      'unchanged capture took 0 topology reads, expected exactly 1'
    );
    expect(callCount()).toBe(1);
  });

  it('fails an unchanged capture that publishes', () => {
    const published = '{"attempted":1,"published":1,"skipped":0,"reasons":{"unchanged":1}}';
    const { run } = runMeter('unchanged', 5, stubApi(`${reads('a')}\necho '${published}'`));
    expect(run.status).toBe(1);
    expect(read('result.json.failure')).toContain(
      'unchanged capture must succeed without publication'
    );
  });

  it('names a failing capture call in a file instead of only in the pane', () => {
    const { run } = runMeter('unchanged', 5, stubApi('echo broken >&2; exit 7'));
    expect(run.status).toBe(1);
    expect(read('result.json.failure')).toContain('AssertionError');
    expect(read('result.json.failure')).toContain('7');
    expect(exists('result.json')).toBe(false);
  });

  it('ends a stalled capture call inside its allowance and says so', () => {
    const { run, elapsedMs } = runMeter('unchanged', 0.4, stubApi('exec sleep 30'));
    expect(run.status).toBe(1);
    expect(read('result.json.failure')).toContain('TimeoutExpired');
    expect(elapsedMs).toBeLessThan(3_000);
  });

  it('makes no capture call once the allowance is spent', () => {
    const marker = path.join(root, 'called');
    const { run } = runMeter('unchanged', 0, stubApi(`touch ${marker}\necho '${unchanged}'`));
    expect(run.status).toBe(1);
    expect(read('result.json.failure')).toContain('the stage allowance was spent');
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('publishes the changed-layout answer for the probe to read', () => {
    const { run } = runMeter('changed', 5, stubApi(`echo '${published}'`));
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(read('result.json.positive'))).toEqual({
      attempted: 1,
      published: 1,
      skipped: 0,
    });
  });

  it('publishes a changed-layout failure as an answer, so the probe stops waiting at once', () => {
    const { run } = runMeter('changed', 5, stubApi(`echo '${unchanged}'`));
    expect(run.status).toBe(1);
    const outcome = JSON.parse(read('result.json.positive'));
    expect(outcome.error).toContain('AssertionError');
    expect(read('result.json.failure')).toBe(outcome.error);
  });
});
