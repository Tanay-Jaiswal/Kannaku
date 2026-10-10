# KANAKKU — SPEC.md (Phase 0, v0.3: v0.2 + approved addendum decisions + final-review fixes)

Adversarial AI hospital-bill auditor for Indian patients. **All demo data is synthetic and labeled "Synthetic data".**
Anything marked **VERIFY** is a fact I could not confirm from here; section 9 lists how to check each one.

---

## 0. Decisions I made that you should confirm (read this first)

1. **Tier conflict.** Your rule 7 says only "price above MRP or ceiling" is Provable; strategy.md also lists arithmetic errors and duplicates as Provable. My default: **Provable = MRP/ceiling violations + pure arithmetic errors** (the bill contradicts itself or a printed number). **Duplicates and bed-day counts are Ask**, because a repeat line can be legitimate (two doses). Say if you want it stricter.
2. **Contractual tier is reserved, never emitted** in this build (its only source was package overlap, which is OUT). It stays in the enum so the schema doesn't change later.
3. **Extra Finding fields** beyond your list: `detector`, `initial_tier`, `evidence`, `question_for_billing_desk`, `status`, `debate_log`. All additive; your 11 fields are all present.
4. **Number guard (v0.3, approved)**: every LLM output is schema-validated, and its text is scanned for **rupee amounts and percentages only**; each one must match a code-supplied value in the finding's `allowed_tokens` or validation fails (retry once, then error). Dates, line-item IDs, counts, quantities and day/night counts are allowed. All financial calculation stays deterministic in code; the LLM never originates or computes a rupee figure.
5. **Cache in git**: Vercel's filesystem is read-only at runtime, so `/cache` is committed. Writes happen only locally.
6. **Model names are not hardcoded**: env vars `MODEL_EXTRACT` (cheap, vision) and `MODEL_REASON` (strong). Confirm the exact ids in the Anthropic Console before API integration (**VERIFY**: the bundle addendum and this environment disagree on whether `claude-sonnet-5-5` exists). Local development continues without waiting.
7. **Cache vs live (v0.3, approved)**: the three built-in sample bills (`SAMPLE_BILL_IDS`) run **cache-only**, always. Uploaded documents may call the live API, under a strict spend cap (env, set before deploy), with graceful failure: a clear error message, never an invented or fallback result. Never claim network-free behaviour for an uncached upload.
8. **Reference data gate (v0.3, approved)**: a drug row is `verified: true` only with source evidence for MRP, pack, source, date, scheduled status and GST. Passing the ceiling sanity check alone never verifies a row. Unverified rows are labeled exactly "Illustrative reference value for demo, not official." (`UNVERIFIED_REFERENCE_LABEL`), and every finding, README line and letter that depends on one shows that label. While ≥4 rows are verified, seeds use verified rows only. **Any D2 finding on a `verified: false` row is capped at Ask, including one above a bill-printed MRP,** and carry `reference_verified: false` in `evidence` (see D2).

---

## 1. Schemas (`src/lib/schemas.ts`, zod)

