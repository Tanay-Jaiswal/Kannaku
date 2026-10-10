// Phase 3: document extraction. The model copies what is printed into a "draft" where every unreadable or
// missing value is null; code then assigns line ids, applies explicit rules for missing values and produces
// the canonical BillExtraction / DischargeSummary. Code never invents a line, price, unit, date or finding.
import { z } from "zod";
import { BillExtraction, Category, DischargeSummary } from "./schemas";
import { cents } from "./money";
import { KanakkuError } from "./errors";
import { callJson } from "./llm/call";
import type { RunContext } from "./spend";
import type { CheckedFile } from "./upload";

const IsoDate = /^\d{4}-\d{2}-\d{2}$/;
const validIso = (s: string | null | undefined): s is string => !!s && IsoDate.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const num = z.number().finite().nullable();

// ---------- What the model returns (nulls are explicit "not printed / unreadable") ----------
export const RawBillItem = z.object({
  date: z.string().nullable(),
  time: z.string().nullable(),
  category: Category,
  description_raw: z.string(),
  quantity: num,
  unit: z.string().nullable(),
  unit_rate: num,
  amount: num,
  printed_mrp: num,
  source_page: z.number().int().positive().nullable(),
  legibility: z.enum(["clear", "partial", "illegible"]),
});
export const RawBill = z.object({
  is_itemized_hospital_bill: z.boolean(),
  problem: z.string().max(300).nullable(), // why it could not be read, if it could not
  hospital_name: z.string().nullable(),
  admission_date: z.string().nullable(),
  discharge_date: z.string().nullable(),
  items: z.array(RawBillItem),
  stated_subtotal: num,
  stated_discount: num,
  stated_total: num,
  notes: z.array(z.string().max(300)).max(20),
});
export type RawBill = z.infer<typeof RawBill>;

export const RawSummary = DischargeSummary.extend({
  is_discharge_summary: z.boolean(),
  problem: z.string().max(300).nullable(),
  admission_date: z.string().nullable(),
  discharge_date: z.string().nullable(),
});
export type RawSummary = z.infer<typeof RawSummary>;

// ---------- Drafts: canonical shape except stay dates, which may come from the other document ----------
export const BillDraft = BillExtraction.extend({
  admission_date: z.string().nullable(),
  discharge_date: z.string().nullable(),
  items: z.array(BillExtraction.shape.items.element.extend({ date: z.string().nullable() })).min(1),
});
export type BillDraft = z.infer<typeof BillDraft>;
export const SummaryDraft = DischargeSummary.extend({ admission_date: z.string().nullable(), discharge_date: z.string().nullable() });
export type SummaryDraft = z.infer<typeof SummaryDraft>;

const UPLOAD_ALIAS = "Patient (uploaded document)"; // never copy a patient name out of an upload

/** Pure code: model draft -> BillDraft. Exported for tests. */
export function billDraftFromRaw(raw: RawBill): BillDraft {
  if (!raw.is_itemized_hospital_bill)
    throw new KanakkuError("UNREADABLE_DOCUMENT", `This does not look like an itemized hospital bill${raw.problem ? `: ${raw.problem}` : ""}. Upload the page-by-page itemized bill, not a summary receipt.`);
  const excluded: { position: number; description: string; reason: string }[] = [];
  const ratesNotPrinted: string[] = [];
  const datesNotPrinted: string[] = [];
  const notes = [...raw.notes];
  const items: BillDraft["items"] = [];

  raw.items.forEach((r, idx) => {
    const position = idx + 1;
    const desc = r.description_raw.trim();
    const drop = (reason: string) => excluded.push({ position, description: desc || "(unreadable description)", reason });
    if (!desc || r.legibility === "illegible") return drop("line is illegible");
    if (r.amount == null) return drop("amount not readable");
    if (r.amount < 0) return drop("credit or discount line; not audited");
    if (r.quantity == null || r.quantity <= 0) return drop("quantity not printed or not readable");
    if (r.unit_rate != null && r.unit_rate < 0) return drop("negative rate; not audited");
    const id = `L${String(items.length + 1).padStart(3, "0")}`;
    let unitRate = r.unit_rate;
    if (unitRate == null) {
      // Rate not printed: code derives the effective rate. Line arithmetic (D1-A1) is then not checkable.
      unitRate = Math.round((r.amount / r.quantity) * 100) / 100;
      ratesNotPrinted.push(id);
    }
    if (!validIso(r.date)) datesNotPrinted.push(id);
    if (r.legibility === "partial") notes.push(`${id}: partly legible; check this line against the paper bill.`);
    items.push({
      id,
      date: validIso(r.date) ? r.date : null,
      ...(r.time && /^\d{2}:\d{2}$/.test(r.time) ? { time: r.time } : {}),
      category: r.category,
      description_raw: desc,
      quantity: r.quantity,
      ...(r.unit ? { unit: r.unit } : {}),
      unit_rate: cents(unitRate),
      amount: cents(r.amount),
      ...(r.printed_mrp != null && r.printed_mrp > 0 ? { printed_mrp: cents(r.printed_mrp) } : {}),
      ...(r.source_page != null ? { source_page: r.source_page } : {}),
    });
  });
  if (items.length === 0)
    throw new KanakkuError("UNREADABLE_DOCUMENT", "No bill lines could be read from this document. If it is a photo, retake it flat, in good light, with the whole table visible.");

  const sum = cents(items.reduce((a, i) => a + i.amount, 0));
  const totalPrinted = raw.stated_total != null && raw.stated_total >= 0;
  if (!totalPrinted) notes.push("No grand total was readable; the total check was skipped and the sum of readable lines is shown instead.");
  return BillDraft.parse({
    hospital_name: raw.hospital_name?.trim() || "Hospital (name not read)",
    patient_alias: UPLOAD_ALIAS,
    admission_date: validIso(raw.admission_date) ? raw.admission_date : null,
    discharge_date: validIso(raw.discharge_date) ? raw.discharge_date : null,
    items,
    ...(raw.stated_subtotal != null && raw.stated_subtotal >= 0 ? { stated_subtotal: cents(raw.stated_subtotal) } : {}),
    ...(raw.stated_discount != null && raw.stated_discount >= 0 ? { stated_discount: cents(raw.stated_discount) } : {}),
    stated_total: totalPrinted ? cents(raw.stated_total!) : sum,
    currency: "INR",
    extraction_notes: notes,
    extraction_quality: { excluded_lines: excluded, stated_total_printed: totalPrinted, rates_not_printed: ratesNotPrinted, dates_not_printed: datesNotPrinted },
  });
}

