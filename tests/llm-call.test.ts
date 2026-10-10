import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { callJson, extractJson, setProviderForTests } from "../src/lib/llm/call";
import { mapProviderError } from "../src/lib/llm/provider";
import { clearMemoryCache, cacheKey } from "../src/lib/cache";
import { loadPrompt } from "../src/lib/prompts";
import { resetSpendState, type RunContext } from "../src/lib/spend";
import { KanakkuError } from "../src/lib/errors";
import { MockProvider, testEnv } from "./helpers/mockProvider";

const Out = z.object({ answer: z.string() });
let dir: string;
let mock: MockProvider;
const ctx = (o: Partial<RunContext> = {}): RunContext => ({ runId: "run-test-0001", clientId: "client-a", mode: "live", ...o });
const call = (o: Partial<Parameters<typeof callJson<{ answer: string }>>[0]> = {}) =>
  callJson({ stage: "normalize", prompt: "normalize", modelKind: "extract", keyInput: { q: 1 }, userText: "{}", schema: Out, ctx: ctx(), ...o });
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { return e as KanakkuError; } throw new Error("expected failure"); };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "kanakku-cache-"));
  testEnv(dir);
  mock = new MockProvider();
  setProviderForTests(mock);
  clearMemoryCache();
  resetSpendState();
});
afterEach(() => {
  setProviderForTests(null);
  for (const k of ["KANAKKU_MAX_CALLS_PER_RUN", "KANAKKU_MAX_RUNS_PER_HOUR", "KANAKKU_MAX_TOKENS_PER_DAY", "KANAKKU_MAX_TOKENS_PER_RUN"]) delete process.env[k];
});

describe("callJson: validation, retry and cache", () => {
  it("parses fenced JSON, validates it, and serves the second identical call from cache", async () => {
    mock.push("Here you go:\n```json\n{\"answer\":\"yes\"}\n```");
    expect((await call()).output).toEqual({ answer: "yes" });
    const again = await call();
    expect(again).toMatchObject({ output: { answer: "yes" }, cached: true });
    expect(mock.calls).toHaveLength(1);
  });

  it("retries once with the validation error appended, then succeeds", async () => {
    mock.push("not json", { answer: "fixed" });
    expect((await call()).output).toEqual({ answer: "fixed" });
    expect(mock.calls).toHaveLength(2);
    expect((mock.calls[1]!.content.at(-1) as { text: string }).text).toMatch(/PREVIOUS ANSWER WAS REJECTED: output was not valid JSON/);
  });

  it("fails loudly after two invalid answers and caches nothing", async () => {
    mock.push({ answer: 5 }, { wrong: true });
    const e = await fails(call());
    expect(e.code).toBe("MODEL_OUTPUT_INVALID");
    expect(e.detail).toMatch(/schema errors/);
    mock.push({ answer: "later" });
    expect((await call()).cached).toBe(false);
  });

  it("runs stage guards (e.g. number guard) and retries on a violation", async () => {
    mock.push({ answer: "you owe ₹999" }, { answer: "fine" });
    const r = await call({ guard: (o) => (o.answer.includes("₹") ? ["invented rupee figure"] : []) });
    expect(r.output.answer).toBe("fine");
  });

  it("never writes uploaded-document results to disk; only the warm script persists", async () => {
    mock.push({ answer: "a" }, { answer: "b" });
    await call();
    expect(existsSync(path.join(dir, "normalize"))).toBe(false);
    await call({ keyInput: { q: 2 }, ctx: ctx({ mode: "warm" }) });
    expect(readdirSync(path.join(dir, "normalize"))).toHaveLength(1);
  });

  it("re-validates disk cache entries; a tampered entry is never used", async () => {
    const version = loadPrompt("normalize").version;
    const key = cacheKey("normalize", version, "mock-extract-model", { q: 1 });
    mkdirSync(path.join(dir, "normalize"), { recursive: true });
    writeFileSync(path.join(dir, "normalize", `${key}.json`), JSON.stringify({ stage: "normalize", prompt_version: version, model: "x", output: { answer: 7 } }));
    const e = await fails(call({ ctx: ctx({ mode: "sample" }) }));
    expect(e.code).toBe("CACHE_MISS");
  });

  it("extractJson tolerates prose around the object", () => {
    expect(JSON.parse(extractJson('Sure! {"a":{"b":1}} Hope that helps'))).toEqual({ a: { b: 1 } });
  });
});

