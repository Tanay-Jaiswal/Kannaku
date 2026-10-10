# Kanakku

Adversarial AI hospital-bill auditor for Indian patients. Upload an itemized inpatient bill and the discharge summary; Kanakku finds charges to question, proves what it can from the documents, cross-examines every finding (Auditor, Defender, Judge) and drafts a polite letter to the billing desk.

**All demo data is synthetic** (`data/synthetic/`, labelled "Synthetic data" in the UI). The reference drug table is hand-curated; only 4 of 16 rows are `verified: true` (pantoprazole, ceftriaxone, amoxicillin-clavulanate, azithromycin). A finding that relies on a `verified: false` row is capped at Ask, shows "Illustrative reference value for demo, not official." and can never support a Provable finding. `verified: true` reflects the hackathon data gate, not regulatory certification. Kanakku is an informational tool, not legal, medical or insurance advice. See `SPEC.md` for the full design.

## How it works

| Step (UI label) | Route | Who does it |
|---|---|---|
| Reading bill | `POST /api/extract` (uploads, one call per document) then `POST /api/normalize` | Model copies the documents into JSON with explicit nulls for anything unreadable; code assigns line ids, reconciles stay dates, and validates. Model maps drug names to the reference table; code rejects unknown ids. |
| Matching prices | `POST /api/rules` | Code only: D1 arithmetic/duplicates/room days, D2 drug price vs printed MRP / reference MRP / NPPA ceiling incl. GST. |
| Checking clinical notes | `POST /api/clinical` | D3: ICU days by code; "not in summary" candidates proposed by the model (it never sees a rupee amount), validated and priced by code. |
| Cross-examining findings | `POST /api/debate` (one step per call, 3 findings at a time) | Auditor, Defender, Judge. Code enforces the Judge: tier can only go down, the amount never changes, a Provable finding is dropped only on a basis error, an Ask finding only with documentary support. |
| Totalling | `POST /api/finalize` | Code re-runs the rules on the server, re-derives every amount, applies the Judge constraints and the de-duplicated totals rule. |

Every model output is zod-validated, checked by the **number guard** (any rupee figure or percentage must be one code supplied) and the **tone lint** (banned words), retried once with the error, and otherwise rejected with a clear message. Prompts are versioned files in `prompts/`. The letter is built by code from the findings you tick (no model call), is editable, and prints or saves as PDF from the browser.

Partial results are explicit: if a model step fails or the budget runs out, the rule findings still appear, un-debated findings are marked "not cross-examined", and an amber "This audit is partial" panel says what did not run. A failed audit is never shown as a clean bill.

## Install and run locally

Requires Node.js 20.9 or newer.

```bash
npm install
cp .env.example .env.local     # then edit; leave KANAKKU_CACHE_ONLY=1 to spend nothing
npm run dev                    # http://localhost:3000
```

- **Sample bills** run from the committed cache only and never call the API. Until the cache is warmed (below), a sample shows a clearly-labelled partial result: the code checks (arithmetic, duplicates, room days, ICU days) run, the AI steps show as not run.
- **Uploads** (PDF, JPEG, PNG or WebP, up to 4 MB and 8 PDF pages each) need `ANTHROPIC_API_KEY`, `MODEL_EXTRACT`, `MODEL_REASON` and `KANAKKU_CACHE_ONLY=0`. Uploaded documents are never written to disk or to the cache directory; their AI results are cached in memory only. The patient's name is never copied from an upload.

## Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Server-side only. Anthropic API billing is separate from a Claude.ai (Pro) subscription. |
| `MODEL_EXTRACT`, `MODEL_REASON` | Model ids. Suggested: `claude-haiku-5-5` (extraction, normalization) and `claude-opus-5-5` (clinical check, debate); `claude-sonnet-5-5` is a cheaper reasoning option. Confirm on the Anthropic "Models overview" page. |
| `KANAKKU_CACHE_ONLY` | Live calls happen only when this is exactly `0`. Unset or `1` = cache-only (safe default for a public demo). |
| `KANAKKU_MAX_CALLS_PER_RUN` (45), `KANAKKU_MAX_TOKENS_PER_RUN` (250000) | Per-audit budget. |
| `KANAKKU_MAX_TOKENS_PER_DAY` (2000000) | Per server instance per UTC day. |
| `KANAKKU_MAX_RUNS_PER_HOUR` (3) | New live audits per client IP per hour. |
| `KANAKKU_MAX_OUTPUT_TOKENS` (4000), `KANAKKU_TIMEOUT_MS` (60000) | Per model call. |
| `KANAKKU_MAX_DEBATE_FINDINGS` (12) | Findings sent through the debate; the rest are shown un-debated, highest-value first are debated. |
| `KANAKKU_MAX_UPLOAD_MB` (4), `KANAKKU_MAX_PDF_PAGES` (8) | Upload limits. |
| `KANAKKU_CACHE_DIR` | Optional; defaults to `./cache`. |

