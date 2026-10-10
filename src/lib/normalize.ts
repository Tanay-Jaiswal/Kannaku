// Phase 3: name normalization. The model maps drug/consumable lines to a reference-table canonical_id (or null)
// and reports the billed pack/unit. Code then enforces: ids must be lines we sent, canonical ids must exist in
// the table, every sent line answered once. D2 re-checks unit consistency before any price comparison.
import { NormalizationResult, type BillExtraction, type DrugTable } from "./schemas";
import { callJson } from "./llm/call";
import type { RunContext } from "./spend";

const NORMALIZE_CATEGORIES = new Set(["drug", "consumable"]);

export function normalizationInput(bill: BillExtraction, table: DrugTable) {
  return {
    lines: bill.items
      .filter((i) => NORMALIZE_CATEGORIES.has(i.category))
      .map((i) => ({ line_item_id: i.id, description_raw: i.description_raw, category: i.category, unit: i.unit ?? null, quantity: i.quantity })),
    reference_rows: table.rows.map((r) => ({
      canonical_id: r.canonical_id, generic_name: r.generic_name, strength: r.strength, form: r.form, route: r.route,
      table_unit: r.table_unit, allowed_pack_sizes: r.allowed_pack_sizes, brand_examples: r.brand_examples, aliases: r.aliases,
    })),
  };
}

export function normalizationProblems(out: NormalizationResult, sentIds: string[], table: DrugTable): string[] {
  const p: string[] = [];
  const known = new Set(table.rows.map((r) => r.canonical_id));
  const seen = new Set<string>();
  for (const n of out.items) {
    if (!sentIds.includes(n.line_item_id)) p.push(`unknown line_item_id ${n.line_item_id}`);
    if (seen.has(n.line_item_id)) p.push(`line ${n.line_item_id} answered twice`);
    seen.add(n.line_item_id);
    if (n.canonical_id != null && !known.has(n.canonical_id)) p.push(`canonical_id ${n.canonical_id} is not in reference_rows; use null`);
  }
  for (const id of sentIds) if (!seen.has(id)) p.push(`missing answer for ${id}`);
  return p;
}

export async function normalizeBill(bill: BillExtraction, table: DrugTable, ctx: RunContext) {
  const input = normalizationInput(bill, table);
  const sentIds = input.lines.map((l) => l.line_item_id);
  if (sentIds.length === 0) return { normalization: { items: [] } as NormalizationResult, meta: null };
  const r = await callJson({
    stage: "normalize", prompt: "normalize", modelKind: "extract", ctx,
    keyInput: { ...input, table_version: table.table_version },
    userText: JSON.stringify(input),
    schema: NormalizationResult,
    guard: (out) => normalizationProblems(out, sentIds, table),
  });
  return { normalization: r.output, meta: { prompt_version: r.promptVersion, model: r.model, cached: r.cached } };
}
