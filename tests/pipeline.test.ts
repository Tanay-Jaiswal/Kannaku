// End-to-end pipeline with a scripted mock model (no network, no API key). Checks plumbing and code-enforced
// rules against the synthetic answer keys: candidates vs kept vs dropped, traps dropped, totals de-duplicated.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setProviderForTests } from "../src/lib/llm/call";
import { clearMemoryCache, writeSampleManifest } from "../src/lib/cache";
import { resetSpendState, type RunContext } from "../src/lib/spend";
import { runPipeline } from "../src/lib/pipeline";
import { loadSample } from "../src/lib/samples";
import { DrugTable, PipelineResult } from "../src/lib/schemas";
import { BANNED_WORD_FRAGMENTS, SAMPLE_BILL_IDS } from "../src/lib/config";
import { MockProvider, testEnv } from "./helpers/mockProvider";
import { scriptedModel } from "./helpers/scriptedModel";

const table = DrugTable.parse(JSON.parse(readFileSync("data/reference/drug_reference.json", "utf8")));
const key = (dir: string) => JSON.parse(readFileSync(`data/synthetic/${dir}/answer_key.json`, "utf8"));
let n = 0;
const ctx = (o: Partial<RunContext> = {}): RunContext => ({ runId: `run-pipe-${String(++n).padStart(4, "0")}`, clientId: `c${n}`, mode: "live", ...o });
const run = (dir: (typeof SAMPLE_BILL_IDS)[number], c: RunContext = ctx()) => {
  const s = loadSample(dir);
  return runPipeline({ billDraft: s.bill_draft, summaryDraft: s.summary_draft, dataLabel: "Synthetic data", ctx: c, table });
};

beforeEach(() => {
  testEnv(mkdtempSync(path.join(tmpdir(), "kanakku-pipe-")));
  clearMemoryCache();
  resetSpendState();
});
afterEach(() => { setProviderForTests(null); delete process.env.KANAKKU_MAX_DEBATE_FINDINGS; delete process.env.KANAKKU_MAX_CALLS_PER_RUN; });