### Cost protections

1. Samples are cache-only in code, whatever the env says, and the UI says when a sample has no saved review.
2. Uploads are off unless `KANAKKU_CACHE_ONLY=0` and the key and both models are set; the UI explains why when they are off.
3. Per-audit call and token budgets, per-IP hourly audit limit, daily token cap, `max_tokens` and timeout on every call, one SDK retry for transient errors plus one validation retry, debate capped per audit and stopped early on budget, rate-limit or configuration errors.
4. These guards live in server memory, so several serverless instances each get their own counters. **Set a monthly spend limit in the Anthropic Console**; that is the hard cap.

A live audit of a bill like `bill-02-demo` makes roughly 2 extraction + 1 normalization + 1 clinical + 3 per finding (about 25 calls).

## Warm the sample cache (one-time, costs API credit)

```bash
npm run warm-samples                 # shows what it would do, spends nothing
npm run warm-samples -- --yes        # runs all three samples live (about 45 calls), writes cache/ and cache/manifest.json
npm run eval                         # replays the samples from cache only and prints the evaluation table
git add cache && git commit -m "Warm sample cache"
```

The samples are pre-extracted (their truth JSON is what a perfect extractor returns), so warming covers normalization, the clinical check and the debate. `cache/manifest.json` records which models produced the cache; sample runs replay with those models even on a deployment with no key. Warm all three samples with the same models. Review the eval table: it reports candidates, kept and dropped separately, seed recall, traps dropped (target 3) and decoys raised (target 0).

## Test

```bash
npm test                             # vitest; mocked model provider, no network, no API key
npm run typecheck
npm run build
npx tsx scripts/check-fixtures.ts    # fixture, answer-key and reference-table consistency
npx tsx scripts/make-answer-keys.ts  # regenerate answer keys from truth JSON (only when fixtures change)
```

The pipeline tests use a scripted mock model driven by the answer keys, so they check plumbing and code-enforced rules (ids, caps, tier enforcement, totals, partial results, budgets), not real model quality. Real quality is measured with `npm run eval` after warming the cache.

## Deploy (Vercel)

1. Import the GitHub repo in Vercel (framework: Next.js; build `npm run build`).
2. Set environment variables. For a public demo: `KANAKKU_CACHE_ONLY=1` and no key (samples replay from cache, uploads are off). To allow uploads: add the key, both models and `KANAKKU_CACHE_ONLY=0`, keep the spend-guard defaults, and set a Console spend limit.
3. `next.config.mjs` bundles `prompts/`, `cache/` and `data/synthetic/` into the API functions. Each route sets `maxDuration = 60` (VERIFY against your plan's function limits).

## Decisions and deviations from SPEC.md

- **Letter**: built by code, not by the `letter.v1` model prompt, and printed via the browser (Save as PDF) instead of `pdf-lib`. No extra model call or dependency, no ₹-glyph font problem, and it cannot introduce a figure.
- **D3-M1 (ICU days)** is computed by code directly; model ICU candidates are ignored. It is a pure numeric comparison, and this keeps it running when the model fails.
- **Debate** runs one step per request (`/api/debate` with `step`) so each request makes at most one model call and stays under serverless time limits.
- **Disk cache** holds only the synthetic samples (written by the warm script). Uploaded documents are cached in memory only, so a real bill can never be committed.
- **Additive schema fields**: `BillExtraction.extraction_quality` (unreadable lines, missing rates/dates/total, so checks that cannot run honestly are skipped and logged), `Finding.review` and `Finding.enforcement_notes`, `PipelineResult.warnings` and `clinical_check`.
- **Dependency added**: `@anthropic-ai/sdk` (on the SPEC's approved list). No other runtime dependency.

## Known limitations

- The sample cache is not warmed yet in this repo (no API key was available while building), so samples currently show the partial, code-only result until `npm run warm-samples -- --yes` is run.
- Extraction accuracy on real scans is untested here; the results page shows "Bill lines as read" so the user can compare with the paper bill.
- HEIC photos are rejected (convert to JPEG); PDFs whose page objects are compressed cannot be page-counted before upload (the provider still enforces its limit).
- In-memory spend counters reset per serverless instance (see Cost protections).
- Drugs not in the 16-row reference table are not priced; they are listed under "Checks skipped".
