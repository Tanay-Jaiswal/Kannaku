// Deterministic rule engine entry point: D1 + D2 (D3 needs the clinical LLM and arrives in Phase 3).
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
  const candidates = [...detectD1(bill, canonical), ...d2.findings].map((c) => CandidateSchema.parse(c));
  return { candidates, skipped_checks: d2.skipped_checks };
}
