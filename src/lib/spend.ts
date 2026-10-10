// Spend guard for live (paid) model calls. In-memory, per server instance: it bounds a single run, a client's
// runs per hour and the instance's tokens per day. Serverless platforms may run several instances, so this is
// a best-effort guard; the hard cap is the monthly spend limit you set in the Anthropic Console (README).
import { KanakkuError } from "./errors";
import { limits } from "./limits";

export type RunContext = {
  /** Client-generated id for one audit; every stage of the same audit sends the same id. */
  runId: string;
  /** Best-effort client identity (first x-forwarded-for hop, or "local"). */
  clientId: string;
  /** sample = cache only; live = may call the provider (uploads); warm = script filling the sample cache. */
  mode: "sample" | "live" | "warm";
};

type Run = { clientId: string; calls: number; tokens: number; startedAt: number };
const runs = new Map<string, Run>();
const clientRuns = new Map<string, number[]>();
let day = { date: "", tokens: 0 };
const HOUR = 3_600_000;

const today = () => new Date().toISOString().slice(0, 10);

/** Call before every live model call. Throws BUDGET_EXCEEDED / RATE_LIMITED instead of spending. */
export function reserveCall(ctx: RunContext, now = Date.now()) {
  if (ctx.mode === "warm") return; // the warm script is run by the developer, by hand
  const l = limits();
  if (day.date !== today()) day = { date: today(), tokens: 0 };
  if (day.tokens >= l.tokensPerDay)
    throw new KanakkuError("BUDGET_EXCEEDED", "This deployment has reached its daily AI usage limit. Please try again tomorrow, or try a sample bill.", "tokensPerDay");

  let run = runs.get(ctx.runId);
  if (!run) {
    const recent = (clientRuns.get(ctx.clientId) ?? []).filter((t) => now - t < HOUR);
    if (recent.length >= l.runsPerHourPerClient)
      throw new KanakkuError("RATE_LIMITED", `Live analysis is limited to ${l.runsPerHourPerClient} uploaded audits per hour. Please try again later, or try a sample bill.`, "runsPerHour");
    clientRuns.set(ctx.clientId, [...recent, now]);
    run = { clientId: ctx.clientId, calls: 0, tokens: 0, startedAt: now };
    runs.set(ctx.runId, run);
    prune(now);
  }
  if (run.clientId !== ctx.clientId) throw new KanakkuError("BAD_INPUT", "This audit id belongs to another session. Start a new audit.", "runId reuse");
  if (run.calls >= l.callsPerRun || run.tokens >= l.tokensPerRun)
    throw new KanakkuError("BUDGET_EXCEEDED", "This audit reached its AI usage limit, so the remaining AI steps were skipped.", `calls=${run.calls} tokens=${run.tokens}`);
  run.calls += 1;
}

/** Call after every live model call with the provider's reported usage. */
export function recordUsage(ctx: RunContext, inputTokens: number, outputTokens: number) {
  if (ctx.mode === "warm") return;
  const t = inputTokens + outputTokens;
  if (day.date !== today()) day = { date: today(), tokens: 0 };
  day.tokens += t;
  const run = runs.get(ctx.runId);
  if (run) run.tokens += t;
}

export function runUsage(runId: string) {
  const r = runs.get(runId);
  return r ? { calls: r.calls, tokens: r.tokens } : { calls: 0, tokens: 0 };
}

function prune(now: number) {
  for (const [id, r] of runs) if (now - r.startedAt > 24 * HOUR) runs.delete(id);
  for (const [c, ts] of clientRuns) if (ts.every((t) => now - t >= HOUR)) clientRuns.delete(c);
}

/** Test helper. */
export function resetSpendState() {
  runs.clear();
  clientRuns.clear();
  day = { date: "", tokens: 0 };
}
