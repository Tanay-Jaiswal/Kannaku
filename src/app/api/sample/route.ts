// GET /api/sample?id=bill-02-demo -> pre-extracted synthetic documents (no model call, no cost).
import { NextResponse } from "next/server";
import { KanakkuError } from "@/lib/errors";
import { errorResponse, isSampleId } from "@/lib/http";
import { SAMPLE_INFO, loadSample } from "@/lib/samples";

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!isSampleId(id)) throw new KanakkuError("BAD_INPUT", "Unknown sample id.");
    return NextResponse.json({ sample_id: id, data_label: "Synthetic data", ...SAMPLE_INFO[id], ...loadSample(id) });
  } catch (e) {
    return errorResponse(e, "sample");
  }
}
