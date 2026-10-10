"use client";
// Dispute letter: built by code from the selected findings, editable, printable (browser "Save as PDF").
import { useEffect, useState } from "react";
import type { PipelineResult } from "@/lib/schemas";
import { buildLetter } from "@/lib/letter";

export function LetterPanel({ result, selected }: { result: PipelineResult; selected: string[] }) {
  const generated = buildLetter(result, selected);
  const [text, setText] = useState(generated);
  const [edited, setEdited] = useState(false);
  // Selection changes regenerate the letter unless the user has started editing it.
  useEffect(() => { if (!edited) setText(generated); }, [generated, edited]);

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-slate-300 bg-white p-5 print:border-0 print:p-0" aria-label="Dispute letter">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <h2 className="text-lg font-semibold">Letter to the billing desk</h2>
          <p className="text-sm text-slate-500">
            {selected.length ? `${selected.length} selected finding(s). Edit the text freely, then print or save as PDF.` : "Tick findings above to include them."}
          </p>
        </div>
        <div className="flex gap-2">
          {edited && (
            <button type="button" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" onClick={() => { setEdited(false); setText(generated); }}>
              Reset to generated text
            </button>
          )}
          <button type="button" disabled={!text} onClick={() => window.print()} className="rounded-md bg-teal-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Print / Save as PDF
          </button>
        </div>
      </div>
      {text ? (
        <>
          <textarea
            value={text} onChange={(e) => { setEdited(true); setText(e.target.value); }}
            className="h-96 w-full rounded-md border border-slate-300 p-3 font-mono text-xs leading-relaxed print:hidden" aria-label="Letter text"
          />
          <div className="hidden whitespace-pre-wrap font-serif text-sm leading-relaxed print:block">{text}</div>
        </>
      ) : (
        <p className="text-sm text-slate-500 print:hidden">No findings selected.</p>
      )}
    </section>
  );
}
