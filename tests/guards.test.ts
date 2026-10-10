import { describe, it, expect } from "vitest";
import { numberGuardViolations, tokensFrom } from "../src/lib/numberGuard";
import { toneViolations } from "../src/lib/tone";
import { enforceJudge } from "../src/lib/debate";
import { computeTotals } from "../src/lib/totals";

describe("number guard", () => {
  const allowed = tokensFrom(["₹1,500.00", "₹72.86", "18%"]);
  it("allows code-supplied figures in any common spelling", () => {
    expect(numberGuardViolations({ a: "Excess is ₹1,500.00, i.e. Rs. 1500 or INR 1,500 or 1500 rupees; GST 18%." }, allowed)).toEqual([]);
    expect(numberGuardViolations(["₹72.86 above MRP"], allowed)).toEqual([]);
  });
  it("rejects computed or invented rupee figures and percentages", () => {
    expect(numberGuardViolations({ a: "about ₹1,600 extra" }, allowed)).toEqual(["₹1,600"]);
    expect(numberGuardViolations({ a: "a 25% markup" }, allowed)).toEqual(["25%"]);
    expect(numberGuardViolations({ deep: [{ x: "Rs.99" }] }, allowed)).toEqual(["Rs.99"]);
  });
  it("leaves dates, line ids, counts and quantities alone", () => {
    expect(numberGuardViolations({ a: "L014 on 2026-08-11, 4 days, 2 vials, 3 nights" }, allowed)).toEqual([]);
  });
  it("percent checks can be disabled for stages that quote clinical values", () => {
    expect(numberGuardViolations({ a: "SpO2 88%" }, tokensFrom([]), { checkPercent: false })).toEqual([]);
  });
});

describe("tone lint", () => {
  it("finds banned words anywhere, case-insensitively", () => {
    expect(toneViolations({ a: ["ok", { b: "This is a SC" + "AM" }] })).toEqual(["sc" + "am"]);
    expect(toneViolations("a charge to question; confirm with the billing desk")).toEqual([]);
  });
});

describe("Judge enforcement (code)", () => {
  const def = (o: Partial<{ verifiable_from_documents: boolean; concedes: boolean }> = {}) => ({
    strongest_justification: "x", supporting_points: [], what_would_confirm: "y", verifiable_from_documents: false, concedes: false, ...o,
  });
  const judge = (decision: "keep" | "downgrade_to_ask" | "drop", basis_error = false) => ({
    decision, rationale: "r", counter_argument: "c", question_for_billing_desk: "q", confidence: "medium" as const, basis_error,
  });
  it("keep preserves the rule tier; downgrade makes it Ask", () => {
    expect(enforceJudge("Provable", def(), judge("keep"))).toMatchObject({ tier: "Provable", status: "kept" });
    expect(enforceJudge("Provable", def(), judge("downgrade_to_ask"))).toMatchObject({ tier: "Ask", status: "downgraded" });
    expect(enforceJudge("Ask", def(), judge("downgrade_to_ask"))).toMatchObject({ tier: "Ask", status: "kept" });
  });
  it("a Provable finding is dropped only on a basis error", () => {
    expect(enforceJudge("Provable", def({ verifiable_from_documents: true }), judge("drop"))).toMatchObject({ decision: "downgrade_to_ask", tier: "Ask" });
    expect(enforceJudge("Provable", def(), judge("drop", true))).toMatchObject({ decision: "drop", status: "dropped" });
  });
  it("an Ask finding is dropped only with documentary support or a basis error", () => {
    expect(enforceJudge("Ask", def({ verifiable_from_documents: true }), judge("drop"))).toMatchObject({ decision: "drop", status: "dropped" });
    expect(enforceJudge("Ask", def(), judge("drop"))).toMatchObject({ decision: "downgrade_to_ask", status: "kept" });
    expect(enforceJudge("Ask", def({ concedes: true, verifiable_from_documents: true }), judge("drop"))).toMatchObject({ decision: "keep" });
  });
});

describe("totals rule", () => {
  const f = (id: string, tier: "Provable" | "Ask", amt: number, ids: string[], status: "kept" | "dropped" | "downgraded" = "kept") =>
    ({ id, tier, amount_at_stake: amt, line_item_ids: ids, status });
  it("counts Provable first, skips overlaps, ignores dropped, never double counts", () => {
    const r = computeTotals([
      f("F-001", "Ask", 500, ["L001"]), f("F-002", "Provable", 100, ["L001"]), f("F-003", "Ask", 50, []),
      f("F-004", "Ask", 70, []), f("F-005", "Provable", 9, ["L009"], "dropped"),
    ]);
    expect(r.totals).toEqual({ provable: 100, ask: 120, questionable_total: 220, dropped_count: 1 });
    expect(r.overlaps).toEqual({ "F-001": "F-002" });
  });
});
