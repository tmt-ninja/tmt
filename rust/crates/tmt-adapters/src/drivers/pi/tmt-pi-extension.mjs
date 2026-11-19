// Target: @earendil-works/pi-coding-agent >= 1.3.0
// Session, turn, prompt, and model lifecycle bridge for TMT (`tmt __hook pi`).
// Intentionally omits `tool_execution_end`, `turn_end`, and `agent_end` to avoid
// per-tool subprocess cost and duplicate turn-end events; `before_agent_start`..
// `agent_settled` plus `ui_prompt_start`/`ui_prompt_end` drive working, waiting, and idle.

import { spawnSync } from 'node:child_process';

const HOOK_BIN = __TMT_HOOK_BIN__;
const STARTUP_READY = __TMT_STARTUP_READY__;
const HOOK_INPUT_LIMIT = 64 * 1024;
const FINAL_TEXT_LIMIT = 16 * 1024;
const PLACEHOLDER_MODELS = new Set(['unknown', 'auto', 'default']);

const EVENTS = [
  'session_start',
  'before_agent_start',
  'agent_settled',
  'ui_prompt_start',
  'ui_prompt_end',
  'model_select',
  'session_shutdown',
];

function normalizeModel(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || PLACEHOLDER_MODELS.has(trimmed.toLowerCase())) return null;
  return trimmed;
}

function toWellFormed(text) {
  return typeof text.toWellFormed === 'function' ? text.toWellFormed() : text;
}

function sliceUtf8Bytes(text, maxBytes) {
  if (maxBytes <= 0 || !text) return '';
  let used = 0;
  let end = 0;
  for (const ch of text) {
    const chBytes = Buffer.byteLength(ch, 'utf8');
    if (used + chBytes > maxBytes) break;
    used += chBytes;
    end += ch.length;
  }
  return text.slice(0, end);
}

function latestAssistantText(ctx) {
  const branch = ctx?.sessionManager?.getBranch?.();
  if (!Array.isArray(branch) || branch.length === 0) return null;
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (entry?.type !== 'message') continue;
    const role = entry?.message?.role;
    if (role === 'user') return null;
    if (role !== 'assistant') continue;
    const blocks = entry.message.content;
    if (!Array.isArray(blocks)) return null;
    const parts = [];
    for (const block of blocks) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
        parts.push(block.text);
      }
    }
    return parts.length > 0 ? parts.join('\n') : null;
  }
  return null;
}

function encodeBoundedPayload(payload) {
  let json = JSON.stringify(payload);
  if (Buffer.byteLength(json, 'utf8') <= HOOK_INPUT_LIMIT) return json;
  for (const field of ['final_text', 'prompt']) {
    const value = payload[field];
    if (typeof value !== 'string') continue;
    if (field === 'final_text') delete payload.final_text_bytes;
    let limit = Buffer.byteLength(value, 'utf8');
    while (Buffer.byteLength(json, 'utf8') > HOOK_INPUT_LIMIT && limit > 0) {
      const excess = Buffer.byteLength(json, 'utf8') - HOOK_INPUT_LIMIT;
      limit = Math.max(0, limit - Math.max(excess, Math.ceil(limit / 4)));
      if (limit > 0) {
        const sliced = sliceUtf8Bytes(value, limit);
        if (sliced) {
          payload[field] = sliced;
        } else {
          delete payload[field];
        }
      } else {
        delete payload[field];
      }
      json = JSON.stringify(payload);
    }
  }
  return Buffer.byteLength(json, 'utf8') <= HOOK_INPUT_LIMIT ? json : null;
}

function sendHook(eventName, event, ctx) {
  if (!HOOK_BIN) return;
  const sessionId = ctx?.sessionManager?.getSessionId?.();
  if (typeof sessionId !== 'string' || !sessionId) return;
  const sessionFile = ctx?.sessionManager?.getSessionFile?.() ?? null;
  const model = normalizeModel(event?.model?.id ?? ctx?.model?.id ?? null);
  const payload = {
    event: eventName,
    idle: ctx?.isIdle?.() === true,
    startup_ready: STARTUP_READY && ctx?.mode === 'tui' && ctx?.isIdle?.() === true,
    session_id: sessionId,
    session_file: typeof sessionFile === 'string' ? sessionFile : null,
    reason: typeof event?.reason === 'string' ? event.reason : null,
    model,
  };
  if (
    eventName === 'before_agent_start' &&
    event?.messageType === 'user' &&
    typeof event?.prompt === 'string' &&
    event.prompt.length > 0
  ) {
    payload.prompt = toWellFormed(event.prompt);
  }
  if (eventName === 'agent_settled') {
    const aborted = event?.aborted === true;
    payload.aborted = aborted;
    if (!aborted) {
      const rawFinal = latestAssistantText(ctx);
      if (rawFinal) {
        const cleanFinal = toWellFormed(rawFinal);
        const originalBytes = Buffer.byteLength(cleanFinal, 'utf8');
        const kept =
          originalBytes > FINAL_TEXT_LIMIT ? sliceUtf8Bytes(cleanFinal, FINAL_TEXT_LIMIT) : cleanFinal;
        if (kept.length > 0) {
          payload.final_text = kept;
          if (originalBytes > Buffer.byteLength(kept, 'utf8')) {
            payload.final_text_bytes = originalBytes;
          }
        }
      }
    }
  }
  const input = encodeBoundedPayload(payload);
  if (input === null) return;
  try {
    spawnSync(HOOK_BIN, ['__hook', 'pi'], {
      input,
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 5000,
    });
  } catch {
    // Never break Pi on hook failures.
  }
}

export default function (pi) {
  if (!pi || typeof pi.on !== 'function') return;
  for (const name of EVENTS) {
    pi.on(name, (event, ctx) => sendHook(name, event, ctx));
  }
}
