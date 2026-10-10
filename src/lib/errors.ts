// One error type for every pipeline failure the user can see. `userMessage` is safe to show in the UI:
// it never contains secrets, raw model output or document content. `code` lets the UI pick wording.
export type KanakkuErrorCode =
  | "BAD_INPUT"            // request body or file failed validation
  | "UNSUPPORTED_FILE"     // wrong type, empty, too large, encrypted, too many pages
  | "LIVE_DISABLED"        // uploads need live AI calls, and they are switched off
  | "MISSING_CONFIG"       // API key or model id not configured
  | "BUDGET_EXCEEDED"      // spend guard refused the call
  | "RATE_LIMITED"         // our own per-client limit, or the provider's 429
  | "CACHE_MISS"           // cache-only mode (sample bills) and no cached response
  | "PROVIDER_ERROR"       // provider failure, timeout, auth, overload
  | "MODEL_OUTPUT_INVALID" // model output failed schema / number guard / tone lint twice
  | "UNREADABLE_DOCUMENT"; // the model could not read the document (scan too poor, wrong document)

const STATUS: Record<KanakkuErrorCode, number> = {
  BAD_INPUT: 400, UNSUPPORTED_FILE: 415, LIVE_DISABLED: 403, MISSING_CONFIG: 503, BUDGET_EXCEEDED: 402,
  RATE_LIMITED: 429, CACHE_MISS: 409, PROVIDER_ERROR: 502, MODEL_OUTPUT_INVALID: 502, UNREADABLE_DOCUMENT: 422,
};

export class KanakkuError extends Error {
  constructor(
    public readonly code: KanakkuErrorCode,
    public readonly userMessage: string,
    /** Internal detail for server logs only. Must not contain document text or secrets. */
    public readonly detail?: string,
  ) {
    super(`${code}: ${userMessage}${detail ? ` (${detail})` : ""}`);
    this.name = "KanakkuError";
  }
  get status() {
    return STATUS[this.code];
  }
}

/** Shape every API route returns on failure. */
export type ApiErrorBody = { error: { code: KanakkuErrorCode | "INTERNAL"; message: string; issues?: unknown } };
