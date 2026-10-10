// Phase 4: the Rebuttal Engine (SPEC 6). Auditor -> Defender -> Judge, one model call per step, every output
// zod-validated and checked by the number guard and tone lint. The Judge's decision is then constrained by code:
// it can only lower a tier, never raise it, never touch the amount, and cannot drop a finding without
// documentary support (or a basis error). All three steps are logged on the finding.
import { z } from "zod";
import type { BillExtraction, CandidateFinding, DischargeSummary, Finding } from "./schemas";
import { Finding as FindingSchema } from "./schemas";
import { daysBetween, formatRupees } from "./money";
import { callJson } from "./llm/call";
import { numberGuardViolations, tokensFrom } from "./numberGuard";
import { toneViolations } from "./tone";
import type { RunContext } from "./spend";

const words = (max: number) => z.string().min(1).max(max * 9); // generous char cap for "max N words"

export const AuditorOut = z.object({
  claim: words(40),
  evidence: z.array(z.object({ source: z.enum(["bill", "summary", "reference_table"]), ref: z.string().max(120), point: words(40) })).min(1).max(4),
  why_it_matters: words(30),
  confidence: z.enum(["high", "medium", "low"]),
});
export const DefenderOut = z.object({
  strongest_justification: words(50),
  supporting_points: z.array(words(30)).max(3),
  verifiable_from_documents: z.boolean(),
  what_would_confirm: words(30),
  concedes: z.boolean(),
});
export const JudgeOut = z.object({
  decision: z.enum(["keep", "downgrade_to_ask", "drop"]),
  rationale: words(50),
  counter_argument: words(80),
  question_for_billing_desk: words(30),
  confidence: z.enum(["high", "medium", "low"]),
  basis_error: z.boolean(),
});
export type AuditorOut = z.infer<typeof AuditorOut>;
export type DefenderOut = z.infer<typeof DefenderOut>;
export type JudgeOut = z.infer<typeof JudgeOut>;

export type DebateRole = "auditor" | "defender" | "judge";
export const ROLE_SCHEMA = { auditor: AuditorOut, defender: DefenderOut, judge: JudgeOut } as const;

/** A candidate plus its code-assigned id ("F-001"). */
export type NumberedCandidate = CandidateFinding & { id: string };

/** SPEC 6 "common debate input", built by code and identical for all three roles. */
export function debateInput(f: NumberedCandidate, bill: BillExtraction, summary: DischargeSummary) {
  const facts: Record<string, string> = { amount_at_stake: formatRupees(f.amount_at_stake) };
  for (const [k, v] of Object.entries(f.evidence)) facts[k] = String(v);
  return {
    finding: {
      id: f.id, type: f.type, tier: f.initial_tier, rule: f.rule_or_source_cited,
      line_items: f.line_item_ids.map((id) => {
        const i = bill.items.find((x) => x.id === id)!;
        return { id: i.id, description_raw: i.description_raw, category: i.category, date: i.date, time: i.time ?? null, quantity: i.quantity, unit: i.unit ?? null };
      }),
    },
    facts,
    allowed_tokens: f.allowed_tokens,
    bill_context: {
      admission_date: bill.admission_date, discharge_date: bill.discharge_date,
      nights: daysBetween(bill.admission_date, bill.discharge_date), hospital_name: bill.hospital_name,
    },
    summary,
  };
}

/** Guard for every debate output: tone, number guard (code tokens + figures already in the documents), real line ids. */
export function debateProblems(out: unknown, f: NumberedCandidate, bill: BillExtraction, summary: DischargeSummary): string[] {
  const allowed = tokensFrom([...f.allowed_tokens, ...Object.values(f.evidence).map(String), summary.free_text_summary, JSON.stringify(summary)]);
  const ids = new Set(bill.items.map((i) => i.id));
  const text = JSON.stringify(out);
  return [
    ...toneViolations(out).map((w) => `banned word "${w}"`),
    ...numberGuardViolations(out, allowed).map((n) => `"${n}" is not a figure supplied in FACTS/allowed_tokens; quote figures verbatim or omit them`),
    ...[...text.matchAll(/\bL\d{3}\b/g)].map((m) => m[0]).filter((id) => !ids.has(id)).map((id) => `line ${id} does not exist on the bill`),
  ];
}

export type DebatePrior = { auditor?: AuditorOut; defender?: DefenderOut };

