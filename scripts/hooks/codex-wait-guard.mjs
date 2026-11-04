#!/usr/bin/env node
// Codex `PreToolUse` hook that keeps seats from waiting on CI, a merge queue, a
// long build or another agent from the main session (#5897, #6003). It reads the
// hook JSON on stdin and either prints nothing (allow) or one deny document.
//
// Checks, in order:
// 1. A call whose `cwd` is outside this repository (the checkout holding this
//    script, or one of its worktrees) is allowed with no log line, so a global
//    wiring is inert elsewhere.
// 2. `TMT_WAIT_HOOK=off` allows, logged as `off` (the per-seat group switch).
// 3. A call that names the key cache is denied in every mode: its input, or a
//    script it runs, contains the cache directory's name (`tmt-codex-wait-guard-`),
//    resolves to it through a path or symlink, or globs a temporary directory into
//    it. This hook's own source is the one script exempt; Codex seats cannot edit
//    this hook or its test with apply_patch.
// 4. A short exact allowlist of calls that cannot wait skips the model, logged as
//    `skip`: `apply_patch`, and a Bash command that is one simple command (no
//    unquoted `; & | < > ( ) $` backtick, backslash or newline) running `rg`,
//    `grep`, `ls`, `cat`, `head`, `wc` or `pwd`, `git status|diff|log|show`, or
//    `sed -n`. `tail` is left out, since `tail -f` waits. One status read is
//    not a wait (repeating it is): `gh pr view|diff|checks|list`, `gh issue
//    view|list` and `gh run view|list` without `--watch`, and a `gh api` GET
//    (no `-X`/`--method` other than GET, no fields, no `--input`). So is
//    writing a file: `cat > file <<'EOF' … EOF` (or `>>`, or the redirection
//    after the heredoc) with a quoted delimiter, so nothing in the body expands
//    or runs, and nothing after the closing line.
//    Starting this repository's scripts/ci-wake.sh, the required CI waiter, is
//    also a `skip` (reason `ci-wake`): one command whose program resolves
//    (realpath) to `<worktree>/scripts/ci-wake.sh`, run directly or by
//    `sh`/`bash`, with any plain arguments, an optional leading `nohup`,
//    trailing redirections and a trailing `&`. A copy elsewhere, or anything
//    chained or wrapped around it, is judged. The host-health gate is a `skip`
//    (reason `host-health`) on the same terms, with exactly `--gate` and nothing
//    else: tmt-infra-lead's `host-health.sh` takes both readings itself. It lives
//    in that seat's notes directory, outside the repository, so the skip also
//    pins its content: only while its sha256 is HOST_HEALTH_SHA256, checked on
//    every call; any other content is judged. Changing that script needs a
//    guard update.
// 5. Every other call is judged by Anthropic's Messages API (`claude-haiku-5-5`,
//    a forced `verdict` tool call, JUDGE_MS in total including the key read). A
//    timeout, a network or HTTP error, a refusal, an unparsable or truncated answer or a
//    missing key allows (fail open), logged with that reason. Until ENFORCE is
//    true (shadow mode) a deny is only logged, as `enforced: false`.
//
// What leaves the machine: for each judged call, the tool name, its input (a Bash
// command with any heredoc, or another tool's input JSON) and the first 8 KiB of
// each script file the command runs (`sh|bash|python3|node … <file>` or
// `./file`) that resolves, after symlinks, inside the call's git worktree; never
// a file outside it. Before sending, values that look like secrets are replaced
// by [REDACTED] (`Authorization` and `x-api-key` headers, bearer tokens, `*_KEY`,
// `*_TOKEN`, `*_SECRET` and `*_PASSWORD` assignments, flags and JSON fields,
// credentials in URLs, and `sk-`, `ghp_`, `github_pat_`, `xox?-` and `AKIA`
// token shapes), and the input is cut to INPUT_CHARS.
//
// The key: the macOS Keychain item `tmt-codex-hook-anthropic` (`security
// find-generic-password -s … -w`; Ben creates it once with `security
// add-generic-password -a "$USER" -s tmt-codex-hook-anthropic -w`) is cached, by
// Ben's 11-03 decision, at $TMPDIR/tmt-codex-wait-guard-<uid>/key (directory
// 0700, file 0600, written atomically), so it is gone after a reboot. A missing
// or unreadable cache reads the Keychain once; a 401 or 403 drops the cache and
// re-reads the Keychain once. The key is never printed or logged, and only this
// hook reads it.
//
// The log: one JSONL line per call inside the repository, at
// ${XDG_STATE_HOME:-~/.local/state}/tmt/codex-wait-guard-YYYY-MM.jsonl (one file
// per UTC month; directory 0700, file 0600). A line holds the time, Codex
// session, tool, verdict, reason, seat, token counts, the judge's time and the
// hook's own wall time, and never the command text, input or script content.
// `node codex-wait-guard.mjs stats [--since 24h|7d] [--json]` summarizes the log
// with no network: counts by day and seat over every call (the denominator),
// fail-open reasons, judge and hook p50/p95, and the judge's cost.
//
// Codex gives hooks no event for re-polling a running session (`write_stdin`
// with empty input) or for code-mode `functions.wait`, so a wait is caught only
// when it starts; the AGENTS rule and scripts/ci-wake.sh stay the primary fix.
//
// TMT_WAIT_GUARD_URL (the Messages endpoint, honored only on a loopback host,
// since the key goes with it; any other host fails open without a request),
// TMT_WAIT_GUARD_LOG_DIR (the log directory) and TMT_WAIT_GUARD_NOW (the clock
// for `stats`) exist for isolated tests.
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

