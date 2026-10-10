"use client";
// The whole user journey on one page: choose documents or a sample -> live pipeline steps -> results or a
// clear failure. Each audit has its own run id and AbortController, so a new audit can never mix with an
// earlier one, and a late response from a cancelled audit is ignored.
import { useEffect, useRef, useState } from "react";
import type { PipelineResult } from "@/lib/schemas";
import { ApiError, runAudit, type AuditSource, type Progress, type StepId } from "@/lib/client/runAudit";
import { PipelineSteps, STEPS, progressAnnouncement } from "./PipelineSteps";
import { Results } from "./Results";
import { UploadBox, precheckFile } from "./UploadBox";
import { Hero, HowItWorks, SampleCards, SampleReviewNote, type SampleInfo, type SampleReviewSource } from "./Landing";
import { Badge, Button, Eyebrow, IconClipboard, IconFlask, IconReceipt, IconShield, Notice, Spinner } from "./ui";

type Config = {
  live_uploads_enabled: boolean;
  live_uploads_reason: "cache_only" | "not_configured" | null;
  max_upload_mb: number;
  max_pdf_pages: number;
  max_debate_findings: number;
  sample_review_saved?: boolean;
  sample_review_source?: SampleReviewSource;
  samples: SampleInfo[];
};
type View =
  | { kind: "idle" }
  | { kind: "running"; label: string; synthetic: boolean }
  | { kind: "done"; result: PipelineResult }
  | { kind: "error"; message: string; code: string; label: string; synthetic: boolean };

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
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setConfig)
      .catch(() => setConfigError(true));
    return () => active.current?.abort.abort();
  }, []);

  // Each view change starts at the top of the page, with keyboard and screen-reader focus on its heading.
  useEffect(() => {
    if (view.kind === "idle") return;
    window.scrollTo({ top: 0 });
    heading.current?.focus();
  }, [view.kind]);

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
    const synthetic = source.kind === "sample";
    setProgress(freshProgress());
    setView({ kind: "running", label, synthetic });
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
      setView({
        kind: "error", label, synthetic,
        code: e instanceof ApiError ? e.code : "INTERNAL",
        message: e instanceof ApiError ? e.message : "Something went wrong. Please try again.",
      });
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
    window.scrollTo({ top: 0 });
  }

  const runSample = (s: SampleInfo) => start({ kind: "sample", id: s.id }, s.title);
  const demo = config?.samples.find((s) => s.id === "bill-02-demo") ?? config?.samples[0];

  if (view.kind === "done") return <Results result={view.result} onNewAudit={reset} headingRef={heading} />;

  if (view.kind === "running" || view.kind === "error") {
    const failed = view.kind === "error";
    return (
      <section aria-labelledby="progress-title" className="mx-auto flex w-full max-w-3xl flex-col gap-6 k-enter">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Eyebrow>{failed ? "Audit stopped" : "Audit in progress"}</Eyebrow>
            {view.synthetic && <Badge tone="caution" icon={<IconFlask className="size-3.5" />}>Synthetic data</Badge>}
          </div>
          <h1 id="progress-title" ref={heading} tabIndex={-1} className="font-display text-3xl tracking-tight text-ink outline-none sm:text-4xl">
            {failed ? "The audit could not be completed" : "Checking your bill"}
          </h1>
          <p className="text-ink-soft">{view.synthetic ? "Sample" : "Documents"}: <span className="font-medium text-ink">{view.label}</span></p>
        </div>

        {view.synthetic && config?.sample_review_source && <SampleReviewNote source={config.sample_review_source} />}

        {failed && (
          <Notice tone="danger" role="alert" title="No result is shown, because nothing was checked to completion.">
            <p>{view.message}</p>
            <p className="mt-1 font-medium">This is not a clean bill. Start over to try again.</p>
          </Notice>
        )}

        <div className="rounded-2xl border border-line bg-surface p-6 shadow-card sm:p-8">
          <PipelineSteps progress={progress} stopped={failed} />
        </div>
        <p className="sr-only" aria-live="polite" role="status">{failed ? "" : progressAnnouncement(progress)}</p>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant={failed ? "primary" : "secondary"} onClick={reset}>{failed ? "Start over" : "Cancel and start over"}</Button>
          {!failed && <span className="flex items-center gap-2 text-sm text-ink-muted"><Spinner /> Keep this tab open while the audit runs.</span>}
        </div>
      </section>
    );
  }

  const maxMb = config?.max_upload_mb ?? 4;
  const liveOff = !config || !config.live_uploads_enabled;
  const ready = !!bill && !!summary && !!config?.live_uploads_enabled;
  const samples = (
  <SampleCards samples={config?.samples ?? []} reviewSource={config?.sample_review_source ?? null} onRun={runSample} />
  );
  const upload = (
      <section id="upload" aria-labelledby="upload-title" className="flex scroll-mt-24 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Eyebrow>Audit your own bill</Eyebrow>
          <h2 id="upload-title" className="font-display text-3xl tracking-tight text-ink">Add your two documents</h2>
          <p className="max-w-2xl text-ink-soft">
            Upload a PDF or a clear photo of each. Up to {config?.max_pdf_pages ?? 8} PDF pages per document.
          </p>
        </div>

        <div className="rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-8">
          <div className="grid gap-6 md:grid-cols-2">
            <UploadBox step={1} title="Itemised hospital bill" description="The full itemised inpatient bill, every page"
              icon={<IconReceipt className="size-5" />} maxMb={maxMb} file={bill} error={errors.bill} disabled={liveOff} disabledLabel={config ? undefined : "Loading settings…"} onChange={pick("bill")} />
            <UploadBox step={2} title="Discharge summary" description="The summary given when the patient was discharged"
              icon={<IconClipboard className="size-5" />} maxMb={maxMb} file={summary} error={errors.summary} disabled={liveOff} disabledLabel={config ? undefined : "Loading settings…"} onChange={pick("summary")} />
          </div>

          <div className="mt-6 flex flex-col gap-4 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
            {configError ? (
              <p className="text-sm text-danger-700" role="alert">Could not load this deployment&apos;s settings. Check your connection and reload the page.</p>
            ) : !config ? (
              <p className="flex items-center gap-2 text-sm text-ink-muted"><Spinner /> Loading settings…</p>
            ) : liveOff ? (
              <p className="flex gap-2 text-sm text-ink-soft">
                <IconShield className="mt-0.5 size-4 shrink-0 text-brand-700" />
                <span>
                  {config.live_uploads_reason === "cache_only"
                    ? "Uploads are switched off on this demo deployment so it never spends API credit. "
                    : "Uploads need an AI provider key, which this deployment does not have. "}
                  <a href="#samples" className="font-medium text-brand-700 underline underline-offset-2">Try a synthetic sample bill instead.</a>
                </span>
              </p>
            ) : (
              <p className="flex max-w-xl gap-2 text-xs text-ink-muted">
                <IconShield className="mt-0.5 size-4 shrink-0 text-brand-700" />
                Your files are sent to the server and to the AI provider for reading only. Kanakku does not store them, and never copies the patient&apos;s name from them.
              </p>
            )}
            {!liveOff && (
              <Button size="lg" disabled={!ready}
                onClick={() => bill && summary && start({ kind: "upload", bill, summary }, `${bill.name} + ${summary.name}`)}>
                Start audit
              </Button>
            )}
          </div>
          {!liveOff && !ready && (
            <p className="mt-3 text-right text-xs text-ink-muted">{!bill && !summary ? "Add both documents to start." : !bill ? "Add the itemised bill to start." : "Add the discharge summary to start."}</p>
          )}
        </div>
      </section>
  );
  return (
    <div className="flex flex-col gap-20 sm:gap-24">
      <Hero onTryDemo={() => demo && runSample(demo)} demoDisabled={!demo} uploadsOn={!liveOff} />

      {liveOff ? <>{samples}{upload}</> : <>{upload}{samples}</>}

      <HowItWorks />
    </div>
  );
}