```ts
import { z } from "zod";

const Rupees = z.number().nonnegative().multipleOf(0.01);       // computed/stored in rupees, 2dp
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const Category = z.enum([
  "room","icu","nursing","consultation","procedure","surgery","anaesthesia","ot",
  "drug","consumable","investigation","radiology","physio","blood","admin","other",
]);

// ---------- (1) Extraction output ----------
export const LineItem = z.object({
  id: z.string().regex(/^L\d{3}$/),          // assigned by code in order of appearance, not by the LLM
  date: IsoDate,
  time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  category: Category,
  description_raw: z.string().min(1),        // exactly as printed, e.g. "INJ PANTOP 40MG IV"
  quantity: z.number().positive(),
  unit: z.string().optional(),               // as printed: "vial", "day", "strip"
  unit_rate: Rupees,
  amount: Rupees,                            // as printed (never recomputed by the extractor)
  printed_mrp: Rupees.optional(),            // only if the bill prints an MRP column
  source_page: z.number().int().positive().optional(),
});
export type LineItem = z.infer<typeof LineItem>;

export const BillExtraction = z.object({
  hospital_name: z.string(),
  patient_alias: z.string(),                 // synthetic name or "Patient"; never real PII in demo
  admission_date: IsoDate,
  discharge_date: IsoDate,
  items: z.array(LineItem).min(1),
  stated_subtotal: Rupees.optional(),
  stated_discount: Rupees.optional(),
  stated_total: Rupees,                      // as printed
  currency: z.literal("INR"),
  extraction_notes: z.array(z.string()).default([]),   // e.g. "page 2 row 7 illegible"
});
export type BillExtraction = z.infer<typeof BillExtraction>;

export const DischargeSummary = z.object({
  primary_diagnosis: z.string(),
  secondary_diagnoses: z.array(z.string()).default([]),
  procedures_performed: z.array(z.object({ name: z.string(), date: IsoDate.optional() })).default([]),
  admission_date: IsoDate,
  discharge_date: IsoDate,
  ward_class: z.string().optional(),                    // "general", "semi-private", "private"
  icu_days: z.number().int().nonnegative(),             // 0 if no ICU stay documented
  ventilator_days: z.number().int().nonnegative().default(0),
  investigations_documented: z.array(z.string()).default([]),
  medications_documented: z.array(z.string()).default([]),  // inpatient + discharge, names only
  blood_products_documented: z.array(z.string()).default([]),
  physio_documented: z.boolean().default(false),
  complications: z.array(z.string()).default([]),
  free_text_summary: z.string(),                        // condensed hospital course
});
export type DischargeSummary = z.infer<typeof DischargeSummary>;

// ---------- (2) Normalization output (LLM maps names; code validates against table) ----------
export const NormalizedItem = z.object({
  line_item_id: z.string(),
  canonical_id: z.string().nullable(),       // key in drug_reference.json, or null if no match
  canonical_name: z.string().nullable(),
  billed_unit: z.enum(["tablet","capsule","ml","vial","ampoule","bag","sachet","other"]).nullable(),
  units_per_billed_unit: z.number().positive().nullable(), // e.g. bill says "per strip of 10" -> 10
  billed_brand: z.string().nullable(),       // brand as printed ("Azikaa"), or null; code compares it to brand_examples
  match_confidence: z.enum(["high","medium","low"]),
  rationale: z.string().max(200),
});
export const NormalizationResult = z.object({ items: z.array(NormalizedItem) });
// Code rule: price checks run ONLY if canonical_id exists in the table AND confidence != "low"
// AND units_per_billed_unit is consistent with the table's pack_size/unit. Otherwise skip + log (never guess).

// ---------- (3) Findings ----------
export const FindingType = z.enum([
  "ARITH_LINE","ARITH_TOTAL",
  "DUPLICATE_EXACT","DUPLICATE_ONE_TIME","ROOM_DAYS_EXCEED_STAY",
  "DRUG_ABOVE_LIMIT",                      // D2: one merged finding per item (v0.2)
  "MISMATCH_ICU_DAYS","MISMATCH_NOT_IN_SUMMARY",
]);
export const Tier = z.enum(["Provable","Contractual","Ask"]);   // Contractual reserved, not emitted

export const DebateStep = z.object({
  role: z.enum(["auditor","defender","judge"]),
  prompt_version: z.string(),                // e.g. "defender.v1"
  model: z.string(),
  cache_key: z.string(),
  output: z.unknown(),                       // validated against the role's schema before storing
});

export const Finding = z.object({
  id: z.string().regex(/^F-\d{3}$/),
  type: FindingType,
  detector: z.enum(["D1_ARITH_DUP","D2_DRUG_PRICE","D3_BILL_VS_SUMMARY"]),
  line_item_ids: z.array(z.string()),        // empty allowed (e.g. ARITH_TOTAL)
  amount_at_stake: Rupees,                   // COMPUTED BY CODE ONLY
  rule_or_source_cited: z.object({
    rule_id: z.string(),                     // e.g. "D2-P1"
    description: z.string(),                 // plain English, tone-linted
    source: z.string(),                      // e.g. "Reference table row paracetamol_650_tab, mrp_per_unit"
    benchmark_label: z.string().optional(),  // "printed MRP" | "printed MRP and NPPA ceiling price (VERIFY)" | "reference benchmark"
  }),
  initial_tier: Tier,                        // from detector rule
  tier: Tier,                                // final, after Judge (never higher than initial_tier)
  confidence: z.enum(["high","medium","low"]),
  evidence: z.record(z.union([z.string(), z.number(), z.boolean()])),  // code-made facts, formatted ("₹1,200.00"); D2 adds reference_verified
  allowed_tokens: z.array(z.string()),       // numbers the LLM may quote verbatim (number guard)
  auditor_argument: z.string(),
  defender_rebuttal: z.object({
    strongest_justification: z.string(),
    supporting_points: z.array(z.string()),
    verifiable_from_documents: z.boolean(),
    what_would_confirm: z.string(),
  }),
  judge_decision: z.object({
    decision: z.enum(["keep","downgrade_to_ask","drop"]),
    rationale: z.string(),
  }),
  counter_argument: z.string(),              // shown in "Our counter" column and in the letter
  question_for_billing_desk: z.string(),
  status: z.enum(["kept","downgraded","dropped"]),
  debate_log: z.array(DebateStep),           // all three steps, always
});
export type Finding = z.infer<typeof Finding>;

// ---------- (4) Pipeline result ----------
export const PipelineResult = z.object({
  run_id: z.string(),
  data_label: z.enum(["Synthetic data","User upload"]),
  bill: BillExtraction,
  summary: DischargeSummary,
  normalization: NormalizationResult,
  skipped_checks: z.array(z.object({ line_item_id: z.string(), reason: z.string() })),
  findings: z.array(Finding),                // ALL findings incl. dropped (needed for the eval table)
  totals: z.object({
    provable: Rupees,                        // kept, tier Provable
    ask: Rupees,                             // kept/downgraded, tier Ask
    questionable_total: Rupees,              // provable + ask, de-duplicated (rule below)
    dropped_count: z.number().int(),
  }),
  disclaimer: z.string(),
  versions: z.object({ spec: z.string(), prompts: z.record(z.string()), table: z.string() }),
});
```

