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
//    resolves to it through a path or symlink, or is a glob (braces expanded) whose
//    literal prefix is inside the cache, or is the temporary directory or one of
//    its ancestors with the rest of the pattern able to match the way down to the
//    cache's name. A glob under any other directory is not a cache read. This
//    hook's own source is the one script exempt; Codex seats cannot edit this hook
//    or its test with apply_patch.
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
//    chained or wrapped around it, goes on to the checks below; a `;`/`&&`
//    chain that ends with it is judged without that last segment (see 5). tmt-infra-lead's
//    host-health gate is a `skip` (reason `host-health`) on the same terms, with
//    exactly `--gate` and nothing else: its one ~60 s call takes both readings and
//    is a sanctioned wait. The pin is its content, not its path: any script whose
//    sha256 is HOST_HEALTH_SHA256, wherever it lives; any other content is judged.
//    Changing that script needs a guard update.
//    Running a known test runner once is a `skip` (reason `test`): one simple
//    command, after optional plain `NAME=value` words and `corepack`, that is
//    `cargo test`, `cargo nextest`, `node --test`, `vp test`, or `pnpm`/`npm`/
//    `npx` (with options, then optional `exec` or `run`) running `test`,
//    `vitest`, `vp test` or `playwright test`, with no `sleep` word and no
//    `--watch`, `-w` or `--ui` flag. A test that waits briefly for its own
//    fixture is not the agent waiting; anything chained, looped or wrapped
//    around the runner is judged, and test files are never sent. `npm|pnpm
//    [run] test` runs whatever the package's `test` script is, so this skip
//    trusts the repository's reviewed package.json scripts in the call's
//    worktree, and nothing outside it.
// 5. A `;` or `&&` chain whose last segment starts this repository's ci-wake.sh
//    (the check above) is sent to the judge, if it gets there (see 6), without
//    that segment, and the judge is told the call then starts it; only scripts
//    the rest runs are read. Nothing left is a `skip` (reason `ci-wake`). A
//    ci-wake.sh that is not last, or any chain with a loop keyword or
//    parentheses, is sent whole.
// 6. A Bash command with no wait primitive is a `skip` (reason `no-wait`), with no model
//    call: no `sleep`, `wait`, `while`/`until` loop, `watch` or `--watch`, `tail -f`,
//    `timeout`, `retry`, `nohup` or background `&` (see waitPrimitive). Quoted text is data,
//    except code handed to a shell or an interpreter; repository scripts the call runs are
//    read for the same primitives, and a script the hook cannot read counts by its command
//    line only. Starting ci-wake.sh anywhere in the command is never a primitive.
// 7. Every other call is judged by Anthropic's Messages API (`claude-haiku-5-5`,
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
/** The reviewed content of tmt-infra-lead's host-health gate, at any path; any other content is judged (#6003). */
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

