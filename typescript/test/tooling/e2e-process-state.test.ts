import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vite-plus/test';
import { processState, type ProcessState } from '../e2e/harness/cleanup.js';
import {
  mockReadinessSnapshot,
  processGroupSnapshot,
  waitForCapture,
  waitForProcessExit,
} from '../e2e/harness/readiness.js';

type Kill = (target: number, signal: 0) => unknown;

function failing(code: string): Kill {
  return () => {
    throw Object.assign(new Error(code), { code });
  };
}

const probeCases: [name: string, kill: Kill, expected: ProcessState][] = [
  ['a signalled process', () => undefined, 'running'],
  ['ESRCH', failing('ESRCH'), 'absent'],
  ['EPERM', failing('EPERM'), 'unknown'],
  ['EIO', failing('EIO'), 'unknown'],
  [
    'an error without a code',
    () => {
      throw new Error('no code');
    },
    'unknown',
  ],
  [
    'a thrown non-error',
    () => {
      throw 'ESRCH';
    },
    'unknown',
  ],
];

describe('E2E process state probe', () => {
  it.each(probeCases)('classifies %s as %s', (_name, kill, expected) => {
    expect(processState(42, { kill })).toBe(expected);
  });

  it('probes the process group through the negated pid', () => {
    const targets: number[] = [];
    const kill = (target: number) => {
      targets.push(target);
    };
    processState(42, { kill });
    processState(42, { kill, group: true });
    expect(targets).toEqual([42, -42]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'leaves pid %s unknown without signalling anything',
    (pid) => {
      const kill = (): never => {
        throw new Error('an invalid pid must not be signalled');
      };
      expect(processState(pid, { kill })).toBe('unknown');
      expect(processState(pid, { kill, group: true })).toBe('unknown');
    }
  );

  it('sees a child this test spawned run and then be proven absent after it is reaped', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30_000)'], {
      stdio: 'ignore',
    });
    try {
      expect(child.pid).toBeDefined();
      expect(processState(child.pid!)).toBe('running');
      child.kill('SIGKILL');
      await once(child, 'close');
      expect(processState(child.pid!)).toBe('absent');
    } finally {
      child.kill('SIGKILL');
    }
  });
});

describe('E2E wait for process exit', () => {
  const sequence = (states: Record<number, ProcessState[]>) => {
    const polls = new Map<number, number>();
    return (pid: number): ProcessState => {
      const seen = polls.get(pid) ?? 0;
      polls.set(pid, seen + 1);
      const list = states[pid]!;
      return list[Math.min(seen, list.length - 1)]!;
    };
  };

  it('reports no processes as exited without probing', async () => {
    const probe = (): never => {
      throw new Error('nothing to probe');
    };
    await expect(waitForProcessExit([], probe, 50)).resolves.toEqual({ outcome: 'exited' });
  });

  it('reports exited once every pid is proven absent, including one that exits while waiting', async () => {
    const probe = sequence({ 1: ['absent'], 2: ['running', 'running', 'absent'] });
    await expect(waitForProcessExit([1, 2], probe, 1_000)).resolves.toEqual({
      outcome: 'exited',
    });
  });

  it('reports a pid that is still running at the deadline as timed out', async () => {
    const probe = sequence({ 1: ['absent'], 2: ['running'], 3: ['unknown'] });
    await expect(waitForProcessExit([1, 2, 3], probe, 60)).resolves.toEqual({
      outcome: 'timed-out',
      running: [2],
      unknown: [3],
    });
  });

  it('reports a pid whose state stays unknown as unknown, never as exited', async () => {
    const probe = sequence({ 1: ['absent'], 2: ['unknown'] });
    await expect(waitForProcessExit([1, 2], probe, 60)).resolves.toEqual({
      outcome: 'unknown',
      unknown: [2],
    });
  });

  it('keeps waiting through a transient unknown state', async () => {
    const probe = sequence({ 1: ['unknown', 'unknown', 'absent'] });
    await expect(waitForProcessExit([1], probe, 1_000)).resolves.toEqual({ outcome: 'exited' });
  });
});