**Totals rule (no double counting):** sort kept findings by tier (Provable first) then `amount_at_stake` desc. Count a finding only if none of its `line_item_ids` overlaps a finding already counted. Overlapping findings still display, marked "overlaps F-00x". This understates rather than overstates. Findings with empty `line_item_ids` never overlap.

**Disclaimer (fixed string, shown in UI + PDF):** "Kanakku is an informational tool, not legal, medical or insurance advice. Items listed are charges to question and confirm with the billing desk. Reference benchmarks are not legal limits. Demo data is synthetic."

---

## 2. Detector rules

Shared constants (`src/lib/config.ts`): `ROUNDING_TOL = ₹1.00` (line and total math), `PRICE_TOL = 0.5%` (rate comparisons, absorbs rounding of per-unit conversion). All amounts rounded to 2dp by code.

### D1 — Arithmetic & duplicates (no LLM except the debate)

| Rule | Condition | amount_at_stake | Tier |
|---|---|---|---|
| **D1-A1** line math | `abs(qty × unit_rate − amount) > ROUNDING_TOL` AND `amount > qty × unit_rate` (only overcharges) | `amount − qty × unit_rate` | Provable |
| **D1-A2** total math | `sum(items.amount) − stated_discount(0 if none) ≠ stated_total` by more than tol AND `stated_total` is higher | `stated_total − (sum − discount)` | Provable |
| **D1-A3** exact duplicate | ≥2 items with same `canonical_id` (or same lower-cased trimmed `description_raw` if unmatched), same `date`, same `time` (or both missing), same `quantity`, same `unit_rate` | `amount` of every copy after the first | Ask |
| **D1-A4** same one-time fee repeated | ≥2 lines fall in the **same** one-time fee class (`ONE_TIME_FEE_CLASSES` in config: admission/registration, discharge processing, file/record processing) and are not exact duplicates (those are A3). Two *different* admin fees never fire | `amount` of every copy after the first | Ask |
| **D1-A5** bed-days exceed stay | category `room` only, `quantity > allowed_days` where `allowed_days = nights + ROOM_DAY_ALLOWANCE (1)` and `nights` = days between `admission_date` and `discharge_date` | `(quantity − allowed_days) × unit_rate` | Ask |

Notes: A5 allows `nights + 1` for room (some hospitals count the admission and discharge day); if quantity exceeds even that, it's raised. **ICU days are never checked here (v0.3)**; they belong to D3-M1, which compares against the summary's documented `icu_days`. The Defender will usually argue "day-of-admission counting convention"; that's the intended debate. A3 is Ask, never Provable, since repeated doses are normal; the time field separates same-time duplicates from repeat doses.

### D2 — Drug price vs MRP / ceiling price (table lookup only)

Precondition: item has `NormalizedItem` with `canonical_id` in the table, `match_confidence != "low"`, unit conversion consistent with table. Per-unit billed rate: `billed_unit_rate = unit_rate / units_per_billed_unit`. Billed quantity in table units: `qty_units = quantity × units_per_billed_unit`.

| Rule | Condition | amount_at_stake | Tier |
|---|---|---|---|
| **D2-P1** above price limit | `billed_unit_rate > basis_limit × (1 + PRICE_TOL)` for at least one applicable basis (below) | `(billed_unit_rate − binding_limit) × qty_units` | Provable or Ask (below) |
| **D2-P3** (log only, no finding) | Bill prints `printed_mrp` and it differs from the table's `mrp_per_unit` by >5% | log in `skipped_checks` for review; the printed MRP is used either way (G1) | — |

Implemented by `assessDrugPrice()` in `schemas.ts`; unit-tested in `tests/drug-price.test.ts`. Rates and quantities must already be in the row's `table_unit` (`units_consistent`); otherwise nothing is compared and the line goes to `skipped_checks`. **Bases:**

