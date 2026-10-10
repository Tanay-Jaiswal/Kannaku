import { AuditApp } from "@/components/AuditApp";
import { Disclaimer } from "@/components/Disclaimer";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-12 print:max-w-none print:p-0">
      <header className="flex flex-col gap-3 print:hidden">
        <h1 className="text-4xl font-bold tracking-tight text-teal-800">Kanakku</h1>
        <p className="text-lg text-slate-700">
          Upload your hospital bill. Kanakku finds what you shouldn&apos;t be paying, proves it, and pre-defeats the
          hospital&apos;s rebuttal.
        </p>
        <p className="text-sm text-slate-500">
          It checks the bill&apos;s arithmetic, compares medicine prices with printed MRP and ceiling prices, and
          matches charges against your discharge summary. Every finding is cross-examined before you see it.
        </p>
      </header>

      <AuditApp />

      <footer className="flex flex-col gap-2 border-t border-slate-200 pt-4 print:hidden">
        <p className="text-xs font-medium text-amber-700">Synthetic data: all demo bills are synthetic.</p>
        <Disclaimer />
      </footer>
    </main>
  );
}
