// GET /api/sample/document?id=bill-02-demo&kind=bill -> the printable synthetic document (HTML), for viewing.
import { KanakkuError } from "@/lib/errors";
import { errorResponse, isSampleId } from "@/lib/http";
import { sampleDocumentHtml } from "@/lib/samples";

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const id = u.searchParams.get("id"), kind = u.searchParams.get("kind");
    if (!isSampleId(id) || (kind !== "bill" && kind !== "summary")) throw new KanakkuError("BAD_INPUT", "Unknown sample document.");
    return new Response(sampleDocumentHtml(id, kind), {
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" },
    });
  } catch (e) {
    return errorResponse(e, "sample-document");
  }
}
