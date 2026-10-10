// Mock model provider for tests: returns queued answers (strings or objects) and records every request.
// No test in this repo makes a network call or needs an API key.
import type { LlmProvider, LlmRequest, LlmResponse } from "../../src/lib/llm/provider";

type Answer = string | object | Error | ((req: LlmRequest) => string | object);

export class MockProvider implements LlmProvider {
  calls: LlmRequest[] = [];
  constructor(private answers: Answer[] = [], private fallback?: (req: LlmRequest) => string | object) {}
  push(...a: Answer[]) { this.answers.push(...a); return this; }
  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const next = this.answers.shift() ?? this.fallback;
    if (next === undefined) throw new Error("MockProvider: no answer queued");
    if (next instanceof Error) throw next;
    const v = typeof next === "function" ? next(req) : next;
    return { text: typeof v === "string" ? v : JSON.stringify(v), inputTokens: 1000, outputTokens: 200, stopReason: "end_turn" };
  }
}

export function testEnv(cacheDir: string) {
  process.env.MODEL_EXTRACT = "mock-extract-model";
  process.env.MODEL_REASON = "mock-reason-model";
  process.env.KANAKKU_CACHE_DIR = cacheDir;
  process.env.KANAKKU_CACHE_ONLY = "0";
  process.env.ANTHROPIC_API_KEY = "";
}
