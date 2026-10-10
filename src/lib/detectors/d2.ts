// D2 — drug price vs printed MRP / NPPA ceiling (SPEC section 2). Table lookup and arithmetic only, no LLM.
// The tier/stake logic lives in assessDrugPrice() (schemas.ts): per-unit limit = min(printed MRP, ceiling × (1 + GST/100)),
// ceiling is ex-GST so GST is added exactly once, and any verified:false row is capped at Ask.
// This module adds: normalization gating, unit conversion, input validation, skipped-check logging, finding assembly.
import {
  type BillExtraction, type CandidateFinding, type DrugRow, type DrugTable, type NormalizationResult, type NormalizedItem,
  assessDrugPrice, mrpPerUnit,
} from "../schemas";
import { PRICE_TOL, PRINTED_MRP_DIVERGENCE, UNVERIFIED_REFERENCE_LABEL } from "../config";
import { allowedTokens, formatRupees } from "../money";

export type SkippedCheck = { line_item_id: string; reason: string };
const BASIS_TEXT = {
  printed_mrp: "the MRP printed on the bill",
  reference_mrp: "the reference-table MRP",
  ceiling_incl_gst: "the published ceiling price including GST",
} as const;

const rate4 = (n: number) => Math.round(n * 10000) / 10000;
const validPositive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

/** Billed unit must be the row's table unit (1 per unit), or "other" (e.g. a strip) with a pack size the row allows. */
function unitsConsistent(n: NormalizedItem, row: DrugRow): boolean {
  const upb = n.units_per_billed_unit;
  if (upb == null || !validPositive(upb)) return false;
  if (n.billed_unit === row.table_unit) return upb === 1;
  return n.billed_unit === "other" && row.allowed_pack_sizes.includes(upb);
}

export function detectD2(
  bill: BillExtraction,
  normalization: NormalizationResult,
  table: DrugTable,
): { findings: CandidateFinding[]; skipped_checks: SkippedCheck[] } {
  const norm = new Map<string, NormalizedItem>();
  for (const n of normalization.items) {
    if (norm.has(n.line_item_id)) throw new Error(`Normalization has two entries for line ${n.line_item_id}`);
    norm.set(n.line_item_id, n);
  }
  const rows = new Map(table.rows.map((r) => [r.canonical_id, r]));
  const findings: CandidateFinding[] = [];
  const skipped: SkippedCheck[] = [];

  for (const item of bill.items) {
    const n = norm.get(item.id);
    const skip = (reason: string) => skipped.push({ line_item_id: item.id, reason });
    if (!n || n.canonical_id == null) {
      if (item.category === "drug") skip("D2 skipped: no reference-table match for this drug line");
      continue;
    }
    const row = rows.get(n.canonical_id);
    if (!row) { skip(`D2 skipped: canonical_id ${n.canonical_id} is not in the reference table`); continue; }
    if (n.match_confidence === "low") { skip("D2 skipped: low-confidence name match"); continue; }
    if (!validPositive(item.quantity) || !validPositive(item.unit_rate)) { skip("D2 skipped: quantity or unit rate is missing or invalid"); continue; }
    if (item.printed_mrp != null && !validPositive(item.printed_mrp)) { skip("D2 skipped: printed MRP is invalid"); continue; }
    if (!unitsConsistent(n, row)) { skip(`D2 skipped: billed unit/pack conversion is not consistent with the reference unit (${row.table_unit})`); continue; }
    const refMrp = mrpPerUnit(row);
    if (refMrp == null && item.printed_mrp == null) { skip("D2 skipped: reference row has no price and the bill prints no MRP"); continue; }

    const upb = n.units_per_billed_unit!; // validated by unitsConsistent
    const unitRate = rate4(item.unit_rate / upb);
    const printedPerUnit = item.printed_mrp != null ? rate4(item.printed_mrp / upb) : undefined;
    const qtyUnits = item.quantity * upb;

    // D2-P3 (log only): printed MRP far from the reference MRP. The printed MRP is used either way.
    if (printedPerUnit != null && refMrp != null && Math.abs(printedPerUnit - refMrp) / refMrp > PRINTED_MRP_DIVERGENCE)
      skip(`D2-P3 log: printed MRP ${formatRupees(printedPerUnit)} per unit differs from the reference MRP ${formatRupees(refMrp)} by more than ${PRINTED_MRP_DIVERGENCE * 100}%; the printed MRP was used`);

    const a = assessDrugPrice(
      row,
      { unit_rate: unitRate, qty_units: qtyUnits, units_consistent: true, printed_mrp: printedPerUnit, billed_brand: n.billed_brand },
      PRICE_TOL,
    );
    if (!a || a.amount_at_stake <= 0) continue;

    const unitWord = row.table_unit;
    const evidence: CandidateFinding["evidence"] = {
      drug: row.generic_name, strength: row.strength, billed_rate_per_unit: formatRupees(unitRate), unit: unitWord,
      quantity_in_units: qtyUnits, binding_limit_per_unit: formatRupees(a.limit_per_unit), binding_basis: a.binding_basis,
      bases_exceeded: a.bases_exceeded.join(", "), reference_verified: a.reference_verified, brand_match: a.brand_match,
      billed_brand: n.billed_brand ?? "not identified", excess: formatRupees(a.amount_at_stake),
    };
    if (printedPerUnit != null) evidence.printed_mrp_per_unit = formatRupees(printedPerUnit);
    if (refMrp != null) evidence.reference_mrp_per_unit = formatRupees(refMrp);
    if (a.bases_exceeded.includes("ceiling_incl_gst") && row.ceiling_price_per_unit != null && row.gst_pct != null) {
      evidence.ceiling_ex_gst_per_unit = formatRupees(row.ceiling_price_per_unit);
      evidence.gst = `${row.gst_pct}%`;
      evidence.ceiling_incl_gst_per_unit = formatRupees(row.ceiling_price_per_unit * (1 + row.gst_pct / 100));
    }
    if (!row.verified) evidence.reference_label = UNVERIFIED_REFERENCE_LABEL;

    const exceeded = a.bases_exceeded.map((b) => BASIS_TEXT[b]).join(" and ");
    const usesCeiling = a.bases_exceeded.includes("ceiling_incl_gst");
    findings.push({
      type: "DRUG_ABOVE_LIMIT",
      detector: "D2_DRUG_PRICE",
      line_item_ids: [item.id],
      amount_at_stake: a.amount_at_stake,
      rule_or_source_cited: {
        rule_id: "D2-P1",
        description:
          `The billed rate per ${unitWord} is above ${exceeded}; the binding limit is ${BASIS_TEXT[a.binding_basis]}. ` +
          `This is a charge to question; confirm with the billing desk.` + (row.verified ? "" : ` ${UNVERIFIED_REFERENCE_LABEL}`),
        source: `Reference table row ${row.canonical_id} (${table.table_version})` + (row.ceiling_source_ref && usesCeiling ? `; ${row.ceiling_source_ref}` : ""),
        benchmark_label: a.tier === "Provable" ? (usesCeiling ? "printed MRP and NPPA ceiling price (VERIFY)" : "printed MRP") : "reference benchmark",
      },
      initial_tier: a.tier,
      confidence: n.match_confidence === "high" ? "high" : "medium",
      evidence,
      allowed_tokens: allowedTokens(evidence, a.amount_at_stake),
    });
  }
  return { findings, skipped_checks: skipped };
}
