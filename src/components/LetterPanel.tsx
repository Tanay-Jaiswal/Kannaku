"use client";
// Dispute letter: built by code from the selected findings, editable, printable (browser "Save as PDF").
// If the user edits and then changes the selection, the letter is marked out of date and cannot be printed
// until it is rebuilt, so a printed letter never names findings the user unticked.
import { useEffect, useState } from "react";
import type { PipelineResult } from "@/lib/schemas";
import { buildLetter, letterSync } from "@/lib/letter";
import { formatInr } from "@/lib/present";
import { Badge, Button, IconAlert, IconCheck, IconFlask, IconLetter, IconPrinter, IconRefresh, Notice } from "./ui";

type Props = { result: PipelineResult; selected: string[]; selectedTotal: number };

export function LetterPanel({ result, selected, selectedTotal }: Props) {
  const generated = buildLetter(result, selected);
  const [text, setText] = useState(generated);
  const [edited, setEdited] = useState(false);
  const [basis, setBasis] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  // Selection changes regenerate the letter unless the user has started editing it.
  useEffect(() => { if (!edited) setText(generated); }, [generated, edited]);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(null), 2500); return () => clearTimeout(t); }, [copied]);

  const sync = letterSync(generated, edited, basis);
  const synthetic = result.data_label === "Synthetic data";
  const count = result.findings.filter((f) => selected.includes(f.id) && f.status !== "dropped").length;

  const rebuild = () => { setEdited(false); setBasis(null); setText(generated); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied("ok"); } catch { setCopied("fail"); }
  };

  return (
    <section id="letter" aria-labelledby="letter-title" className="flex scroll-mt-24 flex-col gap-4 print:block">
      <div className="flex flex-col gap-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2">
          <IconLetter className="size-5 text-brand-700" />
          <h2 id="letter-title" className="font-display text-2xl tracking-tight text-ink sm:text-3xl">Letter to the billing desk</h2>
          {synthetic && <Badge tone="caution" icon={<IconFlask className="size-3.5" />}>Demo letter, not for sending</Badge>}
        </div>
        <p className="max-w-2xl text-sm text-ink-muted">
          Built by code from the findings you ticked, with their bill lines, amounts and sources. It asks for clarification and makes no allegation.
          Add your details, edit anything, then print or save as PDF.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-raised print:overflow-visible print:rounded-none print:border-0 print:shadow-none">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 border-b border-line bg-paper/60 p-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <p className="text-sm text-ink-soft">
            {count
              ? <><span className="font-semibold text-ink num">{count}</span> finding{count === 1 ? "" : "s"} · <span className="font-semibold text-ink num">{formatInr(selectedTotal)}</span> to clarify</>
              : "No findings selected"}
            {sync === "edited" && <span className="ml-2 text-xs text-ink-muted">· edited</span>}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Letter view" className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
              {(["preview", "edit"] as const).map((m) => (
                <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)} disabled={!text}
                  className={`h-8 rounded-md px-3 text-sm font-medium disabled:opacity-50 ${mode === m ? "bg-brand-700 text-white" : "text-ink-soft hover:text-ink"}`}>
                  {m === "preview" ? "Preview" : "Edit"}
                </button>
              ))}
            </div>
            {edited && <Button variant="quiet" size="sm" onClick={rebuild}><IconRefresh className="size-4" /> Reset text</Button>}
            <Button variant="secondary" size="sm" onClick={copy} disabled={!text}>
              {copied === "ok" ? <><IconCheck className="size-4" /> Copied</> : "Copy text"}
            </Button>
            <Button size="sm" onClick={() => window.print()} disabled={!text || sync === "stale"}>
              <IconPrinter className="size-4" /> Print / Save as PDF
            </Button>
          </div>
        </div>
        <p className="sr-only" aria-live="polite">{copied === "ok" ? "Letter copied to the clipboard." : copied === "fail" ? "Could not copy. Select the text and copy it manually." : ""}</p>
        {copied === "fail" && <p className="px-4 pt-3 text-sm text-danger-700 print:hidden">Could not copy automatically. Switch to Edit, select the text and copy it.</p>}

        {sync === "stale" && (
          <div className="p-4 pb-0 print:hidden">
            <Notice tone="caution" role="alert" title="Your selection changed after you edited the letter.">
              <p>The text may still mention findings you unticked, or miss ones you added, and its total may not match. Rebuild it from your
                current selection before printing. Your edits will be replaced, so copy them first if you want to keep them.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={rebuild}><IconRefresh className="size-4" /> Rebuild from selection</Button>
                <Button size="sm" variant="secondary" onClick={copy}>Copy edited text</Button>
              </div>
            </Notice>
          </div>
        )}

        {text || edited ? (
          <div className="p-4 sm:p-8 print:p-0">
            {sync === "stale" && <p className="hidden print:block">This letter is out of date with the selected findings. Rebuild it in Kanakku before printing.</p>}
            {mode === "edit" && (
              <div className="print:hidden">
                <label htmlFor="letter-text" className="sr-only">Letter text</label>
                <textarea
                  id="letter-text" value={text} spellCheck
                  onChange={(e) => { if (!edited) setBasis(generated); setEdited(true); setText(e.target.value); }}
                  className="min-h-[32rem] w-full resize-y rounded-lg border border-line-strong bg-surface p-4 font-sans text-sm leading-relaxed text-ink focus:border-brand-600"
                />
                <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
                  <IconAlert className="size-3.5" /> Replace the bracketed placeholders with your own details. Keep the amounts as they are.
                </p>
              </div>
            )}
            {/* The paper view: shown in Preview, and always the only thing printed. */}
            <article
              aria-label="Letter preview"
              className={`mx-auto max-w-[46rem] whitespace-pre-wrap break-words rounded-sm border border-line bg-white px-6 py-8 font-display text-[15px] leading-relaxed text-ink shadow-card sm:px-12 sm:py-12 print:max-w-none print:border-0 print:p-0 print:text-[12pt] print:shadow-none ${mode === "preview" ? "" : "hidden"} ${sync === "stale" ? "print:hidden" : "print:block"}`}
            >
              {text}
            </article>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center print:hidden">
            <span className="flex size-11 items-center justify-center rounded-full bg-paper-deep text-ink-muted"><IconLetter className="size-5" /></span>
            <p className="font-medium text-ink">No findings selected</p>
            <p className="max-w-sm text-sm text-ink-muted">Tick at least one finding above to build the letter. Dropped findings cannot be included.</p>
          </div>
        )}
      </div>
    </section>
  );
}
