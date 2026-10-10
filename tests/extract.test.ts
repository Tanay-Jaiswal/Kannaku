import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BillDraft, SummaryDraft, billDraftFromRaw, reconcile, summaryDraftFromRaw, type RawBill, type RawSummary } from "../src/lib/extract";
import { runRules } from "../src/lib/detectors";
import { normalizationProblems } from "../src/lib/normalize";
import { DrugTable } from "../src/lib/schemas";
import { KanakkuError } from "../src/lib/errors";

const table = DrugTable.parse(JSON.parse(readFileSync("data/reference/drug_reference.json", "utf8")));
type RawItem = RawBill["items"][number];
const line = (o: Partial<RawItem> = {}): RawItem => ({
  date: "2026-08-02", time: null, category: "other", description_raw: "Service", quantity: 1, unit: null, unit_rate: 100, amount: 100,
  printed_mrp: null, source_page: 1, legibility: "clear", ...o,
});
const raw = (items: RawItem[], o: Partial<RawBill> = {}): RawBill => ({
  is_itemized_hospital_bill: true, problem: null, hospital_name: "Synthetic Hospital", admission_date: "2026-08-01", discharge_date: "2026-08-04",
  items, stated_subtotal: null, stated_discount: null, stated_total: items.reduce((a, i) => a + (i.amount ?? 0), 0), notes: [], ...o,
});
const summaryRaw = (o: Partial<RawSummary> = {}): RawSummary => ({
  is_discharge_summary: true, problem: null, primary_diagnosis: "Synthetic", secondary_diagnoses: [], procedures_performed: [],
  admission_date: "2026-08-01", discharge_date: "2026-08-04", icu_days: 0, ventilator_days: 0, investigations_documented: [],
  medications_documented: [], blood_products_documented: [], physio_documented: false, complications: [], free_text_summary: "Synthetic.", ...o,
});
const err = (f: () => unknown) => { try { f(); } catch (e) { return (e as KanakkuError).code; } return "ok"; };

describe("bill extraction draft (code side)", () => {
  it("assigns L001.. ids in order and preserves descriptions, quantities, units, rates, amounts, MRP and page", () => {
    const d = billDraftFromRaw(raw([
      line({ description_raw: "  INJ PANTOP 40MG IV ", quantity: 2, unit: "vial", unit_rate: 16.88, amount: 33.76, printed_mrp: 16.88, time: "08:00", category: "drug" }),
      line({ description_raw: "Room", quantity: 3, unit: "day", unit_rate: 2500, amount: 7500, category: "room", source_page: 2 }),
    ]));
    expect(d.items.map((i) => i.id)).toEqual(["L001", "L002"]);
    expect(d.items[0]).toMatchObject({ description_raw: "INJ PANTOP 40MG IV", quantity: 2, unit: "vial", unit_rate: 16.88, amount: 33.76, printed_mrp: 16.88, time: "08:00", source_page: 1 });
    expect(d.items[1]).toMatchObject({ unit: "day", source_page: 2 });
    expect(d.patient_alias).toBe("Patient (uploaded document)"); // never copies a name from an upload
  });

  it("never fills or corrects a printed amount; arithmetic errors survive extraction for D1 to find", () => {
    const d = billDraftFromRaw(raw([line({ quantity: 4, unit_rate: 1800, amount: 8700 })]));
    expect(d.items[0]).toMatchObject({ quantity: 4, unit_rate: 1800, amount: 8700 });
  });

  it("excludes unreadable lines explicitly instead of guessing, and records why", () => {
    const d = billDraftFromRaw(raw([
      line(), line({ amount: null }), line({ quantity: null }), line({ legibility: "illegible" }), line({ amount: -500, description_raw: "Discount" }),
    ]));
    expect(d.items).toHaveLength(1);
    expect(d.extraction_quality!.excluded_lines.map((x) => x.reason)).toEqual([
      "amount not readable", "quantity not printed or not readable", "line is illegible", "credit or discount line; not audited",
    ]);
  });

  it("derives a missing rate as amount / quantity in code and flags it; missing dates are flagged, not invented", () => {
    const d = billDraftFromRaw(raw([line({ unit_rate: null, quantity: 3, amount: 100 }), line({ date: null }), line({ date: "02/08/2026" })]));
    expect(d.items[0]!.unit_rate).toBe(33.33);
    expect(d.extraction_quality).toMatchObject({ rates_not_printed: ["L001"], dates_not_printed: ["L002", "L003"] });
    expect(d.items[1]!.date).toBeNull();
  });

  it("uses the line sum when no total is printed, and flags it", () => {
    const d = billDraftFromRaw(raw([line({ amount: 100 }), line({ amount: 50, unit_rate: 50 })], { stated_total: null }));
    expect(d.stated_total).toBe(150);
    expect(d.extraction_quality!.stated_total_printed).toBe(false);
  });

  it("rejects the wrong document and documents with no readable lines", () => {
    expect(err(() => billDraftFromRaw(raw([line()], { is_itemized_hospital_bill: false, problem: "a pharmacy receipt" })))).toBe("UNREADABLE_DOCUMENT");
    expect(err(() => billDraftFromRaw(raw([line({ amount: null })])))).toBe("UNREADABLE_DOCUMENT");
    expect(err(() => summaryDraftFromRaw(summaryRaw({ is_discharge_summary: false })))).toBe("UNREADABLE_DOCUMENT");
  });
});

