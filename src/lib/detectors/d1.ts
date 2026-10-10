// D1 — arithmetic and duplicate checks (SPEC section 2). Pure code, no LLM.
// A1/A2 are Provable (the bill contradicts its own numbers); A3/A4/A5 are Ask (a repeat can be legitimate).
// ICU days are deliberately NOT checked here: they belong to D3-M1.
import type { BillExtraction, CandidateFinding } from "../schemas";
import { ROOM_DAY_ALLOWANCE, ROUNDING_TOL, oneTimeFeeClass } from "../config";
import { allowedTokens, cents, daysBetween, formatRupees } from "../money";

type Item = BillExtraction["items"][number];
type Evidence = CandidateFinding["evidence"];

const make = (
  f: Pick<CandidateFinding, "type" | "line_item_ids" | "rule_or_source_cited" | "initial_tier" | "confidence"> & { evidence: Evidence; stake: number },
): CandidateFinding => ({
  type: f.type,
  detector: "D1_ARITH_DUP",
  line_item_ids: f.line_item_ids,
  amount_at_stake: cents(f.stake),
  rule_or_source_cited: f.rule_or_source_cited,
  initial_tier: f.initial_tier,
  confidence: f.confidence,
  evidence: f.evidence,
  allowed_tokens: allowedTokens(f.evidence, f.stake),
});

/** Optional line_item_id -> canonical_id map (from normalization) so duplicates match across wordings. */
export type CanonicalIds = ReadonlyMap<string, string>;

export function detectD1(bill: BillExtraction, canonical: CanonicalIds = new Map()): CandidateFinding[] {
  return [...lineMath(bill), ...totalMath(bill), ...exactDuplicates(bill, canonical).findings, ...repeatedFees(bill, canonical), ...roomDays(bill)];
}

/** D1-A1: printed amount is higher than quantity × unit rate by more than the rounding tolerance. */
function lineMath(bill: BillExtraction): CandidateFinding[] {
  const out: CandidateFinding[] = [];
  for (const i of bill.items) {
    const computed = cents(i.quantity * i.unit_rate);
    const excess = cents(i.amount - computed);
    if (excess <= ROUNDING_TOL) continue; // only overcharges, and only beyond tolerance
    const evidence: Evidence = {
      printed_amount: formatRupees(i.amount), quantity: i.quantity, unit_rate: formatRupees(i.unit_rate),
      quantity_times_rate: formatRupees(computed), difference: formatRupees(excess),
    };
    out.push(make({
      type: "ARITH_LINE", line_item_ids: [i.id], stake: excess, evidence, initial_tier: "Provable", confidence: "high",
      rule_or_source_cited: {
        rule_id: "D1-A1",
        description: "The printed line amount is higher than quantity multiplied by the printed unit rate. This is a charge to question; confirm with the billing desk.",
        source: `Bill line ${i.id}: quantity × unit rate vs printed amount`,
        benchmark_label: "bill's own printed figures",
      },
    }));
  }
  return out;
}

/** D1-A2: stated total is higher than (sum of line amounts − stated discount). */
function totalMath(bill: BillExtraction): CandidateFinding[] {
  const sum = cents(bill.items.reduce((a, i) => a + i.amount, 0));
  const discount = bill.stated_discount ?? 0;
  const expected = cents(sum - discount);
  const excess = cents(bill.stated_total - expected);
  if (excess <= ROUNDING_TOL) return [];
  const evidence: Evidence = {
    sum_of_line_amounts: formatRupees(sum), stated_discount: formatRupees(discount),
    expected_total: formatRupees(expected), stated_total: formatRupees(bill.stated_total), difference: formatRupees(excess),
  };
  return [make({
    type: "ARITH_TOTAL", line_item_ids: [], stake: excess, evidence, initial_tier: "Provable", confidence: "high",
    rule_or_source_cited: {
      rule_id: "D1-A2",
      description: "The stated total is higher than the sum of the printed line amounts less any stated discount. This is a charge to question; confirm with the billing desk.",
      source: "Bill totals: sum of line amounts, stated discount, stated total",
      benchmark_label: "bill's own printed figures",
    },
  })];
}

const dupKey = (i: Item, canonical: CanonicalIds) =>
  [canonical.get(i.id) ?? `desc:${i.description_raw.trim().toLowerCase()}`, i.date, i.time ?? "", i.quantity, i.unit_rate].join("|");

