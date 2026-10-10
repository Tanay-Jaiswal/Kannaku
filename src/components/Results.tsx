"use client";
// Results: the "₹ you can question" counter, anything that limited the audit, findings grouped by tier,
// skipped checks, the extracted bill lines and the letter. Rendered only from the validated PipelineResult.
import { useMemo, useState } from "react";
import type { PipelineResult } from "@/lib/schemas";
import { computeTotals } from "@/lib/totals";
import { TIER_LABEL, formatInr } from "@/lib/present";
import { FindingCard, LineTable } from "./FindingCard";
import { LetterPanel } from "./LetterPanel";

export function Results({ result, onNewAudit }: { result: PipelineResult; onNewAudit: () => void }) {
  const { overlaps } = useMemo(() => computeTotals(result.findings), [result]);
  const live = result.findings.filter((f) => f.status !== "dropped");
  const dropped = result.findings.filter((f) => f.status === "dropped");
  const [selected, setSelected] = useState<string[]>(() => live.filter((f) => !overlaps[f.id]).map((f) => f.id));
  const notDebated = result.findings.filter((f) => f.review?.state !== "debated").length;
  const q = result.bill.extraction_quality;
  const limitations = [
    ...(result.warnings ?? []),
    ...(result.clinical_check?.state === "failed" ? [result.clinical_check.note] : []),
    ...(notDebated ? [`${notDebated} finding(s) were not cross-examined by the Auditor/Defender/Judge review; they are shown at their rule tier.`] : []),
    ...(q?.excluded_lines.length ? [`${q.excluded_lines.length} bill line(s) could not be read and were not checked: ${q.excluded_lines.map((x) => `#${x.position} (${x.reason})`).join(", ")}.`] : []),
    ...result.bill.extraction_notes.filter((n) => !/^Synthetic data/i.test(n)),
  ];
  const complete = limitations.length === 0;
  const synthetic = result.data_label === "Synthetic data";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <p className={`text-xs font-semibold uppercase tracking-wide ${synthetic ? "text-amber-700" : "text-slate-500"}`}>{result.data_label}</p>
          <h2 className="text-xl font-semibold">{result.bill.hospital_name}</h2>
          <p className="text-sm text-slate-600">
            {result.bill.patient_alias} · admitted {result.bill.admission_date}, discharged {result.bill.discharge_date} · {result.bill.items.length} bill lines · billed total {formatInr(result.bill.stated_total)}
          </p>
        </div>
        <button type="button" onClick={onNewAudit} className="rounded-md border border-teal-700 px-3 py-1.5 text-sm font-medium text-teal-800">Start a new audit</button>
      </div>

      <section className="grid gap-4 rounded-xl bg-teal-800 p-6 text-white sm:grid-cols-[1fr_auto] print:hidden" aria-label="Amount you can question">
        <div>
          <p className="text-sm uppercase tracking-wide text-teal-100">₹ you can question</p>
          <p className="text-5xl font-bold">{formatInr(result.totals.questionable_total)}</p>
          <p className="mt-1 text-sm text-teal-100">Overlapping findings are counted once. {result.totals.dropped_count} candidate(s) were dropped because the documents explain them.</p>
        </div>
        <dl className="grid grid-cols-2 gap-4 self-end text-sm">
          <div><dt className="text-teal-100">Provable</dt><dd className="text-2xl font-semibold">{formatInr(result.totals.provable)}</dd></div>
          <div><dt className="text-teal-100">Ask about</dt><dd className="text-2xl font-semibold">{formatInr(result.totals.ask)}</dd></div>
        </dl>
      </section>

      {!complete && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 print:hidden" aria-label="Audit limitations">
          <p className="font-semibold">This audit is partial. Read before relying on it:</p>
          <ul className="mt-1 list-disc pl-5">{limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </section>
      )}

      {live.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white p-4 text-sm print:hidden">
          {complete
            ? "No charges to question were found by the checks Kanakku runs. This does not certify the bill; it means the arithmetic, duplicate, room-day, medicine-price and summary checks found nothing to raise."
            : "No charges to question were found by the checks that ran. Some checks did not run (see above), so this is not a clean result."}
        </p>
      )}

      <div className="flex flex-col gap-6 print:hidden">
        {(["Provable", "Ask"] as const).map((tier) => {
          const group = live.filter((f) => f.tier === tier);
          if (!group.length) return null;
          return (
            <section key={tier} className="flex flex-col gap-3">
              <header>
                <h3 className="text-lg font-semibold">{TIER_LABEL[tier].title} <span className="text-slate-500">({group.length})</span></h3>
                <p className="text-sm text-slate-500">{TIER_LABEL[tier].blurb}</p>
              </header>
              {group.map((f) => (
                <FindingCard key={f.id} f={f} bill={result.bill} overlapsWith={overlaps[f.id]} selected={selected.includes(f.id)}
                  onSelect={(v) => setSelected((s) => (v ? [...s, f.id] : s.filter((x) => x !== f.id)))} />
              ))}
            </section>
          );
        })}

        {dropped.length > 0 && (
          <details className="flex flex-col gap-3">
            <summary className="cursor-pointer text-lg font-semibold">Dropped after cross-examination <span className="text-slate-500">({dropped.length})</span></summary>
            <p className="my-2 text-sm text-slate-500">These looked questionable at first, but the documents explain them. They are not counted.</p>
            <div className="flex flex-col gap-3">
              {dropped.map((f) => <FindingCard key={f.id} f={f} bill={result.bill} selected={false} onSelect={() => {}} />)}
            </div>
          </details>
        )}

        {result.skipped_checks.length > 0 && (
          <details className="rounded-xl border border-slate-200 bg-white p-4">
            <summary className="cursor-pointer font-semibold">Checks skipped for lack of evidence ({result.skipped_checks.length})</summary>
            <p className="mt-2 text-sm text-slate-500">Kanakku skips a check rather than guess when a medicine is not in the reference table, a unit is unclear, or a value was not printed.</p>
            <ul className="mt-2 list-disc pl-5 text-sm">
              {result.skipped_checks.map((s, i) => <li key={i}><span className="font-mono">{s.line_item_id}</span>: {s.reason}</li>)}
            </ul>
          </details>
        )}

        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer font-semibold">Bill lines as read ({result.bill.items.length})</summary>
          <p className="my-2 text-sm text-slate-500">Compare these with your paper bill. Every check uses these values.</p>
          <LineTable items={result.bill.items} />
        </details>
      </div>

      <LetterPanel result={result} selected={selected} />

      <footer className="flex flex-col gap-1 border-t border-slate-200 pt-4 print:hidden">
        {synthetic && <p className="text-xs font-medium text-amber-700">Synthetic data: this sample bill, its patient and hospital are fictional.</p>}
        <p className="text-xs text-slate-500">Reference table: hand-curated, verify before real use ({result.versions.table}).</p>
      </footer>
    </div>
  );
}
