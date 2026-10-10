// All shared types. Mirrors SPEC.md section 1. Money is in rupees, 2dp, computed by code only.
import { z } from "zod";

const Rupees = z.number().nonnegative().multipleOf(0.01);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Category = z.enum([
  "room", "icu", "nursing", "consultation", "procedure", "surgery", "anaesthesia", "ot",
  "drug", "consumable", "investigation", "radiology", "physio", "blood", "admin", "other",
]);
export type Category = z.infer<typeof Category>;

// ---------- (1) Extraction output ----------
export const LineItem = z.object({
  id: z.string().regex(/^L\d{3}$/), // assigned by code in order of appearance, not by the LLM
  date: IsoDate,
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  category: Category,
  description_raw: z.string().min(1), // exactly as printed, e.g. "INJ PANTOP 40MG IV"
  quantity: z.number().positive(),
  unit: z.string().optional(), // as printed: "vial", "day", "strip"
  unit_rate: Rupees,
  amount: Rupees, // as printed; the extractor never recomputes it
  printed_mrp: Rupees.optional(), // only if the bill prints an MRP column
  source_page: z.number().int().positive().optional(),
});
export type LineItem = z.infer<typeof LineItem>;

export const BillExtraction = z.object({
  hospital_name: z.string(),
  patient_alias: z.string(), // synthetic name or "Patient"
  admission_date: IsoDate,
  discharge_date: IsoDate,
  items: z.array(LineItem).min(1),
  stated_subtotal: Rupees.optional(),
  stated_discount: Rupees.optional(),
  stated_total: Rupees, // as printed
  currency: z.literal("INR"),
  extraction_notes: z.array(z.string()).default([]),
  // Phase 3 (additive): what the extractor could NOT read, so the rule engine can skip checks it cannot
  // run honestly instead of guessing. Absent on the synthetic truth files (they are complete).
  extraction_quality: z
    .object({
      excluded_lines: z.array(z.object({ position: z.number().int().positive(), description: z.string(), reason: z.string() })).default([]),
      stated_total_printed: z.boolean().default(true),
      rates_not_printed: z.array(z.string()).default([]), // line ids whose unit_rate code derived as amount / quantity
      dates_not_printed: z.array(z.string()).default([]), // line ids with no printed date (admission date used for grouping)
    })
    .optional(),
});
export type BillExtraction = z.infer<typeof BillExtraction>;

export const DischargeSummary = z.object({
  primary_diagnosis: z.string(),
  secondary_diagnoses: z.array(z.string()).default([]),
  procedures_performed: z
    .array(z.object({ name: z.string(), date: IsoDate.optional() }))
    .default([]),
  admission_date: IsoDate,
  discharge_date: IsoDate,
  ward_class: z.string().optional(),
  icu_days: z.number().int().nonnegative(), // 0 if no ICU stay documented
  ventilator_days: z.number().int().nonnegative().default(0),
  investigations_documented: z.array(z.string()).default([]),
  medications_documented: z.array(z.string()).default([]),
  blood_products_documented: z.array(z.string()).default([]),
  physio_documented: z.boolean().default(false),
  complications: z.array(z.string()).default([]),
  free_text_summary: z.string(),
});
export type DischargeSummary = z.infer<typeof DischargeSummary>;

// ---------- (2) Normalization output ----------
export const NormalizedItem = z.object({
  line_item_id: z.string(),
  canonical_id: z.string().nullable(), // key in drug_reference.json, or null
  canonical_name: z.string().nullable(),
  billed_unit: z
    .enum(["tablet", "capsule", "ml", "vial", "ampoule", "bag", "syringe", "sachet", "other"])
    .nullable(),
  units_per_billed_unit: z.number().positive().nullable(), // "per strip of 10" -> 10
  billed_brand: z.string().nullable(), // brand as printed ("Azikaa"), or null; code compares it to brand_examples
  match_confidence: z.enum(["high", "medium", "low"]),
  rationale: z.string().max(200),
});
export type NormalizedItem = z.infer<typeof NormalizedItem>;
export const NormalizationResult = z.object({ items: z.array(NormalizedItem) });
export type NormalizationResult = z.infer<typeof NormalizationResult>;

