// finalize() re-derives every number on the server, so nothing the browser sends can change an amount,
// raise a tier, or smuggle in a finding the rules did not produce.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { finalize } from "../src/lib/finalize";
import { runRules } from "../src/lib/detectors";
import { detectIcuDays } from "../src/lib/detectors/d3";
import { numberCandidates } from "../src/lib/flow";
import { loadSample } from "../src/lib/samples";
import { reconcile } from "../src/lib/extract";
import { DrugTable } from "../src/lib/schemas";

const table = DrugTable.parse(JSON.parse(readFileSync("data/reference/drug_reference.json", "utf8")));
const s = loadSample("bill-02-demo");
const { bill, summary } = reconcile(s.bill_draft, s.summary_draft);
const normalization = { items: [] }; // D1 + M1 only is enough here
const base = (items: unknown[], extra: Record<string, unknown> = {}) => ({
  run_id: "run-final-0001", data_label: "Synthetic data", bill, summary, normalization, items, clinical_check: { state: "done", note: "ok" }, ...extra,
});
const cands = () => numberCandidates(runRules(bill, normalization, table).candidates, detectIcuDays(bill, summary));

describe("finalize", () => {
  it("un-debated candidates come back at their rule tier, marked not cross-examined", () => {
    const r = finalize(base(cands().map((c) => ({ candidate: c, debate_error: "budget" }))), table);
    expect(r.findings.map((f) => f.review?.state)).toEqual(r.findings.map(() => "not_debated"));
    expect(r.findings.find((f) => f.type === "ARITH_LINE")).toMatchObject({ tier: "Provable", amount_at_stake: 1500 });
  });

  it("ignores a tampered amount, tier or evidence and uses the server's own computation", () => {
    const c = cands().find((x) => x.type === "DUPLICATE_EXACT")!;
    const tampered = { ...c, amount_at_stake: 999999, initial_tier: "Provable" as const, evidence: { ...c.evidence, amount_of_repeat_copies: "₹999,999.00" } };
    const r = finalize(base([{ candidate: tampered }]), table);
    expect(r.findings[0]).toMatchObject({ amount_at_stake: 1250, initial_tier: "Ask", tier: "Ask" });
  });

  it("removes a finding the rules did not produce, with a warning", () => {
    const c = cands()[0]!;
    const fake = { ...c, line_item_ids: ["L005"], id: "F-009" };
    const r = finalize(base([{ candidate: fake }]), table);
    expect(r.findings).toHaveLength(0);
    expect(r.warnings![0]).toMatch(/could not be re-verified/);
  });

  it("re-adds D3-M2 stakes from the bill and rejects ineligible categories", () => {
    const m2 = { ...cands()[0]!, id: "F-020", type: "MISMATCH_NOT_IN_SUMMARY" as const, detector: "D3_BILL_VS_SUMMARY" as const, line_item_ids: ["L012"],
      amount_at_stake: 1, initial_tier: "Ask" as const, rule_or_source_cited: { rule_id: "D3-M2", description: "x", source: "y" }, evidence: { summary_check: "checked", clinical_reasoning: "absent" } };
    const r = finalize(base([{ candidate: m2 }, { candidate: { ...m2, id: "F-021", line_item_ids: ["L001"] } }]), table);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]).toMatchObject({ amount_at_stake: 3600, evidence: { amount_billed: "₹3,600.00" } });
  });

  it("debate text that fails the number guard is not shown; the finding stays at its rule tier", () => {
    const c = cands().find((x) => x.type === "ARITH_LINE")!;
    const steps = {
      auditor: { claim: "Overcharge.", evidence: [{ source: "bill", ref: "L003", point: "4 × ₹1,800.00" }], why_it_matters: "Pays more.", confidence: "high" },
      defender: { strongest_justification: "None.", supporting_points: [], verifiable_from_documents: false, what_would_confirm: "Nothing.", concedes: true },
      judge: { decision: "keep", rationale: "Clear.", counter_argument: "Please refund ₹2,000.00.", question_for_billing_desk: "Why?", confidence: "high", basis_error: false },
    };
    const r = finalize(base([{ candidate: c, steps }]), table);
    expect(r.findings[0]).toMatchObject({ review: { state: "not_debated" }, tier: "Provable", counter_argument: "" });
  });

  it("rejects malformed input loudly", () => {
    expect(() => finalize({ ...base([]), bill: { ...bill, items: [] } }, table)).toThrow();
    expect(() => finalize({ ...base([]), data_label: "Real patient" }, table)).toThrow();
  });
});