/** D1-A3: same item, date, time, quantity and rate more than once. Returns the ids of the extra copies too. */
function exactDuplicates(bill: BillExtraction, canonical: CanonicalIds) {
  const groups = new Map<string, Item[]>();
  for (const i of bill.items) groups.set(dupKey(i, canonical), [...(groups.get(dupKey(i, canonical)) ?? []), i]);
  const findings: CandidateFinding[] = [];
  const extraCopies = new Set<string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const copies = g.slice(1);
    copies.forEach((c) => extraCopies.add(c.id));
    const stake = copies.reduce((a, c) => a + c.amount, 0);
    const first = g[0]!;
    const evidence: Evidence = {
      description: first.description_raw, date: first.date, time: first.time ?? "not printed", quantity: first.quantity,
      unit_rate: formatRupees(first.unit_rate), copies_billed: g.length, amount_of_repeat_copies: formatRupees(stake),
    };
    findings.push(make({
      type: "DUPLICATE_EXACT", line_item_ids: g.map((x) => x.id), stake, evidence, initial_tier: "Ask", confidence: "medium",
      rule_or_source_cited: {
        rule_id: "D1-A3",
        description: "The same item appears more than once with identical date, time, quantity and rate. A repeat can be legitimate, so this is a question for the billing desk.",
        source: `Bill lines ${g.map((x) => x.id).join(", ")}: identical item, date, time, quantity and rate`,
        benchmark_label: "bill's own printed figures",
      },
    }));
  }
  return { findings, extraCopies };
}

/**
 * D1-A4: the SAME one-time fee class (ONE_TIME_FEE_CLASSES) billed on 2+ lines that are not exact duplicates
 * (exact repeats are A3's). Matches the SPEC wording: no category restriction; two different fee classes never fire.
 */
function repeatedFees(bill: BillExtraction, canonical: CanonicalIds): CandidateFinding[] {
  const { extraCopies } = exactDuplicates(bill, canonical);
  const byClass = new Map<string, Item[]>();
  for (const i of bill.items) {
    if (extraCopies.has(i.id)) continue;
    const cls = oneTimeFeeClass(i.description_raw);
    if (cls) byClass.set(cls, [...(byClass.get(cls) ?? []), i]);
  }
  const out: CandidateFinding[] = [];
  for (const [cls, g] of byClass) {
    if (g.length < 2) continue;
    const repeats = g.slice(1);
    const stake = repeats.reduce((a, c) => a + c.amount, 0);
    const evidence: Evidence = {
      fee_class: cls, lines_billed: g.length, dates: g.map((x) => x.date).join(", "), amount_of_repeat_lines: formatRupees(stake),
    };
    out.push(make({
      type: "DUPLICATE_ONE_TIME", line_item_ids: g.map((x) => x.id), stake, evidence, initial_tier: "Ask", confidence: "medium",
      rule_or_source_cited: {
        rule_id: "D1-A4",
        description: "A fee that is normally charged once per stay appears on more than one line. Confirm with the billing desk whether a second charge applies.",
        source: `Bill lines ${g.map((x) => x.id).join(", ")}: same one-time fee class (${cls})`,
        benchmark_label: "bill's own printed figures",
      },
    }));
  }
  return out;
}

/** D1-A5: room lines only. Allowed bed-days = nights + ROOM_DAY_ALLOWANCE (1). */
function roomDays(bill: BillExtraction): CandidateFinding[] {
  const nights = daysBetween(bill.admission_date, bill.discharge_date);
  if (!Number.isFinite(nights) || nights < 0) return []; // invalid stay dates: cannot judge bed-days
  const allowed = nights + ROOM_DAY_ALLOWANCE;
  const out: CandidateFinding[] = [];
  for (const i of bill.items) {
    if (i.category !== "room" || i.quantity <= allowed) continue;
    const stake = cents((i.quantity - allowed) * i.unit_rate);
    if (stake <= 0) continue;
    const evidence: Evidence = {
      days_billed: i.quantity, admission_date: bill.admission_date, discharge_date: bill.discharge_date,
      nights, allowed_days: allowed, extra_days: i.quantity - allowed, daily_rate: formatRupees(i.unit_rate),
    };
    out.push(make({
      type: "ROOM_DAYS_EXCEED_STAY", line_item_ids: [i.id], stake, evidence, initial_tier: "Ask", confidence: "medium",
      rule_or_source_cited: {
        rule_id: "D1-A5",
        description: "Room days billed exceed the nights of the stay plus one day (some hospitals count admission and discharge days). Confirm the bed-day count with the billing desk.",
        source: `Bill line ${i.id} vs admission and discharge dates (allowed days = nights + ${ROOM_DAY_ALLOWANCE})`,
        benchmark_label: "bill's own printed dates",
      },
    }));
  }
  return out;
}
