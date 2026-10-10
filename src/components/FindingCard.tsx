"use client";
// One finding. Collapsed: what, how much, tier. Expanded: bill lines, the three-column debate
// (Finding / Hospital would say / Our counter), code-computed evidence, source citation and limitations.
import { useState } from "react";
import type { BillExtraction, Finding } from "@/lib/schemas";
import { BASIS_LABEL, EVIDENCE_LABEL, FINDING_TITLE, formatInr } from "@/lib/present";
import { UNVERIFIED_REFERENCE_LABEL } from "@/lib/config";

type Props = { f: Finding; bill: BillExtraction; overlapsWith?: string; selected: boolean; onSelect: (v: boolean) => void };

const TIER_BADGE: Record<Finding["tier"], string> = {
  Provable: "bg-teal-700 text-white", Ask: "bg-amber-100 text-amber-900", Contractual: "bg-slate-200 text-slate-800",
};

export function FindingCard({ f, bill, overlapsWith, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const dropped = f.status === "dropped";
  const debated = f.review?.state === "debated";
  const items = f.line_item_ids.map((id) => bill.items.find((i) => i.id === id)).filter((i): i is BillExtraction["items"][number] => !!i);

  return (
    <article className={`rounded-xl border bg-white ${dropped ? "border-slate-200 opacity-80" : "border-slate-300"}`}>
      <div className="flex items-start gap-3 p-4">
        {!dropped && (
          <input
            type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)}
            className="mt-1 h-4 w-4 accent-teal-700" aria-label={`Include ${f.id} in the letter`} title="Include in the letter"
          />
        )}
        <button type="button" onClick={() => setOpen(!open)} className="flex flex-1 flex-col gap-1 text-left" aria-expanded={open}>
          <span className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono text-slate-500">{f.id}</span>
            <span className={`rounded px-1.5 py-0.5 font-semibold ${TIER_BADGE[f.tier]}`}>{f.tier === "Ask" ? "Ask about this" : f.tier}</span>
            {f.status === "downgraded" && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">downgraded from {f.initial_tier}</span>}
            {dropped && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">explained by the documents</span>}
            {!debated && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-800">not cross-examined</span>}
            {f.evidence.reference_verified === false && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">illustrative reference</span>}
            {overlapsWith && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-700">overlaps {overlapsWith}; counted once</span>}
          </span>
          <span className="font-semibold text-slate-900">{FINDING_TITLE[f.type]}</span>
          <span className="text-sm text-slate-600">
            {items.length ? items.map((i) => `${i.id} ${i.description_raw}`).join("; ") : "Bill totals"}
          </span>
        </button>
        <div className="text-right">
          <div className={`text-lg font-bold ${dropped ? "text-slate-400 line-through" : "text-slate-900"}`}>{formatInr(f.amount_at_stake)}</div>
          <button type="button" onClick={() => setOpen(!open)} className="text-xs text-teal-700 underline">{open ? "Hide details" : "Details"}</button>
        </div>
      </div>

      {open && (
        <div className="flex flex-col gap-4 border-t border-slate-200 p-4 text-sm">
          {items.length > 0 && <LineTable items={items} />}

          <div className="grid gap-3 md:grid-cols-3">
            <Column title="Finding" tone="border-teal-600">
              <p>{f.auditor_argument}</p>
            </Column>
            <Column title="Hospital would say" tone="border-slate-400">
              {debated ? (
                <>
                  <p>{f.defender_rebuttal.strongest_justification}</p>
                  {f.defender_rebuttal.supporting_points.length > 0 && (
                    <ul className="list-disc pl-4">{f.defender_rebuttal.supporting_points.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  )}
                  <p className="text-xs text-slate-500">
                    {f.defender_rebuttal.verifiable_from_documents ? "Supported by the documents provided." : "Not verifiable from the documents provided."}{" "}
                    Would be confirmed by: {f.defender_rebuttal.what_would_confirm}
                  </p>
                </>
              ) : (
                <p className="text-slate-500">This finding was not cross-examined: {f.review?.note}. Its tier comes from the rule alone.</p>
              )}
            </Column>
            <Column title="Our counter" tone="border-amber-500">
              {debated ? <p>{f.counter_argument}</p> : <p className="text-slate-500">No counter was written.</p>}
              <p className="mt-2 font-medium">Ask: {f.question_for_billing_desk}</p>
            </Column>
          </div>

          {debated && (
            <p className="text-slate-700">
              <span className="font-semibold">Judge:</span> {verdict(f)}. {f.judge_decision.rationale}
            </p>
          )}
          {f.enforcement_notes?.map((n, i) => <p key={i} className="rounded bg-slate-50 p-2 text-xs text-slate-600">Code check: {n}</p>)}

          <details>
            <summary className="cursor-pointer font-medium text-slate-700">Evidence (computed by code)</summary>
            <dl className="mt-2 grid grid-cols-[minmax(0,14rem)_1fr] gap-x-4 gap-y-1">
              {Object.entries(f.evidence).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500">{EVIDENCE_LABEL[k] ?? k}</dt>
                  <dd className="text-slate-800">{fmt(k, v)}</dd>
                </div>
              ))}
            </dl>
          </details>

          <div className="rounded bg-slate-50 p-3 text-xs text-slate-600">
            <p><span className="font-semibold">Rule {f.rule_or_source_cited.rule_id}:</span> {f.rule_or_source_cited.description}</p>
            <p><span className="font-semibold">Source:</span> {f.rule_or_source_cited.source}{f.rule_or_source_cited.benchmark_label ? ` (${f.rule_or_source_cited.benchmark_label})` : ""}</p>
            {f.evidence.reference_verified === false && <p className="mt-1 font-semibold text-amber-800">{UNVERIFIED_REFERENCE_LABEL}</p>}
            {f.detector === "D3_BILL_VS_SUMMARY" && <p className="mt-1">A summary is short: a missing mention is a question for the billing desk, not proof the service was not given.</p>}
            <p className="mt-1">Amount computed by code from the printed bill{f.detector === "D2_DRUG_PRICE" ? " and the hand-curated reference table" : ""}; the AI never sets an amount.</p>
          </div>
        </div>
      )}
    </article>
  );
}

function verdict(f: Finding) {
  return f.judge_decision.decision === "keep" ? "keep" : f.judge_decision.decision === "drop" ? "drop (explained)" : "ask about it";
}

function fmt(k: string, v: string | number | boolean) {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (k === "binding_basis") return BASIS_LABEL[String(v)] ?? String(v);
  if (k === "bases_exceeded") return String(v).split(", ").map((b) => BASIS_LABEL[b] ?? b).join(", ");
  return String(v);
}

function Column({ title, tone, children }: { title: string; tone: string; children: React.ReactNode }) {
  return (
    <section className={`flex flex-col gap-2 rounded-lg border-l-4 bg-slate-50 p-3 ${tone}`}>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h4>
      {children}
    </section>
  );
}

export function LineTable({ items }: { items: BillExtraction["items"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-100 text-slate-600">
          <tr>{["Line", "Date", "Description", "Qty", "Rate", "Amount", "Printed MRP"].map((h) => <th key={h} className="px-2 py-1 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-b border-slate-100">
              <td className="px-2 py-1 font-mono">{i.id}</td>
              <td className="px-2 py-1 whitespace-nowrap">{i.date}{i.time ? ` ${i.time}` : ""}</td>
              <td className="px-2 py-1">{i.description_raw}</td>
              <td className="px-2 py-1 whitespace-nowrap">{i.quantity} {i.unit ?? ""}</td>
              <td className="px-2 py-1 whitespace-nowrap">{formatInr(i.unit_rate)}</td>
              <td className="px-2 py-1 whitespace-nowrap">{formatInr(i.amount)}</td>
              <td className="px-2 py-1 whitespace-nowrap">{i.printed_mrp != null ? formatInr(i.printed_mrp) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