/** The one-line flip from shadow mode to enforcing denies, reviewed against a day of shadow data. */
const ENFORCE = false;
const MODEL = 'claude-haiku-5-5';
/** About twice the measured judge p95 (1.6 s, 11-03), under Codex's 5 s hook timeout. */
const JUDGE_MS = 3_500;
const WHOAMI_MS = 500;
const KEY_MS = 500;
const INPUT_CHARS = 8_000;
const SCRIPT_BYTES = 8_192;
const SCRIPTS = 4;
/** Haiku 5.5 USD per million tokens, for prompts of at most 100K tokens. */
const PRICE = { input: 0.1, output: 0.5 };
const BUDGET_USD_PER_MONTH = 200;
const JUDGE_URL = 'https://api.anthropic.com/v1/messages';
const KEYCHAIN_ITEM = 'tmt-codex-hook-anthropic';
const CACHE_PREFIX = 'tmt-codex-wait-guard-';
/** tmt-infra-lead's host-health gate, by its notes directory under the home directory. */
const HOST_HEALTH = [
  '.config',
  'tmt',
  'notes',
  'ada473fa-8c4d-4b12-9686-b44a77791a4b',
  'host-health.sh',
];
/** The reviewed content of that script; any other content is judged (#6003). */
const HOST_HEALTH_SHA256 = 'c46ddc1a37174c254f07e28e0f5a31affb399d7720fd1692d62c6f59aec5e909';

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

const POLICY = `You review one tool call an AI coding agent is about to make in a software repository. You see the tool name, its input, and the content of any repository script the call runs; secrets in them are replaced by [REDACTED].
Deny the call when it waits, sleeps or polls in any form, including inside a script or heredoc it writes or runs: sleep, a retry or watch loop, a background loop (&, nohup, while true), a timer or scheduled task, or repeated status checks of CI, pull requests, merge queues, deploys or other agents. The agent should start scripts/ci-wake.sh (or a provider background task that wakes it) and end its turn instead.
Starting scripts/ci-wake.sh, or a provider background task that wakes the agent, is the allowed way to wait; allow it.
One status read, such as a single gh pr view, gh pr checks without --watch or gh api request, is not a wait; only repeated or looped checks are.
Writing or editing a file is not a wait, even when the text it writes mentions sleeping or polling; judge only what the call runs.
Allow a test or build command whose own code waits briefly (for example a test waiting a few seconds for a local server), and everything that does not wait.
Record your decision with the verdict tool, with a reason of one short sentence.`;