export function summaryDraftFromRaw(raw: RawSummary): SummaryDraft {
  if (!raw.is_discharge_summary)
    throw new KanakkuError("UNREADABLE_DOCUMENT", `This does not look like a discharge summary${raw.problem ? `: ${raw.problem}` : ""}. Upload the discharge summary issued by the hospital.`);
  const { is_discharge_summary: _a, problem: _b, ...rest } = raw;
  return SummaryDraft.parse({
    ...rest,
    admission_date: validIso(raw.admission_date) ? raw.admission_date : null,
    discharge_date: validIso(raw.discharge_date) ? raw.discharge_date : null,
  });
}

/**
 * Pure code: combine the two drafts into canonical, schema-validated documents. Stay dates come from the
 * bill, else the summary; a disagreement is recorded, not hidden. Lines without a printed date are grouped
 * under the admission date for duplicate checks and listed in extraction_quality.dates_not_printed.
 */
export function reconcile(billDraft: BillDraft, summaryDraft: SummaryDraft): { bill: BillExtraction; summary: DischargeSummary } {
  const b = BillDraft.parse(billDraft), s = SummaryDraft.parse(summaryDraft);
  const notes = [...b.extraction_notes];
  const pick = (field: "admission_date" | "discharge_date", label: string) => {
    const v = b[field] ?? s[field];
    if (!v) throw new KanakkuError("UNREADABLE_DOCUMENT", `Could not read the ${label} date on either document, so stay-length checks cannot run. Please upload clearer copies.`);
    if (b[field] && s[field] && b[field] !== s[field]) notes.push(`The bill and the summary print different ${label} dates (${b[field]} vs ${s[field]}); the bill's date is used for bill checks.`);
    else if (!b[field]) notes.push(`The ${label} date was not read on the bill; the summary's date was used.`);
    return v;
  };
  const admission = pick("admission_date", "admission"), discharge = pick("discharge_date", "discharge");
  if (Date.parse(discharge) < Date.parse(admission))
    throw new KanakkuError("UNREADABLE_DOCUMENT", "The discharge date read from the documents is before the admission date. Please check the documents and try again.");
  const bill = BillExtraction.parse({
    ...b, admission_date: admission, discharge_date: discharge, extraction_notes: notes,
    items: b.items.map((i) => ({ ...i, date: i.date ?? admission })),
  });
  const summary = DischargeSummary.parse({ ...s, admission_date: s.admission_date ?? admission, discharge_date: s.discharge_date ?? discharge });
  return { bill, summary };
}

// ---------- Model calls ----------
const attachment = (f: CheckedFile) =>
  f.kind === "pdf"
    ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } } as const)
    : ({ type: "image", source: { type: "base64", media_type: f.mediaType as "image/png" | "image/jpeg" | "image/webp", data: f.base64 } } as const);

export async function extractBill(file: CheckedFile, ctx: RunContext) {
  const r = await callJson({
    stage: "extract_bill", prompt: "extract_bill", modelKind: "extract", ctx,
    keyInput: { file_sha256: file.sha256, media_type: file.mediaType },
    attachments: [attachment(file)],
    userText: "Extract the attached itemized hospital bill. Return the JSON object only.",
    schema: RawBill,
  });
  return { draft: billDraftFromRaw(r.output), meta: { prompt_version: r.promptVersion, model: r.model, cached: r.cached } };
}

export async function extractSummary(file: CheckedFile, ctx: RunContext) {
  const r = await callJson({
    stage: "extract_summary", prompt: "extract_summary", modelKind: "extract", ctx,
    keyInput: { file_sha256: file.sha256, media_type: file.mediaType },
    attachments: [attachment(file)],
    userText: "Extract the attached discharge summary. Return the JSON object only.",
    schema: RawSummary,
  });
  return { draft: summaryDraftFromRaw(r.output), meta: { prompt_version: r.promptVersion, model: r.model, cached: r.cached } };
}
