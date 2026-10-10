"use client";
// The whole user journey on one page: choose documents or a sample -> live pipeline steps -> results or a
// clear failure. Each audit has its own run id and AbortController, so a new audit can never mix with an
// earlier one, and a late response from a cancelled audit is ignored.
import { useEffect, useRef, useState } from "react";
import type { PipelineResult } from "@/lib/schemas";
import { ApiError, runAudit, type AuditSource, type Progress, type StepId } from "@/lib/client/runAudit";
import { PipelineSteps, STEPS } from "./PipelineSteps";
import { Results } from "./Results";
import { UploadBox, precheckFile } from "./UploadBox";

type Config = {
  live_uploads_enabled: boolean;
  live_uploads_reason: "cache_only" | "not_configured" | null;
  max_upload_mb: number;
  max_pdf_pages: number;
  max_debate_findings: number;
  samples: { id: string; title: string; blurb: string }[];
};
type View =
  | { kind: "idle" }
  | { kind: "running"; label: string }
  | { kind: "done"; result: PipelineResult }
  | { kind: "error"; message: string; code: string };

const freshProgress = () => Object.fromEntries(STEPS.map((s) => [s.id, { step: s.id, status: "pending" }])) as Record<StepId, Progress>;

export function AuditApp() {
  const [config, setConfig] = useState<Config | null>(null);
  const [configError, setConfigError] = useState(false);
  const [view, setView] = useState<View>({ kind: "idle" });
  const [progress, setProgress] = useState(freshProgress);
  const [bill, setBill] = useState<File | null>(null);
  const [summary, setSummary] = useState<File | null>(null);
  const [errors, setErrors] = useState<{ bill: string | null; summary: string | null }>({ bill: null, summary: null });
  const active = useRef<{ token: number; abort: AbortController } | null>(null);
  const tokenSeq = useRef(0);

  useEffect(() => {
    fetch("/api/config").then((r) => r.json()).then(setConfig).catch(() => setConfigError(true));
    return () => active.current?.abort.abort();
  }, []);

  const pick = (which: "bill" | "summary") => (file: File | null) => {
    const err = file && config ? precheckFile(file, config.max_upload_mb) : null;
    setErrors((e) => ({ ...e, [which]: err }));
    (which === "bill" ? setBill : setSummary)(err ? null : file);
  };

  async function start(source: AuditSource, label: string) {
    active.current?.abort.abort();
    const token = ++tokenSeq.current;
    const abort = new AbortController();
    active.current = { token, abort };
    const isCurrent = () => active.current?.token === token && !abort.signal.aborted;
    setProgress(freshProgress());
    setView({ kind: "running", label });
    try {
      const result = await runAudit(source, {
        signal: abort.signal,
        maxDebate: config?.max_debate_findings ?? 12,
        onProgress: (p) => isCurrent() && setProgress((prev) => ({ ...prev, [p.step]: p })),
      });
      if (isCurrent()) setView({ kind: "done", result });
    } catch (e) {
      if (!isCurrent()) return;
      setProgress((prev) => {
        const running = Object.values(prev).find((p) => p.status === "running");
        return running ? { ...prev, [running.step]: { ...running, status: "failed" } } : prev;
      });
      setView({ kind: "error", code: e instanceof ApiError ? e.code : "INTERNAL", message: e instanceof ApiError ? e.message : "Something went wrong. Please try again." });
    }
  }

  function reset() {
    active.current?.abort.abort();
    active.current = null;
    setView({ kind: "idle" });
    setProgress(freshProgress());
    setBill(null);
    setSummary(null);
    setErrors({ bill: null, summary: null });
  }

  if (view.kind === "done") return <Results result={view.result} onNewAudit={reset} />;

  if (view.kind === "running" || view.kind === "error")
    return (
      <section className="flex flex-col gap-4" aria-label="Audit progress">
        <p className="text-sm text-slate-600">Auditing: <span className="font-medium">{view.kind === "running" ? view.label : "your documents"}</span></p>
        <PipelineSteps progress={progress} />
        {view.kind === "error" && (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900" role="alert">
            <p className="font-semibold">The audit could not be completed, so no result is shown.</p>
            <p className="mt-1">{view.message}</p>
            <p className="mt-1 text-xs text-rose-700">This is not a clean bill: nothing was checked to completion.</p>
          </div>
        )}
        <button type="button" onClick={reset} className="self-start rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          {view.kind === "running" ? "Cancel and start over" : "Start over"}
        </button>
      </section>
    );

  const liveOff = config && !config.live_uploads_enabled;
  return (
    <div className="flex flex-col gap-8">
      <section aria-label="Upload documents" className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <UploadBox title="Itemized hospital bill" hint={`PDF or photo of the full itemized inpatient bill (max ${config?.max_upload_mb ?? 4} MB)`}
            file={bill} error={errors.bill} disabled={!!liveOff} onChange={pick("bill")} />
          <UploadBox title="Discharge summary" hint={`PDF or photo of the discharge summary (max ${config?.max_upload_mb ?? 4} MB)`}
            file={summary} error={errors.summary} disabled={!!liveOff} onChange={pick("summary")} />
        </div>
        {liveOff ? (
          <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">
            {config.live_uploads_reason === "cache_only"
              ? "Uploads are switched off on this demo deployment so it never spends API credit. Try a sample bill below."
              : "Uploads need an AI provider key, which this deployment does not have. Try a sample bill below."}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={!bill || !summary || !config}
              onClick={() => bill && summary && start({ kind: "upload", bill, summary }, `${bill.name} + ${summary.name}`)}
              className="rounded-md bg-teal-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
              Audit my bill
            </button>
            <p className="text-xs text-slate-500">
              Your files are sent to the server and to the AI provider for reading only; Kanakku does not store them. Up to {config?.max_pdf_pages ?? 8} PDF pages each.
            </p>
          </div>
        )}
        {configError && <p className="text-sm text-rose-700">Could not load this deployment&apos;s settings. Check the connection and reload.</p>}
      </section>

      <section aria-label="Sample bills" className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Try a sample bill</h2>
        <p className="text-sm text-slate-500">Synthetic bills with known answers. They replay a saved AI review, so they cost nothing to run.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(config?.samples ?? []).map((s) => (
            <div key={s.id} className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4">
              <p className="font-semibold">{s.title}</p>
              <p className="flex-1 text-sm text-slate-600">{s.blurb}</p>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => start({ kind: "sample", id: s.id }, `${s.title} (synthetic)`)}
                  className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white">
                  {s.id === "bill-02-demo" ? "Try a sample bill" : "Run this sample"}
                </button>
                <a className="text-xs text-teal-800 underline" href={`/api/sample/document?id=${s.id}&kind=bill`} target="_blank" rel="noreferrer">bill</a>
                <a className="text-xs text-teal-800 underline" href={`/api/sample/document?id=${s.id}&kind=summary`} target="_blank" rel="noreferrer">summary</a>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
