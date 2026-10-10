// Shared helpers for API routes: request context and safe error responses.
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { SAMPLE_BILL_IDS } from "./config";
import { KanakkuError, type ApiErrorBody } from "./errors";
import type { RunContext } from "./spend";

export const isSampleId = (id: unknown): id is (typeof SAMPLE_BILL_IDS)[number] =>
  typeof id === "string" && (SAMPLE_BILL_IDS as readonly string[]).includes(id);

/** Builds the run context. Sample runs are cache-only whatever the env says (SPEC 0.7). */
export function runContext(req: Request, body: { run_id?: unknown; sample_id?: unknown }): RunContext {
  const runId = typeof body.run_id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(body.run_id) ? body.run_id : null;
  if (!runId) throw new KanakkuError("BAD_INPUT", "Missing or invalid audit id. Please start a new audit.");
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { runId, clientId: fwd || "local", mode: isSampleId(body.sample_id) ? "sample" : "live" };
}

/** Converts any thrown error into a JSON response. Logs code and internal detail only, never content. */
export function errorResponse(e: unknown, stage: string): NextResponse<ApiErrorBody> {
  if (e instanceof KanakkuError) {
    console.warn(`[kanakku] ${stage} failed: ${e.code}${e.detail ? ` (${e.detail})` : ""}`);
    return NextResponse.json({ error: { code: e.code, message: e.userMessage } }, { status: e.status });
  }
  if (e instanceof ZodError) {
    console.warn(`[kanakku] ${stage} failed: BAD_INPUT (${e.issues.length} schema issues)`);
    return NextResponse.json(
      { error: { code: "BAD_INPUT", message: "The request data did not pass validation.", issues: e.issues.slice(0, 10).map((i) => ({ path: i.path, message: i.message })) } },
      { status: 400 },
    );
  }
  if (e instanceof SyntaxError) return NextResponse.json({ error: { code: "BAD_INPUT", message: "The request body is not valid JSON." } }, { status: 400 });
  console.error(`[kanakku] ${stage} failed: INTERNAL (${e instanceof Error ? e.name : "unknown"})`);
  return NextResponse.json({ error: { code: "INTERNAL", message: "Something went wrong on the server. Please try again." } }, { status: 500 });
}

/** Reads a JSON body with a size cap, so a huge body cannot exhaust memory. */
export async function readJson(req: Request, maxBytes = 1_000_000): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (text.length > maxBytes) throw new KanakkuError("BAD_INPUT", "The request is too large.");
  const v = JSON.parse(text) as unknown;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new KanakkuError("BAD_INPUT", "The request body must be a JSON object.");
  return v as Record<string, unknown>;
}