| Basis | Limit per unit | Supports Provable when |
|---|---|---|
| `printed_mrp` (G1) | the MRP printed on the bill line. **Always** used when present, in place of the reference MRP | the row is verified (G3: an unverified row never establishes Provable, even with a printed MRP) |
| `reference_mrp` | `mrp_per_pack / pack_size` of the table row; used only if the bill prints no MRP | the billed brand (`NormalizedItem.billed_brand`) matches the row's `brand_examples` **and** the row is verified (G2, G3) |
| `ceiling_incl_gst` | `ceiling_price_per_unit × (1 + gst_pct/100)`, only if the row is scheduled (`nlem_scheduled: true`) and has a ceiling and GST | the row is verified (G3). Applies to every brand, so it is evaluated independently of the MRP basis and brand (G2) |

**Tier and stake:** if any exceeded basis supports Provable, the finding is Provable and the stake uses the lowest exceeded limit *among those bases*; otherwise it is Ask and the stake uses the lowest exceeded limit overall (worded as a reference benchmark, "confirm with billing desk"). So a reference-brand MRP mismatch on a different brand is never called Provable, while an independently supported ceiling violation stays Provable, staked against the ceiling. `evidence` always records `reference_verified`, `brand_match`, the binding basis and every exceeded basis.

**One merged finding per item** (type `DRUG_ABOVE_LIMIT`, rule `D2-P1`). `rule_or_source_cited` cites every exceeded basis (MRP and ceiling price incl. GST), says which one is binding, and `evidence` holds the formatted values. A separate "ceiling" finding is never emitted, so one over-billed item cannot be counted twice.

**Why the ceiling term exists even though MRP is usually lower:** NPPA ceiling prices are per unit and **exclude GST**; a brand's MRP is ceiling plus taxes, and brands may price *below* ceiling. So for a healthy row `mrp_per_unit <= ceiling_price_per_unit × (1 + gst_pct/100)`, and MRP is normally the binding term. The ceiling term only binds if the table's MRP exceeds it, which is a **data red flag** (`scripts/validate-table.ts` fails the table on this) rather than a billing finding. It stays in the formula so the finding can cite the regulatory benchmark and so a mis-curated MRP can't raise the limit above the ceiling.

Ceiling rows carry `ceiling_source_ref`. Any finding whose limit comes from a `verified: false` row shows exactly "Illustrative reference value for demo, not official." (`UNVERIFIED_REFERENCE_LABEL`). Confidence: `high` if `match_confidence=="high"`, else `medium`. Unmatched/low-confidence/unit-inconsistent items → `skipped_checks`, never a finding.

---

### D3 — Bill vs discharge summary (LLM proposes, code prices)

The LLM (`clinical.v1`) receives the bill items (ids, descriptions, categories, dates, qty — **no rupee amounts**) and the `DischargeSummary`, and returns candidates:

```ts
export const ClinicalCandidate = z.object({
  kind: z.enum(["ICU_DAYS_EXCEED","NOT_IN_SUMMARY"]),
  line_item_ids: z.array(z.string()).min(1),
  summary_evidence: z.string().max(300),   // quote or field reference from the summary
  reasoning: z.string().max(400),
  confidence: z.enum(["high","medium","low"]),
});
export const ClinicalResult = z.object({ candidates: z.array(ClinicalCandidate) });
```

| Rule | Code validation | amount_at_stake | Tier |
|---|---|---|---|
| **D3-M1** ICU days | item category `icu`, `quantity > summary.icu_days` (code checks; discard LLM candidate if false) | `(quantity − icu_days) × unit_rate` | Ask |
| **D3-M2** not in summary | every id exists; category ∈ {procedure, surgery, investigation, radiology, blood, physio}; LLM confidence ≠ low | `sum(amount)` of cited items | Ask |

D3 never produces Provable. The LLM may not cite items outside the bill or invent ids (code discards). Cap: max 6 D3 candidates per run (keeps debate cost and demo time bounded).

---

## 3. Synthetic data format

Directory per bill. The truth JSONs are the source of truth; answer keys are generated from them:

```
data/synthetic/bill-01-clean/
  bill.truth.json         # BillExtraction (ground truth, what a perfect extractor returns)
  summary.truth.json      # DischargeSummary
  bill.html               # print-ready bill; open in a browser and Print > Save as PDF if a PDF is needed
  summary.html            # print-ready discharge summary
  seed_manifest.json      # SeedManifest (schemas.ts): seeded errors, traps and decoys
  answer_key.json         # GENERATED by scripts/make-answer-keys.ts, never hand-edited
```
Every HTML page and truth file carries the "Synthetic data" label. `scripts/make-answer-keys.ts` computes every expected stake from truth + manifest + reference table (D2 uses the same `assessDrugPrice()` as the detector, and its tier must equal `expected_initial_tier`). `scripts/render-bill-html.ts` re-renders each bill's line table and totals from the truth JSON. `scripts/check-fixtures.ts` re-derives the answer keys and the bill HTML and fails if either is stale, plus schema, ID, total, label, tone, reference-gate and decoy checks. Phase 1 test: extract the printed bill, diff against `bill.truth.json`. Drug seeds are defined **relative to the table** (e.g. "1.25 × MRP"), so no invented prices.

