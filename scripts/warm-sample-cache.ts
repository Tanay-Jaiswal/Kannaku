// Fills /cache for the three built-in synthetic samples by running the real pipeline with LIVE model calls.
// This is the only code path that writes the disk cache. It costs real API credit (Anthropic API billing is
// separate from any Claude.ai subscription), so it refuses to run without --yes.
// Run: npm run warm-samples -- --yes            (all three)
//      npm run warm-samples -- --yes bill-02-demo
// Needs ANTHROPIC_API_KEY, MODEL_EXTRACT and MODEL_REASON (in .env.local or the environment).
// The samples are pre-extracted, so this makes: 1 normalize + 1 clinical + 3 per finding (about 45 calls for all three).
import { SAMPLE_BILL_IDS } from "../src/lib/config";
import { runPipeline } from "../src/lib/pipeline";
import { loadSample } from "../src/lib/samples";
import { referenceTable } from "../src/lib/table";
import { evaluate } from "./eval";
import { writeSampleManifest } from "../src/lib/cache";

async function main() {
  try { process.loadEnvFile(".env.local"); } catch { /* optional */ }
  const args = process.argv.slice(2);
  const ids = SAMPLE_BILL_IDS.filter((id) => args.length <= 1 || args.includes(id));
  if (!args.includes("--yes")) {
    console.log(`This makes live, billed API calls for: ${ids.join(", ")} (roughly 45 calls in total for all three).`);
    console.log(`Models: MODEL_EXTRACT=${process.env.MODEL_EXTRACT ?? "(unset)"} MODEL_REASON=${process.env.MODEL_REASON ?? "(unset)"}`);
    console.log("Re-run with --yes to proceed. Already-cached steps are reused and cost nothing.");
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY || !process.env.MODEL_EXTRACT || !process.env.MODEL_REASON)
    throw new Error("Set ANTHROPIC_API_KEY, MODEL_EXTRACT and MODEL_REASON first (see .env.example).");
  // Sample runs replay with exactly these model ids, whatever the deployment's env says.
  writeSampleManifest({ extract_model: process.env.MODEL_EXTRACT, reason_model: process.env.MODEL_REASON, warmed_on: new Date().toISOString().slice(0, 10) });
  for (const id of ids) {
    const s = loadSample(id);
    const r = await runPipeline({
      billDraft: s.bill_draft, summaryDraft: s.summary_draft, dataLabel: "Synthetic data", table: referenceTable,
      ctx: { runId: `warm-${id}`, clientId: "warm", mode: "warm" }, log: (m) => console.log(`  ${id}: ${m}`),
    });
    console.table([evaluate(id, r)]);
  }
  console.log("Done. Review `git status cache/`, run `npx tsx scripts/eval.ts`, then commit the cache files.");
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
