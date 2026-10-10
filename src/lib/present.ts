// Plain-language labels shared by the UI and the dispute letter. Pure, browser-safe.
import type { Finding } from "./schemas";

export const FINDING_TITLE: Record<Finding["type"], string> = {
  ARITH_LINE: "Line amount is higher than quantity × rate",
  ARITH_TOTAL: "Bill total is higher than the sum of its lines",
  DUPLICATE_EXACT: "Same item billed more than once",
  DUPLICATE_ONE_TIME: "One-time fee billed more than once",
  ROOM_DAYS_EXCEED_STAY: "More room days billed than the stay",
  DRUG_ABOVE_LIMIT: "Medicine billed above its price limit",
  MISMATCH_ICU_DAYS: "More ICU days billed than the summary documents",
  MISMATCH_NOT_IN_SUMMARY: "Service not mentioned in the discharge summary",
};

export const TIER_LABEL: Record<Finding["tier"], { title: string; blurb: string }> = {
  Provable: { title: "Provable", blurb: "The bill contradicts its own printed figures, or a medicine is billed above a verified price limit." },
  Contractual: { title: "Contractual", blurb: "Depends on your package or contract terms." },
  Ask: { title: "Ask about this", blurb: "Could have a legitimate explanation. Ask the billing desk to show the record behind it." },
};

export const EVIDENCE_LABEL: Record<string, string> = {
  printed_amount: "Printed amount", quantity: "Quantity", unit_rate: "Unit rate", quantity_times_rate: "Quantity × rate", difference: "Difference",
  sum_of_line_amounts: "Sum of line amounts", stated_discount: "Stated discount", expected_total: "Expected total", stated_total: "Stated total",
  description: "Description", date: "Date", time: "Time", copies_billed: "Copies billed", amount_of_repeat_copies: "Amount of repeat copies",
  fee_class: "Fee type", lines_billed: "Lines billed", dates: "Dates", amount_of_repeat_lines: "Amount of repeat lines",
  days_billed: "Days billed", admission_date: "Admission", discharge_date: "Discharge", nights: "Nights", allowed_days: "Allowed days (nights + 1)",
  extra_days: "Extra days", daily_rate: "Daily rate", drug: "Medicine", strength: "Strength", billed_rate_per_unit: "Billed rate per unit", unit: "Unit",
  quantity_in_units: "Quantity (units)", binding_limit_per_unit: "Limit per unit used", binding_basis: "Limit used", bases_exceeded: "Limits exceeded",
  reference_verified: "Reference row verified", brand_match: "Brand matches reference", billed_brand: "Billed brand", excess: "Excess",
  printed_mrp_per_unit: "Printed MRP per unit", reference_mrp_per_unit: "Reference MRP per unit", ceiling_ex_gst_per_unit: "Ceiling price (ex-GST) per unit",
  gst: "GST", ceiling_incl_gst_per_unit: "Ceiling incl. GST per unit", reference_label: "Reference status",
  icu_days_billed: "ICU days billed", icu_days_documented_in_summary: "ICU days in summary", amount_for_extra_days: "Amount for extra days",
  billed_items: "Billed items", amount_billed: "Amount billed", summary_check: "Summary check (AI reading)", clinical_reasoning: "Reasoning (AI reading)",
};

export const BASIS_LABEL: Record<string, string> = {
  printed_mrp: "MRP printed on the bill", reference_mrp: "reference-table MRP", ceiling_incl_gst: "NPPA ceiling price incl. GST",
};

export const formatInr = (n: number) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
