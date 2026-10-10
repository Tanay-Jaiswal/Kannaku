import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { checkFixtures } from "../scripts/check-fixtures";

const key = (dir: string) => JSON.parse(readFileSync(`data/synthetic/${dir}/answer_key.json`, "utf8"));

describe("synthetic fixtures", () => {
  it("pass every consistency check", () => {
    expect(() => checkFixtures()).not.toThrow();
  });
  it("restores 9 decoys across the three bills", () => {
    const n = ["bill-01-clean", "bill-02-demo", "bill-03-errors"].map((d) => key(d).decoys.length);
    expect(n).toEqual([3, 4, 2]);
  });
  it("S2-5 is the same one-time fee repeated, Ask, and may be dropped on evidence", () => {
    const s = key("bill-02-demo").seeded.find((x: { seed_id: string }) => x.seed_id === "S2-5");
    expect(s).toMatchObject({ expected_initial_tier: "Ask", must_survive_rebuttal: false, expected_amount_at_stake: 1500 });
    expect(s.acceptable_decisions).toContain("drop");
  });
  it("bill 01 has no genuine seeds and one trap", () => {
    const k = key("bill-01-clean");
    expect(k.seeded).toHaveLength(0);
    expect(k.evaluation_targets.expected_dropped_count).toBe(1);
  });
  it("bill 02 keeps S2-1..S2-5 and S2-7; ICU line is trap T2", () => {
    const k = key("bill-02-demo");
    expect(k.seeded.map((s: { seed_id: string }) => s.seed_id)).toEqual(["S2-1", "S2-2", "S2-3", "S2-4", "S2-5", "S2-7"]);
    expect(k.traps[0].trap_id).toBe("T2-ICU-HDU-STEPDOWN");
  });
  it("bill 03 keeps S3-1..S3-5 and drops T3", () => {
    const k = key("bill-03-errors");
    expect(k.seeded).toHaveLength(5);
    expect(k.traps[0].trap_id).toBe("T3-CXR-IN-FREE-TEXT");
  });
});
