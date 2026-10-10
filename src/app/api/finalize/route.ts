// Pipeline stage "finalize": pure code. Re-derives every amount on the server, applies the Judge constraints,
// computes de-duplicated totals and returns the validated PipelineResult.
import { NextResponse } from "next/server";
import { finalize } from "@/lib/finalize";
import { errorResponse, readJson } from "@/lib/http";
import { referenceTable } from "@/lib/table";

export async function POST(req: Request) {
  try {
    return NextResponse.json(finalize(await readJson(req, 4_000_000), referenceTable));
  } catch (e) {
    return errorResponse(e, "finalize");
  }
}
