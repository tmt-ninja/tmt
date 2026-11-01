import snapshot from "./stats.json" with { type: "json" };
const text = (value, limit) =>
  typeof value === "string" &&
  value.trim() &&
  value.length <= limit &&
  ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
const shape = (value, keys) =>
  value &&
  !Array.isArray(value) &&
  typeof value === "object" &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
export function validateStats(value) {
  const ids = ["subscriptions", "loop", "agents", "prs", "code"];
  if (
    !shape(value, ["asOf", "metrics", "note"]) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.asOf) ||
    !Number.isFinite(Date.parse(value.asOf)) ||
    new Date(value.asOf).toISOString().slice(0, 10) !== value.asOf ||
    !text(value.note, 2000) ||
    !Array.isArray(value.metrics) ||
    value.metrics.length !== ids.length ||
    value.metrics.some(
      (metric, index) =>
        !shape(metric, ["id", "value", "label"]) ||
        metric.id !== ids[index] ||
        !text(metric.value, 64) ||
        !text(metric.label, 160),
    )
  )
    throw new Error("Invalid blog stats snapshot");
  return value;
}
export const stats = validateStats(snapshot);
