// Precomputed demonstration review for the three built-in SYNTHETIC samples (server only).
//
// Used only when a sample runs on a deployment without a recorded AI review (no cache/manifest.json). No AI
// model is called and nothing is spent. Instead of a model answer, each AI stage gets a scripted answer:
//   - WHAT is found and WHETHER each finding is kept or dropped comes from the verified fixture
//     data/synthetic/<bill>/seed_manifest.json (seeds are kept, traps are dropped, decoys are never raised);
//   - the wording comes from data/demo/demo_review.json, with every figure filled in by code from the
//     finding's code-computed facts.
// The scripted answer then goes through exactly the same checks as a live answer (zod schema, number guard,
// tone lint, line-id checks, code-enforced Judge rules, server re-derivation in finalize). The UI labels the
// result "Precomputed demonstration"; it is never presented as a live AI review.
import demoReview from "../../data/demo/demo_review.json";
import manifest01 from "../../data/synthetic/bill-01-clean/seed_manifest.json";
import manifest02 from "../../data/synthetic/bill-02-demo/seed_manifest.json";
import manifest03 from "../../data/synthetic/bill-03-errors/seed_manifest.json";
import truth01 from "../../data/synthetic/bill-01-clean/bill.truth.json";
import truth02 from "../../data/synthetic/bill-02-demo/bill.truth.json";
import truth03 from "../../data/synthetic/bill-03-errors/bill.truth.json";
import { KanakkuError } from "./errors";
import { referenceTable } from "./table";

export { DEMO_MODEL } from "./config";

type Ref = { rule_id: string; line_item_ids: string[]; canonical_id?: string; billed_brand?: string };
type Seed = Ref & { seed_id: string; expected_initial_tier: string; acceptable_decisions?: string[] };
type Trap = Ref & { trap_id: string };
type Manifest = { seeded: Seed[]; traps: Trap[]; decoys: (Omit<Ref, "rule_id"> & { decoy_id: string })[] };
type RoleText = Record<string, string | string[]>;
type Script = { auditor: RoleText; defender: RoleText; judge: RoleText; clinical?: { summary_evidence: string; reasoning: string } };

// Static imports (not runtime file reads) so the bundler includes exactly these fixture files.
const FIXTURES: Record<string, { manifest: unknown; truth: unknown }> = {
  "bill-01-clean": { manifest: manifest01, truth: truth01 },
  "bill-02-demo": { manifest: manifest02, truth: truth02 },
  "bill-03-errors": { manifest: manifest03, truth: truth03 },
};

const loaded = new Map<string, { manifest: Manifest; scripts: Record<string, Script>; truth: Map<string, string> }>();
function sample(id: string) {
  if (!loaded.has(id)) {
    const fx = FIXTURES[id];
    if (!fx) throw new KanakkuError("BAD_INPUT", "Unknown sample id.", `demo sample ${id}`);
    const truth = fx.truth as { items: { id: string; description_raw: string }[] };
    loaded.set(id, {
      manifest: fx.manifest as Manifest,
      scripts: (demoReview as unknown as Record<string, Record<string, Script>>)[id] ?? {},
      truth: new Map(truth.items.map((i) => [i.id, i.description_raw])),
    });
  }
  return loaded.get(id)!;
}

/** The demonstration only covers the sample's own documents: every line it is asked about must be on the sample bill. */
function assertSampleLines(id: string, lines: { id: string; description_raw: string }[]) {
  const { truth } = sample(id);
  for (const l of lines)
    if (truth.get(l.id) !== l.description_raw)
      throw new KanakkuError("BAD_INPUT", "The demonstration review only covers the built-in sample documents.", `demo line mismatch ${l.id}`);
}

/** Fills {facts.<key>} from code-computed facts. A missing fact is a bug in the script, so it fails loudly. */
function fill(text: string, facts: Record<string, string>): string {
  return text.replace(/\{facts\.([a-z_]+)\}/g, (_, k: string) => {
    if (!(k in facts)) throw new KanakkuError("MODEL_OUTPUT_INVALID", "The demonstration script is out of date for this sample.", `demo fact missing: ${k}`);
    return facts[k]!;
  });
}

const sameIds = (a: string[], b: string[]) => a.join(",") === b.join(",");

