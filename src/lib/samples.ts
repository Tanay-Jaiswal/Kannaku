// Built-in synthetic sample bills. Their documents are pre-extracted: the truth JSON is exactly what a perfect
// extractor returns, so the sample flow skips the extraction model call (and its cost) and starts at
// normalization. Every later AI step runs from the committed cache only.
import { readFileSync } from "node:fs";
import path from "node:path";
import { SAMPLE_BILL_IDS } from "./config";
import { BillDraft, SummaryDraft } from "./extract";

export type SampleId = (typeof SAMPLE_BILL_IDS)[number];
export const SAMPLE_INFO: Record<SampleId, { title: string; blurb: string }> = {
  "bill-02-demo": { title: "Pneumonia with sepsis, 7 nights", blurb: "Demo bill: several charges to question, one trap the Judge should drop." },
  "bill-03-errors": { title: "Femur fracture fixation, 5 nights", blurb: "Second error set: total mismatch, drug price, room days, clinical gaps." },
  "bill-01-clean": { title: "Laparoscopic cholecystectomy, 3 nights", blurb: "Clean bill: the only candidate is explained by the summary." },
};

const dir = (id: SampleId) => path.join(process.cwd(), "data", "synthetic", id);
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as unknown;

export function loadSample(id: SampleId) {
  return {
    bill_draft: BillDraft.parse(readJson(path.join(dir(id), "bill.truth.json"))),
    summary_draft: SummaryDraft.parse(readJson(path.join(dir(id), "summary.truth.json"))),
  };
}

export function sampleDocumentHtml(id: SampleId, kind: "bill" | "summary"): string {
  return readFileSync(path.join(dir(id), `${kind}.html`), "utf8");
}
