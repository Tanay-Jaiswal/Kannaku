// Pipeline stage "Reading bill" (uploads only). multipart/form-data: file, kind ("bill" | "summary"), run_id.
// Returns a draft with explicit nulls for anything unreadable. Samples never call this route.
import { NextResponse } from "next/server";
import { KanakkuError } from "@/lib/errors";
import { extractBill, extractSummary } from "@/lib/extract";
import { errorResponse, runContext } from "@/lib/http";
import { limits } from "@/lib/limits";
import { checkUpload } from "@/lib/upload";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > limits().maxUploadBytes + 64 * 1024)
      throw new KanakkuError("UNSUPPORTED_FILE", "The file is too large. Try a smaller PDF or a lower-resolution photo.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new KanakkuError("BAD_INPUT", "Expected a file upload (multipart form data).");
    }
    const kind = form.get("kind");
    if (kind !== "bill" && kind !== "summary") throw new KanakkuError("BAD_INPUT", "kind must be 'bill' or 'summary'.");
    const ctx = runContext(req, { run_id: form.get("run_id") });
    const file = form.get("file");
    if (!(file instanceof Blob)) throw new KanakkuError("BAD_INPUT", `No ${kind === "bill" ? "bill" : "discharge summary"} file was attached.`);
    const checked = checkUpload(new Uint8Array(await file.arrayBuffer()), kind === "bill" ? "bill" : "discharge summary");
    const result = kind === "bill" ? await extractBill(checked, ctx) : await extractSummary(checked, ctx);
    return NextResponse.json({ kind, draft: result.draft, meta: { ...result.meta, pages: checked.pages } });
  } catch (e) {
    return errorResponse(e, "extract");
  }
}