describe('E2E capture readiness', () => {
  it('keeps polling beyond two seconds and returns as soon as the predicate matches', async () => {
    vi.useFakeTimers();
    try {
      const started = Date.now();
      const capture = () => (Date.now() - started >= 3_000 ? 'ready pane' : 'painting');
      const result = waitForCapture(capture, (output) => output === 'ready pane');
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(result).resolves.toBe('ready pane');
    } finally {
      vi.useRealTimers();
    }
  });

  it('times out at the default deadline with the latest pane', async () => {
    vi.useFakeTimers();
    try {
      const started = Date.now();
      const result = waitForCapture(
        () => `pane at ${Date.now() - started}`,
        () => false
      );
      const assertion = expect(result).rejects.toThrow('pane at 10000');
      await vi.advanceTimersByTimeAsync(10_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors a per-call deadline override without waiting for the default', async () => {
    vi.useFakeTimers();
    try {
      const result = waitForCapture(
        () => 'still loading',
        () => false,
        100
      );
      const assertion = expect(result).rejects.toThrow('still loading');
      await vi.advanceTimersByTimeAsync(100);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('mock readiness timeout evidence', () => {
  it('bounds the pane tail and records environment names only', () => {
    const snapshot = mockReadinessSnapshot(
      42,
      ['TMT_MOCK_LOG', 'HOME'],
      () => 'x'.repeat(20_000) + 'pane tail'
    );
    expect(snapshot).toEqual({
      pid: 42,
      environmentKeys: ['HOME', 'TMT_MOCK_LOG'],
      environmentKeysTruncated: false,
      pane: expect.any(String),
    });
    expect(snapshot.pane).toHaveLength(16_384);
    expect(snapshot.pane.endsWith('pane tail')).toBe(true);
  });

  it('caps environment names without truncating a name into a misleading key', () => {
    const snapshot = mockReadinessSnapshot(
      42,
      Array.from({ length: 300 }, (_, i) => `KEY_${i}`),
      () => ''
    );
    expect(snapshot.environmentKeys).toHaveLength(256);
    expect(snapshot.environmentKeysTruncated).toBe(true);
    expect(mockReadinessSnapshot(42, ['x'.repeat(8_193)], () => '').environmentKeys).toEqual([]);
  });

  it('reports an unavailable pane without leaking subprocess errors', () => {
    expect(
      mockReadinessSnapshot(42, ['TOKEN'], () => {
        throw new Error('secret output');
      })
    ).toEqual({
      pid: 42,
      environmentKeys: ['TOKEN'],
      environmentKeysTruncated: false,
      pane: '[unavailable]',
    });
  });

  it('retains bounded inspection failures and only the requested group rows', () => {
    const inspect = vi.fn((args: string[]) => ({
      status: args[0] === '-p' ? 1 : 0,
      stderr: args[0] === '-p' ? 'x'.repeat(5_000) + 'inspection failed' : '',
      stdout:
        args[0] === '-p'
          ? ''
          : [
              '100 1 99 S unrelated-secret',
              '42 1 42 Z node controlled-pre-ready',
              ...Array.from({ length: 20 }, (_, i) => `${i + 200} 42 42 S ${'a'.repeat(1000)}`),
            ].join('\n'),
    }));
    const snapshot = processGroupSnapshot(42, inspect);
    expect(snapshot.leader).toMatchObject({
      command: ['/bin/ps', '-p', '42', '-o', 'pgid=', '-o', 'lstart='],
      status: 1,
      stderr: expect.stringContaining('inspection failed'),
    });
    expect(JSON.stringify(snapshot.leader).length).toBeLessThan(4_300);
    expect(snapshot.census).toMatchObject({ status: 0, stderr: '' });
    expect(snapshot.rows).toContain('42 1 42 Z node controlled-pre-ready');
    expect(snapshot.rows).not.toContain('unrelated-secret');
    expect(snapshot.rows.length).toBeLessThanOrEqual(8_192);
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it('limits matching rows and marks failed or timed-out inspection explicitly', () => {
    expect(
      processGroupSnapshot(42, () => ({
        status: 0,
        stdout: Array.from({ length: 20 }, (_, i) => `${i + 100} 1 42 S worker`).join('\n'),
      })).rows.split('\n')
    ).toHaveLength(16);
    expect(
      processGroupSnapshot(42, () => ({
        status: null,
        signal: 'SIGKILL',
        error: { code: 'ETIMEDOUT' },
      })).leader
    ).toMatchObject({ status: null, signal: 'SIGKILL', error: 'ETIMEDOUT' });
    expect(
      processGroupSnapshot(42, () => {
        throw new Error('secret output');
      }).census
    ).toMatchObject({ status: null, error: 'unavailable' });
    expect(processGroupSnapshot(42, () => ({ status: 0, stdout: '99 1 99 S other' })).rows).toBe(
      '[no matching processes]'
    );
  });
});
