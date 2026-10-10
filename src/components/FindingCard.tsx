"use client";
// One finding. Collapsed: what, which lines, how much, tier and review state. Expanded: bill lines, the
// three-column cross-examination (Finding / Hospital would say / Our counter), the Judge's verdict, the
// question for the billing desk, code-computed evidence, source citation and limitations.
import { useId, useState, type ReactNode } from "react";
import type { BillExtraction, Finding } from "@/lib/schemas";
import { BASIS_LABEL, EVIDENCE_LABEL, FINDING_TITLE, formatInr } from "@/lib/present";
import { UNVERIFIED_REFERENCE_LABEL } from "@/lib/config";
import { isDemoFinding } from "@/lib/status";
import { Badge, IconAlert, IconCalc, IconCheck, IconChevron, IconMinus, IconQuestion, IconScale, IconXCircle } from "./ui";

type Props = { f: Finding; bill: BillExtraction; overlapsWith?: string; selected: boolean; onSelect: (v: boolean) => void };

function TierBadge({ tier }: { tier: Finding["tier"] }) {
  if (tier === "Provable") return <Badge tone="brand" icon={<IconCalc className="size-3.5" />}>Provable</Badge>;
  if (tier === "Ask") return <Badge tone="ask" icon={<IconQuestion className="size-3.5" />}>Ask about this</Badge>;
  return <Badge tone="neutral">Contractual</Badge>;
}