**Seeds, traps and decoys.** A *seed* is a genuine billing error that should be kept (`acceptable_decisions` defaults to `["keep"]`). A *trap* is a candidate the rule engine or clinical check should raise, but the Judge should **drop** because the documents themselves explain it. A *decoy* is a legitimate line that must not become a candidate at all; each names the rule it guards, and `check-fixtures.ts` proves the code rules (A3, A4, A5, P1, M1) do not fire on it. M2 decoys depend on the clinical LLM, so only their documentary support is checked. Evaluation always reports **candidates, kept and dropped separately**; the candidate count is never presented as the final number of findings.

```ts
// answer_key.json (abridged)
{
  "bill_id": "bill-02", "data_label": "Synthetic data", "table_version": "...",
  "sum_of_printed_line_amounts": 0, "stated_total": 0, "total_gap": 0,
  "seeded": [{ "seed_id": "S2-3", "type": "DRUG_ABOVE_LIMIT", "rule_id": "D2-P1", "line_item_ids": ["L014"],
               "canonical_id": "ceftriaxone_1g_inj", "expected_initial_tier": "Provable",
               "expected_decision": "keep", "must_survive_rebuttal": true, "expected_amount_at_stake": 0 }],
  "traps":  [{ "trap_id": "T2-ICU-HDU-STEPDOWN", "rule_id": "D3-M1", "line_item_ids": ["L002"],
               "expected_decision": "drop", "why_legit": "...", "expected_amount_at_stake": 0 }],
  "decoys": [{ "decoy_id": "DC2-3", "guards_rule": "D2-P1", "line_item_ids": ["L015"], "why_legit": "..." }],
  "evaluation_targets": { "expected_candidate_count": 7, "expected_kept_count": 6, "expected_dropped_count": 1,
                          "must_survive_count": 5, "seeds_that_may_be_dropped": ["S2-5"], "decoy_count": 4, "expected_decoy_candidates": 0 }
}
```

### Bill 01 — clean (≈ ₹1.1–1.3 lakh target; laparoscopic cholecystectomy, 3 nights, no ICU)
Seeded errors: **none**. Trap: **T1-ROOM-DELAYED-DISCHARGE** (D1-A5): room billed `nights + 2`; the free-text summary documents a delayed physical departure and one extra overnight, so the Judge drops it. Decoys: **DC1-1** two ceftriaxone doses, same day, 08:00 and 20:00 (A3); **DC1-2** azithromycin billed exactly at MRP (P1 boundary); **DC1-3** OT + anaesthesia for the documented procedure (M2). The v0.2 room `nights + 1` boundary decoy moved to Bill 02 (DC2-4), since Bill 01's room line is now trap T1.
Expected: 1 candidate, 0 kept, 1 dropped.

### Bill 02 — demo bill (≈ ₹3.4 lakh target; pneumonia with sepsis, 7 nights, 2 ICU days documented)
| Seed | Rule | What is wrong | Expected tier |
|---|---|---|---|
| **S2-1** | D1-A1 | ICU nursing line: `qty × rate` ≠ printed amount (amount inflated by a fixed ₹1,500) | Provable |
| **S2-2** | D2-P1 | Azithromycin 500 (verified, scheduled) billed at nominally 1.25 × table MRP/unit, rounded to cents; above printed MRP, below the GST-inclusive ceiling | Provable |
| **S2-3** | D2-P1 | Ceftriaxone 1 g (verified, scheduled) billed at nominally 1.40 × its ex-GST ceiling, rounded to cents; also above MRP. **One merged finding**, citing both | Provable |
| **S2-4** | D1-A3 | IV fluid line entered twice, identical date/time/qty/rate | Ask |
| **S2-5** | D1-A4 | The same admission and registration fee billed on 08-10 (L018) and again on 08-11 (L019). Not `must_survive`: the Judge may downgrade or drop it if the documents show a legitimate second admission | Ask |
| **S2-7** | D3-M2 | Echocardiography billed; summary lists no echo or cardiac indication | Ask |

Trap: **T2-ICU-HDU-STEPDOWN** (D3-M1, was seed S2-6 in v0.2): the critical-care line bills 4 days and the structured summary says `icu_days = 2`, but the free text explains 2 ICU + 2 HDU/step-down days grouped under one billing code, so the Judge drops it. Expected: 7 candidates, 6 kept, 1 dropped.

