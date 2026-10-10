// Pipeline stage "finalize": assemble the PipelineResult. Every number is re-derived on the server from the
// bill (rules re-run, D3 stakes re-added), so nothing the browser sends can change an amount or raise a tier.
import { z } from "zod";
import { DISCLAIMER, SPEC_VERSION } from "./config";
import { runRules } from "./detectors";
import { M2_CATEGORIES, detectIcuDays, m2Rule } from "./detectors/d3";
import {
  AuditorOut, DefenderOut, JudgeOut, assembleDebated, assembleUndebated, debateProblems, type DebateLogEntry, type NumberedCandidate,
} from "./debate";
import { BillExtraction, DebateStep, DischargeSummary, Finding, NormalizationResult, PipelineResult, type CandidateFinding, type DrugTable } from "./schemas";
import { allowedTokens, cents, formatRupees } from "./money";
import { PROMPT_VERSIONS } from "./prompts";
import { computeTotals } from "./totals";
import { toneViolations } from "./tone";
import { sampleReviewSource } from "./cache";
import { DEMO_MODEL } from "./config";

export const FinalizeItem = z.object({
  candidate: Finding.pick({
    id: true, type: true, detector: true, line_item_ids: true, amount_at_stake: true, rule_or_source_cited: true,
    initial_tier: true, confidence: true, evidence: true, allowed_tokens: true,
  }),
  steps: z.object({ auditor: AuditorOut, defender: DefenderOut, judge: JudgeOut }).nullable().optional(),
  logs: z.array(DebateStep).optional(),
  debate_error: z.string().max(300).optional(),
});
export const FinalizeInput = z.object({
  run_id: z.string(),
  data_label: z.enum(["Synthetic data", "User upload"]),
  bill: BillExtraction,
  summary: DischargeSummary,
  normalization: NormalizationResult,
  items: z.array(FinalizeItem).max(60),
  clinical_check: z.object({ state: z.enum(["done", "failed"]), note: z.string().max(300) }),
  warnings: z.array(z.string().max(300)).max(20).default([]),
});
export type FinalizeInput = z.infer<typeof FinalizeInput>;

const keyOf = (rule: string, ids: string[]) => `${rule}|${ids.join(",")}`;

/** Server-side re-derivation of one candidate. Returns null if it cannot be re-verified from the bill. */
function reverify(c: FinalizeInput["items"][number]["candidate"], server: Map<string, CandidateFinding>, bill: BillExtraction, demo: boolean): NumberedCandidate | null {
  const rule = c.rule_or_source_cited.rule_id;
  if (rule !== "D3-M2") {
    const s = server.get(keyOf(rule, c.line_item_ids));
    return s ? { ...s, id: c.id } : null;
  }
  const items = c.line_item_ids.map((id) => bill.items.find((i) => i.id === id));
  if (items.length === 0 || items.some((i) => !i || !M2_CATEGORIES.has(i.category))) return null;
  if (toneViolations(c.evidence).length) return null;
  const stake = cents(items.reduce((a, i) => a + i!.amount, 0));
  const evidence = {
    billed_items: items.map((i) => `${i!.id} ${i!.description_raw}`).join("; "),
    amount_billed: formatRupees(stake),
    summary_check: String(c.evidence.summary_check ?? "").slice(0, 300),
    clinical_reasoning: String(c.evidence.clinical_reasoning ?? "").slice(0, 400),
  };
  return {
    id: c.id, type: "MISMATCH_NOT_IN_SUMMARY", detector: "D3_BILL_VS_SUMMARY", line_item_ids: c.line_item_ids, amount_at_stake: stake,
    rule_or_source_cited: m2Rule(c.line_item_ids, demo), initial_tier: "Ask", confidence: c.confidence === "high" ? "high" : "medium",
    evidence, allowed_tokens: allowedTokens(evidence, stake),
  };
}

export function finalize(input: unknown, table: DrugTable) {
  const inp = FinalizeInput.parse(input);
  const { bill, summary, normalization } = inp;
  // Who wrote the AI-stage answers. Uploads are live AI. For samples it follows the debate logs (the model id
  // recorded on each step); with no debated finding it falls back to how this deployment serves samples.
  const models = inp.items.flatMap((i) => (i.steps ? (i.logs ?? []).map((l) => l.model) : []));
  const review_source = inp.data_label === "User upload" ? "live_ai"
    : models.includes(DEMO_MODEL) ? "demonstration" : models.length ? "recorded_ai" : sampleReviewSource();
  const rules = runRules(bill, normalization, table);
  const server = new Map<string, CandidateFinding>();
  for (const c of [...rules.candidates, ...detectIcuDays(bill, summary)]) server.set(keyOf(c.rule_or_source_cited.rule_id, c.line_item_ids), c);

  const warnings = [...inp.warnings];
  const findings: Finding[] = [];
  const seen = new Set<string>();
  for (const item of inp.items) {
    const c = reverify(item.candidate, server, bill, review_source === "demonstration");
    if (!c || seen.has(c.id)) { warnings.push(`A finding (${item.candidate.id}) could not be re-verified against the bill and was removed.`); continue; }
    seen.add(c.id);
    let finding: Finding;
    if (item.steps) {
      const problems = [item.steps.auditor, item.steps.defender, item.steps.judge].flatMap((o) => debateProblems(o, c, bill, summary));
      finding = problems.length
        ? assembleUndebated(c, "the review text failed Kanakku's checks, so it is not shown")
        : assembleDebated(c, item.steps, (item.logs ?? []) as DebateLogEntry[]);
    } else {
      finding = assembleUndebated(c, item.debate_error ?? "the review step did not run");
    }
    findings.push(finding);
  }

  const { totals } = computeTotals(findings);
  const result = PipelineResult.parse({
    run_id: inp.run_id,
    data_label: inp.data_label,
    bill, summary, normalization,
    skipped_checks: rules.skipped_checks,
    findings,
    totals,
    disclaimer: DISCLAIMER,
    versions: { spec: SPEC_VERSION, prompts: { ...PROMPT_VERSIONS }, table: table.table_version },
    warnings,
    clinical_check: inp.clinical_check,
    review_source,
  });
  const tone = toneViolations(result.findings);
  if (tone.length) throw new Error(`tone lint failed on final findings: ${tone.join(",")}`);
  return result;
}
