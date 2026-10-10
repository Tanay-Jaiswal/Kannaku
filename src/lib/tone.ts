// Tone lint (project rule 7). Banned words are enforced here, not just requested in prompts.
import { BANNED_WORD_FRAGMENTS } from "./config";

/** Banned fragments found in any string inside `value` (deep). Case-insensitive. */
export function toneViolations(value: unknown): string[] {
  const text = collectText(value).join("\n").toLowerCase();
  return BANNED_WORD_FRAGMENTS.filter((w) => text.includes(w));
}

export function collectText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (value && typeof value === "object") return Object.values(value).flatMap(collectText);
  return [];
}