/** Seed or trap behind a candidate, matched by rule and line ids (the same keys the answer keys use). */
function outcomeFor(id: string, rule: string, ids: string[]) {
  const { manifest, scripts } = sample(id);
  const seed = manifest.seeded.find((s) => s.rule_id === rule && sameIds(s.line_item_ids, ids));
  const trap = manifest.traps.find((t) => t.rule_id === rule && sameIds(t.line_item_ids, ids));
  const key = seed?.seed_id ?? trap?.trap_id;
  const script = key ? scripts[key] : undefined;
  if (!key || !script)
    throw new KanakkuError("MODEL_OUTPUT_INVALID", "No demonstration review was prepared for this finding.", `demo script missing ${rule} ${ids.join(",")}`);
  return { trap: !!trap, provable: seed?.expected_initial_tier === "Provable", script };
}

type DebateInput = { finding: { rule: { rule_id: string }; line_items: { id: string; description_raw: string }[] }; facts: Record<string, string> };

/** The scripted answer for one AI stage. Shapes match the stage's zod schema; callJson validates them. */
export function demoAnswer(stage: string, sampleId: string, input: unknown): unknown {
  const { manifest, scripts } = sample(sampleId);
  switch (stage) {
    case "normalize": {
      const lines = (input as { lines: { line_item_id: string; description_raw: string; unit: string | null }[] }).lines;
      assertSampleLines(sampleId, lines.map((l) => ({ id: l.line_item_id, description_raw: l.description_raw })));
      const refs = [...manifest.seeded, ...manifest.traps, ...manifest.decoys].filter((r) => r.canonical_id);
      return {
        items: lines.map((l) => {
          const ref = refs.find((r) => r.line_item_ids.includes(l.line_item_id));
          const row = ref && referenceTable.rows.find((r) => r.canonical_id === ref.canonical_id);
          return row
            ? { line_item_id: l.line_item_id, canonical_id: row.canonical_id, canonical_name: row.generic_name, billed_unit: row.table_unit,
                units_per_billed_unit: 1, billed_brand: ref!.billed_brand ?? null, match_confidence: "high",
                rationale: "Demonstration: matched from this synthetic sample's verified fixture." }
            : { line_item_id: l.line_item_id, canonical_id: null, canonical_name: null, billed_unit: null, units_per_billed_unit: null,
                billed_brand: null, match_confidence: "low", rationale: "Demonstration: no reference-table row for this line in the sample's fixture." };
        }),
      };
    }
    case "clinical": {
      const bill = (input as { bill_items: { id: string; description_raw: string }[] }).bill_items;
      assertSampleLines(sampleId, bill);
      const m2 = [...manifest.seeded.map((s) => ({ key: s.seed_id, ...s })), ...manifest.traps.map((t) => ({ key: t.trap_id, ...t }))]
        .filter((x) => x.rule_id === "D3-M2");
      return {
        candidates: m2.map((x) => {
          const c = scripts[x.key]?.clinical;
          if (!c) throw new KanakkuError("MODEL_OUTPUT_INVALID", "No demonstration review was prepared for this finding.", `demo clinical text missing ${x.key}`);
          return { kind: "NOT_IN_SUMMARY", line_item_ids: x.line_item_ids, summary_evidence: c.summary_evidence, reasoning: c.reasoning, confidence: "medium" };
        }),
      };
    }
    case "debate_auditor":
    case "debate_defender":
    case "debate_judge": {
      const d = input as DebateInput;
      assertSampleLines(sampleId, d.finding.line_items);
      const o = outcomeFor(sampleId, d.finding.rule.rule_id, d.finding.line_items.map((l) => l.id));
      const t = (role: keyof Script, k: string) => fill(String((o.script[role] as RoleText)[k] ?? ""), d.facts);
      if (stage === "debate_auditor")
        return {
          claim: t("auditor", "claim"),
          evidence: [{ source: "bill", ref: d.finding.line_items.map((l) => l.id).join(", ") || "bill totals", point: t("auditor", "evidence_point") }],
          why_it_matters: t("auditor", "why_it_matters"),
          confidence: o.trap ? "medium" : "high",
        };
      if (stage === "debate_defender")
        return {
          strongest_justification: t("defender", "strongest_justification"),
          supporting_points: ((o.script.defender.supporting_points as string[] | undefined) ?? []).map((p) => fill(p, d.facts)),
          // A trap is explained by the documents; a seed is not. A rule-proven (Provable) seed is conceded.
          verifiable_from_documents: o.trap,
          what_would_confirm: t("defender", "what_would_confirm"),
          concedes: o.provable && !o.trap,
        };
      return {
        decision: o.trap ? "drop" : "keep",
        rationale: t("judge", "rationale"),
        counter_argument: t("judge", "counter_argument"),
        question_for_billing_desk: t("judge", "question_for_billing_desk"),
        confidence: "medium",
        basis_error: false,
      };
    }
    default:
      throw new KanakkuError("BAD_INPUT", "This step has no demonstration review.", `demo stage ${stage}`);
  }
}