Decoys: **DC2-1** ventilator charges for 2 days (documented `ventilator_days = 2`, M2); **DC2-2** two same-day ceftriaxone doses at 08:00 and 20:00, each exactly at MRP (A3, new lines L039–L040); **DC2-3** pantoprazole exactly at MRP (P1 boundary); **DC2-4** room billed `nights + 1` = 8 days (A5 boundary).

### Bill 03 — second error set (≈ ₹1.8–2.2 lakh target; femur fracture fixation, 5 nights, no ICU)
| Seed | Rule | What is wrong | Expected tier |
|---|---|---|---|
| **S3-1** | D1-A2 | `stated_total` exceeds item sum by ₹2,400 | Provable |
| **S3-2** | D2-P1 | Amoxicillin + clavulanate 625 (verified), qty 30, billed at nominally 1.18 × MRP/unit (above printed MRP) | Provable |
| **S3-3** | D1-A5 | Room billed `nights + 2` days | Ask |
| **S3-4** | D3-M2 | "Blood transfusion, 2 units" billed; summary documents none | Ask |
| **S3-5** | D3-M2 | "Physiotherapy ×5 sessions" billed; summary `physio_documented=false` | Ask |

Trap: **T3-CXR-IN-FREE-TEXT** (D3-M2): portable chest radiograph is missing from structured investigations but documented in the free text, so the Judge drops it. Decoys: **DC3-1** implant set and locking screws, one line each (A3); **DC3-2** pantoprazole exactly at MRP (P1 boundary, new line L024). Expected: 6 candidates, 5 kept, 1 dropped.

**Totals:** 11 seeded errors (5 Provable, 6 Ask) + 3 traps + 9 decoys. Eval table (README + slide): recall on seeded errors; kept findings on Bill 01 (target 0); traps dropped (target 3); decoys wrongly raised; and **candidates vs kept vs dropped**, reported separately.

---

## 4. Reference drug table (`data/reference/drug_reference.json`, 16 rows; 6 priced in round 1)

Hand-curated, labeled in UI: "Reference table, hand-curated, verify before real use." Header block carries `table_version`, `curated_on`, `disclaimer`.

| Column | Type | Notes |
|---|---|---|
| `canonical_id` | string | stable key, e.g. `pantoprazole_40_inj_vial` |
| `generic_name` | string | |
| `brand_examples` | string[] | for normalization context only |
| `aliases` | string[] | abbreviations seen on bills ("PANTOP", "PAN 40") |
| `form` | enum | tablet, capsule, injection, infusion, syrup |
| `strength` | string | "40 mg" |
| `route` | string | oral / IV / IM |
| `table_unit` | enum | the unit prices are expressed in (tablet, vial, ml, bag) |
| `pack_size` | number | units in a standard pack |
| `allowed_pack_sizes` | number[] | for unit-conversion consistency check |
| `mrp_per_pack` | number | printed MRP (₹) |
| `mrp_per_unit` | number | **derived** = `mrp_per_pack / pack_size` (script computes; not hand-typed) |
| `ceiling_price_per_unit` | number \| null | NPPA ceiling per unit, **ex-GST**; null if not under price control |
| `gst_pct` | number \| null | GST % on this formulation (needed to compare ceiling with MRP); null until checked |
| `ceiling_source_ref` | string \| null | notification/list reference + date |
| `nlem_scheduled` | boolean | whether it is a scheduled (price-controlled) formulation |
| `mrp_source` | string | where the MRP came from (brand pack label, manufacturer site, etc.) |
| `source_retrieved_on` | date | |
| `verified` | boolean | `false` until a human checked the row against its source |
| `notes` | string | |
| `gst_source_ref`, `gst_source_note` | string \| null, optional | where `gst_pct` came from |

Units follow the source: e.g. ondansetron 2 mg/mL is priced **per mL** (`table_unit: "ml"`, pack 2 mL) because its ceiling is notified per mL. `mrp_per_unit` is never stored; `mrpPerUnit()` derives it (4 dp) and only the final stake is rounded to paise.

Validation (`scripts/validate-table.ts`, run in tests): for any row with a ceiling, `mrp_per_unit <= ceiling_price_per_unit × (1 + gst_pct/100)` (+ `PRICE_TOL`); a ceiling requires `gst_pct`; `verified=true` requires MRP, pack size, source, date, `nlem_scheduled` and `gst_pct`. Failing rows are a data error, not a finding.

Rule (v0.3 gate, see 0.8): rows with `verified=false` still work, but findings built on them show "Illustrative reference value for demo, not official." Drug seeds use verified rows only (enforced by `check-fixtures.ts`). Rows outside round 1 stay unpriced and unused.

