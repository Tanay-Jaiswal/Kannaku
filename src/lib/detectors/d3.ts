// D3 — bill vs discharge summary (SPEC section 2). The clinical model proposes "not in summary" candidates
// from descriptions only (it never sees a rupee amount); code validates ids/categories and prices them.
// D3-M1 (ICU days) is a pure numeric comparison, so code computes it directly and ignores model ICU candidates.
// D3 never produces Provable.
import { z } from "zod";
import { MAX_D3_CANDIDATES } from "../config";
import { ClinicalResult, type BillExtraction, type CandidateFinding, type DischargeSummary } from "../schemas";
import { allowedTokens, cents, formatRupees } from "../money";
import { callJson } from "../llm/call";
import { numberGuardViolations, tokensFrom } from "../numberGuard";
import { toneViolations } from "../tone";
import type { RunContext } from "../spend";
import { KanakkuError } from "../errors";

export const M2_CATEGORIES = new Set(["procedure", "surgery", "investigation", "radiology", "blood", "physio"]);
type ClinicalCandidate = z.infer<typeof ClinicalResult>["candidates"][number];

/** `demo`: the candidate came from the precomputed demonstration script, not an AI reading, and says so. */
export const m2Rule = (ids: string[], demo = false) => ({
  rule_id: "D3-M2",
  description: "This billed service is not mentioned in the discharge summary. That does not mean it was not provided; ask the billing desk for the order or report that supports it.",
  source: `Bill line(s) ${ids.join(", ")} vs discharge summary (${demo ? "precomputed demonstration reading" : "AI-assisted reading"}, code-validated)`,
  benchmark_label: "discharge summary",
});

/** D3-M1: ICU line days above the summary's documented ICU days. */
export function detectIcuDays(bill: BillExtraction, summary: DischargeSummary): CandidateFinding[] {
  return bill.items
    .filter((i) => i.category === "icu" && i.quantity > summary.icu_days)
    .map((i) => {
      const extra = i.quantity - summary.icu_days;
      const stake = cents(extra * i.unit_rate);
      const evidence: CandidateFinding["evidence"] = {
        description: i.description_raw, icu_days_billed: i.quantity, icu_days_documented_in_summary: summary.icu_days,
        extra_days: extra, daily_rate: formatRupees(i.unit_rate), amount_for_extra_days: formatRupees(stake),
      };
      return {
        type: "MISMATCH_ICU_DAYS", detector: "D3_BILL_VS_SUMMARY", line_item_ids: [i.id], amount_at_stake: stake,
        rule_or_source_cited: {
          rule_id: "D3-M1",
          description: "More ICU days are billed than the discharge summary documents. Confirm the unit-by-unit bed record with the billing desk.",
          source: `Bill line ${i.id} vs discharge summary icu_days`,
          benchmark_label: "discharge summary",
        },
        initial_tier: "Ask", confidence: "medium", evidence, allowed_tokens: allowedTokens(evidence, stake),
      } satisfies CandidateFinding;
    });
}

/** Code validation of model candidates (SPEC D3-M2). Returns accepted candidates and why others were discarded. */
export function validateClinical(bill: BillExtraction, result: z.infer<typeof ClinicalResult>, opts: { demo?: boolean } = {}) {
  const byId = new Map(bill.items.map((i) => [i.id, i]));
  const used = new Set<string>();
  const accepted: { c: ClinicalCandidate; findings: CandidateFinding }[] = [];
  const discarded: string[] = [];
  for (const c of result.candidates) {
    if (c.kind !== "NOT_IN_SUMMARY") { discarded.push("ICU-day candidates are computed by code (D3-M1)"); continue; }
    if (c.confidence === "low") { discarded.push(`${c.line_item_ids.join(",")}: low confidence`); continue; }
    const items = c.line_item_ids.map((id) => byId.get(id));
    if (items.some((i) => !i)) { discarded.push(`${c.line_item_ids.join(",")}: cites a line that is not on the bill`); continue; }
    if (items.some((i) => !M2_CATEGORIES.has(i!.category))) { discarded.push(`${c.line_item_ids.join(",")}: category not checked against the summary`); continue; }
    if (c.line_item_ids.some((id) => used.has(id))) { discarded.push(`${c.line_item_ids.join(",")}: overlaps an earlier candidate`); continue; }
    if (accepted.length >= MAX_D3_CANDIDATES) { discarded.push(`${c.line_item_ids.join(",")}: over the per-run cap of ${MAX_D3_CANDIDATES}`); continue; }
    c.line_item_ids.forEach((id) => used.add(id));
    const stake = cents(items.reduce((a, i) => a + i!.amount, 0));
    const evidence: CandidateFinding["evidence"] = {
      billed_items: items.map((i) => `${i!.id} ${i!.description_raw}`).join("; "),
      amount_billed: formatRupees(stake),
      summary_check: c.summary_evidence,
      clinical_reasoning: c.reasoning,
    };
    accepted.push({
      c,
      findings: {
        type: "MISMATCH_NOT_IN_SUMMARY", detector: "D3_BILL_VS_SUMMARY", line_item_ids: c.line_item_ids, amount_at_stake: stake,
        rule_or_source_cited: m2Rule(c.line_item_ids, opts.demo),
        initial_tier: "Ask", confidence: c.confidence === "high" ? "high" : "medium", evidence, allowed_tokens: allowedTokens(evidence, stake),
      },
    });
  }
  return { candidates: accepted.map((a) => a.findings), discarded };
}

export function clinicalInput(bill: BillExtraction, summary: DischargeSummary) {
  // No rupee amounts are sent: the model judges documentation, not prices.
  return {
    bill_items: bill.items.map((i) => ({ id: i.id, description_raw: i.description_raw, category: i.category, date: i.date, quantity: i.quantity, unit: i.unit ?? null })),
    eligible_categories: [...M2_CATEGORIES],
    summary,
  };
}

/** Full D3: code M1 + model-proposed, code-validated M2. A model failure never removes the code M1 result. */
export async function runClinical(bill: BillExtraction, summary: DischargeSummary, ctx: RunContext) {
  const m1 = detectIcuDays(bill, summary);
  try {
    const r = await clinicalModel(bill, summary, ctx);
    return { candidates: [...m1, ...r.candidates], discarded: r.discarded, meta: r.meta, error: null };
  } catch (e) {
    if (!(e instanceof KanakkuError)) throw e;
    // The model half failed: the code-computed ICU check still stands; the result says the rest did not run.
    return { candidates: m1, discarded: [], meta: null, error: { code: e.code, message: e.userMessage } };
  }
}

async function clinicalModel(bill: BillExtraction, summary: DischargeSummary, ctx: RunContext) {
  const input = clinicalInput(bill, summary);
  const r = await callJson({
    stage: "clinical", prompt: "clinical", modelKind: "reason", ctx, keyInput: input, userText: JSON.stringify(input),
    schema: ClinicalResult,
    guard: (out) => [
      ...toneViolations(out).map((w) => `banned word "${w}"`),
      ...numberGuardViolations(out, tokensFrom([]), { checkPercent: false }).map((n) => `rupee figure "${n}" is not allowed in this step`),
    ],
  });
  const m2 = validateClinical(bill, r.output, { demo: ctx.mode === "demo" });
  return { candidates: m2.candidates, discarded: m2.discarded, meta: { prompt_version: r.promptVersion, model: r.model, cached: r.cached } };
}
