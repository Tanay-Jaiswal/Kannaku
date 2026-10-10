// Deterministic rule engine entry point: D1 + D2 (D3 needs the clinical LLM: see d3.ts).
// Inputs and outputs are zod-validated so malformed data fails loudly instead of producing a silent wrong number.
import {
  BillExtraction, Finding, NormalizationResult, type CandidateFinding, type DrugTable,
} from "../schemas";
import { detectD1 } from "./d1";
import { detectD2, type SkippedCheck } from "./d2";

const CandidateSchema = Finding.pick({
  type: true, detector: true, line_item_ids: true, amount_at_stake: true, rule_or_source_cited: true,
  initial_tier: true, confidence: true, evidence: true, allowed_tokens: true,
});

export function runRules(
  billInput: unknown,
  normalizationInput: unknown,
  table: DrugTable,
): { candidates: CandidateFinding[]; skipped_checks: SkippedCheck[] } {
  const bill = BillExtraction.parse(billInput);
  const normalization = NormalizationResult.parse(normalizationInput);
  const canonical = new Map(
    normalization.items.filter((n) => n.canonical_id != null && n.match_confidence !== "low").map((n) => [n.line_item_id, n.canonical_id!]),
  );
  const d2 = detectD2(bill, normalization, table);
  const skipped_checks = [...d2.skipped_checks];
  let d1 = detectD1(bill, canonical);
  // Phase 3: checks that cannot run honestly on an incomplete extraction are skipped and logged, never guessed.
  const q = bill.extraction_quality;
  if (q) {
    if (q.excluded_lines.length > 0 || !q.stated_total_printed) {
      d1 = d1.filter((c) => c.type !== "ARITH_TOTAL");
      skipped_checks.push({
        line_item_id: "TOTAL",
        reason: !q.stated_total_printed
          ? "D1-A2 skipped: no grand total was readable on the bill"
          : `D1-A2 skipped: ${q.excluded_lines.length} bill line(s) could not be read, so the total cannot be re-added reliably`,
      });
    }
    for (const id of q.rates_not_printed) {
      d1 = d1.filter((c) => !(c.type === "ARITH_LINE" && c.line_item_ids.includes(id)));
      skipped_checks.push({ line_item_id: id, reason: "D1-A1 skipped: no unit rate is printed on this line, so quantity × rate cannot be checked" });
    }
  }
  const candidates = [...d1, ...d2.findings].map((c) => CandidateSchema.parse(c));
  return { candidates, skipped_checks };
}
