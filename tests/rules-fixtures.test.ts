import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BANNED_WORD_FRAGMENTS, SAMPLE_BILL_IDS } from "../src/lib/config";
import { BillExtraction, DrugTable, SeedManifest, type NormalizationResult } from "../src/lib/schemas";
import { runRules } from "../src/lib/detectors";

const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const table = DrugTable.parse(read("data/reference/drug_reference.json"));

// Normalization the Phase 1/2 normalizer would produce for the synthetic bills: taken from the seed manifests.
function normalizationFor(dir: string): NormalizationResult {
  const bill = BillExtraction.parse(read(`data/synthetic/${dir}/bill.truth.json`));
  const m = SeedManifest.parse(read(`data/synthetic/${dir}/seed_manifest.json`));
  const refs = [...m.seeded, ...m.traps, ...m.decoys].filter((x) => x.canonical_id);
  return {
    items: refs.flatMap((x) =>
      x.line_item_ids.map((id) => ({
        line_item_id: id, canonical_id: x.canonical_id!, canonical_name: x.canonical_id!,
        billed_unit: bill.items.find((i) => i.id === id)!.unit as "tablet" | "vial", units_per_billed_unit: 1,
        billed_brand: x.billed_brand ?? null, match_confidence: "high" as const, rationale: "from seed manifest",
      })),
    ),
  };
}

describe("rule engine vs synthetic answer keys (D1 + D2 only)", () => {
  for (const dir of SAMPLE_BILL_IDS) {
    it(`${dir}: candidates match the answer key exactly, decoys raise nothing`, () => {
      const key = read(`data/synthetic/${dir}/answer_key.json`);
      const bill = read(`data/synthetic/${dir}/bill.truth.json`);
      const { candidates } = runRules(bill, normalizationFor(dir), table);
      const expected = [...key.seeded, ...key.traps]
        .filter((s: { rule_id: string }) => /^D[12]-/.test(s.rule_id))
        .map((s: { rule_id: string; line_item_ids: string[]; expected_amount_at_stake: number; expected_initial_tier?: string }) => ({
          rule: s.rule_id, ids: s.line_item_ids.join(","), stake: s.expected_amount_at_stake, tier: s.expected_initial_tier,
        }));
      const got = candidates.map((c) => ({ rule: c.rule_or_source_cited.rule_id, ids: c.line_item_ids.join(","), stake: c.amount_at_stake, tier: c.initial_tier }));
      const sortBy = (a: { rule: string; ids: string }, b: { rule: string; ids: string }) => (a.rule + a.ids).localeCompare(b.rule + b.ids);
      // Traps (e.g. T1 room days) are candidates by design and carry no expected tier in the key; the rule's own tier is Ask.
      const fixTier = (e: typeof expected) => e.map((x) => ({ ...x, tier: x.tier ?? "Ask" }));
      expect(got.sort(sortBy)).toEqual(fixTier(expected).sort(sortBy));
    });
  }

  it("no finding text uses a banned word, and every finding is tone-safe", () => {
    for (const dir of SAMPLE_BILL_IDS) {
      const { candidates } = runRules(read(`data/synthetic/${dir}/bill.truth.json`), normalizationFor(dir), table);
      const text = JSON.stringify(candidates).toLowerCase();
      for (const w of BANNED_WORD_FRAGMENTS) expect(text).not.toContain(w);
    }
  });

  it("Bill 02 merged ceftriaxone finding cites MRP and ceiling once, staked on the lowest supporting limit (MRP)", () => {
    const { candidates } = runRules(read("data/synthetic/bill-02-demo/bill.truth.json"), normalizationFor("bill-02-demo"), table);
    const f = candidates.filter((c) => c.line_item_ids.includes("L014"));
    expect(f).toHaveLength(1);
    expect(f[0]!.evidence).toMatchObject({ binding_basis: "reference_mrp", reference_verified: true, brand_match: true });
    expect(f[0]!.evidence.bases_exceeded).toBe("reference_mrp, ceiling_incl_gst");
  });

  it("is deterministic", () => {
    const bill = read("data/synthetic/bill-02-demo/bill.truth.json");
    const n = normalizationFor("bill-02-demo");
    expect(runRules(bill, n, table)).toEqual(runRules(bill, n, table));
  });

  it("Bill 02 logs the unmatched drug line as a skipped check, never a finding", () => {
    const r = runRules(read("data/synthetic/bill-02-demo/bill.truth.json"), normalizationFor("bill-02-demo"), table);
    expect(r.skipped_checks.map((s) => s.line_item_id)).toContain("L030");
    expect(r.candidates.some((c) => c.line_item_ids.includes("L030"))).toBe(false);
  });
});
