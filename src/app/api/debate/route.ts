// Pipeline stage "Cross-examining findings": ONE debate step per call (auditor | defender | judge), so each
// request makes at most one model call and stays well under serverless time limits.
// POST { run_id, sample_id?, step, candidate, bill, summary, prior: { auditor?, defender? } } -> { output, log }.
import { NextResponse } from "next/server";
import { z } from "zod";
import { AuditorOut, DefenderOut, runDebateStep } from "@/lib/debate";
import { errorResponse, readJson, runContext } from "@/lib/http";
import { BillExtraction, DischargeSummary } from "@/lib/schemas";
import { FinalizeItem } from "@/lib/finalize";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  step: z.enum(["auditor", "defender", "judge"]),
  candidate: FinalizeItem.shape.candidate,
  bill: BillExtraction,
  summary: DischargeSummary,
  prior: z.object({ auditor: AuditorOut.optional(), defender: DefenderOut.optional() }).default({}),
});

export async function POST(req: Request) {
  try {
    const raw = await readJson(req);
    const ctx = runContext(req, raw);
    const b = Body.parse(raw);
    if (b.candidate.line_item_ids.some((id) => !b.bill.items.some((i) => i.id === id)))
      return NextResponse.json({ error: { code: "BAD_INPUT", message: "The finding cites a line that is not on the bill." } }, { status: 400 });
    if ((b.step !== "auditor" && !b.prior.auditor) || (b.step === "judge" && !b.prior.defender))
      return NextResponse.json({ error: { code: "BAD_INPUT", message: "Debate steps must run in order: auditor, defender, judge." } }, { status: 400 });
    const r = await runDebateStep(b.step, b.candidate, b.bill, b.summary, b.prior, ctx);
    return NextResponse.json(r);
  } catch (e) {
    return errorResponse(e, "debate");
  }
}
