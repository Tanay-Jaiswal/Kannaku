import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { detectD2 } from "../src/lib/detectors/d2";
import { runRules } from "../src/lib/detectors";
import { DrugTable, type BillExtraction, type DrugRow, type NormalizedItem } from "../src/lib/schemas";
import { UNVERIFIED_REFERENCE_LABEL } from "../src/lib/config";

const real = DrugTable.parse(JSON.parse(readFileSync("data/reference/drug_reference.json", "utf8")));
// Synthetic row: MRP ₹10.00/tablet (pack of 10 for ₹100), ceiling ₹12.00 ex-GST => ₹12.60 incl. 5% GST, brand "RefBrand".
const row: DrugRow = { ...real.rows.find((r) => r.canonical_id === "azithromycin_500_tab")!, canonical_id: "t", brand_examples: ["RefBrand"],
  pack_size: 10, allowed_pack_sizes: [10], mrp_per_pack: 100, ceiling_price_per_unit: 12, gst_pct: 5, verified: true, nlem_scheduled: true, table_unit: "tablet" };
const tbl = (r: Partial<DrugRow> = {}): DrugTable => ({ ...real, rows: [{ ...row, ...r }] });
const bill = (o: Partial<BillExtraction["items"][number]> = {}): BillExtraction => ({
  hospital_name: "H", patient_alias: "P", admission_date: "2026-08-01", discharge_date: "2026-08-03", currency: "INR", extraction_notes: [],
  stated_total: 0, items: [{ id: "L001", date: "2026-08-02", category: "drug", description_raw: "TAB X", quantity: 10, unit: "tablet", unit_rate: 11, amount: 110, ...o }],
});
const norm = (o: Partial<NormalizedItem> = {}) => ({ items: [{ line_item_id: "L001", canonical_id: "t", canonical_name: "x", billed_unit: "tablet" as const,
  units_per_billed_unit: 1, billed_brand: "RefBrand", match_confidence: "high" as const, rationale: "t", ...o }] });
const run = (b = bill(), n = norm(), t = tbl()) => detectD2(b, n, t);

describe("D2 pricing", () => {
  it("reference MRP + brand match + verified row: Provable, stake in code", () => {
    const [f] = run().findings;
    expect(f).toMatchObject({ initial_tier: "Provable", amount_at_stake: 10, confidence: "high" }); // (11-10)*10
    expect(f!.evidence).toMatchObject({ binding_basis: "reference_mrp", brand_match: true, reference_verified: true });
  });
  it("brand mismatch: reference MRP alone is only Ask", () => {
    expect(run(bill(), norm({ billed_brand: "Other" })).findings[0]).toMatchObject({ initial_tier: "Ask", amount_at_stake: 10 });
    expect(run(bill(), norm({ billed_brand: null })).findings[0]!.initial_tier).toBe("Ask");
  });
  it("a printed MRP replaces the reference MRP (billing at printed MRP is not flagged)", () => {
    expect(run(bill({ printed_mrp: 11 }), norm({ billed_brand: "Other" })).findings).toEqual([]);
  });
  it("above printed MRP is Provable for any brand when the row is verified", () => {
    const [f] = run(bill({ printed_mrp: 10.4, unit_rate: 11.4 }), norm({ billed_brand: "Other" })).findings;
    expect(f).toMatchObject({ initial_tier: "Provable", amount_at_stake: 10 });
    expect(f!.evidence.binding_basis).toBe("printed_mrp");
  });
  it("ceiling is ex-GST: GST is added exactly once (limit ₹12.60, not ₹13.23)", () => {
    expect(run(bill({ printed_mrp: 20, unit_rate: 12.6 })).findings).toEqual([]);
    const [f] = run(bill({ printed_mrp: 20, unit_rate: 13 })).findings;
    expect(f).toMatchObject({ initial_tier: "Provable", amount_at_stake: 4 }); // (13-12.6)*10
    expect(f!.evidence).toMatchObject({ binding_basis: "ceiling_incl_gst", ceiling_incl_gst_per_unit: "₹12.60", gst: "5%" });
    expect(f!.rule_or_source_cited.benchmark_label).toContain("ceiling");
  });
  it("unverified row caps every finding at Ask, even above a printed MRP, and carries the label", () => {
    const [f] = run(bill({ printed_mrp: 10, unit_rate: 15 }), norm(), tbl({ verified: false })).findings;
    expect(f).toMatchObject({ initial_tier: "Ask" });
    expect(f!.evidence).toMatchObject({ reference_verified: false, reference_label: UNVERIFIED_REFERENCE_LABEL });
    expect(f!.rule_or_source_cited.description).toContain(UNVERIFIED_REFERENCE_LABEL);
  });
  it("non-scheduled row ignores the ceiling", () => {
    expect(run(bill({ printed_mrp: 20, unit_rate: 15 }), norm(), tbl({ nlem_scheduled: false })).findings).toEqual([]);
  });
  it("boundaries: at limit and inside 0.5% tolerance are clean; just past it is flagged", () => {
    expect(run(bill({ unit_rate: 10 })).findings).toEqual([]);
    expect(run(bill({ unit_rate: 10.04 })).findings).toEqual([]);
    expect(run(bill({ unit_rate: 10.06 })).findings).toHaveLength(1);
  });
  it("rounds the stake to paise", () => {
    expect(run(bill({ unit_rate: 10.337, quantity: 3 })).findings[0]!.amount_at_stake).toBe(1.01); // 0.337*3
  });
});

