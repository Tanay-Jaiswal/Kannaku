// Pipeline stage "Reading bill" (part 2). POST { run_id, sample_id?, bill_draft, summary_draft }
// -> { bill, summary, normalization }. Reconciles the two drafts in code, then maps drug names to the table.
import { NextResponse } from "next/server";
import { KanakkuError } from "@/lib/errors";
import { BillDraft, SummaryDraft, reconcile } from "@/lib/extract";
import { errorResponse, readJson, runContext } from "@/lib/http";
import { normalizeBill } from "@/lib/normalize";
import { referenceTable } from "@/lib/table";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    const ctx = runContext(req, body);
    const { bill, summary } = reconcile(BillDraft.parse(body.bill_draft), SummaryDraft.parse(body.summary_draft));
    try {
      const { normalization, meta } = await normalizeBill(bill, referenceTable, ctx);
      return NextResponse.json({ bill, summary, normalization, meta });
    } catch (e) {
      // Partial result: without name matching, drug-price checks are skipped (and logged) but every other
      // check still runs. The UI shows this message; nothing is guessed.
      if (!(e instanceof KanakkuError)) throw e;
      console.warn(`[kanakku] normalize degraded: ${e.code}`);
      return NextResponse.json({ bill, summary, normalization: { items: [] }, meta: null, normalize_error: { code: e.code, message: e.userMessage } });
    }
  } catch (e) {
    return errorResponse(e, "normalize");
  }
}
