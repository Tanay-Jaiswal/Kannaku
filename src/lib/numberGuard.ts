// Number guard (SPEC 0.4). Model-written text may mention a rupee amount or a percentage only if the same
// value was supplied by code (allowed tokens). Comparison is by value at paise precision, so "₹1,500" and
// "₹1,500.00" are the same token, but any figure the model computed or invented fails validation.
import { collectText } from "./tone";

const MONEY = /(?:₹|\bRs\.?|\bINR)\s*([0-9][0-9,]*(?:\.[0-9]+)?)|([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:rupees|\/-)/gi;
const PERCENT = /([0-9]+(?:\.[0-9]+)?)\s*(?:%|per\s?cent)/gi;

const toPaise = (s: string) => Math.round(Number(s.replace(/,/g, "")) * 100);

export type GuardTokens = { money: Set<number>; percent: Set<number> };

/** Builds the allowed set from code-supplied strings such as "₹1,500.00" or "12%". */
export function tokensFrom(strings: string[]): GuardTokens {
  const t: GuardTokens = { money: new Set(), percent: new Set() };
  for (const s of strings) {
    for (const m of s.matchAll(MONEY)) t.money.add(toPaise(m[1] ?? m[2]!));
    for (const m of s.matchAll(PERCENT)) t.percent.add(toPaise(m[1]!));
  }
  return t;
}

/** Every rupee amount or percentage in `value` (deep) that is not in `allowed`. Empty array = passes. */
export function numberGuardViolations(value: unknown, allowed: GuardTokens, opts: { checkPercent?: boolean } = {}): string[] {
  const bad: string[] = [];
  for (const text of collectText(value)) {
    for (const m of text.matchAll(MONEY)) if (!allowed.money.has(toPaise(m[1] ?? m[2]!))) bad.push(m[0].trim());
    if (opts.checkPercent !== false)
      for (const m of text.matchAll(PERCENT)) if (!allowed.percent.has(toPaise(m[1]!))) bad.push(m[0].trim());
  }
  return bad;
}
