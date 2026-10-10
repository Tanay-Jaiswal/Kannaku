import { describe, it, expect } from "vitest";
import { detectD1 } from "../src/lib/detectors/d1";
import type { BillExtraction } from "../src/lib/schemas";

type Item = BillExtraction["items"][number];
const item = (o: Partial<Item> & { id: string }): Item => ({
  date: "2026-08-02", category: "other", description_raw: "Service", quantity: 1, unit_rate: 100, amount: 100, ...o,
});
const bill = (items: Item[], o: Partial<BillExtraction> = {}): BillExtraction => ({
  hospital_name: "Synthetic Hospital", patient_alias: "Patient", admission_date: "2026-08-01", discharge_date: "2026-08-04",
  items, stated_total: items.reduce((a, i) => a + i.amount, 0), currency: "INR", extraction_notes: [], ...o,
});

describe("D1-A1 line math", () => {
  it("flags an overcharge beyond tolerance as Provable with a code-computed stake", () => {
    const [f] = detectD1(bill([item({ id: "L001", quantity: 4, unit_rate: 1800, amount: 8700 })]));
    expect(f).toMatchObject({ type: "ARITH_LINE", initial_tier: "Provable", amount_at_stake: 1500, line_item_ids: ["L001"] });
  });
  it("ignores a difference of exactly the ₹1 tolerance, and undercharges", () => {
    expect(detectD1(bill([item({ id: "L001", quantity: 3, unit_rate: 100, amount: 301 })]))).toEqual([]);
    expect(detectD1(bill([item({ id: "L001", quantity: 3, unit_rate: 100, amount: 100 })]))).toEqual([]);
    expect(detectD1(bill([item({ id: "L001", quantity: 3, unit_rate: 100, amount: 301.02 })]))).toHaveLength(1);
  });
  it("handles fractional quantity rounding to paise", () => {
    expect(detectD1(bill([item({ id: "L001", quantity: 2.5, unit_rate: 33.33, amount: 83.33 })]))).toEqual([]); // 83.325 -> 83.33
  });
});

describe("D1-A2 total math", () => {
  it("flags a higher stated total as Provable, no line ids", () => {
    const b = bill([item({ id: "L001" }), item({ id: "L002", description_raw: "Other" })], { stated_total: 2600 });
    const [f] = detectD1(b);
    expect(f).toMatchObject({ type: "ARITH_TOTAL", initial_tier: "Provable", line_item_ids: [], amount_at_stake: 2400 });
  });
  it("respects a stated discount and ignores a lower stated total", () => {
    expect(detectD1(bill([item({ id: "L001", amount: 1000, unit_rate: 1000 })], { stated_discount: 100, stated_total: 900 }))).toEqual([]);
    expect(detectD1(bill([item({ id: "L001" })], { stated_total: 50 }))).toEqual([]);
  });
});

