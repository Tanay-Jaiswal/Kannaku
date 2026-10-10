// Central constants. Thresholds live here so detectors and tests share one source of truth.

/** Rupee tolerance for line/total arithmetic (absorbs rounding on printed bills). */
export const ROUNDING_TOL = 1.0;

/** Relative tolerance on per-unit rate comparisons (D2). 0.005 = 0.5%. */
export const PRICE_TOL = 0.005;

/** If a bill's printed MRP differs from the table by more than this, log it and use the bill's MRP (D2-P3). */
export const PRINTED_MRP_DIVERGENCE = 0.05;

/** Max D3 (bill-vs-summary) candidates per run, to bound debate cost and demo time. */
export const MAX_D3_CANDIDATES = 6;

/** Debate calls run this many findings at a time. */
export const DEBATE_CONCURRENCY = 3;

/** Room bed-days allowed = nights + this (some hospitals count admission and discharge day). */
export const ROOM_DAY_ALLOWANCE = 1;

/**
 * One-time admin fees (D1-A4). Each class is one fee that should appear once per stay.
 * D1-A4 fires only when 2+ lines fall in the SAME class (the same fee repeated),
 * never just because two different admin fees appear.
 */
export const ONE_TIME_FEE_CLASSES = {
  admission_registration: /registration|admission/i,
  discharge_processing: /discharge\s*(processing|summary)/i,
  file_processing: /\bfile\b|record processing/i,
} as const;
export type OneTimeFeeClass = keyof typeof ONE_TIME_FEE_CLASSES;

/** First matching one-time fee class for a bill description, or null. */
export function oneTimeFeeClass(description: string): OneTimeFeeClass | null {
  for (const [k, re] of Object.entries(ONE_TIME_FEE_CLASSES)) if (re.test(description)) return k as OneTimeFeeClass;
  return null;
}

/** Words that must never appear in user-facing text. Enforced by tone.ts, kept as fragments. */
export const BANNED_WORD_FRAGMENTS = ["fra" + "ud", "sc" + "am", "ill" + "egal"];

export const DISCLAIMER =
  "Kanakku is an informational tool, not legal, medical or insurance advice. " +
  "Items listed are charges to question and confirm with the billing desk. " +
  "Reference benchmarks are not legal limits. Demo data is synthetic.";

export const SPEC_VERSION = "0.3";

/** Shown on every finding, README line and letter that depends on a drug row with verified=false. */
export const UNVERIFIED_REFERENCE_LABEL = "Illustrative reference value for demo, not official.";

/** Model ids come from env; never hardcoded. Verify names against the Anthropic docs. */
export const models = {
  extract: () => requireEnv("MODEL_EXTRACT"),
  reason: () => requireEnv("MODEL_REASON"),
};

export const cacheOnly = () => process.env.KANAKKU_CACHE_ONLY === "1";

/** IDs of the built-in demo bills. These always run from the committed cache, never live (SPEC 0.7). */
export const SAMPLE_BILL_IDS = ["bill-01-clean", "bill-02-demo", "bill-03-errors"] as const;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}. See .env.example.`);
  return v;
}
