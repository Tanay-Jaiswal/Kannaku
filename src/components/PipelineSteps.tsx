// Live pipeline progress. One row per real pipeline stage; each row shows the state it actually reached
// (waiting, running, done, partial, failed) in words as well as an icon, plus the note the stage reported.
// No percentages: the only counts shown are the ones the pipeline reports (lines read, findings reviewed).
import type { Progress, StepId, StepStatus } from "@/lib/client/runAudit";
import { IconAlert, IconCheck, IconXCircle, Spinner } from "./ui";

export const STEPS: { id: StepId; label: string; detail: string }[] = [
  { id: "read", label: "Reading bill", detail: "Bill lines and the discharge summary are read into a structured form; medicine names are matched to the reference table." },
  { id: "prices", label: "Matching prices", detail: "Code checks line arithmetic, duplicates, room days and medicine prices against printed MRP and ceiling prices." },
  { id: "clinical", label: "Checking clinical notes", detail: "Charges are compared with what the discharge summary documents, such as ICU days and services." },
  { id: "debate", label: "Cross-examining findings", detail: "Each finding is argued by an Auditor, defended as the hospital would, and decided by a Judge." },
  { id: "finalize", label: "Totalling what you can question", detail: "The server re-derives every amount and counts overlapping findings once." },
];

const STATUS_TEXT: Record<StepStatus, string> = { pending: "Waiting", running: "In progress", done: "Done", partial: "Partly done", failed: "Did not finish" };

function Marker({ status }: { status: StepStatus }) {
  const ring = "flex size-8 shrink-0 items-center justify-center rounded-full";
  if (status === "done") return <span className={`${ring} bg-brand-700 text-white`}><IconCheck className="size-4" /></span>;
  if (status === "running") return <span className={`${ring} bg-brand-50 text-brand-700 ring-2 ring-brand-500`}><Spinner /></span>;
  if (status === "partial") return <span className={`${ring} bg-ask-100 text-ask-800`}><IconAlert className="size-4" /></span>;
  if (status === "failed") return <span className={`${ring} bg-danger-50 text-danger-700 ring-1 ring-danger-200`}><IconXCircle className="size-4" /></span>;
  return <span className={`${ring} border-2 border-line-strong bg-surface`} />;
}

/** `stopped`: the audit ended early (error), so steps that never started read "Not run" instead of "Waiting". */
export function PipelineSteps({ progress, stopped = false }: { progress: Record<StepId, Progress>; stopped?: boolean }) {
  return (
    <ol className="flex flex-col">
      {STEPS.map((s, i) => {
        const p = progress[s.id];
        const last = i === STEPS.length - 1;
        return (
          <li key={s.id} className="relative flex gap-4 pb-6 last:pb-0" aria-current={p.status === "running" ? "step" : undefined}>
            {!last && <span aria-hidden className={`absolute left-4 top-9 -ml-px h-[calc(100%-2.5rem)] w-0.5 ${p.status === "done" ? "bg-brand-500" : "bg-line"}`} />}
            <Marker status={p.status} />
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className={`font-semibold ${p.status === "pending" ? "text-ink-muted" : "text-ink"}`}>{s.label}</span>
                <span className={`text-xs font-medium ${statusTone(p.status)}`}>{stopped && p.status === "pending" ? "Not run" : STATUS_TEXT[p.status]}{p.note ? ` · ${p.note}` : ""}</span>
              </div>
              <p className="mt-1 text-sm text-ink-muted">{s.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function statusTone(s: StepStatus) {
  return s === "done" ? "text-brand-700" : s === "running" ? "text-brand-700" : s === "partial" ? "text-ask-700" : s === "failed" ? "text-danger-700" : "text-ink-faint";
}

/** One-line text for the screen-reader live region: the step currently running, or the last one that changed. */
export function progressAnnouncement(progress: Record<StepId, Progress>): string {
  const running = STEPS.find((s) => progress[s.id].status === "running");
  if (running) {
    const p = progress[running.id];
    return `${running.label}: in progress${p.note ? `, ${p.note}` : ""}.`;
  }
  const failed = STEPS.find((s) => progress[s.id].status === "failed");
  if (failed) return `${failed.label} did not finish.`;
  return "";
}
