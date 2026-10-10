// Runtime limits read from env (server only). Every limit has a conservative default so a missing
// variable never means "unlimited". See .env.example and README "Cost protections".
const num = (name: string, def: number, min = 0): number => {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : def;
};

export const limits = () => ({
  /** Max model calls one audit run may make (extract + normalize + clinical + 3 per debated finding). */
  callsPerRun: num("KANAKKU_MAX_CALLS_PER_RUN", 45, 1),
  /** Max input + output tokens one audit run may use. */
  tokensPerRun: num("KANAKKU_MAX_TOKENS_PER_RUN", 250_000, 1),
  /** Max input + output tokens per server instance per UTC day (best effort; also set a Console spend limit). */
  tokensPerDay: num("KANAKKU_MAX_TOKENS_PER_DAY", 2_000_000, 1),
  /** Max new live audit runs per client IP per hour. */
  runsPerHourPerClient: num("KANAKKU_MAX_RUNS_PER_HOUR", 3, 1),
  /** max_tokens for any single model response. */
  maxOutputTokens: num("KANAKKU_MAX_OUTPUT_TOKENS", 4_000, 256),
  /** Per-request timeout for one model call, in ms (the SDK retries are disabled; we retry once ourselves). */
  timeoutMs: num("KANAKKU_TIMEOUT_MS", 60_000, 1_000),
  /** Max upload size per document, in bytes. Vercel's request body limit is about 4.5 MB (VERIFY). */
  maxUploadBytes: Math.round(num("KANAKKU_MAX_UPLOAD_MB", 4, 0.1) * 1024 * 1024),
  /** Max PDF pages per document (bounds tokens). */
  maxPdfPages: num("KANAKKU_MAX_PDF_PAGES", 8, 1),
  /** Max findings sent through the Auditor/Defender/Judge debate per run; the rest are shown un-debated. */
  maxDebateFindings: num("KANAKKU_MAX_DEBATE_FINDINGS", 12, 0),
});
export type Limits = ReturnType<typeof limits>;
