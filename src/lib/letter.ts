// Phase 6: the dispute letter. Built by code from the user's selected findings only: every amount, line id and
// source comes from the validated PipelineResult, and the wording is a request for clarification, not a claim.
// No model call, so it costs nothing and cannot introduce a figure.
import type { PipelineResult } from "./schemas";
import { computeTotals } from "./totals";
import { FINDING_TITLE, formatInr } from "./present";
import { UNVERIFIED_REFERENCE_LABEL } from "./config";

export type LetterOptions = { today?: string };

export function buildLetter(result: PipelineResult, selectedIds: string[], opts: LetterOptions = {}): string {
  const chosen = result.findings.filter((f) => selectedIds.includes(f.id) && f.status !== "dropped");
  if (chosen.length === 0) return "";
  const { bill } = result;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const { totals, overlaps } = computeTotals(chosen);
  const lines: string[] = [];
  if (result.data_label === "Synthetic data") lines.push("SYNTHETIC DATA - DEMO LETTER, NOT FOR SENDING", "");
  lines.push(
    `Date: ${today}`, "",
    "To: The Billing Desk",
    bill.hospital_name, "",
    `Subject: Request for clarification of itemised bill (admission ${bill.admission_date}, discharge ${bill.discharge_date})`, "",
    "Dear Sir or Madam,", "",
    "Thank you for the care provided. While reviewing the itemised bill, I found the charges below that I would like to understand before settling the account. I am not alleging any wrongdoing; I am asking for clarification and, where a charge was entered in error, a corrected bill.", "",
  );
  chosen.forEach((f, i) => {
    const items = f.line_item_ids.map((id) => bill.items.find((x) => x.id === id)).filter(Boolean);
    const where = items.length ? items.map((x) => `${x!.id} "${x!.description_raw}" (${x!.date})`).join("; ") : "the bill total";
    lines.push(`${i + 1}. ${FINDING_TITLE[f.type]}`);
    lines.push(`   Bill line(s): ${where}`);
    lines.push(`   Amount to clarify: ${formatInr(f.amount_at_stake)}${overlaps[f.id] ? ` (overlaps item ${chosen.findIndex((c) => c.id === overlaps[f.id]) + 1}; not counted twice)` : ""}`);
    lines.push(`   Basis: ${f.rule_or_source_cited.description}`);
    lines.push(`   Source: ${f.rule_or_source_cited.source}`);
    if (f.evidence.reference_verified === false) lines.push(`   Note: ${UNVERIFIED_REFERENCE_LABEL}`);
    if (f.review?.state === "debated" && f.counter_argument) lines.push(`   ${f.counter_argument}`);
    lines.push(`   Question: ${f.question_for_billing_desk}`, "");
  });
  lines.push(
    `Total amount I am asking you to clarify: ${formatInr(totals.questionable_total)} (overlapping items counted once).`, "",
    "Could you please review these items and share the supporting records (for example, the pharmacy issue slip, the bed-transfer log or the order for each service), or issue a corrected bill? I would be grateful for a written reply.", "",
    "Yours faithfully,", "",
    "[Your name]",
    "[Patient name and hospital registration / UHID number]",
    "[Phone number]", "",
    "---",
    "Prepared with Kanakku, an informational tool. This is not legal, medical or insurance advice. Reference benchmarks are not legal limits.",
  );
  return lines.join("\n");
}