---

## 5. File and folder structure

```
kanakku/
  SPEC.md   CLAUDE.md   README.md   .env.example   .gitignore
  data/
    reference/drug_reference.json
    synthetic/bill-01-clean/  bill-02-demo/  bill-03-errors/   (files per section 3)
  prompts/
    extract_bill.v1.md  extract_summary.v1.md  normalize.v1.md  clinical.v1.md
    auditor.v1.md  defender.v1.md  judge.v1.md  letter.v1.md
  cache/                                  # committed; <stage>/<sha256>.json
  scripts/
    validate-table.ts  make-answer-keys.ts  render-bill-html.ts  check-fixtures.ts  eval.ts  lint-tone.ts
  src/
    app/
      page.tsx                            # landing: sentence, upload, "Try a sample bill"
      run/[runId]/page.tsx                # processing view + results
      api/extract/route.ts                # bill + summary -> BillExtraction, DischargeSummary
      api/normalize/route.ts
      api/rules/route.ts                  # D1 + D2 (pure code) -> candidate findings
      api/clinical/route.ts               # D3 candidates
      api/debate/route.ts                 # ONE finding per call: auditor -> defender -> judge
      api/finalize/route.ts               # assemble PipelineResult, totals, tone lint
      api/letter/route.ts                 # dispute letter PDF
    lib/
      schemas.ts  config.ts
      llm.ts          # SDK call + zod validation + 1 retry + cache + number guard
      cache.ts        # sha256(prompt_version + model + canonical-JSON(input))
      prompts.ts      # loads /prompts/*.md, returns {text, version}
      detectors/d1.ts  d2.ts  d3.ts
      totals.ts  tone.ts  money.ts
    components/       # Counter, TierGroup, FindingCard, ThreeColumn, PipelineSteps, Disclaimer
  tests/              # vitest: detectors vs answer keys (no network)
```
Dependencies (tell-me-first list): `next`, `react`, `tailwindcss`, `@anthropic-ai/sdk`, `zod`, `pdf-lib`, `vitest` (tests only), `tsx` (scripts only). Nothing else without asking. Vercel request body limit is small (VERIFY, about 4.5 MB), so uploads are downscaled client-side; sample bills load from `/data` and never upload.

**Pipeline/API contract:** UI calls routes in order; each takes and returns JSON validated by zod, so the UI shows live steps: Reading bill (`extract`, `normalize`) → Matching prices (`rules`) → Checking clinical notes (`clinical`) → Cross-examining findings (`debate` × N, parallel, max 3 at a time) → `finalize`.

**LLM wrapper contract (`llm.ts`):** `callJson({stage, promptVersion, model, input, schema})` → cache lookup (miss + `CACHE_ONLY` ⇒ throw) → SDK call asking for JSON only → strip fences → `JSON.parse` → `schema.parse` → number guard + tone lint (for text-bearing stages) → on any failure, retry once with the validation error appended → second failure throws `KanakkuLLMError(stage, reason, raw)`. Only validated outputs are cached.

---

## 6. Prompt designs

All prompts: versioned file in `/prompts`, with `{{placeholders}}` filled by code; system text includes the **tone rules** (no banned words; "charge to question", "confirm with billing desk"; benchmarks are not legal limits) and the **number rule** ("Quote figures only from FACTS, verbatim. Never calculate, estimate or introduce any rupee figure or percentage."). The banned words are enforced by `tone.ts`, not just asked for.

**Common debate input (code-built, same for all three):**
```ts
{
  finding: { id, type, tier: initial_tier, rule: rule_or_source_cited, line_items: [{id, description_raw, category, date, quantity, unit}] },
  facts: Record<string,string>,          // pre-formatted by code: "billed_rate": "₹148.00 per tablet", "mrp": "₹118.40 per tablet", "excess": "₹2,400.00"
  allowed_tokens: string[],              // every number the model may quote
  bill_context: { admission_date, discharge_date, nights, hospital_name },
  summary: DischargeSummary,             // full, small
}
```

### Auditor (`auditor.v1.md`) — model: MODEL_REASON
- **Role:** patient's advocate stating the finding with evidence.
- **Input:** common debate input.
- **Output:** `{ claim: string (≤40 words), evidence: [{source: "bill"|"summary"|"reference_table", ref: string, point: string}] (1–4), why_it_matters: string (≤30 words), confidence: "high"|"medium"|"low" }`
- **Constraints:** every evidence item must cite a line-item id, a summary field, or the rule's source; no claims beyond FACTS; no accusation of intent; must state what is known vs. inferred.

