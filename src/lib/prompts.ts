// Prompts live in /prompts as versioned markdown files (project rule 6). The file stem is the version
// recorded in debate logs and cache keys, e.g. "judge.v1".
import { readFileSync } from "node:fs";
import path from "node:path";

export const PROMPT_VERSIONS = {
  extract_bill: "extract_bill.v1",
  extract_summary: "extract_summary.v1",
  normalize: "normalize.v1",
  clinical: "clinical.v1",
  auditor: "auditor.v1",
  defender: "defender.v1",
  judge: "judge.v1",
} as const;
export type PromptName = keyof typeof PROMPT_VERSIONS;

const loaded = new Map<string, string>();

/** Shared rules appended to every prompt so tone and number rules cannot drift between files. */
const COMMON = "common.v1";

export function loadPrompt(name: PromptName): { text: string; version: string } {
  const version = PROMPT_VERSIONS[name];
  const read = (v: string) => {
    if (!loaded.has(v)) loaded.set(v, readFileSync(path.join(process.cwd(), "prompts", `${v}.md`), "utf8"));
    return loaded.get(v)!;
  };
  return { text: `${read(version)}\n\n${read(COMMON)}`, version: `${version}+${COMMON}` };
}
