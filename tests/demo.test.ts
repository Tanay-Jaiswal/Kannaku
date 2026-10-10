// Regression tests for the precomputed demonstration path (SYNTHETIC samples only, no AI model, no network):
// the clean sample must not show a false positive, the three traps must be dropped, amounts must equal the
// verified answer keys, and a demonstration must always be labelled as such and never as a live AI review.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { setProviderForTests } from "../src/lib/llm/call";
import { clearMemoryCache } from "../src/lib/cache";
import { resetSpendState, type RunContext } from "../src/lib/spend";
import { runPipeline } from "../src/lib/pipeline";
import { loadSample } from "../src/lib/samples";
import { DEMO_MODEL, SAMPLE_BILL_IDS, BANNED_WORD_FRAGMENTS } from "../src/lib/config";
import { referenceTable } from "../src/lib/table";
import { PipelineResult } from "../src/lib/schemas";
import { auditStatus, isDemoFinding } from "../src/lib/status";
import { demoAnswer } from "../src/lib/demo";
import { finalize } from "../src/lib/finalize";
import { MockProvider, testEnv } from "./helpers/mockProvider";

const key = (dir: string) => JSON.parse(readFileSync(`data/synthetic/${dir}/answer_key.json`, "utf8"));
const demoCtx = (id: string): RunContext => ({ runId: `run-demo-${id}`, clientId: "t", mode: "demo", sampleId: id });
const run = (id: (typeof SAMPLE_BILL_IDS)[number], ctx = demoCtx(id)) => {
  const s = loadSample(id);
  return runPipeline({ billDraft: s.bill_draft, summaryDraft: s.summary_draft, dataLabel: "Synthetic data", ctx, table: referenceTable });
};

let mock: MockProvider;
beforeEach(() => {
  testEnv(mkdtempSync(path.join(tmpdir(), "kanakku-demo-"))); // empty cache dir: no recorded review
  process.env.KANAKKU_CACHE_ONLY = "1";
  clearMemoryCache();
  resetSpendState();
  mock = new MockProvider();
  setProviderForTests(mock);
});
afterEach(() => setProviderForTests(null));

