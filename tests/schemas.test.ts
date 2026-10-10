import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { DrugTable, LineItem, mrpPerUnit, priceLimitPerUnit } from "../src/lib/schemas";
import { validateTable } from "../scripts/validate-table";

describe("schemas", () => {
  it("drug table parses: 16 rows, only the 6 round-1 rows priced", () => {
    const t = DrugTable.parse(JSON.parse(readFileSync("data/reference/drug_reference.json", "utf8")));
    expect(t.rows).toHaveLength(16);
    expect(new Set(t.rows.map((r) => r.canonical_id)).size).toBe(16);
    const priced = t.rows.filter((r) => mrpPerUnit(r) !== null).map((r) => r.canonical_id).sort();
    expect(priced).toEqual([
      "amoxclav_625_tab", "azithromycin_500_tab", "ceftriaxone_1g_inj",
      "ondansetron_4mg_inj", "pantoprazole_40_inj", "paracetamol_650_tab",
    ]);
    expect(t.rows.filter((r) => r.verified).every((r) => priced.includes(r.canonical_id))).toBe(true);
  });
  it("derives mrp_per_unit", () => {
    const t = DrugTable.parse(JSON.parse(readFileSync("data/reference/drug_reference.json", "utf8")));
    const r = { ...t.rows[0]!, pack_size: 10, mrp_per_pack: 25 };
    expect(mrpPerUnit(r)).toBe(2.5);
  });
  it("rejects a malformed line item", () => {
    expect(() => LineItem.parse({ id: "L1" })).toThrow();
  });
  it("price limit is min(MRP, ceiling incl. GST)", () => {
    const t = DrugTable.parse(JSON.parse(readFileSync("data/reference/drug_reference.json", "utf8")));
    const base = { ...t.rows[0]!, pack_size: 10, mrp_per_pack: 100, ceiling_price_per_unit: null }; // MRP 10/unit
    expect(priceLimitPerUnit(base)).toBe(10); // no ceiling -> MRP
    expect(priceLimitPerUnit({ ...base, ceiling_price_per_unit: 9, gst_pct: 5 })).toBe(9.45); // ceiling binds
    expect(priceLimitPerUnit({ ...base, ceiling_price_per_unit: 20, gst_pct: 5 })).toBe(10); // MRP binds
  });
  it("table validator passes the current table", () => {
    expect(validateTable()).toEqual([]);
  });
});