// ---------- (3) Reference drug table ----------
export const DrugRow = z.object({
  canonical_id: z.string(),
  generic_name: z.string(),
  brand_examples: z.array(z.string()),
  aliases: z.array(z.string()),
  form: z.enum(["tablet", "capsule", "injection", "infusion", "syrup"]),
  strength: z.string(),
  route: z.string(),
  table_unit: z.enum(["tablet", "capsule", "ml", "vial", "ampoule", "bag", "syringe", "sachet"]),
  pack_size: z.number().positive().nullable(), // null until verified
  allowed_pack_sizes: z.array(z.number().positive()),
  mrp_per_pack: z.number().positive().nullable(), // null until verified
  ceiling_price_per_unit: z.number().positive().nullable(), // NPPA ceiling per unit, ex-GST
  gst_pct: z.number().min(0).max(100).nullable(), // needed to compare ceiling with MRP
  ceiling_source_ref: z.string().nullable(),
  nlem_scheduled: z.boolean().nullable(), // null = not yet checked
  mrp_source: z.string().nullable(),
  source_retrieved_on: IsoDate.nullable(),
  verified: z.boolean(),
  notes: z.string(),
  gst_source_ref: z.string().nullable().optional(), // where gst_pct came from
  gst_source_note: z.string().nullable().optional(),
});
export type DrugRow = z.infer<typeof DrugRow>;
export const DrugTable = z.object({
  table_version: z.string(),
  curated_on: IsoDate,
  disclaimer: z.string(),
  rows: z.array(DrugRow),
});
export type DrugTable = z.infer<typeof DrugTable>;
// mrp_per_unit is derived (mrp_per_pack / pack_size) by code, never stored by hand.
export const mrpPerUnit = (r: DrugRow): number | null =>
  r.mrp_per_pack != null && r.pack_size ? Math.round((r.mrp_per_pack / r.pack_size) * 10000) / 10000 : null;

/** D2 price limit per unit: min(MRP, ceiling incl. GST). Ceiling term only if the row has one. */
const round4 = (n: number) => Math.round(n * 10000) / 10000;
/** Strictly-greater test against limit × (1 + tol). Both sides are rounded to 6dp so binary float error
 *  (e.g. 10 × 1.005 = 10.049999999999999) cannot flag a rate sitting exactly on the tolerance boundary. */
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const exceedsLimit = (rate: number, limit: number, tol: number) => round6(rate) > round6(limit * (1 + tol));
const sameBrand = (a: string, b: string) => a.replace(/[^a-z0-9]/gi, "").toLowerCase() === b.replace(/[^a-z0-9]/gi, "").toLowerCase();

/**
 * D2-P1 assessment for one billed drug line (pure code, no LLM). Rules (SPEC 2, D2):
 * - Units: rate and quantity must already be in the row's table_unit (units_consistent); otherwise no
 *   comparison is made and the caller logs the line in skipped_checks.
 * - G1: a bill-printed MRP, when present, is the MRP input; otherwise the table's reference-brand MRP.
 * - G2: a reference-brand MRP supports Provable only if the billed brand matches the row's brand_examples.
 * - Ceiling: only for a scheduled row (nlem_scheduled === true) with a ceiling and GST. It applies to every
 *   brand, so it is evaluated independently of the MRP basis.
 * - G3: a finding that uses a verified:false row is capped at Ask, whatever the basis (printed MRP included).
 * Stake is measured against the lowest exceeded limit among the bases that set the tier.
 */