const VERDICT_TOOL = {
  name: 'verdict',
  description: 'Record whether the tool call is allowed.',
  input_schema: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: ['allow', 'deny'] },
      reason: { type: 'string', description: 'One short sentence.' },
    },
    required: ['verdict', 'reason'],
    additionalProperties: false,
  },
};

/** Shell words with quotes removed, split at unquoted operators; `simple` is false when any appear. */
function shellWords(command) {
  const words = [];
  let word = '';
  let inWord = false;
  let quote = null;
  let simple = true;
  const end = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  for (const ch of command) {
    if (quote === "'") {
      if (ch === "'") quote = null;
      else word += ch;
    } else if (quote === '"') {
      if (ch === '"') quote = null;
      else {
        if ('$`\\'.includes(ch)) simple = false;
        word += ch;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (/\s/.test(ch)) {
      if (ch === '\n') simple = false;
      end();
    } else if (';&|<>()'.includes(ch)) {
      simple = false;
      end();
    } else {
      if ('$`\\'.includes(ch)) simple = false;
      word += ch;
      inWord = true;
    }
  }
  if (quote) simple = false;
  end();
  return { words, simple };
}

const READ_ONLY = new Set(['rg', 'grep', 'ls', 'cat', 'head', 'wc', 'pwd']);
/** `gh <group> <command>` reads that answer once; `--watch` turns one into a wait. */
const GH_READS = {
  pr: ['view', 'diff', 'checks', 'list'],
  issue: ['view', 'list'],
  run: ['view', 'list'],
};
/** `gh api` flags that make a request other than one GET. */
const GH_API_WRITES = /^(?:-X|--method|-f|-F|--field|--raw-field|--input)(?:=|$)|^-[XfF]./;

/** One gh status read: a listed read without `--watch`, or a `gh api` GET. */
function ghRead(words) {
  const [, group, command, ...rest] = words;
  if (group === 'api') {
    const flags = words.slice(2);
    return (
      flags.length > 0 &&
      flags.every(
        (word, index) =>
          !GH_API_WRITES.test(word) ||
          (/^(?:-X|--method)$/.test(word) && flags[index + 1]?.toUpperCase() === 'GET') ||
          /^(?:-X|--method=)GET$/i.test(word)
      )
    );
  }
  return (
    (GH_READS[group] ?? []).includes(command) &&
    !rest.some((word) => /^(?:--watch|-w)(?:=|$)/.test(word))
  );
}

/** `cat > file <<'EOF'` … `EOF`: a quoted delimiter, so the body never expands, ending at its line. */
const HEREDOC_WRITE =
  /^cat\s+(?:>>?\s*([^\s;&|<>()`$\\'"]+)\s+<<-?\s*'([A-Za-z_][A-Za-z0-9_]*)'|<<-?\s*'([A-Za-z_][A-Za-z0-9_]*)'\s+>>?\s*([^\s;&|<>()`$\\'"]+))[ \t]*\n/;

/** Writing one file from a quoted heredoc, with nothing before or after it. */
function writesFile(command) {
  const match = HEREDOC_WRITE.exec(command);
  if (!match) return false;
  const delimiter = match[2] ?? match[3];
  const body = command.slice(match[0].length).replace(/\n$/, '').split('\n');
  // The first line equal to the delimiter closes the heredoc; it must be the last.
  return body.findIndex((line) => line.replace(/^\t+/, '') === delimiter) === body.length - 1;
}

/** The exact allowlist of calls that cannot wait, which skip the model. */
export function allowlisted(tool, command) {
  if (tool === 'apply_patch') return true;
  if (tool !== 'Bash') return false;
  if (writesFile(command)) return true;
  const { words, simple } = shellWords(command);
  if (!simple || words.length === 0) return false;
  const [program, first] = words;
  if (program === 'pwd' || program === 'ls') return true;
  // Without an operand these read stdin.
  if (READ_ONLY.has(program)) return words.length > 1;
  if (program === 'git') return ['status', 'diff', 'log', 'show'].includes(first);
  if (program === 'gh') return ghRead(words);
  return program === 'sed' && first === '-n';
}

/** A trailing `&`, and redirections such as `> log 2>&1` or `< /dev/null`, at the end of a command. */
const TRAILING_REDIRECT =
  /\s+(?:\d*>&\d+|(?:\d*>>?|&>|<)\s*(?:'[^']*'|"[^"]*"|[^\s;&|<>()`$\\'"]+))$/;

/**
 * Whether the command only starts this repository's scripts/ci-wake.sh, the required
 * CI waiter, so its own polling loop is not mistaken for a wait in the main session. Anything chained or wrapped around it, or a copy elsewhere, is judged.
 */
export function startsCiWake(cwd, command) {
  const started = startedScript(cwd, command);
  const root = worktree(cwd);
  return Boolean(started && root) && started.file === path.join(root, 'scripts', 'ci-wake.sh');
}

/**
 * Whether the command only runs tmt-infra-lead's host-health gate with `--gate`, while that
 * script's content is the reviewed one. Arguments, chaining or other content are judged.
 */
export function runsHostHealthGate(cwd, command) {
  const started = startedScript(cwd, command);
  if (!started || started.args.length !== 1 || started.args[0] !== '--gate') return false;
  try {
    const gate = realpathSync(path.join(os.homedir(), ...HOST_HEALTH));
    return (
      started.file === gate &&
      createHash('sha256').update(readFileSync(gate)).digest('hex') === HOST_HEALTH_SHA256
    );
  } catch {
    return false;
  }
}

/**
 * The script one command starts and its arguments: one simple command, run directly or by
 * `sh`/`bash`, with an optional leading `nohup`, trailing redirections and a trailing `&`.
 * `file` is the program's realpath; null when the command is anything else.
 */
function startedScript(cwd, command) {
  let rest = command.trim();
  if (rest.endsWith('&') && !rest.endsWith('&&')) rest = rest.slice(0, -1).trimEnd();
  for (let match = TRAILING_REDIRECT.exec(rest); match; match = TRAILING_REDIRECT.exec(rest)) {
    rest = rest.slice(0, match.index);
  }
  const { words, simple } = shellWords(rest);
  if (!simple) return null;
  let at = words[0] === 'nohup' ? 1 : 0;
  if (['sh', 'bash'].includes(words[at])) at += 1;
  const program = words[at];
  if (!program || !program.includes('/')) return null;
  try {
    return { file: realpathSync(path.resolve(cwd, program)), args: words.slice(at + 1) };
  } catch {
    return null;
  }
}

const SECRET_PATTERNS = [
  [
    /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})/g,
    '[REDACTED]',
  ],
  [
    /\b((?:authorization|proxy-authorization)\s*:\s*)(?:(?:bearer|basic|token)\s+)?[^\s'",}]+/gi,
    '$1[REDACTED]',
  ],
  [/\b(x-api-key\s*:\s*)[^\s'",}]+/gi, '$1[REDACTED]'],
  [/\b(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]'],
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:'"]+:[^\s/@'"]+@/gi, '$1[REDACTED]@'],
  [/("[A-Za-z0-9_-]*(?:key|token|secret|password)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, '$1"[REDACTED]"'],
  [/\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))=("[^"]*"|'[^']*'|[^\s;&|]+)/gi, '$1=[REDACTED]'],
  [
    /(--?[A-Za-z0-9-]*(?:key|token|secret|password))(=|\s+)("[^"]*"|'[^']*'|[^\s;&|-][^\s;&|]*)/gi,
    '$1$2[REDACTED]',
  ],
];

/** Replace values that look like secrets, before anything leaves the machine. */
export function redact(text) {
  return SECRET_PATTERNS.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text
  );
}

const INTERPRETERS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'python',
  'python3',
  'node',
  'ruby',
  'perl',
  'bun',
  'deno',
]);

/** The git worktree holding `cwd`, resolved, or null. */
function worktree(cwd) {
  try {
    return realpathSync(
      execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1_000,
      }).trim()
    );
  } catch {
    return null;
  }
}

/** The first bytes of each script file the command runs, read only inside the call's worktree. */
function readScripts(cwd, command) {
  const { words } = shellWords(command);
  const candidates = new Set();
  words.forEach((word, at) => {
    if (INTERPRETERS.has(path.basename(word)) && words[at + 1] && !words[at + 1].startsWith('-')) {
      candidates.add(words[at + 1]);
    } else if (word.startsWith('./') || /\/[^/]+\.(sh|bash|py|mjs|cjs|js|ts|rb|pl)$/.test(word)) {
      candidates.add(word);
    }
  });
  if (candidates.size === 0) return [];
  const root = worktree(cwd);
  if (!root) return [];
  const scripts = [];
  for (const candidate of [...candidates].slice(0, SCRIPTS)) {
    try {
      const file = realpathSync(path.resolve(cwd, candidate));
      if (!file.startsWith(root + path.sep) || !statSync(file).isFile()) continue;
      const buffer = Buffer.alloc(SCRIPT_BYTES);
      const fd = openSync(file, 'r');
      const length = readSync(fd, buffer, 0, SCRIPT_BYTES, 0);
      closeSync(fd);
      scripts.push({
        file,
        path: path.relative(root, file),
        content: buffer.subarray(0, length).toString('utf8'),
      });
    } catch {
      // An unreadable script is judged by its command alone.
    }
  }
  return scripts;
}

function cacheDir() {
  return path.join(os.tmpdir(), `${CACHE_PREFIX}${process.getuid()}`);
}

function strings(value) {
  if (typeof value === 'string') return [value];
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

const TEMP_ROOT = /TMPDIR|\/tmp\b|\/var\/folders|\/private\/var/;

const SELF = fileURLToPath(import.meta.url);

/**
 * Whether the call names the key cache: by name, by a resolved path or symlink, or by a temp-dir
 * glob. This hook's own source, which names the cache to manage it, is the one script exempt.
 */
function touchesCache(tool, input, command, scripts, cwd) {
  const text = [
    command,
    ...scripts.filter((script) => script.file !== SELF).map((script) => script.content),
  ];
  if (text.some((part) => part.includes(CACHE_PREFIX))) return true;
  const words = (
    tool === 'Bash'
      ? shellWords(command).words
      : strings(input).flatMap((part) => part.split(/\s+/))
  )
    .filter(Boolean)
    .slice(0, 256);
  let tmp;
  try {
    tmp = realpathSync(os.tmpdir());
  } catch {
    tmp = os.tmpdir();
  }
  const name = path.basename(cacheDir());
  const dir = path.join(tmp, name);
  for (const word of words) {
    if (/[*?[]/.test(word)) {
      if (!TEMP_ROOT.test(word)) continue;
      const glob = (segment) =>
        new RegExp(
          `^${segment
            .replace(/[.+^${}()|\\]/g, '\\$&')
            .replace(/\*/g, '.*')
            .replace(/\?/g, '.')}$`
        );
      if (word.split('/').some((segment) => /[*?[]/.test(segment) && glob(segment).test(name)))
        return true;
      continue;
    }
    if (!word.includes('/')) continue;
    try {
      const real = realpathSync(path.resolve(cwd, word));
      if (real === dir || real.startsWith(dir + path.sep)) return true;
    } catch {
      // A path that does not resolve cannot reach the cache.
    }
  }
  return false;
}

function keychain() {
  try {
    const value = execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_ITEM, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: KEY_MS,
    }).replace(/\r?\n$/, '');
    return value || null;
  } catch {
    return null;
  }
}

function cachedKey() {
  try {
    const file = path.join(cacheDir(), 'key');
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0) return null;
    return readFileSync(file, 'utf8') || null;
  } catch {
    return null;
  }
}

function cacheKey(value) {
  const dir = cacheDir();
  const temp = path.join(dir, `key.${process.pid}`);
  try {
    mkdirSync(dir, { mode: 0o700 });
  } catch {
    // It exists; checked below.
  }
  try {
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.uid !== process.getuid()) return;
    chmodSync(dir, 0o700);
    writeFileSync(temp, value, { mode: 0o600, flag: 'wx' });
    renameSync(temp, path.join(dir, 'key'));
  } catch {
    try {
      unlinkSync(temp);
    } catch {
      // Nothing was written.
    }
  }
}

function dropCachedKey() {
  try {
    unlinkSync(path.join(cacheDir(), 'key'));
  } catch {
    // Already gone.
  }
}

/** `{value, cached}`: the cached key, else the Keychain item (then cached); value null on failure. */
function apiKey(fresh = false) {
  const cached = fresh ? null : cachedKey();
  if (cached) return { value: cached, cached: true };
  const value = keychain();
  if (value) cacheKey(value);
  return { value, cached: false };
}

function post(url, secret, content, deadline) {
  return fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    headers: {
      'content-type': 'application/json',
      'x-api-key': secret,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1_024,
      // Haiku 5.5 thinks adaptively by default; thinking would spend max_tokens and add latency.
      thinking: { type: 'disabled' },
      system: POLICY,
      tools: [VERDICT_TOOL],
      tool_choice: { type: 'tool', name: 'verdict' },
      messages: [{ role: 'user', content: JSON.stringify(content) }],
    }),
  });
}

