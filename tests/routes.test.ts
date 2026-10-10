// API route handlers called directly (no server). Provider is mocked; nothing touches the network.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { POST as extract } from "../src/app/api/extract/route";
import { POST as normalize } from "../src/app/api/normalize/route";
import { POST as rules } from "../src/app/api/rules/route";
import { POST as clinical } from "../src/app/api/clinical/route";
import { POST as debate } from "../src/app/api/debate/route";
import { POST as finalizeRoute } from "../src/app/api/finalize/route";
import { GET as sample } from "../src/app/api/sample/route";
import { GET as sampleDoc } from "../src/app/api/sample/document/route";
import { GET as config } from "../src/app/api/config/route";
import { setProviderForTests } from "../src/lib/llm/call";
import { clearMemoryCache, writeSampleManifest } from "../src/lib/cache";
import { resetSpendState } from "../src/lib/spend";
import { MockProvider, testEnv } from "./helpers/mockProvider";
import { scriptedModel } from "./helpers/scriptedModel";

const RUN = "run-route-0001";
const json = (url: string, body: unknown) => new Request(`http://t${url}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const form = (fields: Record<string, string | Blob>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return new Request("http://t/api/extract", { method: "POST", body: f });
};
const pdfBlob = () => new Blob([Buffer.from("%PDF-1.7\n1 0 obj << /Type /Page >> endobj\n%%EOF\n", "latin1")], { type: "application/pdf" });
const rawBill = {
  is_itemized_hospital_bill: true, problem: null, hospital_name: "Synthetic", admission_date: "2026-08-01", discharge_date: "2026-08-03",
  items: [{ date: "2026-08-01", time: null, category: "room", description_raw: "Room", quantity: 2, unit: "day", unit_rate: 1000, amount: 2000, printed_mrp: null, source_page: 1, legibility: "clear" }],
  stated_subtotal: null, stated_discount: null, stated_total: 2000, notes: [],
};
const samplePayload = async () => {
  const b = (await (await sample(new Request("http://t/api/sample?id=bill-02-demo"))).json()) as { bill_draft: unknown; summary_draft: unknown };
  return { bill_draft: b.bill_draft, summary_draft: b.summary_draft }; // no sample_id: treated as a live run in these tests
};

beforeEach(() => {
  testEnv(mkdtempSync(path.join(tmpdir(), "kanakku-routes-")));
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-secret-do-not-leak";
  clearMemoryCache();
  resetSpendState();
});
afterEach(() => setProviderForTests(null));

describe("/api/extract", () => {
  it("validates the request and the file before any model call", async () => {
    const mock = new MockProvider();
    setProviderForTests(mock);
    expect((await extract(form({ kind: "bill", run_id: RUN }))).status).toBe(400);
    expect((await extract(form({ kind: "invoice", run_id: RUN, file: pdfBlob() }))).status).toBe(400);
    expect((await extract(form({ kind: "bill", file: pdfBlob() }))).status).toBe(400); // no run id
    const bad = await extract(form({ kind: "bill", run_id: RUN, file: new Blob(["<html>"]) }));
    expect(bad.status).toBe(415);
    expect((await bad.json()).error.message).toMatch(/PDF, JPEG, PNG or WebP/);
    expect(mock.calls).toHaveLength(0);
  });

  it("refuses live extraction in cache-only mode with a clear message", async () => {
    delete process.env.KANAKKU_CACHE_ONLY;
    const r = await extract(form({ kind: "bill", run_id: RUN, file: pdfBlob() }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatchObject({ code: "LIVE_DISABLED" });
  });

  it("extracts with the (mock) model when live mode is on, sending the PDF as a document block", async () => {
    const mock = new MockProvider([rawBill]);
    setProviderForTests(mock);
    const r = await extract(form({ kind: "bill", run_id: RUN, file: pdfBlob() }));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.draft.items[0]).toMatchObject({ id: "L001", amount: 2000 });
    expect(mock.calls[0]!.content[0]).toMatchObject({ type: "document", source: { media_type: "application/pdf" } });
    expect(mock.calls[0]!.model).toBe("mock-extract-model");
  });

  it("a provider failure becomes a safe error body that never contains the key", async () => {
    setProviderForTests(new MockProvider(["nope", "still nope"]));
    const r = await extract(form({ kind: "summary", run_id: RUN, file: pdfBlob() }));
    expect(r.status).toBe(502);
    const text = await r.text();
    expect(text).toMatch(/MODEL_OUTPUT_INVALID/);
    expect(text).not.toMatch(/sk-ant/);
  });
});

describe("sample routes", () => {
  it("serves pre-extracted synthetic drafts and the printable documents", async () => {
    const r = await sample(new Request("http://t/api/sample?id=bill-02-demo"));
    const body = await r.json();
    expect(body).toMatchObject({ sample_id: "bill-02-demo", data_label: "Synthetic data" });
    expect(body.bill_draft.items).toHaveLength(40);
    expect((await sample(new Request("http://t/api/sample?id=../../etc"))).status).toBe(400);
    const doc = await sampleDoc(new Request("http://t/api/sample/document?id=bill-02-demo&kind=summary"));
    expect(await doc.text()).toMatch(/Synthetic/i);
    expect((await sampleDoc(new Request("http://t/api/sample/document?id=bill-02-demo&kind=../x"))).status).toBe(400);
  });

  it("with no recorded review, sample normalize uses the labelled demonstration script and never calls a provider", async () => {
    const mock = new MockProvider();
    setProviderForTests(mock);
    const r = await normalize(json("/api/normalize", { run_id: RUN, sample_id: "bill-02-demo", ...(await samplePayload()) }));
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.normalize_error).toBeUndefined();
    expect(body.meta.model).toBe("kanakku-demonstration-script");
    expect(body.bill.items).toHaveLength(40);
    expect(mock.calls).toHaveLength(0);
  });

  it("with a recorded-review manifest but a cold cache, sample normalize degrades to a partial result instead of spending", async () => {
    writeSampleManifest({ extract_model: "m-extract", reason_model: "m-reason", warmed_on: "2026-10-10" });
    const mock = new MockProvider();
    setProviderForTests(mock);
    const r = await normalize(json("/api/normalize", { run_id: RUN, sample_id: "bill-02-demo", ...(await samplePayload()) }));
    const body = await r.json();
    expect(r.status).toBe(200);
    expect(body.normalize_error.code).toBe("CACHE_MISS");
    expect(mock.calls).toHaveLength(0);
  });
});

describe("pipeline routes", () => {
  it("rules: invalid input is a 400 with issues; valid input returns candidates", async () => {
    const bad = await rules(json("/api/rules", { bill: { items: [] }, normalization: { items: [] } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe("BAD_INPUT");
    const p = await samplePayload();
    setProviderForTests(new MockProvider([], scriptedModel("bill-02-demo")));
    const n = await (await normalize(json("/api/normalize", { run_id: RUN, ...p }))).json();
    expect(n.normalize_error).toBeUndefined();
    const ok = await (await rules(json("/api/rules", { bill: n.bill, normalization: n.normalization }))).json();
    expect(ok.candidates.map((c: { rule_or_source_cited: { rule_id: string } }) => c.rule_or_source_cited.rule_id).sort()).toEqual(["D1-A1", "D1-A3", "D1-A4", "D2-P1", "D2-P1"]);
  });

  it("clinical + debate + finalize work end to end through the routes", async () => {
    setProviderForTests(new MockProvider([], scriptedModel("bill-02-demo")));
    const p = await samplePayload();
    const n = await (await normalize(json("/api/normalize", { run_id: RUN, ...p }))).json();
    const cl = await (await clinical(json("/api/clinical", { run_id: RUN, bill: n.bill, summary: n.summary }))).json();
    expect(cl.candidates.map((c: { line_item_ids: string[] }) => c.line_item_ids[0])).toEqual(["L002", "L012"]);
    const candidate = { ...cl.candidates[0], id: "F-001" };
    const base = { run_id: RUN, candidate, bill: n.bill, summary: n.summary };
    expect((await debate(json("/api/debate", { ...base, step: "judge" }))).status).toBe(400); // out of order
    const au = await (await debate(json("/api/debate", { ...base, step: "auditor" }))).json();
    const de = await (await debate(json("/api/debate", { ...base, step: "defender", prior: { auditor: au.output } }))).json();
    const ju = await (await debate(json("/api/debate", { ...base, step: "judge", prior: { auditor: au.output, defender: de.output } }))).json();
    expect(ju.log).toMatchObject({ role: "judge", model: "mock-reason-model" });
    const fin = await finalizeRoute(json("/api/finalize", {
      run_id: RUN, data_label: "Synthetic data", bill: n.bill, summary: n.summary, normalization: n.normalization,
      items: [{ candidate, steps: { auditor: au.output, defender: de.output, judge: ju.output }, logs: [au.log, de.log, ju.log] }],
      clinical_check: { state: "done", note: "ok" },
    }));
    const result = await fin.json();
    expect(result.findings[0]).toMatchObject({ id: "F-001", status: "dropped", amount_at_stake: 23000 }); // trap T2 dropped
  });

  it("finalize: a non-JSON body is a 400", async () => {
    const r = await finalizeRoute(new Request("http://t/api/finalize", { method: "POST", body: "{not json" }));
    expect(r.status).toBe(400);
  });
});

describe("/api/config", () => {
  it("reports capabilities without exposing the key", async () => {
    const text = await (await config()).text();
    expect(text).not.toMatch(/sk-ant/);
    expect(JSON.parse(text)).toMatchObject({ live_uploads_enabled: true, max_upload_mb: 4 });
    delete process.env.KANAKKU_CACHE_ONLY;
    expect(await (await config()).json()).toMatchObject({ live_uploads_enabled: false, live_uploads_reason: "cache_only" });
  });
  it("says whether the warmed sample review is present, so the UI never implies a full sample run", async () => {
    expect(await (await config()).json()).toMatchObject({ sample_review_saved: false, sample_review_source: "demonstration" }); // fresh temp cache dir
    writeSampleManifest({ extract_model: "m-extract", reason_model: "m-reason", warmed_on: "2026-10-10" });
    const body = await (await config()).json();
    expect(body).toMatchObject({ sample_review_saved: true, sample_review_source: "recorded_ai" });
    expect(JSON.stringify(body)).not.toMatch(/m-extract|m-reason/); // model ids are not exposed
  });
});
