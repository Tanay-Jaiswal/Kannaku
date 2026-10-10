import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DrugTable, assessDrugPrice, type DrugRow } from "../src/lib/schemas";
import { oneTimeFeeClass } from "../src/lib/config";

const table = DrugTable.parse(JSON.parse(readFileSync("data/reference/drug_reference.json", "utf8")));
const base = table.rows.find((r) => r.canonical_id === "azithromycin_500_tab")!; // verified, scheduled
// Synthetic row for unit tests: MRP ₹10.00/unit, ceiling ₹12.00 ex-GST (₹12.60 incl. 5%), brand "RefBrand".
const row: DrugRow = { ...base, brand_examples: ["RefBrand"], pack_size: 10, mrp_per_pack: 100, ceiling_price_per_unit: 12, gst_pct: 5, verified: true };

describe("D2 assessDrugPrice", () => {
  it("G1: a bill-printed MRP replaces the reference MRP (charge at printed MRP is not flagged)", () => {
    expect(assessDrugPrice(row, { unit_rate: 10.4, units_consistent: true, qty_units: 10, printed_mrp: 10.4, billed_brand: "OtherBrand" })).toBeNull();
  });
  it("G1: above printed MRP is Provable even for a different brand", () => {
    const a = assessDrugPrice(row, { unit_rate: 11.4, units_consistent: true, qty_units: 10, printed_mrp: 10.4, billed_brand: "OtherBrand" })!;
    expect(a).toMatchObject({ tier: "Provable", binding_basis: "printed_mrp", amount_at_stake: 10 });
  });
  it("G1: printed MRP above the ceiling still respects the ceiling", () => {
    const a = assessDrugPrice(row, { unit_rate: 13, units_consistent: true, qty_units: 1, printed_mrp: 14 })!;
    expect(a).toMatchObject({ tier: "Provable", binding_basis: "ceiling_incl_gst", amount_at_stake: 0.4 });
  });
  it("G2: reference-brand MRP with a brand match is Provable", () => {
    const a = assessDrugPrice(row, { unit_rate: 11, units_consistent: true, qty_units: 2, billed_brand: "refbrand" })!;
    expect(a).toMatchObject({ tier: "Provable", binding_basis: "reference_mrp", amount_at_stake: 2, brand_match: true });
  });
  it("G2: reference-brand MRP without a brand match is only Ask", () => {
    const a = assessDrugPrice(row, { unit_rate: 11, units_consistent: true, qty_units: 2, billed_brand: "OtherBrand" })!;
    expect(a).toMatchObject({ tier: "Ask", binding_basis: "reference_mrp", brand_match: false });
  });
  it("G2: a ceiling violation stays Provable on its own, staked against the ceiling", () => {
    const a = assessDrugPrice(row, { unit_rate: 14.6, units_consistent: true, qty_units: 1, billed_brand: "OtherBrand" })!;
    expect(a).toMatchObject({ tier: "Provable", binding_basis: "ceiling_incl_gst", amount_at_stake: 2 });
    expect(a.bases_exceeded).toEqual(["reference_mrp", "ceiling_incl_gst"]);
  });
  it("G3: an unverified row caps reference MRP and ceiling findings at Ask", () => {
    const u = { ...row, verified: false };
    const a = assessDrugPrice(u, { units_consistent: true, qty_units: 1, unit_rate: 14.6, billed_brand: "RefBrand" })!;
    expect(a).toMatchObject({ tier: "Ask", reference_verified: false });
  });
  it("G3: an unverified row caps even a bill-printed MRP violation at Ask", () => {
    const u = { ...row, verified: false };
    const a = assessDrugPrice(u, { units_consistent: true, qty_units: 1, unit_rate: 11, printed_mrp: 10 })!;
    expect(a).toMatchObject({ tier: "Ask", binding_basis: "printed_mrp", reference_verified: false, amount_at_stake: 1 });
  });
  it("ceiling counts only for a scheduled row", () => {
    const ns = { ...row, nlem_scheduled: false };
    const a = assessDrugPrice(ns, { units_consistent: true, qty_units: 1, unit_rate: 14.6, billed_brand: "OtherBrand" })!;
    expect(a).toMatchObject({ tier: "Ask", binding_basis: "reference_mrp", bases_exceeded: ["reference_mrp"] });
  });
  it("inconsistent units are never compared", () => {
    expect(assessDrugPrice(row, { units_consistent: false, qty_units: 1, unit_rate: 99, printed_mrp: 10 })).toBeNull();
  });
  it("within the 0.5% tolerance there is no finding", () => {
    expect(assessDrugPrice(row, { unit_rate: 10.04, units_consistent: true, qty_units: 1, billed_brand: "RefBrand" })).toBeNull();
  });
});

describe("D2 exact tolerance boundary (floating-point regression)", () => {
  // MRP ₹10.00/unit, tolerance 0.5% => threshold is exactly ₹10.05; the rule is strictly greater-than.
  const at = (unit_rate: number) => assessDrugPrice(row, { unit_rate, units_consistent: true, qty_units: 1, billed_brand: "RefBrand" });
  it("exactly on the boundary is not flagged (10 × 1.005 is 10.049999999999999 in binary floats)", () => {
    expect(at(10.05)).toBeNull();
  });
  it("just below the boundary is not flagged", () => {
    expect(at(10.0499)).toBeNull();
    expect(at(10.04)).toBeNull();
  });
  it("just above the boundary is flagged", () => {
    expect(at(10.0501)).toMatchObject({ tier: "Provable" });
    expect(at(10.06)).not.toBeNull();
  });
  it("the same boundary holds for a printed MRP and for the ceiling term", () => {
    const printed = (r: number) => assessDrugPrice(row, { unit_rate: r, units_consistent: true, qty_units: 1, printed_mrp: 10 });
    expect(printed(10.05)).toBeNull();
    expect(printed(10.0501)).not.toBeNull();
    // ceiling incl. GST = 12.60 -> threshold 12.663 (printed MRP raised out of the way)
    const ceil = (r: number) => assessDrugPrice(row, { unit_rate: r, units_consistent: true, qty_units: 1, printed_mrp: 50 });
    expect(ceil(12.663)).toBeNull();
    expect(ceil(12.6631)).toMatchObject({ binding_basis: "ceiling_incl_gst" });
  });
  it("a sweep of 4dp rates around the boundary never flags at or below 10.05", () => {
    for (let r = 10.04; r <= 10.05 + 1e-9; r += 0.0001) expect(at(Math.round(r * 1e4) / 1e4)).toBeNull();
  });
});

describe("D1-A4 one-time fee classes", () => {
  it("same fee repeated shares a class; different admin fees do not", () => {
    expect(oneTimeFeeClass("Admission and registration fee")).toBe("admission_registration");
    expect(oneTimeFeeClass("Medical file and record processing fee")).toBe("file_processing");
    expect(oneTimeFeeClass("Discharge file preparation")).not.toBe("admission_registration");
    expect(oneTimeFeeClass("Physician rounds")).toBeNull();
  });
});