export type PriceBasis = "printed_mrp" | "reference_mrp" | "ceiling_incl_gst";
export function assessDrugPrice(
  r: DrugRow,
  line: { unit_rate: number; qty_units: number; units_consistent: boolean; printed_mrp?: number; billed_brand?: string | null },
  priceTol = 0.005,
) {
  if (!line.units_consistent) return null; // never compare across units; caller records a skipped check
  const brand_match = !!line.billed_brand && r.brand_examples.some((b) => sameBrand(b, line.billed_brand!));
  const bases: { basis: PriceBasis; limit: number; supports_provable: boolean }[] = [];
  const refMrp = mrpPerUnit(r);
  if (line.printed_mrp != null) bases.push({ basis: "printed_mrp", limit: line.printed_mrp, supports_provable: r.verified });
  else if (refMrp != null) bases.push({ basis: "reference_mrp", limit: refMrp, supports_provable: r.verified && brand_match });
  if (r.nlem_scheduled === true && r.ceiling_price_per_unit != null && r.gst_pct != null)
    bases.push({ basis: "ceiling_incl_gst", limit: round4(r.ceiling_price_per_unit * (1 + r.gst_pct / 100)), supports_provable: r.verified });
  const exceeded = bases.filter((b) => exceedsLimit(line.unit_rate, b.limit, priceTol));
  if (exceeded.length === 0) return null; // at or below every applicable limit: no finding
  const provable = exceeded.filter((b) => b.supports_provable);
  const deciding = provable.length > 0 ? provable : exceeded;
  const binding = deciding.reduce((a, b) => (b.limit < a.limit ? b : a));
  return {
    tier: (provable.length > 0 ? "Provable" : "Ask") as Tier,
    binding_basis: binding.basis,
    limit_per_unit: binding.limit,
    amount_at_stake: Math.round((line.unit_rate - binding.limit) * line.qty_units * 100) / 100,
    reference_verified: r.verified,
    brand_match,
    bases_exceeded: exceeded.map((b) => b.basis),
  };
}

export const priceLimitPerUnit = (r: DrugRow, mrpOverride?: number): number | null => {
  const mrp = mrpOverride ?? mrpPerUnit(r);
  if (mrp == null) return null;
  if (r.ceiling_price_per_unit == null || r.gst_pct == null) return mrp;
  return Math.min(mrp, Math.round(r.ceiling_price_per_unit * (1 + r.gst_pct / 100) * 10000) / 10000);
};

// ---------- (4) Clinical (D3) candidates ----------
export const ClinicalCandidate = z.object({
  kind: z.enum(["ICU_DAYS_EXCEED", "NOT_IN_SUMMARY"]),
  line_item_ids: z.array(z.string()).min(1),
  summary_evidence: z.string().max(300),
  reasoning: z.string().max(400),
  confidence: z.enum(["high", "medium", "low"]),
});
export const ClinicalResult = z.object({ candidates: z.array(ClinicalCandidate) });

// ---------- (5) Findings ----------
export const FindingType = z.enum([
  "ARITH_LINE", "ARITH_TOTAL",
  "DUPLICATE_EXACT", "DUPLICATE_ONE_TIME", "ROOM_DAYS_EXCEED_STAY",
  "DRUG_ABOVE_LIMIT", // D2: one merged finding per item, cites MRP and ceiling
  "MISMATCH_ICU_DAYS", "MISMATCH_NOT_IN_SUMMARY",
]);
export const Tier = z.enum(["Provable", "Contractual", "Ask"]); // Contractual reserved, never emitted
export type Tier = z.infer<typeof Tier>;

export const DebateStep = z.object({
  role: z.enum(["auditor", "defender", "judge"]),
  prompt_version: z.string(),
  model: z.string(),
  cache_key: z.string(),
  output: z.unknown(),
});

export const Finding = z.object({
  id: z.string().regex(/^F-\d{3}$/),
  type: FindingType,
  detector: z.enum(["D1_ARITH_DUP", "D2_DRUG_PRICE", "D3_BILL_VS_SUMMARY"]),
  line_item_ids: z.array(z.string()),
  amount_at_stake: Rupees, // COMPUTED BY CODE ONLY
  rule_or_source_cited: z.object({
    rule_id: z.string(),
    description: z.string(),
    source: z.string(),
    benchmark_label: z.string().optional(),
  }),
  initial_tier: Tier,
  tier: Tier, // final; never higher than initial_tier
  confidence: z.enum(["high", "medium", "low"]),
  evidence: z.record(z.union([z.string(), z.number(), z.boolean()])), // incl. reference_verified for D2
  allowed_tokens: z.array(z.string()), // number guard: the only numbers the LLM may quote
  auditor_argument: z.string(),
  defender_rebuttal: z.object({
    strongest_justification: z.string(),
    supporting_points: z.array(z.string()),
    verifiable_from_documents: z.boolean(),
    what_would_confirm: z.string(),
  }),
  judge_decision: z.object({
    decision: z.enum(["keep", "downgrade_to_ask", "drop"]),
    rationale: z.string(),
  }),
  counter_argument: z.string(),
  question_for_billing_desk: z.string(),
  status: z.enum(["kept", "downgraded", "dropped"]),
  debate_log: z.array(DebateStep),
  // Phase 4 (additive): whether the Auditor/Defender/Judge debate actually ran. A finding that could not be
  // debated (budget, provider failure) keeps its rule tier and is shown as "not cross-examined", never hidden.
  review: z.object({ state: z.enum(["debated", "not_debated"]), note: z.string() }).optional(),
  // Code-side corrections applied to the Judge's decision (e.g. a Provable finding dropped without basis_error).
  enforcement_notes: z.array(z.string()).optional(),
});
export type Finding = z.infer<typeof Finding>;

