// Consistency checks for the synthetic fixture pack. Throws on the first failure. Also run from vitest.
// Run: npx tsx scripts/check-fixtures.ts (after make-answer-keys.ts)
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { BillExtraction, DischargeSummary, DrugTable, SeedManifest } from "../src/lib/schemas";
import { BANNED_WORD_FRAGMENTS, ROOM_DAY_ALLOWANCE, SAMPLE_BILL_IDS, oneTimeFeeClass } from "../src/lib/config";
import { validateTable } from "./validate-table";
import { buildAnswerKey, drugAssessment } from "./make-answer-keys";
import { renderBillHtml } from "./render-bill-html";

type Item = BillExtraction["items"][number];
const exactDuplicate = (a: Item, b: Item) =>
  a.description_raw.trim().toLowerCase() === b.description_raw.trim().toLowerCase() &&
  a.date === b.date && (a.time ?? "") === (b.time ?? "") && a.quantity === b.quantity && a.unit_rate === b.unit_rate;
const nights = (b: BillExtraction) =>
  Math.round((Date.parse(`${b.discharge_date}T00:00:00Z`) - Date.parse(`${b.admission_date}T00:00:00Z`)) / 86_400_000);

const assert = (ok: boolean, msg: string) => {
  if (!ok) throw new Error(msg);
};