describe("D1-A3 / A4 duplicates", () => {
  const sal = { category: "consumable" as const, description_raw: "Normal saline", time: "08:00" };
  it("identical lines are Ask, stake = amount of copies after the first", () => {
    const [f] = detectD1(bill([item({ id: "L001", ...sal }), item({ id: "L002", ...sal }), item({ id: "L003", ...sal })]));
    expect(f).toMatchObject({ type: "DUPLICATE_EXACT", initial_tier: "Ask", amount_at_stake: 200, line_item_ids: ["L001", "L002", "L003"] });
  });
  it("different times (repeat doses) are not duplicates; missing vs present time differ too", () => {
    expect(detectD1(bill([item({ id: "L001", ...sal }), item({ id: "L002", ...sal, time: "20:00" })]))).toEqual([]);
    expect(detectD1(bill([item({ id: "L001", ...sal }), item({ id: "L002", ...sal, time: undefined })]))).toEqual([]);
  });
  it("canonical id matches differently worded identical drug lines", () => {
    const a = item({ id: "L001", description_raw: "INJ CTX 1G" }), b = item({ id: "L002", description_raw: "Ceftriaxone 1g inj" });
    expect(detectD1(bill([a, b]))).toEqual([]);
    expect(detectD1(bill([a, b]), new Map([["L001", "c"], ["L002", "c"]]))).toHaveLength(1);
  });
  const fee = (id: string, date: string, d = "Admission and registration fee") => item({ id, date, category: "admin", description_raw: d });
  it("A4: same one-time fee on different dates is Ask; exact repeat is A3 only", () => {
    const f = detectD1(bill([fee("L001", "2026-08-01"), fee("L002", "2026-08-02")]));
    expect(f.map((x) => x.type)).toEqual(["DUPLICATE_ONE_TIME"]);
    expect(f[0]).toMatchObject({ initial_tier: "Ask", amount_at_stake: 100 });
    expect(detectD1(bill([fee("L001", "2026-08-01"), fee("L002", "2026-08-01")])).map((x) => x.type)).toEqual(["DUPLICATE_EXACT"]);
  });
  it("A4: two different admin fees never fire", () => {
    expect(detectD1(bill([fee("L001", "2026-08-01"), fee("L002", "2026-08-02", "Discharge file preparation")]))).toEqual([]);
  });
  it("A4 follows the SPEC class rule with no category restriction", () => {
    const f2 = (id: string, date: string) => item({ id, date, category: "other", description_raw: "Admission and registration fee" });
    expect(detectD1(bill([f2("L001", "2026-08-01"), f2("L002", "2026-08-02")])).map((x) => x.type)).toEqual(["DUPLICATE_ONE_TIME"]);
  });
  it("A4 does not fire on a single fee line, or on non-fee lines", () => {
    expect(detectD1(bill([fee("L001", "2026-08-01")]))).toEqual([]);
    const c = (id: string, date: string) => item({ id, date, description_raw: "Physician rounds" });
    expect(detectD1(bill([c("L001", "2026-08-01"), c("L002", "2026-08-02")]))).toEqual([]);
  });
  it("A4 stake is the later lines only, and an exact copy is left to A3 (no double count)", () => {
    // L001 and L002 identical (A3 takes L002); L003 is the same fee on another day (A4 pairs L001 with L003).
    const f = detectD1(bill([fee("L001", "2026-08-01"), fee("L002", "2026-08-01"), fee("L003", "2026-08-02")]));
    expect(f.map((x) => [x.type, x.amount_at_stake, x.line_item_ids.join(",")])).toEqual([
      ["DUPLICATE_EXACT", 100, "L001,L002"], ["DUPLICATE_ONE_TIME", 100, "L001,L003"],
    ]);
  });
});

describe("D1-A5 room days vs ICU days", () => {
  // Stay 08-01..08-04 = 3 nights -> allowed 4 room days.
  const room = (q: number, cat: Item["category"] = "room") => item({ id: "L001", category: cat, quantity: q, unit_rate: 1000, amount: q * 1000 });
  it("nights + 1 is allowed; one extra day is Ask with a code-computed stake", () => {
    expect(detectD1(bill([room(4)]))).toEqual([]);
    const [f] = detectD1(bill([room(5)]));
    expect(f).toMatchObject({ type: "ROOM_DAYS_EXCEED_STAY", initial_tier: "Ask", amount_at_stake: 1000 });
    expect(f!.evidence).toMatchObject({ nights: 3, allowed_days: 4, extra_days: 1 });
  });
  it("ICU lines are never checked by D1 (D3-M1 owns them), however many days", () => {
    expect(detectD1(bill([room(40, "icu")]))).toEqual([]);
  });
  it("same-day stay allows one day; reversed dates are not judged", () => {
    expect(detectD1(bill([room(1)], { discharge_date: "2026-08-01" }))).toEqual([]);
    expect(detectD1(bill([room(2)], { discharge_date: "2026-08-01" }))).toHaveLength(1);
    expect(detectD1(bill([room(9)], { discharge_date: "2026-07-01" }))).toEqual([]);
  });
});
