// Response cache (SPEC 0.5/0.7). Key = sha256(stage + prompt version + model + canonical JSON input).
// Disk cache under /cache/<stage>/<key>.json is committed to git and holds ONLY the built-in synthetic samples
// (written by scripts/warm-sample-cache.ts). Uploaded documents are cached in memory only, never on disk,
// so a real bill can never end up in the repository.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

export const cacheDir = () => process.env.KANAKKU_CACHE_DIR || path.join(process.cwd(), "cache");

/** JSON with sorted object keys, so the same input always hashes the same. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object")
    return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

export const cacheKey = (stage: string, promptVersion: string, model: string, input: unknown) =>
  createHash("sha256").update(`${stage}\n${promptVersion}\n${model}\n${canonicalJson(input)}`).digest("hex");

export type CacheEntry = { stage: string; prompt_version: string; model: string; output: unknown; usage?: { input_tokens: number; output_tokens: number } };

const memory = new Map<string, CacheEntry>();
const MEMORY_MAX = 300;

export function readCache(stage: string, key: string): CacheEntry | null {
  const m = memory.get(key);
  if (m) return m;
  const file = path.join(/*turbopackIgnore: true*/ cacheDir(), stage, `${key}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as CacheEntry;
  } catch {
    return null; // a corrupt cache file is treated as a miss, never as data
  }
}

export function writeCache(key: string, entry: CacheEntry, persist: boolean) {
  if (persist) {
    const dir = path.join(/*turbopackIgnore: true*/ cacheDir(), entry.stage);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(entry, null, 2) + "\n");
    return;
  }
  if (memory.size >= MEMORY_MAX) memory.delete(memory.keys().next().value!);
  memory.set(key, entry);
}

export const clearMemoryCache = () => memory.clear();

/**
 * Which models produced the committed sample cache. Sample runs use these ids (not the env), so the demo
 * replays from cache on any deployment, even one with no API key or model configured.
 */
export type SampleManifest = { extract_model: string; reason_model: string; warmed_on: string };
export function readSampleManifest(): SampleManifest | null {
  try {
    return JSON.parse(readFileSync(path.join(cacheDir(), "manifest.json"), "utf8")) as SampleManifest;
  } catch {
    return null;
  }
}
export function writeSampleManifest(m: SampleManifest) {
  mkdirSync(cacheDir(), { recursive: true });
  writeFileSync(path.join(cacheDir(), "manifest.json"), JSON.stringify(m, null, 2) + "\n");
}