describe("D2 units, gating and bad input", () => {
  it("converts a strip of 10 priced per strip into per-tablet maths", () => {
    const b = bill({ unit: "strip", quantity: 2, unit_rate: 110, amount: 220 });
    const [f] = run(b, norm({ billed_unit: "other", units_per_billed_unit: 10 })).findings;
    expect(f).toMatchObject({ amount_at_stake: 20 }); // 11/unit vs 10/unit * 20 tablets
    expect(f!.evidence.quantity_in_units).toBe(20);
  });
  it("printed MRP on a strip is converted to per-unit too", () => {
    const b = bill({ unit: "strip", unit_rate: 110, printed_mrp: 100, quantity: 1 });
    expect(run(b, norm({ billed_unit: "other", units_per_billed_unit: 10 })).findings[0]!.evidence.printed_mrp_per_unit).toBe("₹10.00");
  });
  it.each([
    ["pack size not allowed by the row", { billed_unit: "other" as const, units_per_billed_unit: 7 }],
    ["billed unit differs from table unit", { billed_unit: "vial" as const, units_per_billed_unit: 1 }],
    ["tablet billed with a multiplier", { billed_unit: "tablet" as const, units_per_billed_unit: 10 }],
    ["unit conversion unknown", { units_per_billed_unit: null }],
    ["billed unit unknown", { billed_unit: null }],
    ["low confidence", { match_confidence: "low" as const }],
    ["no canonical id", { canonical_id: null }],
    ["unknown canonical id", { canonical_id: "nope" }],
  ])("skips and logs (never a finding): %s", (_n, over) => {
    const r = run(bill({ category: "drug" }), norm(over));
    expect(r.findings).toEqual([]);
    expect(r.skipped_checks).toHaveLength(1);
  });
  it("skips an unpriced reference row unless the bill prints an MRP", () => {
    const unpriced = tbl({ mrp_per_pack: null, pack_size: null, ceiling_price_per_unit: null, gst_pct: null, verified: false });
    expect(run(bill(), norm(), unpriced).skipped_checks).toHaveLength(1);
    expect(run(bill({ printed_mrp: 5 }), norm(), unpriced).findings[0]).toMatchObject({ initial_tier: "Ask", amount_at_stake: 60 });
  });
  it("skips invalid numbers instead of computing", () => {
    expect(run(bill({ unit_rate: Number.NaN })).skipped_checks).toHaveLength(1);
    expect(run(bill({ quantity: 0 })).skipped_checks).toHaveLength(1);
    expect(run(bill({ printed_mrp: -1 })).skipped_checks).toHaveLength(1);
  });
  it("logs D2-P3 when the printed MRP differs from the reference by >5%, and still uses the printed MRP", () => {
    const r = run(bill({ printed_mrp: 11.5, unit_rate: 11.5 }), norm({ billed_brand: "Other" }));
    expect(r.skipped_checks[0]!.reason).toContain("D2-P3");
    expect(r.findings).toEqual([]);
  });
  it("rejects duplicate normalization entries loudly", () => {
    const n = norm();
    expect(() => run(bill(), { items: [...n.items, ...n.items] })).toThrow(/two entries/);
  });
  it("unmatched non-drug lines are not logged as skipped", () => {
    expect(run(bill({ category: "room" }), norm({ canonical_id: null })).skipped_checks).toEqual([]);
  });
});

describe("runRules validation and evidence", () => {
  it("fails loudly on malformed bill or normalization", () => {
    expect(() => runRules({ nope: 1 }, { items: [] }, tbl())).toThrow();
    expect(() => runRules(bill(), { items: [{ line_item_id: "L001" }] }, tbl())).toThrow();
  });
  it("every finding exposes only code-made, formatted rupee tokens", () => {
    const { candidates } = runRules(bill(), norm(), tbl());
    expect(candidates[0]!.allowed_tokens).toContain("₹10.00");
    expect(candidates[0]!.evidence.excess).toBe("₹10.00");
  });
});