describe("callJson: cost and configuration gates", () => {
  it("sample runs are cache-only: a miss fails without calling the provider", async () => {
    const e = await fails(call({ ctx: ctx({ mode: "sample" }) }));
    expect(e.code).toBe("CACHE_MISS");
    expect(mock.calls).toHaveLength(0);
  });

  it("uploads cannot call the provider unless KANAKKU_CACHE_ONLY is explicitly 0", async () => {
    delete process.env.KANAKKU_CACHE_ONLY;
    expect((await fails(call())).code).toBe("LIVE_DISABLED");
    process.env.KANAKKU_CACHE_ONLY = "1";
    expect((await fails(call())).code).toBe("LIVE_DISABLED");
    expect(mock.calls).toHaveLength(0);
  });

  it("missing API key or model id is a clear configuration error", async () => {
    setProviderForTests(null);
    const e = await fails(call());
    expect(e.code).toBe("MISSING_CONFIG");
    expect(e.userMessage).not.toMatch(/sk-/);
    setProviderForTests(mock);
    process.env.MODEL_EXTRACT = "";
    expect((await fails(call())).userMessage).toMatch(/MODEL_EXTRACT/);
  });

  it("enforces the per-run call budget", async () => {
    process.env.KANAKKU_MAX_CALLS_PER_RUN = "2";
    mock.push({ answer: "1" }, { answer: "2" }, { answer: "3" });
    await call({ keyInput: 1 });
    await call({ keyInput: 2 });
    const e = await fails(call({ keyInput: 3 }));
    expect(e.code).toBe("BUDGET_EXCEEDED");
    expect(mock.calls).toHaveLength(2);
  });

  it("enforces the per-run token budget using reported usage", async () => {
    process.env.KANAKKU_MAX_TOKENS_PER_RUN = "1500"; // each mock call reports 1,200 tokens
    mock.push({ answer: "1" }, { answer: "2" }, { answer: "3" });
    await call({ keyInput: 1 });
    await call({ keyInput: 2 });
    expect((await fails(call({ keyInput: 3 }))).code).toBe("BUDGET_EXCEEDED");
  });

  it("limits new live runs per client per hour, without affecting other clients", async () => {
    process.env.KANAKKU_MAX_RUNS_PER_HOUR = "1";
    mock.push({ answer: "1" }, { answer: "2" });
    await call({ keyInput: 1, ctx: ctx({ runId: "run-aaaaaaaa" }) });
    expect((await fails(call({ keyInput: 2, ctx: ctx({ runId: "run-bbbbbbbb" }) }))).code).toBe("RATE_LIMITED");
    await call({ keyInput: 3, ctx: ctx({ runId: "run-cccccccc", clientId: "client-b" }) });
  });

  it("enforces the daily token cap", async () => {
    process.env.KANAKKU_MAX_TOKENS_PER_DAY = "1000";
    mock.push({ answer: "1" }, { answer: "2" });
    await call({ keyInput: 1 });
    expect((await fails(call({ keyInput: 2, ctx: ctx({ runId: "run-other-01" }) }))).code).toBe("BUDGET_EXCEEDED");
  });

  it("a run id cannot be reused by another client", async () => {
    mock.push({ answer: "1" }, { answer: "2" });
    await call({ keyInput: 1 });
    expect((await fails(call({ keyInput: 2, ctx: ctx({ clientId: "client-z" }) }))).code).toBe("BAD_INPUT");
  });
});

describe("provider error mapping", () => {
  const h = new Headers();
  it("maps SDK errors to user-safe codes", () => {
    expect(mapProviderError(new Anthropic.AuthenticationError(401, {}, "bad key sk-ant-secret", h))).toMatchObject({ code: "MISSING_CONFIG" });
    expect(mapProviderError(new Anthropic.NotFoundError(404, {}, "model", h)).userMessage).toMatch(/model id/);
    expect(mapProviderError(new Anthropic.RateLimitError(429, {}, "slow down", h))).toMatchObject({ code: "RATE_LIMITED" });
    expect(mapProviderError(new Anthropic.InternalServerError(529, {}, "overloaded", h))).toMatchObject({ code: "PROVIDER_ERROR" });
    expect(mapProviderError(new Anthropic.APIConnectionTimeoutError()).userMessage).toMatch(/too long/);
    expect(mapProviderError(new Anthropic.APIError(402, {}, "billing", h)).userMessage).toMatch(/billing or credit/);
    expect(mapProviderError(new Error("boom"))).toMatchObject({ code: "PROVIDER_ERROR" });
  });
  it("never puts the provider's raw message (which may echo secrets) in the user message", () => {
    const e = mapProviderError(new Anthropic.AuthenticationError(401, {}, "invalid x-api-key sk-ant-abc", h));
    expect(e.userMessage).not.toMatch(/sk-ant/);
  });
  it("provider failures propagate from callJson as KanakkuError", async () => {
    mock.push(mapProviderError(new Anthropic.RateLimitError(429, {}, "x", h)));
    expect((await fails(call())).code).toBe("RATE_LIMITED");
  });
});
