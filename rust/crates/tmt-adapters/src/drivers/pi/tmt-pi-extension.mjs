// Target: @earendil-works/pi-coding-agent >= 1.3.0
// Session, turn, prompt, and model lifecycle bridge for TMT (`tmt __hook pi`).
// Intentionally omits `tool_execution_end` and `turn_end` to avoid per-tool
// subprocess cost; `before_agent_start`..`agent_end`/`agent_settled` plus
// `ui_prompt_start`/`ui_prompt_end` already drive working, waiting, and idle.

import { spawnSync } from "node:child_process";

const EVENTS = [
  "session_start",
  "before_agent_start",
  "agent_end",
  "agent_settled",
  "ui_prompt_start",
  "ui_prompt_end",
  "model_select",
  "session_shutdown",
];

function sendHook(eventName, event, ctx) {
  const sessionId = ctx?.sessionManager?.getSessionId?.();
  if (typeof sessionId !== "string" || !sessionId) return undefined;
  const sessionFile = ctx?.sessionManager?.getSessionFile?.() ?? null;
  const model = event?.model?.id ?? ctx?.model?.id ?? null;
  const payload = {
    event: eventName,
    session_id: sessionId,
    session_file: typeof sessionFile === "string" ? sessionFile : null,
    reason: typeof event?.reason === "string" ? event.reason : null,
    model: typeof model === "string" ? model : null,
  };
  const bin = process.env.TMT_HOOK_BIN || "tmt";
  try {
    const result = spawnSync(bin, ["__hook", "pi"], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.status === 0 && typeof result.stdout === "string") {
      const trimmed = result.stdout.trim();
      if (trimmed) {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed.systemMessage === "string" && parsed.systemMessage) {
          return parsed;
        }
      }
    }
  } catch {
    // Never break Pi on hook failures.
  }
  return undefined;
}

export default function (pi) {
  if (!pi || typeof pi.on !== "function") return;
  for (const name of EVENTS) {
    pi.on(name, (event, ctx) => sendHook(name, event, ctx));
  }
}
