// Pipeline stage "Checking clinical notes": D3. POST { run_id, sample_id?, bill, summary } -> { candidates, meta }.
import { NextResponse } from "next/server";
import { runClinical } from "@/lib/detectors/d3";
import { errorResponse, readJson, runContext } from "@/lib/http";
import { BillExtraction, DischargeSummary } from "@/lib/schemas";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const ctx = runContext(req, body);
    const r = await runClinical(BillExtraction.parse(body.bill), DischargeSummary.parse(body.summary), ctx);
    return NextResponse.json({ candidates: r.candidates, discarded_count: r.discarded.length, meta: r.meta, clinical_error: r.error });
  } catch (e) {
    return errorResponse(e, "clinical");
  }
}