const failOpen = (reason, tokens) => ({ verdict: 'fail_open', reason, tokens });

/** `{verdict, reason, tokens}`; `fail_open` for any failure, with a distinct reason. */
async function judge(content) {
  const deadline = Date.now() + JUDGE_MS;
  const url = judgeUrl();
  if (!url) return failOpen('untrusted judge url');
  let secret = apiKey();
  if (!secret.value) return failOpen('no key');
  let response;
  try {
    response = await post(url, secret.value, content, deadline);
    if ((response.status === 401 || response.status === 403) && secret.cached) {
      dropCachedKey();
      secret = apiKey(true);
      if (!secret.value) return failOpen('no key');
      response = await post(url, secret.value, content, deadline);
    }
  } catch (error) {
    return failOpen(error?.name === 'TimeoutError' ? 'timeout' : 'network');
  }
  if (!response.ok) return failOpen(`http ${response.status}`);
  let document;
  try {
    document = await response.json();
  } catch (error) {
    return failOpen(error?.name === 'TimeoutError' ? 'timeout' : 'parse');
  }
  const tokens = {
    input: document.usage?.input_tokens ?? null,
    output: document.usage?.output_tokens ?? null,
  };
  if (document.stop_reason === 'max_tokens') return failOpen('max_tokens', tokens);
  if (document.stop_reason === 'refusal') return failOpen('refusal', tokens);
  const call = (document.content ?? []).find(
    (part) => part.type === 'tool_use' && part.name === 'verdict'
  );
  if (!call) return failOpen('parse', tokens);
  const { verdict, reason } = call.input ?? {};
  if (verdict !== 'allow' && verdict !== 'deny') return failOpen('bad verdict', tokens);
  return { verdict, reason: String(reason ?? '').slice(0, 300), tokens };
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
    return commonDir(cwd) === commonDir(path.dirname(SELF));
  } catch {
    return false;
  }
}

