// Browser-side workflow: calls the API routes in pipeline order and reports progress. Every number shown later
// comes from /api/finalize, which re-derives it on the server. This file never sees the API key.
import type { BillExtraction, CandidateFinding, DischargeSummary, NormalizationResult, PipelineResult } from "../schemas";
import { debateOrder, numberCandidates } from "../flow";

export type StepId = "read" | "prices" | "clinical" | "debate" | "finalize";
export type StepStatus = "pending" | "running" | "done" | "partial" | "failed";
export type Progress = { step: StepId; status: StepStatus; note?: string };
export type AuditSource = { kind: "sample"; id: string } | { kind: "upload"; bill: File; summary: File };

export class ApiError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

type Numbered = CandidateFinding & { id: string };
type Steps = { auditor: unknown; defender: unknown; judge: unknown };

async function call<T>(url: string, init: RequestInit, signal: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new ApiError("NETWORK", "Could not reach the Kanakku server. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
  if (!res.ok || !body) throw new ApiError(body?.error?.code ?? "INTERNAL", body?.error?.message ?? `The server returned an error (${res.status}).`);
  return body as T;
}
const post = <T,>(url: string, body: unknown, signal: AbortSignal) =>
  call<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, signal);

/** Runs `fn` over items with at most `n` in flight (SPEC: debates 3 at a time). */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift()!);
  }));
}

export async function runAudit(source: AuditSource, opts: { signal: AbortSignal; maxDebate: number; onProgress: (p: Progress) => void; onDebate?: (done: number, total: number) => void }): Promise<PipelineResult> {
  const { signal, onProgress } = opts;
  const run_id = crypto.randomUUID();
  const sample_id = source.kind === "sample" ? source.id : undefined;
  const warnings: string[] = [];

  // 1. Reading bill: drafts (sample: pre-extracted; upload: model extraction of both documents in parallel)
  onProgress({ step: "read", status: "running" });
  let drafts: { bill_draft: unknown; summary_draft: unknown };
  if (source.kind === "sample") {
    drafts = await call(`/api/sample?id=${encodeURIComponent(source.id)}`, {}, signal);
  } else {
    const extract = (kind: "bill" | "summary", file: File) => {
      const f = new FormData();
      f.append("kind", kind); f.append("run_id", run_id); f.append("file", file);
      return call<{ draft: unknown }>("/api/extract", { method: "POST", body: f }, signal);
    };
    const [b, s] = await Promise.all([extract("bill", source.bill), extract("summary", source.summary)]);
    drafts = { bill_draft: b.draft, summary_draft: s.draft };
  }
  const norm = await post<{ bill: BillExtraction; summary: DischargeSummary; normalization: NormalizationResult; normalize_error?: { message: string } }>(
    "/api/normalize", { run_id, sample_id, ...drafts }, signal);
  if (norm.normalize_error) warnings.push(`Medicine names could not be matched to the reference table, so drug-price checks were skipped: ${norm.normalize_error.message}`);
  onProgress({ step: "read", status: norm.normalize_error ? "partial" : "done", note: `${norm.bill.items.length} bill lines read` });
  const { bill, summary, normalization } = norm;

  // 2. Matching prices: deterministic D1 + D2
  onProgress({ step: "prices", status: "running" });
  const rules = await post<{ candidates: CandidateFinding[] }>("/api/rules", { bill, normalization }, signal);
  onProgress({ step: "prices", status: norm.normalize_error ? "partial" : "done", note: `${rules.candidates.length} rule-based candidate(s)` });

  // 3. Checking clinical notes: D3
  onProgress({ step: "clinical", status: "running" });
  const clin = await post<{ candidates: CandidateFinding[]; clinical_error: { message: string } | null }>("/api/clinical", { run_id, sample_id, bill, summary }, signal);
  const clinical_check = clin.clinical_error
    ? { state: "failed" as const, note: `The AI comparison with the discharge summary did not run: ${clin.clinical_error.message} (the ICU-day check is code-only and still ran).` }
    : { state: "done" as const, note: "Bill compared with the discharge summary." };
  onProgress({ step: "clinical", status: clin.clinical_error ? "partial" : "done", note: clin.clinical_error ? "AI comparison did not run" : `${clin.candidates.length} candidate(s)` });

  // 4. Cross-examining findings: auditor -> defender -> judge per finding, 3 findings at a time
  const numbered = numberCandidates(rules.candidates, clin.candidates);
  const { debate } = debateOrder(numbered, opts.maxDebate);
  const results = new Map<string, { steps?: Steps; logs?: unknown[]; debate_error?: string }>();
  let stopReason: string | null = null;
  let done = 0;
  onProgress({ step: "debate", status: "running", note: `0 of ${debate.length}` });
  opts.onDebate?.(0, debate.length);
  await pool(debate, 3, async (c: Numbered) => {
    if (stopReason) { results.set(c.id, { debate_error: stopReason }); return; }
    try {
      const base = { run_id, sample_id, candidate: c, bill, summary };
      const au = await post<{ output: unknown; log: unknown }>("/api/debate", { ...base, step: "auditor" }, signal);
      const de = await post<{ output: unknown; log: unknown }>("/api/debate", { ...base, step: "defender", prior: { auditor: au.output } }, signal);
      const ju = await post<{ output: unknown; log: unknown }>("/api/debate", { ...base, step: "judge", prior: { auditor: au.output, defender: de.output } }, signal);
      results.set(c.id, { steps: { auditor: au.output, defender: de.output, judge: ju.output }, logs: [au.log, de.log, ju.log] });
    } catch (e) {
      if (signal.aborted) throw e;
      const msg = e instanceof ApiError ? e.message : "the review step failed";
      // Budget, configuration and rate limits will not recover within this audit: stop spending on the rest.
      if (e instanceof ApiError && ["BUDGET_EXCEEDED", "RATE_LIMITED", "MISSING_CONFIG", "LIVE_DISABLED", "CACHE_MISS"].includes(e.code)) stopReason = msg;
      results.set(c.id, { debate_error: msg });
    }
    done += 1;
    opts.onDebate?.(done, debate.length);
    onProgress({ step: "debate", status: "running", note: `${done} of ${debate.length}` });
  });
  const failedDebates = [...results.values()].filter((r) => r.debate_error).length + (numbered.length - debate.length);
  onProgress({ step: "debate", status: failedDebates ? "partial" : "done", note: failedDebates ? `${failedDebates} finding(s) not cross-examined` : `${debate.length} cross-examined` });

  // 5. Finalize: server re-derives amounts, applies Judge constraints and totals
  onProgress({ step: "finalize", status: "running" });
  const result = await post<PipelineResult>("/api/finalize", {
    run_id, data_label: source.kind === "sample" ? "Synthetic data" : "User upload", bill, summary, normalization, clinical_check, warnings,
    items: numbered.map((c) => ({ candidate: c, ...(results.get(c.id) ?? { debate_error: "over this deployment's per-audit review limit" }) })),
  }, signal);
  onProgress({ step: "finalize", status: "done" });
  return result;
}
