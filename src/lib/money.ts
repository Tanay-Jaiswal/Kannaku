// Small money/date helpers shared by detectors. All rupee maths is plain TypeScript, never an LLM.

/** Round to paise (2dp). */
export const cents = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** "₹1,200.00" (Indian digit grouping). Used for evidence strings and number-guard tokens. */
export const formatRupees = (n: number): string =>
  "₹" + cents(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Whole days between two ISO dates (YYYY-MM-DD); negative if `to` is earlier. NaN if either is invalid. */
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Number-guard tokens (SPEC 0.4): the stake plus every rupee amount or percentage string in the evidence. */
export function allowedTokens(evidence: Record<string, string | number | boolean>, stake: number): string[] {
  const out = new Set<string>([formatRupees(stake)]);
  for (const v of Object.values(evidence)) if (typeof v === "string" && /^₹[\d,]+\.\d{2}$|^\d+(\.\d+)?%$/.test(v)) out.add(v);
  return [...out];
}
