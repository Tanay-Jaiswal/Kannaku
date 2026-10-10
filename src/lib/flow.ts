// Pure helpers shared by the browser workflow and the in-process pipeline (scripts, tests), so both build
// identical requests and therefore hit the same cache entries. No Node imports here.
import type { CandidateFinding } from "./schemas";

/** Finding ids are assigned by code, in pipeline order: D1/D2 candidates first, then D3. */
export function numberCandidates(rules: CandidateFinding[], clinical: CandidateFinding[]) {
  return [...rules, ...clinical].map((c, i) => ({ ...c, id: `F-${String(i + 1).padStart(3, "0")}` }));
}

/** Which numbered candidates get the (paid) debate: the first `limit`, by tier then amount, so the most
 *  important ones are cross-examined if the budget is small. */
export function debateOrder<T extends CandidateFinding & { id: string }>(cands: T[], limit: number): { debate: T[]; skip: T[] } {
  const ranked = [...cands].sort((a, b) => (a.initial_tier === b.initial_tier ? b.amount_at_stake - a.amount_at_stake : a.initial_tier === "Provable" ? -1 : 1));
  const chosen = new Set(ranked.slice(0, Math.max(0, limit)).map((c) => c.id));
  return { debate: cands.filter((c) => chosen.has(c.id)), skip: cands.filter((c) => !chosen.has(c.id)) };
}
