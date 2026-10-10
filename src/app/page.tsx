import { Disclaimer } from "@/components/Disclaimer";
import { UploadBox } from "@/components/UploadBox";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-bold tracking-tight text-teal-800">Kanakku</h1>
        <p className="text-lg text-slate-700">
          Upload your hospital bill. Kanakku finds what you shouldn&apos;t be paying, proves it, and pre-defeats the
          hospital&apos;s rebuttal.
        </p>
        <p className="text-sm text-slate-500">
          It checks the bill&apos;s arithmetic, compares medicine prices with printed MRP and ceiling prices, and
          matches charges against your discharge summary.
        </p>
      </header>

      <section aria-label="Upload documents" className="grid gap-4 sm:grid-cols-2">
        <UploadBox id="bill" title="Itemized hospital bill" hint="PDF or photo of the full itemized inpatient bill" />
        <UploadBox id="summary" title="Discharge summary" hint="PDF or photo of the discharge summary" />
      </section>
      <p className="text-sm text-slate-500">Bill analysis is not connected yet. Uploaded files are not processed.</p>

      <footer className="flex flex-col gap-2 border-t border-slate-200 pt-4">
        <p className="text-xs font-medium text-amber-700">Synthetic data: all demo bills are synthetic.</p>
        <Disclaimer />
      </footer>
    </main>
  );
}