export function FindingCard({ f, bill, overlapsWith, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const dropped = f.status === "dropped";
  const debated = f.review?.state === "debated";
  const demo = debated && isDemoFinding(f);
  const items = f.line_item_ids.map((id) => bill.items.find((i) => i.id === id)).filter((i): i is BillExtraction["items"][number] => !!i);
  const panelId = `${uid}-panel`;

  return (
    <article
      aria-labelledby={`${uid}-title`}
      className={`rounded-xl border bg-surface shadow-card transition-colors ${dropped ? "border-line bg-surface/70" : selected ? "border-brand-200" : "border-line"}`}
    >
      <div className="flex items-start gap-3 p-4 sm:gap-4 sm:p-5">
        {!dropped && (
          <label className="flex shrink-0 cursor-pointer flex-col items-center gap-1 pt-0.5">
            <input
              type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)}
              className="size-5 cursor-pointer rounded accent-brand-700"
              aria-label={`Include ${f.id}, ${FINDING_TITLE[f.type]}, in the letter`}
            />
            <span className="hidden text-[10px] font-medium uppercase tracking-wide text-ink-muted sm:block" aria-hidden>Letter</span>
          </label>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <TierBadge tier={f.tier} />
            {f.status === "downgraded" && <Badge tone="outline">Downgraded from {f.initial_tier}</Badge>}
            {dropped && <Badge tone="outline" icon={<IconXCircle className="size-3.5" />}>Explained by the documents</Badge>}
            {!debated && <Badge tone="danger" icon={<IconAlert className="size-3.5" />}>Not cross-examined</Badge>}
            {demo && <Badge tone="outline">Scripted demo review</Badge>}
            {f.evidence.reference_verified === false && <Badge tone="caution">Illustrative reference</Badge>}
            {overlapsWith && <Badge tone="outline">Overlaps {overlapsWith}; counted once</Badge>}
          </div>
          <h4 id={`${uid}-title`} className="mt-2 font-semibold text-ink">{FINDING_TITLE[f.type]}</h4>
          <p className="mt-0.5 break-words text-sm text-ink-muted">
            {items.length ? items.map((i) => `${i.id} ${i.description_raw}`).join("; ") : "Bill totals"}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1 text-right">
          <span className="font-mono text-xs text-ink-faint">{f.id}</span>
          <span className={`text-lg font-semibold num sm:text-xl ${dropped ? "text-ink-faint line-through" : "text-ink"}`}>{formatInr(f.amount_at_stake)}</span>
          {dropped && <span className="sr-only">Not counted.</span>}
        </div>
      </div>

      <button
        type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-paper/60 sm:px-5"
      >
        <span>{open ? "Hide evidence and review" : "Show evidence and review"}</span>
        <IconChevron className={`size-4 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div id={panelId} className="flex flex-col gap-5 border-t border-line p-4 text-sm sm:p-5">
          {items.length > 0 && (
            <div className="flex flex-col gap-2">
              <SectionLabel>Bill lines</SectionLabel>
              <LineTable items={items} />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <SectionLabel>{demo ? "Cross-examination (precomputed demonstration, no AI model ran)" : "Cross-examination"}</SectionLabel>
            <div className="grid gap-3 lg:grid-cols-3">
              <Column title="Finding" who="Auditor" accent="border-t-brand-600">
                <p>{f.auditor_argument}</p>
              </Column>
              <Column title="Hospital would say" who="Defender" accent="border-t-line-strong">
                {debated ? (
                  <>
                    <p>{f.defender_rebuttal.strongest_justification}</p>
                    {f.defender_rebuttal.supporting_points.length > 0 && (
                      <ul className="list-disc pl-4">{f.defender_rebuttal.supporting_points.map((p, i) => <li key={i}>{p}</li>)}</ul>
                    )}
                    <p className="text-xs text-ink-muted">
                      {f.defender_rebuttal.verifiable_from_documents ? "Supported by the documents provided." : "Not verifiable from the documents provided."}{" "}
                      Would be confirmed by: {f.defender_rebuttal.what_would_confirm}
                    </p>
                  </>
                ) : (
                  <p className="text-ink-muted">Not cross-examined: {f.review?.note?.replace(/\.+$/, "")}. The tier comes from the rule alone.</p>
                )}
              </Column>
              <Column title="Our counter" who="Judge" accent="border-t-ask-700">
                {debated ? <p>{f.counter_argument}</p> : <p className="text-ink-muted">No counter was written.</p>}
              </Column>
            </div>
          </div>

          {debated && (
            <div className="flex flex-col gap-2 rounded-lg border border-line bg-paper/60 p-3 sm:flex-row sm:items-start sm:gap-3">
              <span className="flex items-center gap-2 font-semibold text-ink"><IconScale className="size-4 text-brand-700" /> Judge</span>
              <Verdict f={f} />
              <p className="min-w-0 flex-1 text-ink-soft">{f.judge_decision.rationale}</p>
            </div>
          )}

          {!dropped && (
            <div className="rounded-lg border border-brand-200 bg-brand-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">Ask the billing desk</p>
              <p className="mt-1 text-ink">{f.question_for_billing_desk}</p>
            </div>
          )}

          {f.enforcement_notes?.map((n, i) => (
            <p key={i} className="flex gap-2 rounded-lg bg-paper-deep/70 p-3 text-xs text-ink-soft"><IconCalc className="size-4 shrink-0" /> Code check: {n}</p>
          ))}

          <details className="group rounded-lg border border-line">
            <summary className="flex cursor-pointer items-center gap-2 p-3 font-medium text-ink-soft">
              <IconChevron className="size-4 transition-transform group-open:rotate-90" /> Evidence computed by code
            </summary>
            <dl className="grid gap-x-4 gap-y-2 border-t border-line p-3 sm:grid-cols-[minmax(0,14rem)_1fr]">
              {Object.entries(f.evidence).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-ink-muted">{(demo ? EVIDENCE_LABEL[k]?.replace("(AI reading)", "(demonstration script)") : EVIDENCE_LABEL[k]) ?? k}</dt>
                  <dd className="-mt-1.5 break-words text-ink sm:mt-0">{fmt(k, v)}</dd>
                </div>
              ))}
            </dl>
          </details>

          <div className="flex flex-col gap-1.5 rounded-lg bg-paper-deep/60 p-3 text-xs leading-relaxed text-ink-soft">
            <p><span className="font-semibold text-ink">Rule {f.rule_or_source_cited.rule_id}:</span> {f.rule_or_source_cited.description}</p>
            <p><span className="font-semibold text-ink">Source:</span> {f.rule_or_source_cited.source}{f.rule_or_source_cited.benchmark_label ? ` (${f.rule_or_source_cited.benchmark_label})` : ""}</p>
            {f.evidence.reference_verified === false && <p className="font-semibold text-caution-800">{UNVERIFIED_REFERENCE_LABEL}</p>}
            {f.detector === "D3_BILL_VS_SUMMARY" && <p>A summary is short: a missing mention is a question for the billing desk, not proof the service was not given.</p>}
            <p>Amount computed by code from the printed bill{f.detector === "D2_DRUG_PRICE" ? " and the hand-curated reference table" : ""}; the AI never sets an amount.</p>
          </div>
        </div>
      )}
    </article>
  );
}

function Verdict({ f }: { f: Finding }) {
  const d = f.judge_decision.decision;
  if (d === "keep") return <Badge tone="brand" icon={<IconCheck className="size-3.5" />}>Keep</Badge>;
  if (d === "drop") return <Badge tone="outline" icon={<IconXCircle className="size-3.5" />}>Drop (explained)</Badge>;
  return <Badge tone="ask" icon={<IconMinus className="size-3.5" />}>Ask about it</Badge>;
}

function fmt(k: string, v: string | number | boolean) {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (k === "binding_basis") return BASIS_LABEL[String(v)] ?? String(v);
  if (k === "bases_exceeded") return String(v).split(", ").map((b) => BASIS_LABEL[b] ?? b).join(", ");
  return String(v);
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-muted">{children}</p>;
}

function Column({ title, who, accent, children }: { title: string; who: string; accent: string; children: ReactNode }) {
  return (
    <section className={`flex flex-col gap-2 rounded-lg border border-line border-t-4 bg-surface p-3 leading-relaxed text-ink-soft ${accent}`}>
      <h5 className="flex items-baseline justify-between gap-2">
        <span className="font-semibold text-ink">{title}</span>
        <span className="text-xs text-ink-muted">{who}</span>
      </h5>
      {children}
    </section>
  );
}

export function LineTable({ items }: { items: BillExtraction["items"] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[40rem] text-left text-xs">
        <thead className="bg-paper-deep/70 text-ink-muted">
          <tr>
            {["Line", "Date", "Description", "Qty", "Rate", "Amount", "Printed MRP"].map((h, i) => (
              <th key={h} scope="col" className={`px-3 py-2 font-semibold ${i >= 3 ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {items.map((i) => (
            <tr key={i.id} className="align-top">
              <td className="px-3 py-2 font-mono text-ink-muted">{i.id}</td>
              <td className="whitespace-nowrap px-3 py-2">{i.date}{i.time ? ` ${i.time}` : ""}</td>
              <td className="px-3 py-2 text-ink">{i.description_raw}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right num">{i.quantity} {i.unit ?? ""}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right num">{formatInr(i.unit_rate)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-medium text-ink num">{formatInr(i.amount)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right num">{i.printed_mrp != null ? formatInr(i.printed_mrp) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
