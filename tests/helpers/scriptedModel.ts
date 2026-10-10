// A scripted stand-in for the model, driven by the synthetic answer keys. It behaves like a GOOD model so the
// tests can check the plumbing end to end (ids, caps, tier enforcement, totals). It says nothing about real
// model quality; that is measured with scripts/eval.ts on the real cache.
import { readFileSync } from "node:fs";
import type { LlmRequest } from "../../src/lib/llm/provider";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
type KeyEntry = { rule_id: string; line_item_ids: string[]; canonical_id?: string; billed_brand?: string };

export function scriptedModel(dir: string, opts: { clinicalExtras?: unknown[]; judgeOverride?: (findingId: string) => object | null } = {}) {
  const key = read(`data/synthetic/${dir}/answer_key.json`);
  const manifest = read(`data/synthetic/${dir}/seed_manifest.json`);
  const trapLines = new Set<string>((key.traps as KeyEntry[]).flatMap((t) => t.line_item_ids));
  const drugRefs = [...manifest.seeded, ...manifest.traps, ...manifest.decoys].filter((x: KeyEntry) => x.canonical_id) as KeyEntry[];

  return (req: LlmRequest) => {
    const text = (req.content.at(-1) as { text: string }).text.split("\n\nYOUR PREVIOUS ANSWER")[0]!;
    const input = JSON.parse(text);
    const stage = req.system.match(/^# (\w+)\.v1/m)?.[1];
    switch (stage) {
      case "normalize":
        return {
          items: input.lines.map((l: { line_item_id: string; unit: string | null }) => {
            const ref = drugRefs.find((r) => r.line_item_ids.includes(l.line_item_id));
            return ref
              ? { line_item_id: l.line_item_id, canonical_id: ref.canonical_id, canonical_name: ref.canonical_id, billed_unit: l.unit, units_per_billed_unit: 1, billed_brand: ref.billed_brand ?? null, match_confidence: "high", rationale: "scripted" }
              : { line_item_id: l.line_item_id, canonical_id: null, canonical_name: null, billed_unit: null, units_per_billed_unit: null, billed_brand: null, match_confidence: "low", rationale: "no table row" };
          }),
        };
      case "clinical": {
        const m2 = [...key.seeded, ...key.traps].filter((s: KeyEntry) => s.rule_id === "D3-M2");
        return {
          candidates: [
            ...m2.map((s: KeyEntry) => ({ kind: "NOT_IN_SUMMARY", line_item_ids: s.line_item_ids, summary_evidence: "Structured investigations and narrative checked.", reasoning: "Not mentioned in the summary; a question, not proof.", confidence: "medium" })),
            ...(opts.clinicalExtras ?? []),
          ],
        };
      }
      case "auditor":
        return { claim: `Question ${input.finding.id}: ${input.finding.rule.rule_id}.`, evidence: [{ source: "bill", ref: input.finding.line_items[0]?.id ?? "bill totals", point: `Billed amount at stake ${input.facts.amount_at_stake}.` }], why_it_matters: "It changes what the patient pays.", confidence: "medium" };
      case "defender": {
        const trap = input.finding.line_items.some((l: { id: string }) => trapLines.has(l.id));
        const provable = input.finding.tier === "Provable";
        return {
          strongest_justification: trap ? "The discharge summary narrative explains this charge." : provable ? "No legitimate justification is visible." : "A generic billing convention could apply.",
          supporting_points: trap ? ["free_text_summary describes it."] : [],
          verifiable_from_documents: trap, what_would_confirm: "The ward transfer log or the order record.", concedes: provable && !trap,
        };
      }
      case "judge": {
        const o = opts.judgeOverride?.(input.finding.id);
        if (o) return o;
        const trap = input.finding.line_items.some((l: { id: string }) => trapLines.has(l.id));
        return {
          decision: trap ? "drop" : "keep", rationale: trap ? "The summary explains it." : "Not explained by the documents.",
          counter_argument: trap ? "This charge appears explained by the discharge summary." : `Please review this line; the amount at stake is ${input.facts.amount_at_stake}.`,
          question_for_billing_desk: "Can you share the record that supports this charge?", confidence: "medium", basis_error: false,
        };
      }
      default:
        throw new Error(`scriptedModel: unknown stage ${stage}`);
    }
  };
}
