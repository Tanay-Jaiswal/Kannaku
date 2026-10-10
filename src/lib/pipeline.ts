// The whole pipeline in one process, in exactly the order the browser runs it through the API routes.
// Used by scripts/warm-sample-cache.ts (fills /cache for the samples), scripts/eval.ts and the tests.
import { finalize, type FinalizeInput } from "./finalize";
import { runRules } from "./detectors";
import { runClinical } from "./detectors/d3";
import { runDebateStep, type AuditorOut, type DefenderOut, type JudgeOut, type DebateLogEntry } from "./debate";
import { reconcile, type BillDraft, type SummaryDraft } from "./extract";
import { debateOrder, numberCandidates } from "./flow";
import { normalizeBill } from "./normalize";
import { KanakkuError } from "./errors";
import { limits } from "./limits";
import type { DrugTable } from "./schemas";
import type { RunContext } from "./spend";

const userMsg = (e: unknown) => (e instanceof KanakkuError ? e.userMessage : "an unexpected error");

export async function runPipeline(a: { billDraft: BillDraft; summaryDraft: SummaryDraft; dataLabel: FinalizeInput["data_label"]; ctx: RunContext; table: DrugTable; log?: (s: string) => void }) {
  const log = a.log ?? (() => {});
  const { bill, summary } = reconcile(a.billDraft, a.summaryDraft);
  const warnings: string[] = [];
  let normalization: Awaited<ReturnType<typeof normalizeBill>>["normalization"] = { items: [] };
  try {
    normalization = (await normalizeBill(bill, a.table, a.ctx)).normalization;
  } catch (e) {
    if (!(e instanceof KanakkuError)) throw e;
    warnings.push(`Medicine names could not be matched to the reference table, so drug-price checks were skipped: ${e.userMessage}`);
  }
  log("normalized");
  const rules = runRules(bill, normalization, a.table);
  let clinical: Awaited<ReturnType<typeof runClinical>>["candidates"] = [];
  let clinicalCheck: FinalizeInput["clinical_check"] = { state: "done", note: "Bill compared with the discharge summary." };
  const cl = await runClinical(bill, summary, a.ctx);
  clinical = cl.candidates;
  if (cl.error) clinicalCheck = { state: "failed", note: `The AI comparison with the discharge summary did not run: ${cl.error.message} (the ICU-day check is code-only and still ran).` };
  log(`candidates: ${rules.candidates.length} rule + ${clinical.length} clinical`);
  const numbered = numberCandidates(rules.candidates, clinical);
  const { debate } = debateOrder(numbered, limits().maxDebateFindings);
  const items: FinalizeInput["items"] = [];
  for (const c of numbered) {
    if (!debate.includes(c)) { items.push({ candidate: c, debate_error: "over this deployment's per-audit review limit" }); continue; }
    try {
      const au = await runDebateStep("auditor", c, bill, summary, {}, a.ctx);
      const de = await runDebateStep("defender", c, bill, summary, { auditor: au.output as AuditorOut }, a.ctx);
      const ju = await runDebateStep("judge", c, bill, summary, { auditor: au.output as AuditorOut, defender: de.output as DefenderOut }, a.ctx);
      items.push({
        candidate: c,
        steps: { auditor: au.output as AuditorOut, defender: de.output as DefenderOut, judge: ju.output as JudgeOut },
        logs: [au.log, de.log, ju.log] as DebateLogEntry[],
      });
      log(`debated ${c.id}`);
    } catch (e) {
      items.push({ candidate: c, debate_error: userMsg(e) });
      log(`debate failed ${c.id}: ${e instanceof KanakkuError ? e.code : String(e)}`);
    }
  }
  return finalize({ run_id: a.ctx.runId, data_label: a.dataLabel, bill, summary, normalization, items, clinical_check: clinicalCheck, warnings }, a.table);
}
