// Static landing content: the hero, what Kanakku needs and returns, how a bill is checked, and the sample
// bill cards. Everything here describes what the app actually does; there are no invented statistics.
import type { ReactNode } from "react";
import {
  Badge, Button, Eyebrow, IconArrowRight, IconCalc, IconClipboard, IconExternal, IconFlask, IconQuestion,
  IconReceipt, IconScale, IconShield, buttonClass,
} from "./ui";

export type SampleInfo = { id: string; title: string; blurb: string };

export function Hero({ onTryDemo, demoDisabled, uploadsOn }: { onTryDemo: () => void; demoDisabled: boolean; uploadsOn: boolean }) {
  return (
    <section aria-labelledby="hero-title" className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:gap-14">
      <div className="flex flex-col gap-6">
        <Eyebrow>Hospital bill review for patients in India</Eyebrow>
        <h1 id="hero-title" className="font-display text-4xl leading-[1.1] tracking-tight text-ink sm:text-5xl">
          Find the charges on your hospital bill that are worth questioning.
        </h1>
        <p className="max-w-xl text-lg leading-relaxed text-ink-soft">
          Kanakku reads your itemised inpatient bill and discharge summary, checks the arithmetic and medicine prices,
          compares charges with your clinical notes, and cross-examines every finding before you see it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={onTryDemo} disabled={demoDisabled}>
            Try the synthetic demo bill <IconArrowRight className="size-4" />
          </Button>
          {uploadsOn
            ? <a href="#upload" className={buttonClass("secondary", "lg")}>Audit my documents</a>
            : <a href="#samples" className={buttonClass("secondary", "lg")}>See all sample bills</a>}
        </div>
        <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-muted">
          <li className="flex items-center gap-1.5"><IconShield className="size-4 text-brand-700" /> No account needed</li>
          <li className="flex items-center gap-1.5"><IconCalc className="size-4 text-brand-700" /> Every rupee amount computed by code</li>
          <li className="flex items-center gap-1.5"><IconQuestion className="size-4 text-brand-700" /> Questions, not accusations</li>
        </ul>
      </div>

      <aside aria-label="What you need and what you get" className="rounded-2xl border border-line bg-surface p-6 shadow-raised">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">You provide</p>
        <ul className="mt-3 flex flex-col gap-3">
          <NeedRow icon={<IconReceipt className="size-5" />} title="Itemised hospital bill" text="Every line with date, quantity, rate and amount. A summary bill is not enough." />
          <NeedRow icon={<IconClipboard className="size-5" />} title="Discharge summary" text="Used to check ICU days and services against what the doctors documented." />
        </ul>
        <div className="my-5 border-t border-dashed border-line" />
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-muted">You receive</p>
        <ul className="mt-3 flex flex-col gap-2.5 text-sm text-ink-soft">
          <GetRow>Charges to question, sorted into <strong className="text-ink">Provable</strong> and <strong className="text-ink">Ask about this</strong></GetRow>
          <GetRow>The bill lines, evidence and source behind each one</GetRow>
          <GetRow>What the hospital might say, and the counter to it</GetRow>
          <GetRow>Checks that could not run, listed openly</GetRow>
          <GetRow>A polite, editable letter for the billing desk</GetRow>
        </ul>
      </aside>
    </section>
  );
}

function NeedRow({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{icon}</span>
      <span><span className="block text-sm font-semibold text-ink">{title}</span><span className="block text-sm text-ink-muted">{text}</span></span>
    </li>
  );
}
function GetRow({ children }: { children: ReactNode }) {
  return <li className="flex gap-2.5"><span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-brand-500" /><span>{children}</span></li>;
}

const HOW = [
  { icon: <IconReceipt className="size-5" />, title: "Read", text: "The AI copies bill lines and summary details into a checked, structured form. Anything unreadable is marked, not guessed." },
  { icon: <IconCalc className="size-5" />, title: "Check by code", text: "Deterministic rules test line arithmetic, the bill total, duplicates, room days and medicine prices against printed MRP and ceiling prices." },
  { icon: <IconClipboard className="size-5" />, title: "Compare with notes", text: "Charges are compared with the discharge summary. A missing mention becomes a question, never proof." },
  { icon: <IconScale className="size-5" />, title: "Cross-examine", text: "An Auditor states each finding, a Defender gives the hospital's best explanation, and a Judge keeps, downgrades or drops it." },
];

