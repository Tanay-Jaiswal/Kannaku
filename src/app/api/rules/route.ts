// Pipeline stage "Matching prices": pure-code D1 + D2. POST { bill, normalization } -> { candidates, skipped_checks }.
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import tableJson from "../../../../data/reference/drug_reference.json";
import { DrugTable } from "@/lib/schemas";
import { runRules } from "@/lib/detectors";

const table = DrugTable.parse(tableJson);

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { bill?: unknown; normalization?: unknown };
    return NextResponse.json(runRules(body.bill, body.normalization, table));
  } catch (e) {
    if (e instanceof ZodError) return NextResponse.json({ error: "Invalid input", issues: e.issues }, { status: 400 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "Rule engine failed" }, { status: 500 });
  }
}