### Defender (`defender.v1.md`) — model: MODEL_REASON
- **Role:** the hospital billing office's best *legitimate* justification. Not a straw man, not a fabrication.
- **Input:** common debate input + `auditor` output.
- **Output:** `{ strongest_justification: string (≤50 words), supporting_points: string[] (0–3), verifiable_from_documents: boolean, what_would_confirm: string (≤30 words), concedes: boolean }`
- **Constraints:** may use only (a) facts in the documents, (b) well-known, generic billing practices (e.g. bed-day counting conventions, per-dose billing, pack-vs-unit rounding), clearly phrased as possibilities; must **not** invent hospital policies, invoices, doctor orders, or numbers; `verifiable_from_documents=true` only if the summary/bill actually contains the support; if nothing legitimate exists, set `concedes=true` and say so. This is what makes the rebuttal honest.

### Judge (`judge.v1.md`) — model: MODEL_REASON
- **Role:** impartial arbiter; writes the counter shown to the user.
- **Input:** common debate input + auditor + defender outputs.
- **Output:** `{ decision: "keep"|"downgrade_to_ask"|"drop", rationale: string (≤50 words), counter_argument: string (≤80 words, addressed to the billing desk, calm), question_for_billing_desk: string (≤30 words), confidence: "high"|"medium"|"low", basis_error: boolean }`
- **Decision rubric (also enforced in code):**
  - `keep`: Defender `concedes`, or gives only unverifiable generic justification AND finding is rule-based Provable.
  - `downgrade_to_ask`: Defender's justification is plausible and not verifiable from documents.
  - `drop`: the documents themselves support the Defender's justification, or the finding rests on a data/normalization error (`basis_error=true`).
- **Code-enforced constraints:** final `tier` can never exceed `initial_tier`; `keep` on an Ask finding stays Ask; a **Provable finding cannot be `drop`ped unless `basis_error=true`** (otherwise code coerces to `downgrade_to_ask` and logs it); Judge never alters `amount_at_stake`.

**Debate cost:** 3 calls/finding, ≈ 8–14 findings/run ⇒ 24–42 calls, all cached after the first run. Findings run 3-at-a-time; one route call per finding so each stays well under serverless timeouts.

**Other prompts (Phases 1–3, brief):** `extract_*` (vision → schema, "copy exactly as printed, never compute, never correct arithmetic"), `normalize` (map each description to a table `canonical_id` from a supplied candidate list or null; report pack/unit conversion), `clinical` (D3 candidates as in section 2, "flag only what the summary does not support; absent evidence is a question, not a conclusion"), `letter` (polite dispute letter whose amounts are `{{amount:F-003}}` placeholders that code fills; same tone/number guards).

---

## 7. Phase 0 remaining work (after you approve this spec)
1. Create repo skeleton + `schemas.ts` + `config.ts`.
2. Curate and verify ~40 drug rows (you verify prices; I give the exact checklist).
3. Write truth JSONs for the 3 bills + summaries, render PDFs, generate answer keys.
Phase 0 test: `npx tsx scripts/make-answer-keys.ts`, then `npx tsx scripts/check-fixtures.ts`, `npm run typecheck`, `npm test` (no LLM, no network).

## 8. Time check (from strategy.md plan)
This spec is the 0–1h slot. Data work is 1–3h. The riskiest slot is Phase 4 (3 calls × N findings); the cut order stays: negotiation script, package overlap, extra layouts. Never cut the Rebuttal Engine, tiering, or demo polish.

## 9. VERIFY list (I have not confirmed any of these)
| Item | How to verify |
|---|---|
| Current Claude model ids and vision support | Anthropic Console / docs "models overview" page before any API call; set `MODEL_EXTRACT`/`MODEL_REASON` in `.env`. Sources disagree on `claude-sonnet-5-5` |
| Round-1 drug rows | See `data/reference/VERIFY_CHECKLIST.md` "Status after merge": paracetamol and ondansetron unverified; MRPs for the verified rows come from aggregator/pharmacy listings |
| Ceiling prices and which formulations are scheduled | NPPA website (nppaindia.nic.in), notified ceiling price lists and the NLEM; the NPPA "Pharma Sahi Daam" app lists current ceiling prices |
| Each drug's printed MRP | Manufacturer site, brand pack label, or an online pharmacy listing; record the source in `mrp_source` |
| Whether a GST-inclusive/exclusive basis affects MRP comparison | Printed MRP is inclusive of taxes; confirm and note it in the README |
| Vercel request body limit and function timeout for the current plan | Vercel docs "Functions limits" |
| `pdf-lib` handles ₹ glyph | Needs an embedded Unicode font (e.g. Noto Sans); standard fonts lack ₹. Test in Phase 6 |
| CGHS/PMJAY reference rates | Not used by any detector in this build; benchmark language kept only as a tone rule |
