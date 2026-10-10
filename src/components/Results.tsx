"use client";
// Results: audit status, the "₹ you can question" summary, findings grouped by tier, dropped findings,
// skipped checks, the extracted bill lines and the letter. Rendered only from the validated PipelineResult;
// every amount shown comes from it or from computeTotals (the same code the server and the letter use).
import { useMemo, useState, type ReactNode, type RefObject } from "react";
import type { Finding, PipelineResult } from "@/lib/schemas";
import { computeTotals } from "@/lib/totals";
import { TIER_LABEL, formatInr } from "@/lib/present";
import { REVIEW_SOURCE_LABEL, auditStatus } from "@/lib/status";
import { FindingCard, LineTable } from "./FindingCard";
import { LetterPanel } from "./LetterPanel";
import {
  Badge, Button, Eyebrow, IconAlert, IconCalc, IconChevron, IconFlask, IconLetter, IconQuestion, IconXCircle, Notice, buttonClass,
} from "./ui";

const TIER_ORDER = ["Provable", "Contractual", "Ask"] as const;
const TIER_ICON: Record<Finding["tier"], ReactNode> = {
  Provable: <IconCalc className="size-5" />, Contractual: <IconLetter className="size-5" />, Ask: <IconQuestion className="size-5" />,
};

export function Results({ result, onNewAudit, headingRef }: { result: PipelineResult; onNewAudit: () => void; headingRef?: RefObject<HTMLHeadingElement | null> }) {
  const { overlaps } = useMemo(() => computeTotals(result.findings), [result]);
  const live = result.findings.filter((f) => f.status !== "dropped");
  const dropped = result.findings.filter((f) => f.status === "dropped");
  // Default: every finding that counts toward the total (an overlapping duplicate starts unticked).
  const [selected, setSelected] = useState<string[]>(() => live.filter((f) => !overlaps[f.id]).map((f) => f.id));
  const selectedTotals = useMemo(() => computeTotals(result.findings.filter((f) => selected.includes(f.id))).totals, [result, selected]);
  const { complete, limitations, notDebated, source, demonstration } = auditStatus(result);
  const synthetic = result.data_label === "Synthetic data";
  const { bill } = result;

  return (
    <div className="flex flex-col gap-10 pb-24 k-enter print:gap-0 print:pb-0">
      {/* Header */}
      <section aria-labelledby="result-title" className="flex flex-col gap-5 print:hidden">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Eyebrow>Audit result</Eyebrow>
              {synthetic
                ? <Badge tone="caution" icon={<IconFlask className="size-3.5" />}>Synthetic data</Badge>
                : <Badge tone="outline">Your upload</Badge>}
              <Badge tone={demonstration ? "caution" : "outline"}>{REVIEW_SOURCE_LABEL[source].badge}</Badge>
              {complete ? <Badge tone="neutral">All stages ran</Badge> : <Badge tone="caution" icon={<IconAlert className="size-3.5" />}>Partial audit</Badge>}
            </div>
            <h1 id="result-title" ref={headingRef} tabIndex={-1} className="font-display text-3xl tracking-tight text-ink outline-none sm:text-4xl">
              {bill.hospital_name}
            </h1>
            <p className="text-sm text-ink-muted">
              {bill.patient_alias} · {result.summary.primary_diagnosis} · admitted {bill.admission_date}, discharged {bill.discharge_date} · {bill.items.length} bill lines read
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href="#letter" className={buttonClass("secondary", "md")}><IconLetter className="size-4" /> Go to letter</a>
            <Button variant="secondary" onClick={onNewAudit}>Start a new audit</Button>
          </div>
        </div>

        {synthetic && (
          <p className="flex gap-2 rounded-lg border border-caution-200 bg-caution-50 px-3 py-2 text-sm text-caution-800">
            <IconFlask className="mt-0.5 size-4 shrink-0" />
            Synthetic sample: the patient, hospital and bill are fictional. This run demonstrates the workflow; it does not measure accuracy on real bills.
          </p>
        )}
      </section>

      {/* Summary */}
      <section aria-label="Amount you can question" className="overflow-hidden rounded-2xl border border-line bg-surface shadow-raised print:hidden">
        <div className="grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-3 bg-brand-900 p-6 text-white sm:p-8">
            <p className="text-sm font-medium text-brand-100">₹ you can question</p>
            <p className="font-display text-5xl tracking-tight num sm:text-6xl">{formatInr(result.totals.questionable_total)}</p>
            <p className="max-w-md text-sm leading-relaxed text-brand-100">
              Charges worth raising with the billing desk. Overlapping findings are counted once. This is an amount to clarify, not a proven overcharge,
              except where a finding is marked Provable.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-px bg-line">
            <Stat label="Billed total" value={formatInr(bill.stated_total)} note="As printed on the bill" />
            <Stat label="Provable" value={formatInr(result.totals.provable)} note="Contradicted by the bill or a verified limit" tone="brand" />
            <Stat label="Ask about" value={formatInr(result.totals.ask)} note="May have an explanation" tone="ask" />
            <Stat label="Findings" value={`${live.length} to raise`} note={dropped.length ? `${dropped.length} dropped after review` : notDebated ? "None dropped; review did not run on all" : "None dropped"} />
          </dl>
        </div>
      </section>

      {/* Audit status */}
      <div className="print:hidden">
        {demonstration && (
          <Notice tone="info" className="mb-3" title="Precomputed demonstration, not a live AI review.">
            {REVIEW_SOURCE_LABEL.demonstration.text}
          </Notice>
        )}
        {complete ? (
          <Notice tone="success" title={demonstration ? "Every stage completed for this demonstration." : "Every check ran on this bill."}>
            Arithmetic, duplicates, room days, medicine prices and the discharge-summary comparison all completed, and each finding was cross-examined
            {demonstration ? " using the scripted demonstration answers" : source === "recorded_ai" ? " (recorded AI review)" : ""}.
            Checks skipped for missing evidence are listed below.
          </Notice>
        ) : (
          <Notice tone="caution" title="This audit is partial. Read before relying on it." role="status">
            <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">{limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
          </Notice>
        )}
      </div>

      {/* Findings */}
      <section aria-labelledby="findings-title" className="flex flex-col gap-8 print:hidden">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="findings-title" className="font-display text-2xl tracking-tight text-ink sm:text-3xl">Findings</h2>
            <p className="mt-1 text-sm text-ink-muted">Open a finding to see the bill lines, the evidence and the cross-examination. Tick the ones to include in your letter.</p>
          </div>
          {live.length > 0 && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setSelected(live.map((f) => f.id))} disabled={selected.length === live.length}>Select all</Button>
              <Button size="sm" variant="quiet" onClick={() => setSelected([])} disabled={!selected.length}>Clear</Button>
            </div>
          )}
        </div>

        {live.length === 0 && (
          complete ? (
            <Notice tone="success" title="No charges to question were found by the checks Kanakku runs.">
              This does not certify the bill. It means the arithmetic, duplicate, room-day, medicine-price and summary checks found nothing to raise.
              {dropped.length > 0 && ` ${dropped.length} candidate${dropped.length === 1 ? " was" : "s were"} explained by the documents and dropped (shown below).`}
            </Notice>
          ) : (
            <Notice tone="caution" title="No charges to question were found by the checks that ran.">
              Some checks did not run (see above), so this is not a clean result.
            </Notice>
          )
        )}

        {TIER_ORDER.map((tier) => {
          const group = live.filter((f) => f.tier === tier);
          if (!group.length) return null;
          return (
            <section key={tier} aria-labelledby={`tier-${tier}`} className="flex flex-col gap-3">
              <header className="flex items-start gap-3">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tier === "Provable" ? "bg-brand-700 text-white" : tier === "Ask" ? "bg-ask-100 text-ask-800" : "bg-paper-deep text-ink-soft"}`}>
                  {TIER_ICON[tier]}
                </span>
                <div>
                  <h3 id={`tier-${tier}`} className="text-lg font-semibold text-ink">
                    {TIER_LABEL[tier].title} <span className="font-normal text-ink-muted num">({group.length})</span>
                  </h3>
                  <p className="text-sm text-ink-muted">{TIER_LABEL[tier].blurb}{tier === "Contractual" ? " Not counted in the totals." : ""}</p>
                </div>
              </header>
              <div className="flex flex-col gap-3">
                {group.map((f) => (
                  <FindingCard key={f.id} f={f} bill={bill} overlapsWith={overlaps[f.id]} selected={selected.includes(f.id)}
                    onSelect={(v) => setSelected((s) => (v ? [...s, f.id] : s.filter((x) => x !== f.id)))} />
                ))}
              </div>
            </section>
          );
        })}

        {dropped.length > 0 && (
          <Disclosure title={<>Dropped after cross-examination <span className="font-normal text-ink-muted num">({dropped.length})</span></>}
            icon={<IconXCircle className="size-5 text-ink-muted" />}
            intro="These looked questionable at first, but the documents explain them. They are not counted and cannot be added to the letter.">
            <div className="flex flex-col gap-3">
              {dropped.map((f) => <FindingCard key={f.id} f={f} bill={bill} selected={false} onSelect={() => {}} />)}
            </div>
          </Disclosure>
        )}

        {result.skipped_checks.length > 0 && (
          <Disclosure title={<>Checks skipped for lack of evidence <span className="font-normal text-ink-muted num">({result.skipped_checks.length})</span></>}
            icon={<IconAlert className="size-5 text-ask-700" />}
            intro="Kanakku skips a check rather than guess when a medicine is not in the reference table, a unit is unclear, or a value was not printed.">
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line bg-surface text-sm">
              {result.skipped_checks.map((s, i) => (
                <li key={i} className="flex flex-col gap-1 p-3 sm:flex-row sm:gap-4">
                  <span className="shrink-0 font-mono text-xs text-ink-muted sm:w-14 sm:pt-0.5">{s.line_item_id}</span>
                  <span className="min-w-0 text-ink-soft">{lineName(result, s.line_item_id)}{s.reason}</span>
                </li>
              ))}
            </ul>
          </Disclosure>
        )}

        <Disclosure title={<>Bill lines as read <span className="font-normal text-ink-muted num">({bill.items.length})</span></>}
          icon={<IconCalc className="size-5 text-ink-muted" />}
          intro="Compare these with your paper bill. Every check uses these values.">
          <LineTable items={bill.items} />
        </Disclosure>
      </section>

      <LetterPanel result={result} selected={selected} selectedTotal={selectedTotals.questionable_total} />

      <footer className="flex flex-col gap-1 border-t border-line pt-4 text-xs text-ink-muted print:hidden">
        {synthetic && <p className="font-medium text-caution-800">Synthetic data: this sample bill, its patient and hospital are fictional.</p>}
        <p>Reference table: hand-curated, verify before real use ({result.versions.table}).</p>
      </footer>

      {/* Selection bar: what will go into the letter. */}
      {live.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur print:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <p className="min-w-0 text-sm text-ink-soft" aria-live="polite">
              <span className="font-semibold text-ink num">{selected.length}</span> of {live.length} selected for the letter
              <span className="hidden sm:inline"> · </span>
              <span className="block font-semibold text-ink num sm:inline">{formatInr(selectedTotals.questionable_total)}</span>
            </p>
            <a href="#letter" className={buttonClass("primary", "md")}><IconLetter className="size-4" /> Review letter</a>
          </div>
        </div>
      )}
    </div>
  );
}

function lineName(result: PipelineResult, id: string) {
  const item = result.bill.items.find((i) => i.id === id);
  return item ? <span className="font-medium text-ink">{item.description_raw}: </span> : null;
}

function Stat({ label, value, note, tone }: { label: string; value: string; note: string; tone?: "brand" | "ask" }) {
  return (
    <div className="flex flex-col gap-1 bg-surface p-5 sm:p-6">
      <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">
        {tone && <span aria-hidden className={`size-2 rounded-full ${tone === "brand" ? "bg-brand-600" : "bg-ask-700"}`} />}
        {label}
      </dt>
      <dd className="text-xl font-semibold text-ink num sm:text-2xl">{value}</dd>
      <dd className="text-xs text-ink-muted">{note}</dd>
    </div>
  );
}

function Disclosure({ title, icon, intro, children }: { title: ReactNode; icon: ReactNode; intro: string; children: ReactNode }) {
  return (
    <details className="group rounded-xl border border-line bg-surface shadow-card">
      <summary className="flex cursor-pointer items-center gap-3 rounded-xl p-4 hover:bg-paper/60">
        {icon}
        <span className="flex-1 font-semibold text-ink">{title}</span>
        <IconChevron className="size-4 text-ink-muted transition-transform group-open:rotate-90" />
      </summary>
      <div className="flex flex-col gap-3 border-t border-line p-4">
        <p className="text-sm text-ink-muted">{intro}</p>
        {children}
      </div>
    </details>
  );
}