/** Runs one debate step. The caller (route or in-process pipeline) supplies earlier steps' outputs. */
export async function runDebateStep(role: DebateRole, f: NumberedCandidate, bill: BillExtraction, summary: DischargeSummary, prior: DebatePrior, ctx: RunContext) {
  if (role !== "auditor" && !prior.auditor) throw new Error("defender/judge need the auditor output");
  if (role === "judge" && !prior.defender) throw new Error("judge needs the defender output");
  const common = debateInput(f, bill, summary);
  const payload = role === "auditor" ? common : role === "defender" ? { ...common, auditor: prior.auditor } : { ...common, auditor: prior.auditor, defender: prior.defender };
  const schema = ROLE_SCHEMA[role] as z.ZodType<AuditorOut | DefenderOut | JudgeOut, z.ZodTypeDef, unknown>;
  const r = await callJson({
    stage: `debate_${role}`, prompt: role, modelKind: "reason", ctx, keyInput: payload, userText: JSON.stringify(payload), schema,
    guard: (out) => debateProblems(out, f, bill, summary),
  });
  return { output: r.output, log: { role, prompt_version: r.promptVersion, model: r.model, cache_key: r.cacheKey, output: r.output } };
}

export type DebateLogEntry = Awaited<ReturnType<typeof runDebateStep>>["log"];

/**
 * Code-enforced Judge constraints (SPEC 6). Pure function; also re-applied in finalize, so a tampered client
 * cannot raise a tier or keep a dropped-without-support decision.
 */
export function enforceJudge(initialTier: Finding["initial_tier"], defender: DefenderOut, judge: JudgeOut) {
  const notes: string[] = [];
  let decision = judge.decision;
  if (decision === "drop" && !judge.basis_error) {
    if (initialTier === "Provable") {
      decision = "downgrade_to_ask";
      notes.push("The Judge proposed dropping a rule-proven (Provable) finding without identifying a data error; code kept it as a question instead.");
    } else if (defender.concedes) {
      decision = "keep";
      notes.push("The Judge proposed dropping a finding that the Defender conceded; code kept it.");
    } else if (!defender.verifiable_from_documents) {
      decision = "downgrade_to_ask";
      notes.push("The Judge proposed dropping this finding, but the hospital's explanation is not supported by the documents; code kept it as a question.");
    }
  }
  const tier: Finding["tier"] = decision === "downgrade_to_ask" ? "Ask" : initialTier;
  const status: Finding["status"] = decision === "drop" ? "dropped" : tier !== initialTier ? "downgraded" : "kept";
  return { decision, tier, status, notes };
}

/** Assembles the final Finding from a candidate and its three validated steps. */
export function assembleDebated(f: NumberedCandidate, steps: { auditor: AuditorOut; defender: DefenderOut; judge: JudgeOut }, log: DebateLogEntry[]): Finding {
  const e = enforceJudge(f.initial_tier, steps.defender, steps.judge);
  return FindingSchema.parse({
    ...f,
    tier: e.tier,
    auditor_argument: steps.auditor.claim + " " + steps.auditor.why_it_matters,
    defender_rebuttal: {
      strongest_justification: steps.defender.strongest_justification,
      supporting_points: steps.defender.supporting_points,
      verifiable_from_documents: steps.defender.verifiable_from_documents,
      what_would_confirm: steps.defender.what_would_confirm,
    },
    judge_decision: { decision: e.decision, rationale: steps.judge.rationale },
    counter_argument: steps.judge.counter_argument,
    question_for_billing_desk: steps.judge.question_for_billing_desk,
    status: e.status,
    debate_log: log,
    review: { state: "debated", note: "Auditor, Defender and Judge steps completed." },
    ...(e.notes.length ? { enforcement_notes: e.notes } : {}),
  });
}

/** A finding the debate could not run on: rule tier stands, clearly marked, nothing invented. */
export function assembleUndebated(f: NumberedCandidate, reason: string): Finding {
  return FindingSchema.parse({
    ...f,
    tier: f.initial_tier,
    auditor_argument: f.rule_or_source_cited.description,
    defender_rebuttal: { strongest_justification: "Not cross-examined.", supporting_points: [], verifiable_from_documents: false, what_would_confirm: "Ask the billing desk for the record behind this line." },
    judge_decision: { decision: "keep", rationale: `Not cross-examined: ${reason}` },
    counter_argument: "",
    question_for_billing_desk: `Please explain bill line(s) ${f.line_item_ids.join(", ") || "on the bill total"}: ${f.rule_or_source_cited.description}`,
    status: "kept",
    debate_log: [],
    review: { state: "not_debated", note: reason },
  });
}