describe("reconcile + rule engine on incomplete extractions", () => {
  it("fills stay dates from the other document and records conflicts", () => {
    const b = billDraftFromRaw(raw([line({ date: null })], { admission_date: null }));
    const s = summaryDraftFromRaw(summaryRaw({ discharge_date: "2026-08-05" }));
    const { bill, summary } = reconcile(b, s);
    expect(bill.admission_date).toBe("2026-08-01");
    expect(bill.items[0]!.date).toBe("2026-08-01"); // grouping date only; listed in dates_not_printed
    expect(bill.extraction_notes.join(" ")).toMatch(/different discharge dates \(2026-08-04 vs 2026-08-05\)/);
    expect(summary.discharge_date).toBe("2026-08-05");
  });

  it("fails clearly when neither document has a date, or dates are reversed", () => {
    const b = billDraftFromRaw(raw([line()], { admission_date: null }));
    expect(err(() => reconcile(b, summaryDraftFromRaw(summaryRaw({ admission_date: null }))))).toBe("UNREADABLE_DOCUMENT");
    const r = billDraftFromRaw(raw([line()], { admission_date: "2026-08-09" }));
    expect(err(() => reconcile(r, summaryDraftFromRaw(summaryRaw())))).toBe("UNREADABLE_DOCUMENT");
  });

  it("skips the total check (never a false Provable) when a line was unreadable or no total was printed", () => {
    const b = billDraftFromRaw(raw([line({ amount: 100 }), line({ amount: null })], { stated_total: 2600 }));
    const { bill } = reconcile(b, summaryDraftFromRaw(summaryRaw()));
    const r = runRules(bill, { items: [] }, table);
    expect(r.candidates.filter((c) => c.type === "ARITH_TOTAL")).toEqual([]);
    expect(r.skipped_checks).toContainEqual(expect.objectContaining({ line_item_id: "TOTAL" }));
  });

  it("the same bill with every line readable does raise the total check", () => {
    const b = billDraftFromRaw(raw([line({ amount: 100 })], { stated_total: 2600 }));
    const r = runRules(reconcile(b, summaryDraftFromRaw(summaryRaw())).bill, { items: [] }, table);
    expect(r.candidates.map((c) => c.type)).toEqual(["ARITH_TOTAL"]);
  });

  it("synthetic truth files round-trip unchanged through the draft schemas and reconcile", () => {
    for (const dir of ["bill-01-clean", "bill-02-demo", "bill-03-errors"]) {
      const b = JSON.parse(readFileSync(`data/synthetic/${dir}/bill.truth.json`, "utf8"));
      const s = JSON.parse(readFileSync(`data/synthetic/${dir}/summary.truth.json`, "utf8"));
      const out = reconcile(BillDraft.parse(b), SummaryDraft.parse(s));
      expect(out.bill.items).toEqual(b.items);
      expect(out.bill.stated_total).toBe(b.stated_total);
      expect(out.summary.free_text_summary).toBe(s.free_text_summary);
    }
  });
});

describe("normalization output validation", () => {
  const ok = { line_item_id: "L001", canonical_id: "pantoprazole_40_inj", canonical_name: "Pantoprazole 40 mg", billed_unit: "vial" as const,
    units_per_billed_unit: 1, billed_brand: null, match_confidence: "high" as const, rationale: "x" };
  it("accepts a complete answer", () => expect(normalizationProblems({ items: [ok] }, ["L001"], table)).toEqual([]));
  it("rejects invented canonical ids, unknown or missing lines and duplicates", () => {
    expect(normalizationProblems({ items: [{ ...ok, canonical_id: "made_up_drug" }] }, ["L001"], table)).toEqual(["canonical_id made_up_drug is not in reference_rows; use null"]);
    expect(normalizationProblems({ items: [{ ...ok, line_item_id: "L099" }] }, ["L001"], table)).toEqual(["unknown line_item_id L099", "missing answer for L001"]);
    expect(normalizationProblems({ items: [ok, ok] }, ["L001"], table)).toEqual(["line L001 answered twice"]);
  });
});
