// Live pipeline progress: Reading bill -> Matching prices -> Checking clinical notes -> Cross-examining findings.
import type { Progress, StepId, StepStatus } from "@/lib/client/runAudit";

export const STEPS: { id: StepId; label: string }[] = [
  { id: "read", label: "Reading bill" },
  { id: "prices", label: "Matching prices" },
  { id: "clinical", label: "Checking clinical notes" },
  { id: "debate", label: "Cross-examining findings" },
  { id: "finalize", label: "Totalling what you can question" },
];

const ICON: Record<StepStatus, string> = { pending: "○", running: "◐", done: "✓", partial: "!", failed: "✕" };
const TONE: Record<StepStatus, string> = {
  pending: "text-slate-400", running: "text-teal-700 animate-pulse", done: "text-teal-700", partial: "text-amber-600", failed: "text-rose-700",
};

export function PipelineSteps({ progress }: { progress: Record<StepId, Progress> }) {
  return (
    <ol className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-6" aria-live="polite">
      {STEPS.map((s) => {
        const p = progress[s.id];
        return (
          <li key={s.id} className="flex items-baseline gap-3">
            <span className={`w-5 text-center font-bold ${TONE[p.status]}`} aria-hidden>{ICON[p.status]}</span>
            <span className={p.status === "pending" ? "text-slate-400" : "font-medium text-slate-800"}>{s.label}</span>
            {p.note && <span className="text-sm text-slate-500">· {p.note}</span>}
          </li>
        );
      })}
    </ol>
  );
}