export function checkFixtures(root = "."): string[] {
  const log: string[] = [];
  const table = DrugTable.parse(JSON.parse(readFileSync(`${root}/data/reference/drug_reference.json`, "utf8")));
  const tableErrs = validateTable(`${root}/data/reference/drug_reference.json`);
  assert(tableErrs.length === 0, `Drug table: ${tableErrs.join("; ")}`);
  const verified = table.rows.filter((r) => r.verified);
  assert(verified.length >= 4, `Expected >=4 verified rows, got ${verified.length}`);
  assert(verified.some((r) => r.nlem_scheduled === true), "Expected at least one verified scheduled row");

  let seeds = 0, traps = 0, decoys = 0;
  for (const dir of SAMPLE_BILL_IDS) {
    const base = `${root}/data/synthetic/${dir}`;
    const bill = BillExtraction.parse(JSON.parse(readFileSync(`${base}/bill.truth.json`, "utf8")));
    const summary = DischargeSummary.parse(JSON.parse(readFileSync(`${base}/summary.truth.json`, "utf8")));
    const manifest = SeedManifest.parse(JSON.parse(readFileSync(`${base}/seed_manifest.json`, "utf8")));
    const byId = new Map(bill.items.map((i) => [i.id, i]));
    const lineSum = Math.round(bill.items.reduce((a, i) => a + i.amount, 0) * 100) / 100;
    assert(bill.stated_subtotal === undefined || Math.abs(bill.stated_subtotal - lineSum) < 0.01, `${dir}: stated_subtotal != line sum`);
    const html = readFileSync(`${base}/bill.html`, "utf8");
    assert(renderBillHtml(html, bill) === html, `${dir}: bill.html is stale; rerun render-bill-html`);
    const key = JSON.parse(readFileSync(`${base}/answer_key.json`, "utf8"));
    const fresh = buildAnswerKey(dir, root); // also parses summary + manifest with their schemas
    assert(isDeepStrictEqual(key, fresh), `${dir}: answer_key.json is stale or hand-edited; rerun make-answer-keys`);

    const ids = bill.items.map((i) => i.id);
    assert(new Set(ids).size === ids.length, `${dir}: duplicate line IDs`);
    for (const f of [...fresh.seeded, ...fresh.traps]) {
      const fid = "seed_id" in f ? f.seed_id : f.trap_id;
      for (const id of f.line_item_ids) assert(ids.includes(id), `${dir}: ${fid} points at missing ${id}`);
      if (f.canonical_id) {
        const row = table.rows.find((r) => r.canonical_id === f.canonical_id);
        // Relaxed gate: with >=4 verified rows, drug seeds may only use verified rows.
        assert(!!row?.verified, `${dir}: ${fid} uses unverified or unknown row ${f.canonical_id}`);
      }
      if ("seed_id" in f) assert(f.expected_amount_at_stake > 0, `${dir}: ${fid} has zero stake`);
      if (f.rule_id === "D1-A4") {
        // Narrowed rule: the same one-time fee repeated, not two different admin fees.
        const [a, b] = f.line_item_ids.map((id) => byId.get(id)!);
        const cls = oneTimeFeeClass(a!.description_raw);
        assert(cls !== null && cls === oneTimeFeeClass(b!.description_raw), `${dir}: ${fid} lines are not the same one-time fee`);
        assert(!exactDuplicate(a!, b!), `${dir}: ${fid} is an exact duplicate (that is D1-A3)`);
      }
    }

    for (const f of fresh.seeded)
      if ("computed_initial_tier" in f)
        assert(f.computed_initial_tier === f.expected_initial_tier, `${dir}: ${f.seed_id} D2 tier ${f.computed_initial_tier} != expected ${f.expected_initial_tier}`);

    // Decoys: legitimate lines that must not trigger the rule they guard.
    const seedLines = new Set([...manifest.seeded, ...manifest.traps].flatMap((x) => x.line_item_ids));
    for (const d of manifest.decoys) {
      const items = d.line_item_ids.map((id) => {
        const i = byId.get(id);
        assert(!!i, `${dir}: ${d.decoy_id} points at missing ${id}`);
        assert(!seedLines.has(id), `${dir}: ${d.decoy_id} line ${id} is also a seed or trap line`);
        return i!;
      });
      switch (d.guards_rule) {
        case "D1-A3":
          for (let x = 0; x < items.length; x++)
            for (let y = x + 1; y < items.length; y++)
              assert(!exactDuplicate(items[x]!, items[y]!), `${dir}: ${d.decoy_id} would fire D1-A3`);
          if (d.canonical_id)
            for (const i of items) assert(drugAssessment(d, i, table) === null, `${dir}: ${d.decoy_id} ${i.id} would fire D2-P1`);
          break;
        case "D1-A4": {
          const classes = items.map((i) => oneTimeFeeClass(i.description_raw));
          assert(new Set(classes).size === classes.length, `${dir}: ${d.decoy_id} would fire D1-A4`);
          break;
        }
        case "D1-A5":
          for (const i of items)
            assert(i.category === "room" && i.quantity <= nights(bill) + ROOM_DAY_ALLOWANCE, `${dir}: ${d.decoy_id} would fire D1-A5`);
          break;
        case "D2-P1":
          for (const i of items) assert(drugAssessment(d, i, table) === null, `${dir}: ${d.decoy_id} ${i.id} would fire D2-P1`);
          break;
        case "D3-M1":
          for (const i of items) assert(i.quantity <= summary.icu_days, `${dir}: ${d.decoy_id} would fire D3-M1`);
          break;
        case "D3-M2":
          // Raised by the clinical LLM, so only the documentary support can be checked here.
          for (const i of items)
            if (/ventilat/i.test(i.description_raw)) assert(i.quantity <= summary.ventilator_days, `${dir}: ${d.decoy_id} exceeds ventilator_days`);
          assert(summary.procedures_performed.length > 0, `${dir}: ${d.decoy_id} has no documented procedure`);
          break;
      }
    }

    assert(bill.extraction_notes.some((x) => x.includes("Synthetic data")), `${dir}: synthetic label missing from truth`);
    for (const f of ["bill.html", "summary.html", "bill.truth.json", "summary.truth.json"]) {
      const text = readFileSync(`${base}/${f}`, "utf8");
      if (f.endsWith(".html")) assert(text.includes("Synthetic data"), `${dir}/${f}: "Synthetic data" label missing`);
      for (const w of BANNED_WORD_FRAGMENTS)
        assert(!text.toLowerCase().includes(w), `${dir}/${f}: contains a banned word`);
    }
    seeds += fresh.seeded.length;
    traps += fresh.traps.length;
    log.push(`PASS ${dir}: ${bill.items.length} items, ${fresh.seeded.length} seeds, ${fresh.traps.length} traps, ${manifest.decoys.length} decoys, total ₹${bill.stated_total.toFixed(2)}`);
    decoys += manifest.decoys.length;
  }
  assert(traps === 3, `Expected exactly 3 traps, got ${traps}`);
  assert(decoys === 9, `Expected 9 decoys, got ${decoys}`);
  log.push(`PASS reference: ${verified.length} of ${table.rows.length} rows verified; ${seeds} seeded errors; ${traps} traps; ${decoys} decoys`);
  return log;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  for (const line of checkFixtures()) console.log(line);
}
