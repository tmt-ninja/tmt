#!/usr/bin/env node
// Codex `PreToolUse` hook that keeps seats from waiting on CI, a merge queue, a
// long build or another agent from the main session (#5897). It reads the hook
// JSON on stdin and either prints nothing (allow) or one deny document.
//
// Checks run cheapest first, and only the last one uses the network:
// 1. `TMT_WAIT_HOOK=off` allows, logged as `off` (the per-seat group switch).
// 2. A call whose `cwd` is outside this repository (the checkout holding this
//    script, or one of its worktrees) is allowed, so a global wiring is inert
//    elsewhere.
// 3. A deterministic prefilter allows every call that is not wait- or
//    poll-shaped, with no request and no log line: `clocksleep`, a tool ending
//    in `wait_agent`, or a `Bash` command with `sleep`, `until … do`,
//    `while … do`, `gh run watch|view`, `gh pr checks` or `statusCheckRollup`.
// 4. Anthropic's Messages API (`claude-haiku-5-5`, 2 s in total) judges the
//    tool name and the command (another tool's input), cut to 2000 characters. A timeout, an HTTP
//    error, an unreadable answer or a missing key allows (fail open), logged.
//
// The key is read from TMT_WAIT_GUARD_API_KEY inside this process only; it is
// never printed, logged or written. Every judged or prefiltered call adds one
// JSONL line to ${XDG_STATE_HOME:-~/.local/state}/tmt/codex-wait-guard.jsonl
// (directory 0700, file 0600) with the command cut to 300 characters.
//
// Codex gives hooks no event for re-polling a running session (`write_stdin`
// with empty input) or for code-mode `functions.wait`, so a wait is caught only
// when it starts; the AGENTS rule and scripts/ci-wake.sh stay the primary fix.
//
// TMT_WAIT_GUARD_URL (the Messages endpoint, honored only on a loopback host,
// since the key goes with it; any other host fails open without a request) and
// TMT_WAIT_GUARD_LOG (the log file) exist for isolated tests.
import { execFile, execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL = 'claude-haiku-5-5';
const JUDGE_MS = 2_000;
const WHOAMI_MS = 500;
const PROMPT_CHARS = 2_000;
const LOG_CHARS = 300;
const JUDGE_URL = 'https://api.anthropic.com/v1/messages';

/** The judge endpoint. The test override is honored only on loopback, since the key goes with it. */
function judgeUrl() {
  const override = process.env.TMT_WAIT_GUARD_URL;
  if (!override) return JUDGE_URL;
  try {
    const url = new URL(override);
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
    return loopback && (url.protocol === 'http:' || url.protocol === 'https:') ? override : null;
  } catch {
    return null;
  }
}

const POLICY = `You review one tool call an AI coding agent is about to make in a software repository.
Deny it when the call waits or polls for something slow from the agent's main session: CI checks, a merge queue, a pull request's state, a long build, a deploy, or another agent's reply. Such waits waste the session; the agent should start scripts/ci-wake.sh (or a provider background task that wakes it) and end its turn instead.
Allow short bounded waits that are part of a script or test (for example waiting a few seconds for a local server or file to appear), and anything that is not a wait.
Answer with JSON only: {"verdict":"allow"|"deny","reason":"<one short sentence>"}.`;

/** The key source: one place, so a later switch (for example to the Keychain) is one change. */
function key() {
  return process.env.TMT_WAIT_GUARD_API_KEY || null;
}

const WAIT_TOOL = /^clocksleep$|wait_agent$/;
const WAIT_COMMAND =
  /(^|[\s;&|(])sleep\s|\buntil\b[\s\S]*\bdo\b|\bwhile\b[\s\S]*\bdo\b|\bgh\s+run\s+(watch|view)\b|\bgh\s+pr\s+checks\b|statusCheckRollup/;

export function prefilter(tool, command) {
  if (WAIT_TOOL.test(tool)) return true;
  return tool === 'Bash' && WAIT_COMMAND.test(command);
}

/** Whether `cwd` is in the repository that holds this script (any of its worktrees). */
function inRepository(cwd) {
  const commonDir = (dir) =>
    realpathSync(
      path.resolve(
        dir,
        execFileSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 1_000,
        }).trim()
      )
    );
  try {
    return commonDir(cwd) === commonDir(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    return false;
  }
}

function logFile() {
  if (process.env.TMT_WAIT_GUARD_LOG) return process.env.TMT_WAIT_GUARD_LOG;
  const state = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(state, 'tmt', 'codex-wait-guard.jsonl');
}

function log(entry) {
  try {
    const file = logFile();
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    chmodSync(path.dirname(file), 0o700);
    appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch {
    // The log is evidence for later analysis; it never changes the verdict.
  }
}

/** The seat's identity, best effort, outside the judge's budget. */
function whoami() {
  return new Promise((resolve) => {
    execFile('tmt', ['whoami', '--json'], { timeout: WHOAMI_MS }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        const document = JSON.parse(stdout);
        resolve(document.name ?? null);
      } catch {
        resolve(null);
      }
    });
  });
}

/** `{verdict, reason, tokens}`; `fail_open` for any failure, with why. */
async function judge(tool, command) {
  const secret = key();
  if (!secret) return { verdict: 'fail_open', reason: 'no key' };
  const url = judgeUrl();
  if (!url) return { verdict: 'fail_open', reason: 'untrusted judge url' };
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(JUDGE_MS),
      headers: {
        'content-type': 'application/json',
        'x-api-key': secret,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 100,
        system: POLICY,
        messages: [
          {
            role: 'user',
            content: JSON.stringify({ tool, command: command.slice(0, PROMPT_CHARS) }),
          },
        ],
      }),
    });
    if (!response.ok) return { verdict: 'fail_open', reason: `http ${response.status}` };
    const document = await response.json();
    const tokens = {
      input: document.usage?.input_tokens ?? null,
      output: document.usage?.output_tokens ?? null,
    };
    const text = (document.content ?? [])
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    const answer = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (answer.verdict !== 'allow' && answer.verdict !== 'deny') {
      return { verdict: 'fail_open', reason: 'unreadable verdict', tokens };
    }
    return { verdict: answer.verdict, reason: String(answer.reason ?? '').slice(0, 300), tokens };
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'timeout' : 'error';
    return { verdict: 'fail_open', reason };
  }
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const tool = String(payload.tool_name ?? '');
  // A shell call is judged by its command, any other tool by its input (a sleep's duration).
  const command =
    tool === 'Bash'
      ? String(payload.tool_input?.command ?? '')
      : JSON.stringify(payload.tool_input ?? {});
  const base = { at: new Date().toISOString(), tool, command: command.slice(0, LOG_CHARS) };
  if (process.env.TMT_WAIT_HOOK === 'off') {
    if (prefilter(tool, command)) log({ ...base, prefilter: true, verdict: 'off' });
    return;
  }
  if (!payload.cwd || !inRepository(payload.cwd) || !prefilter(tool, command)) return;
  const started = Date.now();
  const result = await judge(tool, command);
  const latencyMs = Date.now() - started;
  if (result.verdict === 'deny') {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `${result.reason} Start scripts/ci-wake.sh (or a background task that wakes you) and end the turn instead of waiting`,
        },
      })}\n`
    );
  }
  log({
    ...base,
    seat: await whoami(),
    prefilter: true,
    verdict: result.verdict,
    reason: result.reason,
    latencyMs,
    inputTokens: result.tokens?.input ?? null,
    outputTokens: result.tokens?.output ?? null,
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
