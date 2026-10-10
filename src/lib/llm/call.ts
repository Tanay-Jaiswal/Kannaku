// LLM wrapper contract (SPEC 5): cache lookup -> (cache-only? fail) -> spend guard -> provider call -> strip
// fences -> JSON.parse -> zod -> stage guard (number guard, tone lint) -> on failure retry ONCE with the
// validation error -> second failure throws MODEL_OUTPUT_INVALID. Only validated outputs are cached.
import type Anthropic from "@anthropic-ai/sdk";
import type { z } from "zod";
import { DEMO_MODEL, cacheOnly } from "../config";
import { demoAnswer } from "../demo";
import { KanakkuError } from "../errors";
import { limits } from "../limits";
import { cacheKey, readCache, readSampleManifest, writeCache } from "../cache";
import { loadPrompt, type PromptName } from "../prompts";
import { recordUsage, reserveCall, type RunContext } from "../spend";
import { AnthropicProvider, type LlmProvider } from "./provider";

let override: LlmProvider | null = null;
/** Tests (and only tests) install a mock provider here. */
export const setProviderForTests = (p: LlmProvider | null) => { override = p; };

function provider(): LlmProvider {
  if (override) return override;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new KanakkuError("MISSING_CONFIG", "Live analysis is not configured on this server (no API key). Try a sample bill instead.", "ANTHROPIC_API_KEY unset");
  return new AnthropicProvider(key);
}

export function modelFor(kind: "extract" | "reason", mode: RunContext["mode"] = "live"): string {
  if (mode === "demo") return DEMO_MODEL;
  if (mode === "sample") {
    const m = readSampleManifest();
    if (!m) throw new KanakkuError("CACHE_MISS", "No recorded AI review for the sample bills is deployed here, so this step did not run.", "cache/manifest.json missing");
    return kind === "extract" ? m.extract_model : m.reason_model;
  }
  const name = kind === "extract" ? "MODEL_EXTRACT" : "MODEL_REASON";
  const v = process.env[name]?.trim();
  if (!v) throw new KanakkuError("MISSING_CONFIG", `The AI model is not configured on this server (${name}). Try a sample bill instead.`, `${name} unset`);
  return v;
}

export type CallJsonArgs<T> = {
  stage: string;
  prompt: PromptName;
  modelKind: "extract" | "reason";
  /** Everything that determines the answer; hashed for the cache key. Files go in as their sha256, not bytes. */
  keyInput: unknown;
  /** Text payload sent to the model after the system prompt (usually JSON). */
  userText: string;
  /** Document/image blocks placed before the text (extraction only). */
  attachments?: Anthropic.ContentBlockParam[];
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Extra checks on the parsed output (number guard, tone lint, id checks). Return problems; empty = ok. */
  guard?: (out: T) => string[];
  ctx: RunContext;
};

export type CallJsonResult<T> = { output: T; promptVersion: string; model: string; cacheKey: string; cached: boolean };

export async function callJson<T>(a: CallJsonArgs<T>): Promise<CallJsonResult<T>> {
  const { text: system, version } = loadPrompt(a.prompt);
  const model = modelFor(a.modelKind, a.ctx.mode);
  const key = cacheKey(a.stage, version, model, a.keyInput);

  // Precomputed demonstration (synthetic samples only): a scripted answer instead of a model, never cached,
  // never sent anywhere, and validated exactly like a model answer. A script that fails the checks fails loudly.
  if (a.ctx.mode === "demo") {
    if (!a.ctx.sampleId) throw new KanakkuError("BAD_INPUT", "The demonstration review only covers the built-in sample documents.", "demo without sampleId");
    const checked = validate(JSON.stringify(demoAnswer(a.stage, a.ctx.sampleId, JSON.parse(a.userText))), "end_turn", a);
    if (!checked.ok)
      throw new KanakkuError("MODEL_OUTPUT_INVALID", "The demonstration review for this sample failed Kanakku's checks, so it was not used.", `demo stage=${a.stage}: ${checked.reason}`);
    return { output: checked.value, promptVersion: version, model, cacheKey: key, cached: false };
  }

  const hit = readCache(a.stage, key);
  if (hit) {
    // Cached outputs are re-validated: a stale or hand-edited file can never inject an unchecked value.
    const parsed = a.schema.safeParse(hit.output);
    const problems = parsed.success ? (a.guard?.(parsed.data) ?? []) : ["schema"];
    if (parsed.success && problems.length === 0) return { output: parsed.data, promptVersion: version, model, cacheKey: key, cached: true };
  }

  if (a.ctx.mode === "sample")
    throw new KanakkuError("CACHE_MISS",
      "The recorded AI review for this sample is incomplete on this deployment, so this step did not run. Sample bills never call the AI live or spend API credit.",
      `stage=${a.stage}`);
  if (a.ctx.mode === "live" && cacheOnly())
    throw new KanakkuError("LIVE_DISABLED",
      "Live analysis of uploaded documents is switched off on this deployment (cache-only mode). Try a sample bill instead.", "KANAKKU_CACHE_ONLY");

  const p = provider();
  const l = limits();
  let feedback = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    reserveCall(a.ctx);
    const res = await p.complete({
      model, system, maxTokens: l.maxOutputTokens, timeoutMs: l.timeoutMs,
      content: [...(a.attachments ?? []), { type: "text", text: a.userText + feedback }],
    });
    recordUsage(a.ctx, res.inputTokens, res.outputTokens);
    const problem = validate(res.text, res.stopReason, a);
    if (problem.ok) {
      writeCache(key, { stage: a.stage, prompt_version: version, model, output: problem.value, usage: { input_tokens: res.inputTokens, output_tokens: res.outputTokens } }, a.ctx.mode === "warm");
      return { output: problem.value, promptVersion: version, model, cacheKey: key, cached: false };
    }
    if (attempt === 2)
      throw new KanakkuError("MODEL_OUTPUT_INVALID", "The AI returned an answer that failed Kanakku's safety checks twice, so it was not used.", `stage=${a.stage}: ${problem.reason}`);
    feedback = `\n\nYOUR PREVIOUS ANSWER WAS REJECTED: ${problem.reason}\nReturn one corrected JSON object only, following every rule.`;
  }
  throw new Error("unreachable");
}

type Validated<T> = { ok: true; value: T } | { ok: false; reason: string };

function validate<T>(raw: string, stopReason: string | null, a: CallJsonArgs<T>): Validated<T> {
  if (stopReason === "max_tokens") return { ok: false, reason: "the answer was cut off; be more concise" };
  let json: unknown;
  try {
    json = JSON.parse(extractJson(raw));
  } catch {
    return { ok: false, reason: "output was not valid JSON" };
  }
  const parsed = a.schema.safeParse(json);
  if (!parsed.success)
    return { ok: false, reason: "schema errors: " + parsed.error.issues.slice(0, 6).map((i) => `${i.path.join(".") || "(root)"} ${i.message}`).join("; ") };
  const problems = a.guard?.(parsed.data) ?? [];
  if (problems.length) return { ok: false, reason: problems.slice(0, 6).join("; ") };
  return { ok: true, value: parsed.data };
}

/** Strips markdown fences and any prose around the outermost JSON object. */
export function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const s = (fenced ? fenced[1]! : raw).trim();
  const start = s.indexOf("{"), end = s.lastIndexOf("}");
  return start >= 0 && end > start ? s.slice(start, end + 1) : s;
}
