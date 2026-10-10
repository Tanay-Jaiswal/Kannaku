// Data-quality checks for the drug table. Run in tests. Returns human-readable errors.
import { readFileSync } from "node:fs";
import { DrugTable, mrpPerUnit } from "../src/lib/schemas";
import { PRICE_TOL } from "../src/lib/config";

export function validateTable(path = "data/reference/drug_reference.json"): string[] {
  const t = DrugTable.parse(JSON.parse(readFileSync(path, "utf8")));
  const errs: string[] = [];
  for (const r of t.rows) {
    const mrp = mrpPerUnit(r);
    if (r.ceiling_price_per_unit != null) {
      if (r.gst_pct == null) errs.push(`${r.canonical_id}: ceiling requires gst_pct`);
      else if (mrp != null && mrp > r.ceiling_price_per_unit * (1 + r.gst_pct / 100) * (1 + PRICE_TOL))
        errs.push(`${r.canonical_id}: mrp_per_unit ${mrp} exceeds ceiling incl. GST (check units/GST)`);
    }
    if (r.verified && (mrp == null || !r.mrp_source || !r.source_retrieved_on || r.nlem_scheduled == null || r.gst_pct == null))
      errs.push(`${r.canonical_id}: verified=true needs MRP, pack size, source, date, nlem_scheduled and gst_pct`);
    if (r.nlem_scheduled === true && r.verified && r.ceiling_price_per_unit == null)
      errs.push(`${r.canonical_id}: scheduled but no ceiling price`);
  }
  return errs;
}