function logDir() {
  if (process.env.TMT_WAIT_GUARD_LOG_DIR) return process.env.TMT_WAIT_GUARD_LOG_DIR;
  const state = process.env.XDG_STATE_HOME || path.join(os.homedir(), '.local', 'state');
  return path.join(state, 'tmt');
}

const LOG_NAME = /^codex-wait-guard(-\d{4}-\d{2})?\.jsonl$/;

function log(entry) {
  try {
    const dir = logDir();
    const file = path.join(dir, `codex-wait-guard-${entry.at.slice(0, 7)}.jsonl`);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    appendFileSync(file, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
    chmodSync(file, 0o600);
  } catch {
    // The log is evidence for later analysis; it never changes the verdict.
  }
}

/** The seat's identity, best effort, with its own short limit. */
function whoami() {
  return new Promise((resolve) => {
    execFile('tmt', ['whoami', '--json'], { timeout: WHOAMI_MS }, (error, stdout) => {
      if (error) return resolve(null);
      try {
        resolve(JSON.parse(stdout).name ?? null);
      } catch {
        resolve(null);
      }
    });
  });
}

function deny(reason) {
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    })}\n`
  );
}

async function main() {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return;
  }
  const tool = String(payload.tool_name ?? '');
  const input = payload.tool_input ?? {};
  // A shell call is judged by its command, any other tool by its input.
  const command = tool === 'Bash' ? String(input.command ?? '') : JSON.stringify(input);
  if (!payload.cwd || !inRepository(payload.cwd)) return;
  const base = { at: new Date().toISOString(), session: payload.session_id ?? null, tool };
  const finish = (entry) => log({ ...base, ...entry, hookMs: Math.round(performance.now()) });
  if (process.env.TMT_WAIT_HOOK === 'off') return finish({ verdict: 'off' });
  const scripts = tool === 'Bash' ? readScripts(payload.cwd, command) : [];
  if (touchesCache(tool, input, command, scripts, payload.cwd)) {
    deny("The call names the wait guard's private key cache, which no agent may read.");
    return finish({ verdict: 'deny', enforced: true, reason: 'key cache' });
  }
  if (allowlisted(tool, command)) return finish({ verdict: 'skip' });
  if (tool === 'Bash' && startsCiWake(payload.cwd, command)) {
    return finish({ verdict: 'skip', reason: 'ci-wake' });
  }
  if (tool === 'Bash' && runsHostHealthGate(payload.cwd, command)) {
    return finish({ verdict: 'skip', reason: 'host-health' });
  }
  const seat = whoami();
  const started = Date.now();
  const content = { tool, input: redact(command).slice(0, INPUT_CHARS) };
  if (scripts.length > 0) {
    content.scripts = scripts.map((script) => ({
      path: script.path,
      content: redact(script.content),
    }));
  }
  const result = await judge(content);
  const judgeMs = Date.now() - started;
  if (result.verdict === 'deny' && ENFORCE) {
    deny(
      `${result.reason} Start scripts/ci-wake.sh (or a background task that wakes you) and end the turn instead of waiting`
    );
  }
  finish({
    seat: await seat,
    verdict: result.verdict,
    ...(result.verdict === 'deny' ? { enforced: ENFORCE } : {}),
    reason: result.reason,
    judgeMs,
    inputTokens: result.tokens?.input ?? null,
    outputTokens: result.tokens?.output ?? null,
  });
}

const COUNTS = ['calls', 'skip', 'allow', 'deny', 'shadowDeny', 'failOpen', 'off'];

function quantiles(values) {
  if (values.length === 0) return { p50: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
  return { p50: at(0.5), p95: at(0.95) };
}

/** The summary of the log over a window, read from the log alone. */
export function summarize(lines, { now, sinceMs }) {
  const from = now - sinceMs;
  const seats = new Map();
  const entries = [];
  let corrupt = 0;
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      corrupt += 1;
      continue;
    }
    const at = typeof entry?.at === 'string' ? Date.parse(entry.at) : NaN;
    if (Number.isNaN(at)) {
      corrupt += 1;
      continue;
    }
    if (entry.session && entry.seat) seats.set(entry.session, entry.seat);
    if (at >= from && at <= now) entries.push(entry);
  }
  const empty = () => Object.fromEntries(COUNTS.map((name) => [name, 0]));
  const total = empty();
  const byDay = {};
  const bySeat = {};
  const failOpenReasons = {};
  const judgeMs = [];
  const hookMs = [];
  const tokens = { input: 0, output: 0 };
  for (const entry of entries) {
    const kind =
      entry.verdict === 'fail_open'
        ? 'failOpen'
        : entry.verdict === 'deny' && entry.enforced === false
          ? 'shadowDeny'
          : entry.verdict;
    if (!COUNTS.includes(kind) || kind === 'calls') continue;
    const day = entry.at.slice(0, 10);
    const seat = entry.seat ?? seats.get(entry.session) ?? 'unknown';
    for (const counts of [total, (byDay[day] ??= empty()), (bySeat[seat] ??= empty())]) {
      counts.calls += 1;
      counts[kind] += 1;
    }
    if (kind === 'failOpen')
      failOpenReasons[entry.reason] = (failOpenReasons[entry.reason] ?? 0) + 1;
    // Lines before #6003 named the judge's time latencyMs.
    const judged = entry.judgeMs ?? entry.latencyMs;
    if (typeof judged === 'number') judgeMs.push(judged);
    if (typeof entry.hookMs === 'number') hookMs.push(entry.hookMs);
    tokens.input += entry.inputTokens ?? 0;
    tokens.output += entry.outputTokens ?? 0;
  }
  const costUsd = (tokens.input * PRICE.input + tokens.output * PRICE.output) / 1e6;
  const costUsdPerDay = costUsd / (sinceMs / 86_400_000);
  return {
    from: new Date(from).toISOString(),
    to: new Date(now).toISOString(),
    corrupt,
    total,
    failOpenReasons,
    judgeMs: quantiles(judgeMs),
    hookMs: quantiles(hookMs),
    tokens,
    costUsd: Number(costUsd.toFixed(6)),
    costUsdPerDay: Number(costUsdPerDay.toFixed(6)),
    budgetUsdPerMonth: BUDGET_USD_PER_MONTH,
    byDay,
    bySeat,
  };
}

function stats(args) {
  const json = args.includes('--json');
  const sinceArg = args.includes('--since') ? args[args.indexOf('--since') + 1] : '24h';
  const since = /^(\d+)([hd])$/.exec(sinceArg ?? '');
  const unknown = args.filter(
    (arg, at) => arg !== '--json' && arg !== '--since' && args[at - 1] !== '--since'
  );
  if (!since || Number(since[1]) === 0 || unknown.length > 0) {
    process.stderr.write('usage: codex-wait-guard.mjs stats [--since <n>h|<n>d] [--json]\n');
    process.exitCode = 2;
    return;
  }
  const sinceMs = Number(since[1]) * (since[2] === 'h' ? 3_600_000 : 86_400_000);
  const now = process.env.TMT_WAIT_GUARD_NOW
    ? Date.parse(process.env.TMT_WAIT_GUARD_NOW)
    : Date.now();
  let files = [];
  try {
    files = readdirSync(logDir()).filter((name) => LOG_NAME.test(name));
  } catch {
    // No log yet.
  }
  const lines = files.flatMap((name) =>
    readFileSync(path.join(logDir(), name), 'utf8').split('\n').filter(Boolean)
  );
  const summary = summarize(lines, { now, sinceMs });
  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  const t = summary.total;
  const reasons = Object.entries(summary.failOpenReasons)
    .map(([reason, count]) => `${reason} ${count}`)
    .join(', ');
  process.stdout.write(
    [
      `Codex wait guard, ${summary.from} to ${summary.to}`,
      `calls ${t.calls} · skip ${t.skip} · allow ${t.allow} · deny ${t.deny} · shadow deny ${t.shadowDeny} · fail open ${t.failOpen}${reasons ? ` (${reasons})` : ''} · off ${t.off}`,
      `judge p50 ${summary.judgeMs.p50 ?? '-'} ms, p95 ${summary.judgeMs.p95 ?? '-'} ms · hook p50 ${summary.hookMs.p50 ?? '-'} ms, p95 ${summary.hookMs.p95 ?? '-'} ms`,
      `tokens ${summary.tokens.input} in, ${summary.tokens.output} out · $${summary.costUsd.toFixed(4)} ($${summary.costUsdPerDay.toFixed(4)}/day; budget $${BUDGET_USD_PER_MONTH}/month)`,
      ...(summary.corrupt ? [`${summary.corrupt} unreadable lines skipped`] : []),
    ].join('\n') + '\n'
  );
}

if (process.argv[1] && realpathSync(process.argv[1]) === SELF) {
  if (process.argv[2] === 'stats') stats(process.argv.slice(3));
  else await main();
}
