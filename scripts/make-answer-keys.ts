// Generates data/synthetic/<bill>/answer_key.json from the truth JSONs, seed manifest and drug table.
// Every expected rupee amount is computed here; answer keys are never hand-edited.
// Run: npx tsx scripts/make-answer-keys.ts
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  BillExtraction, DischargeSummary, DrugTable, SeedManifest, assessDrugPrice,
} from "../src/lib/schemas";
import { PRICE_TOL, ROOM_DAY_ALLOWANCE, SAMPLE_BILL_IDS } from "../src/lib/config";

type Seedish = SeedManifest["seeded"][number] | SeedManifest["traps"][number];

const readJson = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));
const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const nightsBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function amountFor(seed: Seedish, bill: BillExtraction, summary: DischargeSummary, table: DrugTable): number {
  const byId = new Map(bill.items.map((i) => [i.id, i]));
  const line = (id: string | undefined) => {
    const i = id ? byId.get(id) : undefined;
    if (!i) throw new Error(`${seedId(seed)}: missing line ${id}`);
    return i;
  };
  const first = seed.line_item_ids[0];
  switch (seed.amount_formula) {
    case "line_arithmetic_excess": {
      const i = line(first);
      return cents(Math.max(0, i.amount - i.quantity * i.unit_rate));
    }
    case "total_mismatch": {
      const sum = bill.items.reduce((a, i) => a + i.amount, 0) - (bill.stated_discount ?? 0);
      return cents(Math.max(0, bill.stated_total - sum));
    }
    case "price_limit_excess": {
      // Same assessment as detector D2-P1 (printed MRP first, brand match, ceiling, verified cap).
      const a = drugAssessment(seed, line(first), table);
      if (!a) throw new Error(`${seedId(seed)}: line is not above any applicable limit`);
      return a.amount_at_stake;
    }
    case "duplicate_line_amount":
      return cents(line(seed.duplicate_copy_id ?? seed.line_item_ids[1]).amount);
    case "repeat_admin_amount":
      return cents(line(seed.repeat_line_id ?? seed.line_item_ids[1]).amount);
    case "room_excess_days": {
      const i = line(first);
      const allowed = nightsBetween(bill.admission_date, bill.discharge_date) + ROOM_DAY_ALLOWANCE;
      return cents(Math.max(0, (i.quantity - allowed) * i.unit_rate));
    }
    case "icu_excess_vs_summary": {
      const i = line(first);
      return cents(Math.max(0, (i.quantity - summary.icu_days) * i.unit_rate));
    }
    case "line_amount_sum":
      return cents(seed.line_item_ids.reduce((a, id) => a + line(id).amount, 0));
  }
}

const seedId = (s: Seedish) => ("seed_id" in s ? s.seed_id : s.trap_id);

/** D2 assessment for one drug line as the pipeline would see it. Exported for check-fixtures. */
export function drugAssessment(
  ref: { canonical_id?: string; billed_brand?: string },
  item: BillExtraction["items"][number],
  table: DrugTable,
) {
  const row = table.rows.find((r) => r.canonical_id === ref.canonical_id);
  if (!row) throw new Error(`canonical_id ${ref.canonical_id} not in table`);
  return assessDrugPrice(
    row,
    {
      unit_rate: item.unit_rate,
      qty_units: item.quantity,
      units_consistent: item.unit === row.table_unit, // fixtures bill in table units; anything else is skipped
      printed_mrp: item.printed_mrp,
      billed_brand: ref.billed_brand,
    },
    PRICE_TOL,
  );
}

export function buildAnswerKey(dir: string, root = ".") {
  const base = `${root}/data/synthetic/${dir}`;
  const table = DrugTable.parse(readJson(`${root}/data/reference/drug_reference.json`));
  const bill = BillExtraction.parse(readJson(`${base}/bill.truth.json`));
  const summary = DischargeSummary.parse(readJson(`${base}/summary.truth.json`));
  const manifest = SeedManifest.parse(readJson(`${base}/seed_manifest.json`));
  const itemSum = cents(bill.items.reduce((a, i) => a + i.amount, 0));
  const discount = bill.stated_discount ?? 0;
  const byId = new Map(bill.items.map((i) => [i.id, i]));
  const seeded = manifest.seeded.map((s) => {
    const out = { ...s, expected_amount_at_stake: amountFor(s, bill, summary, table) };
    if (s.amount_formula !== "price_limit_excess") return out;
    const a = drugAssessment(s, byId.get(s.line_item_ids[0]!)!, table)!;
    return { ...out, computed_initial_tier: a.tier, binding_basis: a.binding_basis, reference_verified: a.reference_verified };
  });
  const traps = manifest.traps.map((t) => ({ ...t, expected_amount_at_stake: amountFor(t, bill, summary, table) }));
  return {
    bill_id: manifest.bill_id,
    data_label: "Synthetic data",
    table_version: table.table_version,
    computed_from: ["bill.truth.json", "summary.truth.json", "seed_manifest.json", "../../reference/drug_reference.json"],
    stated_subtotal: bill.stated_subtotal ?? itemSum,
    sum_of_printed_line_amounts: itemSum,
    stated_discount: discount,
    stated_total: bill.stated_total,
    total_gap: cents(bill.stated_total - (itemSum - discount)),
    seeded,
    traps,
    decoys: manifest.decoys,
    // Candidates, kept and dropped are reported separately; candidates are never shown as the final count.
    evaluation_targets: {
      seeded_error_count: seeded.length,
      trap_count: traps.length,
      expected_candidate_count: seeded.length + traps.length,
      expected_kept_count: seeded.length,
      expected_dropped_count: traps.length,
      must_survive_count: seeded.filter((s) => s.must_survive_rebuttal).length,
      seeds_that_may_be_dropped: seeded.filter((s) => s.acceptable_decisions.includes("drop")).map((s) => s.seed_id),
      decoy_count: manifest.decoys.length,
      expected_decoy_candidates: 0,
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  for (const dir of SAMPLE_BILL_IDS) {
    const key = buildAnswerKey(dir);
    writeFileSync(`data/synthetic/${dir}/answer_key.json`, JSON.stringify(key, null, 2) + "\n", "utf8");
    console.log(
      `${dir}: ${key.seeded.length} seeded, ${key.traps.length} traps, ` +
        `line sum ₹${key.sum_of_printed_line_amounts.toFixed(2)}, total gap ₹${key.total_gap.toFixed(2)}`,
    );
  }
}
