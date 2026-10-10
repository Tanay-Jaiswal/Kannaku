import { AuditApp } from "@/components/AuditApp";
import { Disclaimer } from "@/components/Disclaimer";
import { LogoMark } from "@/components/ui";

export default function Home() {
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-raised">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-line/80 bg-paper/90 backdrop-blur print:hidden">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="/" className="flex items-center gap-2.5" aria-label="Kanakku home">
            <LogoMark className="size-8" />
            <span className="font-display text-xl font-semibold tracking-tight text-ink">Kanakku</span>
          </a>
          <p className="hidden text-sm text-ink-muted sm:block">Hospital bill review · India</p>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-16 print:max-w-none print:p-0">
        <AuditApp />
      </main>

      <footer className="border-t border-line bg-paper-deep/50 print:hidden">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-xs leading-relaxed text-ink-muted sm:px-6">
          <div className="flex items-center gap-2 text-ink-soft">
            <LogoMark className="size-5" />
            <span className="font-semibold">Kanakku</span>
          </div>
          <Disclaimer />
          <p>
            Sample bills, patients and hospitals are synthetic. The medicine reference table is hand-curated for this demo;
            values marked illustrative are not official.
          </p>
        </div>
      </footer>
    </>
  );
}