/** What detectors emit before the debate fills in the argument fields. */
export type CandidateFinding = Pick<
  Finding,
  "type" | "detector" | "line_item_ids" | "amount_at_stake" | "rule_or_source_cited" |
  "initial_tier" | "confidence" | "evidence" | "allowed_tokens"
>;

// ---------- (6) Pipeline result ----------
export const PipelineResult = z.object({
  run_id: z.string(),
  data_label: z.enum(["Synthetic data", "User upload"]),
  bill: BillExtraction,
  summary: DischargeSummary,
  normalization: NormalizationResult,
  skipped_checks: z.array(z.object({ line_item_id: z.string(), reason: z.string() })),
  findings: z.array(Finding), // all, including dropped (needed for the eval table)
  totals: z.object({
    provable: Rupees,
    ask: Rupees,
    questionable_total: Rupees, // de-duplicated, see SPEC totals rule
    dropped_count: z.number().int(),
  }),
  disclaimer: z.string(),
  versions: z.object({ spec: z.string(), prompts: z.record(z.string()), table: z.string() }),
  // Phase 4/5 (additive): plain-language notes about anything that limited this audit.
  warnings: z.array(z.string()).optional(),
  clinical_check: z.object({ state: z.enum(["done", "failed"]), note: z.string() }).optional(),
});
export type PipelineResult = z.infer<typeof PipelineResult>;

// ---------- (6) Synthetic fixtures (seed manifests; answer keys are generated from these) ----------
// A seed is a genuine billing error the pipeline should keep; a trap is a candidate the Judge must drop
// because the documents explain it; a decoy is a legitimate line that must not become a finding at all.
// amount_formula names the code path in scripts/make-answer-keys.ts.
export const AmountFormula = z.enum([
  "line_arithmetic_excess", "total_mismatch", "price_limit_excess", "duplicate_line_amount",
  "repeat_admin_amount", "room_excess_days", "icu_excess_vs_summary", "line_amount_sum",
]);
const SeedBase = z.object({
  type: FindingType,
  detector: z.enum(["D1_ARITH_DUP", "D2_DRUG_PRICE", "D3_BILL_VS_SUMMARY"]),
  rule_id: z.string(),
  line_item_ids: z.array(z.string()),
  amount_formula: AmountFormula,
  canonical_id: z.string().optional(),
  billed_brand: z.string().optional(), // what normalization should report for D2 lines
  duplicate_copy_id: z.string().optional(),
  repeat_line_id: z.string().optional(),
  description: z.string().optional(),
});
export const Seed = SeedBase.extend({
  seed_id: z.string(),
  expected_initial_tier: Tier,
  expected_decision: z.literal("keep"),
  must_survive_rebuttal: z.boolean(),
  // Judge outcomes that still count as correct. Default: keep only. S2-5 also allows downgrade/drop on evidence.
  acceptable_decisions: z.array(z.enum(["keep", "downgrade_to_ask", "drop"])).default(["keep"]),
});
export const Trap = SeedBase.extend({
  trap_id: z.string(),
  expected_decision: z.literal("drop"),
  why_legit: z.string(),
});
export const Decoy = z.object({
  decoy_id: z.string(),
  guards_rule: z.enum(["D1-A3", "D1-A4", "D1-A5", "D2-P1", "D3-M1", "D3-M2"]), // rule it must not trigger
  line_item_ids: z.array(z.string()).min(1),
  canonical_id: z.string().optional(),
  billed_brand: z.string().optional(),
  why_legit: z.string(),
});
export const SeedManifest = z.object({
  bill_id: z.string(),
  seeded: z.array(Seed),
  traps: z.array(Trap),
  decoys: z.array(Decoy),
});
export type SeedManifest = z.infer<typeof SeedManifest>;