describe("pipeline vs synthetic answer keys (scripted model)", () => {
  for (const dir of SAMPLE_BILL_IDS) {
    it(`${dir}: candidates, kept and dropped match evaluation_targets; every seed kept, every trap dropped`, async () => {
      setProviderForTests(new MockProvider([], scriptedModel(dir)));
      const r = await run(dir);
      const k = key(dir);
      expect(PipelineResult.safeParse(r).success).toBe(true);
      expect(r.findings).toHaveLength(k.evaluation_targets.expected_candidate_count);
      expect(r.findings.filter((f) => f.status !== "dropped")).toHaveLength(k.evaluation_targets.expected_kept_count);
      expect(r.totals.dropped_count).toBe(k.evaluation_targets.expected_dropped_count);
      for (const s of k.seeded) {
        const f = r.findings.find((x) => x.rule_or_source_cited.rule_id === s.rule_id && x.line_item_ids.join() === s.line_item_ids.join())!;
        expect(f, s.seed_id).toBeDefined();
        expect(f.amount_at_stake).toBe(s.expected_amount_at_stake);
        expect(f.initial_tier).toBe(s.expected_initial_tier);
        expect(f.status).not.toBe("dropped");
      }
      for (const t of k.traps) {
        const f = r.findings.find((x) => x.line_item_ids.join() === t.line_item_ids.join())!;
        expect(f.status, t.trap_id).toBe("dropped");
        expect(f.amount_at_stake).toBe(t.expected_amount_at_stake);
      }
      for (const f of r.findings) expect(f.debate_log.map((l) => l.role)).toEqual(["auditor", "defender", "judge"]);
      const text = JSON.stringify(r.findings).toLowerCase();
      for (const w of BANNED_WORD_FRAGMENTS) expect(text).not.toContain(w);
    });
  }

  it("bill-02 totals: Provable first, no double counting, dropped trap excluded", async () => {
    setProviderForTests(new MockProvider([], scriptedModel("bill-02-demo")));
    const r = await run("bill-02-demo");
    expect(r.totals).toEqual({ provable: 1581.44, ask: 6350, questionable_total: 7931.44, dropped_count: 1 }); // 1500+8.58+72.86 ; 1250+1500+3600
  });

  it("D3 never yields Provable, discards invented ids / wrong categories, and ignores model ICU candidates", async () => {
    setProviderForTests(new MockProvider([], scriptedModel("bill-02-demo", {
      clinicalExtras: [
        { kind: "NOT_IN_SUMMARY", line_item_ids: ["L999"], summary_evidence: "x", reasoning: "invented line", confidence: "high" },
        { kind: "NOT_IN_SUMMARY", line_item_ids: ["L001"], summary_evidence: "x", reasoning: "room is not eligible", confidence: "high" },
        { kind: "ICU_DAYS_EXCEED", line_item_ids: ["L002"], summary_evidence: "x", reasoning: "dup of code M1", confidence: "high" },
      ],
    })));
    const r = await run("bill-02-demo");
    const d3 = r.findings.filter((f) => f.detector === "D3_BILL_VS_SUMMARY");
    expect(d3.map((f) => f.line_item_ids.join())).toEqual(["L002", "L012"]);
    expect(d3.every((f) => f.initial_tier === "Ask" && f.tier === "Ask")).toBe(true);
  });

  it("a Judge drop of a Provable finding without basis_error is coerced to a question, with a logged note", async () => {
    setProviderForTests(new MockProvider([], scriptedModel("bill-02-demo", {
      judgeOverride: (id) => (id === "F-001" ? { decision: "drop", rationale: "Looks fine.", counter_argument: "No issue.", question_for_billing_desk: "None?", confidence: "low", basis_error: false } : null),
    })));
    const r = await run("bill-02-demo");
    const f = r.findings.find((x) => x.id === "F-001")!;
    expect(f).toMatchObject({ initial_tier: "Provable", tier: "Ask", status: "downgraded", judge_decision: { decision: "downgrade_to_ask" } });
    expect(f.enforcement_notes![0]).toMatch(/without identifying a data error/);
  });

  it("the Judge can never raise a tier: 'keep' on an Ask finding stays Ask", async () => {
    setProviderForTests(new MockProvider([], scriptedModel("bill-03-errors")));
    const r = await run("bill-03-errors");
    for (const f of r.findings) if (f.initial_tier === "Ask") expect(f.tier).toBe("Ask");
  });

  it("debate failures leave findings un-debated at their rule tier, clearly marked, never hidden", async () => {
    process.env.KANAKKU_MAX_DEBATE_FINDINGS = "2";
    setProviderForTests(new MockProvider([], scriptedModel("bill-02-demo")));
    const r = await run("bill-02-demo");
    const nd = r.findings.filter((f) => f.review?.state === "not_debated");
    expect(nd).toHaveLength(5);
    for (const f of nd) expect(f).toMatchObject({ status: "kept", debate_log: [], judge_decision: { rationale: expect.stringMatching(/^Not cross-examined/) } });
    // the two debated ones are the highest-priority Provable findings
    expect(r.findings.filter((f) => f.review?.state === "debated").every((f) => f.initial_tier === "Provable")).toBe(true);
  });

  it("when the run budget runs out mid-audit, the result is partial and says so", async () => {
    process.env.KANAKKU_MAX_CALLS_PER_RUN = "5"; // normalize + clinical + one full debate
    setProviderForTests(new MockProvider([], scriptedModel("bill-02-demo")));
    const r = await run("bill-02-demo");
    expect(r.findings.filter((f) => f.review?.state === "debated")).toHaveLength(1);
    expect(r.findings.find((f) => f.review?.state === "not_debated")!.review!.note).toMatch(/usage limit/);
  });

  it("if the clinical model fails, rule findings still arrive and the result says the clinical check did not run", async () => {
    const script = scriptedModel("bill-02-demo");
    setProviderForTests(new MockProvider([], (req) => (req.system.includes("# clinical.v1") ? "garbage" : script(req))));
    const r = await run("bill-02-demo");
    expect(r.clinical_check!.state).toBe("failed");
    expect(r.findings.some((f) => f.detector === "D3_BILL_VS_SUMMARY" && f.type === "MISMATCH_NOT_IN_SUMMARY")).toBe(false);
    expect(r.findings.some((f) => f.type === "MISMATCH_ICU_DAYS")).toBe(true); // code-only ICU check still ran
    expect(r.findings.length).toBeGreaterThan(0);
  });

  it("an invented rupee figure in a debate step is rejected and retried; a second offence leaves the finding un-debated", async () => {
    const script = scriptedModel("bill-02-demo");
    setProviderForTests(new MockProvider([], (req) => {
      const out = script(req) as Record<string, unknown>;
      return req.system.includes("# auditor.v1") ? { ...out, why_it_matters: "The patient may be overpaying ₹12,345.00 in total." } : out;
    }));
    const r = await run("bill-02-demo");
    expect(r.findings.every((f) => f.review?.state === "not_debated")).toBe(true);
    expect(r.findings[0]!.review!.note).toMatch(/failed Kanakku's safety checks/);
  });

  it("sample runs make zero provider calls: a cold cache gives a clearly-labelled partial result", async () => {
    const mock = new MockProvider([], scriptedModel("bill-02-demo"));
    setProviderForTests(mock);
    const r = await run("bill-02-demo", ctx({ mode: "sample" }));
    expect(mock.calls).toHaveLength(0);
    expect(r.warnings!.join(" ")).toMatch(/drug-price checks were skipped/);
    expect(r.clinical_check!.state).toBe("failed");
    expect(r.findings.every((f) => f.review?.state === "not_debated")).toBe(true);
  });

  it("after a warm run, the same sample replays fully from cache with zero calls", async () => {
    const warm = new MockProvider([], scriptedModel("bill-03-errors"));
    setProviderForTests(warm);
    const first = await run("bill-03-errors", ctx({ mode: "warm" }));
    writeSampleManifest({ extract_model: "mock-extract-model", reason_model: "mock-reason-model", warmed_on: "2026-10-10" });
    // Samples replay with the manifest's models even when this deployment has no model or key configured.
    process.env.MODEL_EXTRACT = "";
    process.env.MODEL_REASON = "";
    const replay = new MockProvider();
    setProviderForTests(replay);
    const second = await run("bill-03-errors", ctx({ mode: "sample" }));
    expect(replay.calls).toHaveLength(0);
    expect({ ...second, run_id: "" }).toEqual({ ...first, run_id: "" });
  });
});