const POLICY = `You review one tool call an AI coding agent is about to make in a software repository. You see the tool name, its input, and the content of any repository script the call runs; secrets in them are replaced by [REDACTED]. A shell command reaches you only because it holds a wait primitive (sleep, wait, a while or until loop, watch, following a log, a timeout or retry, nohup or a background &).
Deny only when this call itself waits or polls: it sleeps, loops over a repeated status check of CI, pull requests, merge queues, deploys or other agents, follows output, or leaves a background loop running. Never deny for anything else the call does, such as publishing, commenting, messaging, committing, editing files or notes, or text that only mentions waiting.
Starting scripts/ci-wake.sh, or a provider background task that wakes the agent, is the allowed way to wait; allow it, in the foreground or in the background.
One status read, such as a single gh pr view, gh pr checks without --watch or gh api request, is not a wait; only repeated or looped checks are.
A script whose content you are not shown is judged by its command line only; never deny because you cannot see it.
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

/** Package-manager options that take the next word as their value. */
const PACKAGE_VALUE_OPTIONS = new Set(['-C', '--dir', '--filter', '-F', '--prefix', '--workspace']);
/** Flags that keep a runner watching instead of running once. */
const WATCH_FLAGS = /^(?:--watch|-w|--ui)(?:=|$)/;

/** Whether `words` start a test run: `test`, `vitest`, `vp test` or `playwright test`. */
function testSubject(words) {
  const [subject, next] = words;
  if (subject === 'test' || subject === 'vitest') return true;
  return (subject === 'vp' || subject === 'playwright') && next === 'test';
}

/**
 * Whether the command runs a known test runner once (#6003): one simple command, no `sleep`,
 * no watch flag. Its own fixtures may wait briefly; the agent does not.
 */
export function runsTests(command) {
  const { words, simple } = shellWords(command);
  if (!simple || words.some((word) => word === 'sleep' || WATCH_FLAGS.test(word))) return false;
  let at = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[at] ?? '')) at += 1;
  if (words[at] === 'corepack') at += 1;
  const [program, ...rest] = words.slice(at);
  if (program === 'cargo') {
    const sub = rest.find((word) => !word.startsWith('+') && !word.startsWith('-'));
    return sub === 'test' || sub === 'nextest';
  }
  if (program === 'node') return rest.includes('--test');
  if (program === 'vp') return rest[0] === 'test';
  if (!['pnpm', 'npm', 'npx'].includes(program)) return false;
  let next = 0;
  while (rest[next]?.startsWith('-')) next += PACKAGE_VALUE_OPTIONS.has(rest[next]) ? 2 : 1;
  if (rest[next] === 'exec' || rest[next] === 'run') next += 1;
  return testSubject(rest.slice(next));
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
 * Whether the command only runs tmt-infra-lead's host-health gate with `--gate`: a script, at
 * any path, whose content is the reviewed one. Arguments, chaining or other content are judged.
 */
export function runsHostHealthGate(cwd, command) {
  const started = startedScript(cwd, command);
  if (!started || started.args.length !== 1 || started.args[0] !== '--gate') return false;
  try {
    return (
      createHash('sha256').update(readFileSync(started.file)).digest('hex') === HOST_HEALTH_SHA256
    );
  } catch {
    return false;
  }
}

const LOOP_WORDS = new Set(['while', 'until', 'for', 'do', 'done', 'select']);

/**
 * The command before a last `;` or `&&` segment that starts this repository's ci-wake.sh (empty
 * when nothing comes before it), or null: when there is no such segment, or the chain has
 * parentheses or a loop keyword.
 */
export function beforeCiWake(cwd, command) {
  let quote = null;
  let cut = null;
  for (let at = 0; at < command.length; at += 1) {
    const ch = command[at];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"') at += 1;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '\\') at += 1;
    else if (ch === '(' || ch === ')') return null;
    else if (ch === ';' || ch === '\n') cut = { end: at, start: at + 1 };
    else if (ch === '&' && command[at + 1] === '&') {
      cut = { end: at, start: at + 2 };
      at += 1;
    }
  }
  if (quote || !cut) return null;
  const rest = command.slice(0, cut.end).trim();
  if (!startsCiWake(cwd, command.slice(cut.start))) return null;
  if (shellWords(rest.replace(/;|&&|\|\|?/g, ' ')).words.some((word) => LOOP_WORDS.has(word))) {
    return null;
  }
  return rest;
}

/** Shell words that sleep, wait, loop, watch, time out, retry or detach a process (#6003). */
const WAIT_WORDS = new Set([
  'sleep',
  'wait',
  'while',
  'until',
  'watch',
  'nohup',
  'timeout',
  'gtimeout',
  'retry',
]);
/** The same primitives, and their library spellings, in code handed to an interpreter or a script. */
const WAIT_TEXT =
  /\b(?:sleep|wait|while|until|watch|nohup|timeout|retry|setTimeout|setInterval)\b|--watch\b|--follow\b|\btail\s+(?:-\S*\s+)*-[A-Za-z]*[fF]\b|[^&|>]&\s*$/m;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
/** Options whose next (quoted) word is code to run. */
const CODE_OPTIONS = new Set(['-c', '-lc', '-ic', '-e', '--eval']);
/** Runners whose `-w` or `--ui` keeps them watching. */
const WATCHERS = new Set(['vitest', 'vp', 'playwright', 'jest', 'tsc', 'tsx']);
/** Programs whose quoted words are shell code. */
const SHELL_RUNNERS = new Set(['eval', 'ssh', 'xargs']);

/**
 * The command split at unquoted `;`, `&&`, `||`, `|`, `&`, newlines, parentheses, `$(` and
 * backticks. Each segment keeps its raw text, its words (quoted ones marked), whether it ends in
 * a background `&`, its heredoc bodies, and the redirect targets it writes. Double-quoted text
 * holding `$(` or a backtick is returned as shell code, since it runs.
 */
function shellSegments(command) {
  const segments = [];
  const code = [];
  let segment;
  let start = 0;
  let word = '';
  let inWord = false;
  let quoted = false;
  let target = false;
  const pending = [];
  const open = (at) => {
    segment = { words: [], raw: '', background: false, heredocs: [], targets: [] };
    start = at;
  };
  const endWord = () => {
    if (inWord) {
      segment.words.push({ text: word, quoted });
      if (target) segment.targets.push(word);
      target = false;
    }
    word = '';
    inWord = false;
    quoted = false;
  };
  const endSegment = (at, next, background = false) => {
    endWord();
    segment.raw = command.slice(start, at).trim();
    segment.background = background;
    if (segment.words.length > 0 || segment.heredocs.length > 0) segments.push(segment);
    open(next);
  };
  open(0);
  for (let at = 0; at < command.length; at += 1) {
    const ch = command[at];
    const next = command[at + 1];
    if (ch === "'") {
      const close = command.indexOf("'", at + 1);
      const end = close === -1 ? command.length : close;
      word += command.slice(at + 1, end);
      inWord = true;
      quoted = true;
      at = end;
    } else if (ch === '"') {
      let text = '';
      let runs = false;
      for (at += 1; at < command.length && command[at] !== '"'; at += 1) {
        if (command[at] === '\\') text += command[++at] ?? '';
        else {
          if (command[at] === '`' || (command[at] === '$' && command[at + 1] === '(')) runs = true;
          text += command[at];
        }
      }
      if (runs) code.push(text);
      word += text;
      inWord = true;
      quoted = true;
    } else if (ch === '\\') {
      if (next === '\n') at += 1;
      else {
        word += next ?? '';
        inWord = true;
        at += 1;
      }
    } else if (ch === '#' && !inWord) {
      while (at + 1 < command.length && command[at + 1] !== '\n') at += 1;
    } else if (ch === '\n') {
      endWord();
      const at0 = at;
      // Heredoc bodies start on the next line, in the order their `<<` appeared.
      for (const heredoc of pending.splice(0)) {
        const body = [];
        let line = at + 1;
        while (line <= command.length) {
          const end = command.indexOf('\n', line);
          const text = command.slice(line, end === -1 ? command.length : end);
          const bare = heredoc.strip ? text.replace(/^\t+/, '') : text;
          at = end === -1 ? command.length : end;
          if (bare === heredoc.delimiter) break;
          body.push(text);
          if (end === -1) break;
          line = end + 1;
        }
        heredoc.segment.heredocs.push({ body: body.join('\n'), quoted: heredoc.quoted });
      }
      endSegment(at0, at + 1);
    } else if (/\s/.test(ch)) {
      endWord();
    } else if (ch === '<' && next === '<' && command[at + 2] !== '<') {
      endWord();
      at += 2;
      const strip = command[at] === '-';
      if (strip) at += 1;
      while (command[at] === ' ' || command[at] === '\t') at += 1;
      let delimiter = '';
      let quotedDelimiter = false;
      for (; at < command.length && !/[\s;&|<>()]/.test(command[at]); at += 1) {
        if (command[at] === "'" || command[at] === '"' || command[at] === '\\') {
          quotedDelimiter = true;
        } else delimiter += command[at];
      }
      at -= 1;
      pending.push({ delimiter, strip, quoted: quotedDelimiter, segment });
    } else if (ch === '<' || ch === '>') {
      endWord();
      if (ch === '>' && next === '>') at += 1;
      if (ch === '<' && next === '<') at += 2;
      if (command[at + 1] === '&') at += 1;
      else target = ch === '>';
    } else if (ch === '&') {
      if (next === '&') {
        endSegment(at, at + 2);
        at += 1;
      } else if (next === '>') {
        endWord();
        at += 1;
        if (command[at + 1] === '>') at += 1;
        target = true;
      } else endSegment(at, at + 1, true);
    } else if (ch === '|') {
      const skip = next === '|' || next === '&' ? 1 : 0;
      endSegment(at, at + 1 + skip);
      at += skip;
    } else if (ch === ';' || ch === '(' || ch === ')' || ch === '`') {
      endSegment(at, at + 1);
    } else if (ch === '$' && next === '(') {
      endSegment(at, at + 2);
      at += 1;
    } else {
      word += ch;
      inWord = true;
    }
  }
  endSegment(command.length, command.length);
  return { segments, code };
}

