// Pipeline stage "Matching prices": pure-code D1 + D2. POST { bill, normalization } -> { candidates, skipped_checks }.
import { NextResponse } from "next/server";
import { runRules } from "@/lib/detectors";
import { errorResponse, readJson } from "@/lib/http";
import { referenceTable } from "@/lib/table";

export async function POST(req: Request) {
  try {
    const body = await readJson(req);
    return NextResponse.json(runRules(body.bill, body.normalization, referenceTable));
  } catch (e) {
    return errorResponse(e, "rules");
  }
}
