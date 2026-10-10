// GET /api/config -> what this deployment can do, so the UI can explain limits before the user uploads.
// Never returns the API key, only whether one is set.
import { NextResponse } from "next/server";
import { SAMPLE_BILL_IDS, cacheOnly } from "@/lib/config";
import { limits } from "@/lib/limits";
import { SAMPLE_INFO } from "@/lib/samples";

export const dynamic = "force-dynamic";

export function GET() {
  const l = limits();
  const configured = !!process.env.ANTHROPIC_API_KEY && !!process.env.MODEL_EXTRACT && !!process.env.MODEL_REASON;
  return NextResponse.json({
    live_uploads_enabled: configured && !cacheOnly(),
    live_uploads_reason: cacheOnly() ? "cache_only" : configured ? null : "not_configured",
    max_upload_mb: Math.round((l.maxUploadBytes / 1048576) * 10) / 10,
    max_pdf_pages: l.maxPdfPages,
    max_debate_findings: l.maxDebateFindings,
    samples: (Object.keys(SAMPLE_INFO) as (typeof SAMPLE_BILL_IDS)[number][]).map((id) => ({ id, ...SAMPLE_INFO[id] })), // demo bill first
  });
}
