// Evaluation table (SPEC 3): runs the three synthetic samples through the full pipeline from the committed
// cache ONLY (no network, no cost) and compares with the answer keys. Candidates, kept and dropped are
// reported separately. Run: npx tsx scripts/eval.ts   (after npm run warm-samples)
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { SAMPLE_BILL_IDS } from "../src/lib/config";
import { sampleReviewSource } from "../src/lib/cache";
import { runPipeline } from "../src/lib/pipeline";
import { loadSample } from "../src/lib/samples";
import { referenceTable } from "../src/lib/table";
import type { PipelineResult } from "../src/lib/schemas";

type Row = { bill: string; candidates: number; kept: number; dropped: number; not_debated: number; seeds_found: string; seeds_kept: string; traps_dropped: string; decoys_raised: number; expected: string };

export function evaluate(dir: string, r: PipelineResult): Row {
  const key = JSON.parse(readFileSync(`data/synthetic/${dir}/answer_key.json`, "utf8"));
  const find = (ids: string[], rule?: string) => r.findings.find((f) => f.line_item_ids.join() === ids.join() && (!rule || f.rule_or_source_cited.rule_id === rule));
  const seeds = key.seeded.map((s: { line_item_ids: string[]; rule_id: string; acceptable_decisions: string[] }) => ({ s, f: find(s.line_item_ids, s.rule_id) }));
  const found = seeds.filter((x: { f?: unknown }) => x.f);
  const kept = found.filter((x: { f: PipelineResult["findings"][number]; s: { acceptable_decisions: string[] } }) =>
    x.f.status !== "dropped" || x.s.acceptable_decisions.includes("drop"));
  const traps = key.traps.map((t: { line_item_ids: string[] }) => find(t.line_item_ids));
  const decoyLines = new Set<string>(key.decoys.flatMap((d: { line_item_ids: string[] }) => d.line_item_ids));
  const t = key.evaluation_targets;
  return {
    bill: dir,
    candidates: r.findings.length,
    kept: r.findings.filter((f) => f.status !== "dropped").length,
    dropped: r.totals.dropped_count,
    not_debated: r.findings.filter((f) => f.review?.state === "not_debated").length,
    seeds_found: `${found.length}/${key.seeded.length}`,
    seeds_kept: `${kept.length}/${key.seeded.length}`,
    traps_dropped: `${traps.filter((f: PipelineResult["findings"][number] | undefined) => f?.status === "dropped").length}/${key.traps.length}` + (traps.some((f: unknown) => !f) ? " (trap not raised)" : ""),
    decoys_raised: r.findings.filter((f) => f.status !== "dropped" && f.line_item_ids.some((id) => decoyLines.has(id))).length,
    expected: `${t.expected_candidate_count} cand / ${t.expected_kept_count} kept / ${t.expected_dropped_count} dropped`,
  };
}

async function main() {
  const rows: Row[] = [];
  const source = sampleReviewSource();
  console.log(source === "recorded_ai"
    ? "Evaluating the RECORDED AI review replayed from cache/ (no network)."
    : "No recorded AI review in cache/: evaluating the PRECOMPUTED DEMONSTRATION. This checks the pipeline wiring on synthetic data; it is not a measure of AI quality.");
  for (const dir of SAMPLE_BILL_IDS) {
    const s = loadSample(dir);
    const r = await runPipeline({ billDraft: s.bill_draft, summaryDraft: s.summary_draft, dataLabel: "Synthetic data", table: referenceTable,
      ctx: { runId: `eval-${dir}`, clientId: "eval", mode: source === "recorded_ai" ? "sample" : "demo", sampleId: dir } });
    rows.push(evaluate(dir, r));
    if (r.warnings?.length || r.clinical_check?.state === "failed") console.log(`${dir}: ${[...(r.warnings ?? []), r.clinical_check?.state === "failed" ? r.clinical_check.note : ""].filter(Boolean).join(" | ")}`);
  }
  console.table(rows);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  try { process.loadEnvFile(".env.local"); } catch { /* optional */ }
  main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