/** The first word that is not a `NAME=value` assignment, as a basename. */
function programOf(words) {
  const first = words.find((word) => word.quoted || !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word.text));
  return first ? path.basename(first.text) : '';
}

/**
 * The wait primitive a shell command holds, or null when it has none and needs no judge (#6003):
 * sleep, wait, a while or until loop, watch or --watch, tail -f, timeout or retry, nohup, or a
 * background `&`. Quoted text is data, except code handed to a shell or an interpreter (`-c`,
 * `-e`, `eval`, `ssh`, a heredoc it reads, or `$(…)` in double quotes); a heredoc another
 * segment of the call runs as a file is code too. Repository scripts the call runs are read for
 * the same primitives; a script the hook cannot read counts by its command line only. Starting
 * this repository's ci-wake.sh, in the foreground or background, is never a primitive.
 */
export function waitPrimitive(cwd, command, depth = 0) {
  if (depth > 4) return 'nesting';
  const { segments, code } = shellSegments(command);
  const run = segments.filter(
    (segment) => !startsCiWake(cwd, segment.background ? `${segment.raw} &` : segment.raw)
  );
  const named = new Set(
    run.flatMap((segment) => segment.words.map((word) => path.basename(word.text)))
  );
  // Shell code is scanned like the command; other code, or code whose language is unknown, by text.
  const inCode = (text, shell) =>
    (shell && waitPrimitive(cwd, text, depth + 1)) || WAIT_TEXT.exec(text)?.[0]?.trim() || null;
  for (const text of code) {
    const found = waitPrimitive(cwd, text, depth + 1);
    if (found) return found;
  }
  for (const segment of run) {
    const program = programOf(segment.words);
    for (const [at, word] of segment.words.entries()) {
      if (word.quoted) {
        const option = segment.words[at - 1]?.text;
        if (CODE_OPTIONS.has(option) || SHELL_RUNNERS.has(program)) {
          const found = inCode(word.text, SHELLS.has(program) || SHELL_RUNNERS.has(program));
          if (found) return found;
        }
        continue;
      }
      if (WAIT_WORDS.has(path.basename(word.text))) return path.basename(word.text);
      if (/^--watch(?:=|$)/.test(word.text)) return '--watch';
      if (WATCH_FLAGS.test(word.text) && segment.words.some((w) => WATCHERS.has(w.text))) {
        return word.text;
      }
      if (
        program === 'tail' &&
        /^(?:-[A-Za-z0-9]*[fF][A-Za-z0-9]*|--follow(?:=.*)?)$/.test(word.text)
      ) {
        return 'tail -f';
      }
    }
    if (segment.background) return '&';
    const runsBody =
      INTERPRETERS.has(program) ||
      segment.targets.some(
        (file) => named.has(path.basename(file)) && run.some((other) => other !== segment)
      );
    for (const heredoc of segment.heredocs) {
      const expands = !heredoc.quoted && /\$\(|`/.test(heredoc.body);
      if (!runsBody && !expands) continue;
      const found = inCode(heredoc.body, !INTERPRETERS.has(program) || SHELLS.has(program));
      if (found) return found;
    }
    for (const script of readScripts(cwd, segment.raw)) {
      const found = WAIT_TEXT.exec(script.content)?.[0];
      if (found) return found.trim();
    }
  }
  return null;
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

/** `a/{b,c}/d` as `a/b/d` and `a/c/d`, expanding every brace group. */
function expandBraces(word) {
  const match = /\{([^{}]*,[^{}]*)\}/.exec(word);
  if (!match) return [word];
  const head = word.slice(0, match.index);
  const tail = word.slice(match.index + match[0].length);
  return match[1].split(',').flatMap((choice) => expandBraces(head + choice + tail));
}

/** A glob path segment as an anchored regular expression. */
function globSegment(segment) {
  return new RegExp(
    `^${segment
      .replace(/[.+^${}()|\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`
  );
}

/**
 * Whether a glob can reach the key cache (#6003): its literal prefix (before the first wildcard
 * segment, `$NAME` expanded from this environment) is inside the cache, or is the temporary
 * directory or one of its ancestors and the rest of the pattern matches the path from there to
 * the cache directory's name. A glob under any other directory cannot, short of a symlink to the
 * cache planted there, which is accepted like any non-Codex reader.
 */
function globReachesCache(pattern, cwd, temps, name) {
  const expanded = pattern.replace(
    /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g,
    (_, variable) => process.env[variable] ?? ''
  );
  const segments = expanded.split('/');
  const first = segments.findIndex((segment) => /[*?[]/.test(segment));
  if (first === -1) return false;
  let prefix = path.resolve(
    cwd,
    segments.slice(0, first).join('/') || (expanded.startsWith('/') ? '/' : '.')
  );
  try {
    prefix = realpathSync(prefix);
  } catch {
    // A prefix that does not exist is compared as written.
  }
  const rest = segments.slice(first).filter(Boolean);
  for (const tmp of temps) {
    const cache = path.join(tmp, name);
    if (prefix === cache || prefix.startsWith(cache + path.sep)) return true;
    if (prefix !== tmp && !tmp.startsWith(prefix === path.sep ? prefix : prefix + path.sep))
      continue;
    if (rest.includes('**')) return true;
    const steps = path.relative(prefix, cache).split(path.sep);
    if (
      rest.length >= steps.length &&
      steps.every((step, at) => globSegment(rest[at]).test(step))
    ) {
      return true;
    }
  }
  return false;
}

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
  const temps = [...new Set([tmp, path.resolve(os.tmpdir())])];
  const name = path.basename(cacheDir());
  const dir = path.join(tmp, name);
  for (const word of words) {
    if (/[*?[]/.test(word)) {
      if (expandBraces(word).some((pattern) => globReachesCache(pattern, cwd, temps, name))) {
        return true;
      }
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
  if (tool === 'Bash' && runsTests(command)) return finish({ verdict: 'skip', reason: 'test' });
  if (tool === 'Bash' && startsCiWake(payload.cwd, command)) {
    return finish({ verdict: 'skip', reason: 'ci-wake' });
  }
  if (tool === 'Bash' && runsHostHealthGate(payload.cwd, command)) {
    return finish({ verdict: 'skip', reason: 'host-health' });
  }
  // The allowed waiter at the end of a chain is not judged with the rest (#6003).
  const before = tool === 'Bash' ? beforeCiWake(payload.cwd, command) : null;
  if (before === '') return finish({ verdict: 'skip', reason: 'ci-wake' });
  // Only a command that holds a wait primitive needs the judge (#6003).
  if (tool === 'Bash' && !waitPrimitive(payload.cwd, command)) {
    return finish({ verdict: 'skip', reason: 'no-wait' });
  }
  const seat = whoami();
  const started = Date.now();
  const content = { tool, input: redact(before ?? command).slice(0, INPUT_CHARS) };
  if (before !== null) content.next = 'the call then starts scripts/ci-wake.sh, which is allowed';
  const judged = before === null ? scripts : readScripts(payload.cwd, before);
  if (judged.length > 0) {
    content.scripts = judged.map((script) => ({
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