export function HowItWorks() {
  return (
    <section aria-labelledby="how-title" className="flex flex-col gap-6">
      <div className="max-w-2xl">
        <Eyebrow>How a bill is checked</Eyebrow>
        <h2 id="how-title" className="mt-2 font-display text-3xl tracking-tight text-ink">Code does the maths. The AI reads and argues.</h2>
        <p className="mt-2 text-ink-soft">
          The AI never sets a rupee amount and can only lower a finding&apos;s tier, never raise it.
        </p>
      </div>
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {HOW.map((h, i) => (
          <li key={h.title} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
            <div className="flex items-center justify-between">
              <span className="flex size-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">{h.icon}</span>
              <span className="text-xs font-semibold text-ink-faint num">0{i + 1}</span>
            </div>
            <h3 className="font-semibold text-ink">{h.title}</h3>
            <p className="text-sm leading-relaxed text-ink-muted">{h.text}</p>
          </li>
        ))}
      </ol>
      <dl className="grid gap-4 rounded-xl border border-line bg-paper-deep/60 p-5 text-sm sm:grid-cols-3">
        <TierDef badge={<Badge tone="brand">Provable</Badge>} text="The bill contradicts its own printed figures, or a medicine is billed above a verified price limit." />
        <TierDef badge={<Badge tone="ask">Ask about this</Badge>} text="May have a legitimate explanation. Ask the billing desk for the record behind it." />
        <TierDef badge={<Badge tone="outline">Dropped</Badge>} text="Looked questionable, but the documents explain it. Shown for transparency, never counted." />
      </dl>
    </section>
  );
}
function TierDef({ badge, text }: { badge: ReactNode; text: string }) {
  return <div className="flex flex-col gap-1.5"><dt>{badge}</dt><dd className="text-ink-soft">{text}</dd></div>;
}

export type SampleReviewSource = "recorded_ai" | "demonstration";

export function SampleCards({ samples, reviewSource, onRun }: { samples: SampleInfo[]; reviewSource: SampleReviewSource | null; onRun: (s: SampleInfo) => void }) {
  return (
    <section id="samples" aria-labelledby="samples-title" className="flex scroll-mt-24 flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Eyebrow>Explore without your own bill</Eyebrow>
        <h2 id="samples-title" className="font-display text-3xl tracking-tight text-ink">Synthetic sample bills</h2>
        <p className="max-w-2xl text-ink-soft">
          Fictional patients and hospitals, built with known answers to show the workflow. A sample run demonstrates how
          Kanakku works; it does not show how accurate an audit of a real bill would be.
        </p>
      </div>
      {reviewSource && <SampleReviewNote source={reviewSource} />}
      <ul className="grid gap-4 md:grid-cols-3">
        {samples.map((s) => (
          <li key={s.id} className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-5 shadow-card">
            <div className="flex items-center justify-between gap-2">
              <Badge tone="caution" icon={<IconFlask className="size-3.5" />}>Synthetic data</Badge>
              {s.id === "bill-02-demo" && <span className="text-xs font-medium text-brand-700">Recommended demo</span>}
            </div>
            <h3 className="font-semibold text-ink">{s.title}</h3>
            <p className="flex-1 text-sm text-ink-muted">{s.blurb}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
              <Button size="sm" onClick={() => onRun(s)} aria-label={`Run sample audit: ${s.title}`}>Run sample audit</Button>
              <DocLink href={`/api/sample/document?id=${s.id}&kind=bill`} label="Bill" title={s.title} />
              <DocLink href={`/api/sample/document?id=${s.id}&kind=summary`} label="Summary" title={s.title} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
/** Says up front how a sample run's AI stages are produced on this deployment. A sample never calls the AI live. */
export function SampleReviewNote({ source }: { source: SampleReviewSource }) {
  return (
    <p className="flex gap-2 rounded-lg border border-caution-200 bg-caution-50 p-3 text-sm text-caution-800">
      <IconFlask className="mt-0.5 size-4 shrink-0" />
      {source === "demonstration" ? (
        <span>
          <strong className="font-semibold">Precomputed demonstration.</strong> On this deployment a sample run does not call an AI model.
          The code checks run for real; the AI stages use answers written in advance from each sample&apos;s verified answer key and are
          checked exactly like live AI output. No API credit is spent.
        </span>
      ) : (
        <span>
          <strong className="font-semibold">Recorded AI review.</strong> A sample run replays AI answers recorded in advance for these
          synthetic bills and re-checks them. No AI model is called live and no API credit is spent.
        </span>
      )}
    </p>
  );
}

function DocLink({ href, label, title }: { href: string; label: string; title: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline"
      aria-label={`View the synthetic ${label.toLowerCase()} for ${title} (opens in a new tab)`}>
      {label} <IconExternal className="size-3.5" />
    </a>
  );
}

