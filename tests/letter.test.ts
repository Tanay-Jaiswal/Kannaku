// Dispute letter (Phase 6), workflow helpers and secret handling: pure functions and file checks, no browser.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildLetter, letterSync } from "../src/lib/letter";
import { debateOrder, numberCandidates } from "../src/lib/flow";
import { runPipeline } from "../src/lib/pipeline";
import { setProviderForTests } from "../src/lib/llm/call";
import { loadSample } from "../src/lib/samples";
import { resetSpendState } from "../src/lib/spend";
import { BANNED_WORD_FRAGMENTS, UNVERIFIED_REFERENCE_LABEL } from "../src/lib/config";
import { DrugTable, type PipelineResult } from "../src/lib/schemas";
import { numberGuardViolations, tokensFrom } from "../src/lib/numberGuard";
import { MockProvider, testEnv } from "./helpers/mockProvider";
import { scriptedModel } from "./helpers/scriptedModel";

const table = DrugTable.parse(JSON.parse(readFileSync("data/reference/drug_reference.json", "utf8")));
let result: PipelineResult;

beforeAll(async () => {
  testEnv(mkdtempSync(path.join(tmpdir(), "kanakku-letter-")));
  resetSpendState();
  setProviderForTests(new MockProvider([], scriptedModel("bill-02-demo")));
  const s = loadSample("bill-02-demo");
  result = await runPipeline({ billDraft: s.bill_draft, summaryDraft: s.summary_draft, dataLabel: "Synthetic data", table, ctx: { runId: "run-letter-01", clientId: "l", mode: "live" } });
  setProviderForTests(null);
});

describe("dispute letter", () => {
  it("includes only the selected findings, with code amounts and line ids, and a de-duplicated total", () => {
    const letter = buildLetter(result, ["F-001", "F-004"], { today: "2026-10-10" });
    expect(letter).toMatch(/^SYNTHETIC DATA - DEMO LETTER/);
    expect(letter).toContain("Bill line(s): L003");
    expect(letter).toContain("Amount to clarify: ₹1,500.00");
    expect(letter).toContain("Total amount I am asking you to clarify: ₹1,508.58");
    expect(letter).not.toContain("L016"); // F-002 not selected
  });

  it("never includes dropped findings, and is empty with nothing selected", () => {
    const dropped = result.findings.find((f) => f.status === "dropped")!;
    expect(buildLetter(result, [dropped.id])).toBe("");
    expect(buildLetter(result, [])).toBe("");
  });

  it("contains no figure that is not in the result, and no banned word", () => {
    const letter = buildLetter(result, result.findings.map((f) => f.id), { today: "2026-10-10" });
    const known = tokensFrom([
      ...result.findings.flatMap((f) => [...f.allowed_tokens, ...Object.values(f.evidence).map(String), f.counter_argument]),
      "₹7,931.44",
    ]);
    expect(numberGuardViolations(letter, known)).toEqual([]);
    for (const w of BANNED_WORD_FRAGMENTS) expect(letter.toLowerCase()).not.toContain(w);
    expect(letter).toMatch(/not legal, medical or insurance advice/);
  });

  it("shows the unverified-reference label when a selected finding relies on an unverified row", () => {
    const f = result.findings.find((x) => x.type === "DRUG_ABOVE_LIMIT")!;
    const fake: PipelineResult = { ...result, findings: [{ ...f, evidence: { ...f.evidence, reference_verified: false } }] };
    expect(buildLetter(fake, [f.id])).toContain(UNVERIFIED_REFERENCE_LABEL);
  });

  it("a user-upload letter has no synthetic banner", () => {
    expect(buildLetter({ ...result, data_label: "User upload" }, ["F-001"])).not.toMatch(/SYNTHETIC/);
  });
});

describe("workflow helpers", () => {
  const c = (tier: "Provable" | "Ask", amt: number) => ({
    type: "ARITH_LINE" as const, detector: "D1_ARITH_DUP" as const, line_item_ids: [], amount_at_stake: amt,
    rule_or_source_cited: { rule_id: "x", description: "d", source: "s" }, initial_tier: tier, confidence: "high" as const, evidence: {}, allowed_tokens: [],
  });
  it("numbers rule candidates before clinical ones", () => {
    expect(numberCandidates([c("Ask", 1)], [c("Ask", 2)]).map((x) => x.id)).toEqual(["F-001", "F-002"]);
  });
  it("debates the most important findings first when the limit is small", () => {
    const n = numberCandidates([c("Ask", 900), c("Provable", 5), c("Ask", 50)], []);
    expect(debateOrder(n, 2).debate.map((x) => x.id)).toEqual(["F-001", "F-002"]);
    expect(debateOrder(n, 0).debate).toEqual([]);
  });
});

describe("letter stays in step with the selection", () => {
  // Regression: an edited letter used to keep printing findings the user had since unticked.
  it("is stale once the selection changes after an edit, and only then", () => {
    const ids = result.findings.filter((f) => f.status !== "dropped").map((f) => f.id);
    expect(ids.length).toBeGreaterThan(1);
    const before = buildLetter(result, ids, { today: "2026-10-10" });
    const after = buildLetter(result, ids.slice(1), { today: "2026-10-10" });
    expect(letterSync(before, false, null)).toBe("generated");
    expect(letterSync(before, true, before)).toBe("edited");
    expect(letterSync(after, true, before)).toBe("stale");
    expect(letterSync("", true, before)).toBe("stale"); // everything unticked after editing
    expect(letterSync(before, true, before)).toBe("edited"); // re-ticking restores the original selection
  });
});

describe("secret handling", () => {
  it("no client component or browser helper imports the provider SDK, the key, or Node modules", () => {
    // Every component (all of them render in the browser) plus the browser-side helpers.
    const components = readdirSync("src/components").filter((f) => f.endsWith(".tsx")).map((f) => `src/components/${f}`);
    expect(components.length).toBeGreaterThan(8);
    const files = [...components, "src/lib/client/runAudit.ts", "src/lib/flow.ts", "src/lib/letter.ts", "src/lib/present.ts", "src/lib/totals.ts"];
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/@anthropic-ai|ANTHROPIC_API_KEY|llm\/|node:fs/);
  });
  it(".env.example holds placeholders only", () => {
    const env = readFileSync(".env.example", "utf8");
    expect(env).toMatch(/^ANTHROPIC_API_KEY=\s*$/m);
    expect(env).not.toMatch(/sk-ant-/);
  });
  it(".gitignore keeps local env files out of git", () => {
    const gi = readFileSync(".gitignore", "utf8");
    expect(gi).toMatch(/^\.env$/m);
    expect(gi).toMatch(/^\.env\.local$/m);
  });
});
