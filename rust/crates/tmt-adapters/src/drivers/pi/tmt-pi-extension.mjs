// Target: @earendil-works/pi-coding-agent >= 1.3.0
// Session, turn, prompt, and model lifecycle bridge for TMT (`tmt __hook pi`).
// Intentionally omits `tool_execution_end`, `turn_end`, and `agent_end` to avoid
// per-tool subprocess cost and duplicate turn-end events; `before_agent_start`..
// `agent_settled` plus `ui_prompt_start`/`ui_prompt_end` drive working, waiting, and idle.

import { spawnSync } from "node:child_process";

const HOOK_BIN = __TMT_HOOK_BIN__;

const EVENTS = [
  "session_start",
  "before_agent_start",
  "agent_settled",
  "ui_prompt_start",
  "ui_prompt_end",
  "model_select",
  "session_shutdown",
];

function sendHook(eventName, event, ctx) {
  if (!HOOK_BIN) return;
  const sessionId = ctx?.sessionManager?.getSessionId?.();
  if (typeof sessionId !== "string" || !sessionId) return;
  const sessionFile = ctx?.sessionManager?.getSessionFile?.() ?? null;
  const model = event?.model?.id ?? ctx?.model?.id ?? null;
  const payload = {
    event: eventName,
    session_id: sessionId,
    session_file: typeof sessionFile === "string" ? sessionFile : null,
    reason: typeof event?.reason === "string" ? event.reason : null,
    model: typeof model === "string" ? model : null,
  };
  try {
    spawnSync(HOOK_BIN, ["__hook", "pi"], {
      input: JSON.stringify(payload),
      stdio: ["pipe", "ignore", "ignore"],
      timeout: 5000,
    });
  } catch {
    // Never break Pi on hook failures.
  }
}

export default function (pi) {
  if (!pi || typeof pi.on !== "function") return;
  for (const name of EVENTS) {
    pi.on(name, (event, ctx) => sendHook(name, event, ctx));
  }
}
