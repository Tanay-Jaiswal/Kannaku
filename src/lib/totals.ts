// "₹ you can question" totals (SPEC 1, totals rule). Pure code, safe to import in the browser.
// Kept findings sorted Provable first, then by amount; a finding counts only if none of its lines overlaps
// a finding already counted. This understates rather than overstates. Empty line_item_ids never overlap.
import type { Finding } from "./schemas";
import { cents } from "./money";

type TotalsInput = Pick<Finding, "id" | "tier" | "status" | "amount_at_stake" | "line_item_ids">;

export function computeTotals(findings: TotalsInput[]) {
  const live = findings.filter((f) => f.status !== "dropped");
  const order = [...live].sort((a, b) => (a.tier === b.tier ? b.amount_at_stake - a.amount_at_stake : a.tier === "Provable" ? -1 : b.tier === "Provable" ? 1 : 0));
  const claimed = new Map<string, string>(); // line id -> finding id that counted it
  const overlaps: Record<string, string> = {}; // finding id -> the counted finding it overlaps
  let provable = 0, ask = 0;
  for (const f of order) {
    const hit = f.line_item_ids.find((id) => claimed.has(id));
    if (hit) { overlaps[f.id] = claimed.get(hit)!; continue; }
    f.line_item_ids.forEach((id) => claimed.set(id, f.id));
    if (f.tier === "Provable") provable += f.amount_at_stake;
    else if (f.tier === "Ask") ask += f.amount_at_stake;
  }
  return {
    totals: { provable: cents(provable), ask: cents(ask), questionable_total: cents(provable + ask), dropped_count: findings.length - live.length },
    overlaps,
  };
}