describe("precomputed demonstration (no recorded AI review deployed)", () => {
  for (const id of SAMPLE_BILL_IDS) {
    it(`${id}: matches the answer key, makes no provider call, and is complete and labelled as a demonstration`, async () => {
      const r = await run(id);
      const k = key(id);
      expect(mock.calls).toHaveLength(0);
      expect(PipelineResult.safeParse(r).success).toBe(true);
      expect(r.review_source).toBe("demonstration");
      expect(r.warnings).toEqual([]);
      expect(r.clinical_check!.state).toBe("done");
      expect(r.findings).toHaveLength(k.evaluation_targets.expected_candidate_count);
      expect(r.findings.filter((f) => f.status !== "dropped")).toHaveLength(k.evaluation_targets.expected_kept_count);
      expect(r.totals.dropped_count).toBe(k.evaluation_targets.expected_dropped_count);
      for (const s of k.seeded) {
        const f = r.findings.find((x) => x.rule_or_source_cited.rule_id === s.rule_id && x.line_item_ids.join() === s.line_item_ids.join())!;
        expect(f, s.seed_id).toBeDefined();
        expect(f.amount_at_stake).toBe(s.expected_amount_at_stake); // computed by code, equal to the answer key
        expect(f.initial_tier).toBe(s.expected_initial_tier);
        expect(f.status).not.toBe("dropped");
      }
      for (const t of k.traps) {
        const f = r.findings.find((x) => x.line_item_ids.join() === t.line_item_ids.join())!;
        expect(f.status, t.trap_id).toBe("dropped");
      }
      for (const f of r.findings) {
        expect(f.review?.state).toBe("debated");
        expect(f.debate_log.map((l) => l.role)).toEqual(["auditor", "defender", "judge"]);
        expect(isDemoFinding(f)).toBe(true);
        expect(f.debate_log.every((l) => l.model === DEMO_MODEL)).toBe(true);
      }
      const status = auditStatus(r);
      expect(status.complete).toBe(true);
      expect(status.demonstration).toBe(true);
      const text = JSON.stringify(r).toLowerCase();
      for (const w of BANNED_WORD_FRAGMENTS) expect(text).not.toContain(w);
    });
  }

  it("the clean sample shows zero rupees to question (its only candidate, the delayed discharge, is dropped)", async () => {
    const r = await run("bill-01-clean");
    expect(r.totals).toEqual({ provable: 0, ask: 0, questionable_total: 0, dropped_count: 1 });
    expect(r.findings.filter((f) => f.status !== "dropped")).toHaveLength(0);
  });

  it("the three documented traps are dropped and the demo totals equal the answer-key sums", async () => {
    expect((await run("bill-01-clean")).findings.find((f) => f.line_item_ids.join() === "L001")!.status).toBe("dropped");
    const b2 = await run("bill-02-demo");
    expect(b2.findings.find((f) => f.rule_or_source_cited.rule_id === "D3-M1")!.status).toBe("dropped");
    expect(b2.totals).toEqual({ provable: 1581.44, ask: 6350, questionable_total: 7931.44, dropped_count: 1 });
    const b3 = await run("bill-03-errors");
    expect(b3.findings.find((f) => f.line_item_ids.join() === "L017")!.status).toBe("dropped");
    expect(b3.totals).toEqual({ provable: 2438.15, ask: 18700, questionable_total: 21138.15, dropped_count: 1 });
  });

  it("scripted text never contains a figure that code did not supply (it passes the number guard)", async () => {
    // A tampered script would fail loudly through callJson; here every stage of every sample succeeded without warnings.
    for (const id of SAMPLE_BILL_IDS) expect((await run(id)).findings.every((f) => f.review?.state === "debated")).toBe(true);
  });

  it("refuses to answer for lines that are not on the sample bill, and for unknown stages", () => {
    expect(() => demoAnswer("normalize", "bill-02-demo", { lines: [{ line_item_id: "L013", description_raw: "SOMETHING ELSE", unit: "tablet" }] })).toThrow();
    expect(() => demoAnswer("extract_bill", "bill-02-demo", {})).toThrow();
  });

  it("demo mode without a sample id cannot run (a live upload can never reach the script)", async () => {
    const s = loadSample("bill-02-demo");
    const r = await runPipeline({ billDraft: s.bill_draft, summaryDraft: s.summary_draft, dataLabel: "Synthetic data", table: referenceTable,
      ctx: { runId: "run-demo-nosample", clientId: "t", mode: "demo" } });
    expect(r.warnings!.join(" ")).toMatch(/drug-price checks were skipped/);
    expect(r.findings.every((f) => f.review?.state === "not_debated")).toBe(true);
    expect(auditStatus(r).complete).toBe(false);
  });

  it("uploads are never labelled as a demonstration, whatever the debate log says", async () => {
    const r = await run("bill-02-demo");
    const f = finalize({
      run_id: "run-up-0001", data_label: "User upload", bill: r.bill, summary: r.summary, normalization: r.normalization, clinical_check: r.clinical_check,
      items: r.findings.map((x) => ({ candidate: x, steps: JSON.parse(JSON.stringify({ auditor: x.debate_log[0]!.output, defender: x.debate_log[1]!.output, judge: x.debate_log[2]!.output })), logs: x.debate_log })),
    }, referenceTable);
    expect(f.review_source).toBe("live_ai");
  });
});

describe("a sample audit is never marked complete when a required stage did not run", () => {
  it("recorded-review mode with a cold cache is partial, not complete", async () => {
    const s = loadSample("bill-01-clean");
    const r = await runPipeline({ billDraft: s.bill_draft, summaryDraft: s.summary_draft, dataLabel: "Synthetic data", table: referenceTable,
      ctx: { runId: "run-cold-0001", clientId: "t", mode: "sample" } });
    expect(auditStatus(r).complete).toBe(false);
    expect(r.clinical_check!.state).toBe("failed");
  });
  it("a result with no clinical-check record is not complete", async () => {
    const r = await run("bill-01-clean");
    expect(auditStatus({ ...r, clinical_check: undefined }).complete).toBe(false);
    expect(auditStatus({ ...r, clinical_check: { state: "failed", note: "x" } }).complete).toBe(false);
  });
});
