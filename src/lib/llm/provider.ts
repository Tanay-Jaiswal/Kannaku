// The only module that talks to the model provider. Everything else goes through callJson() (./call.ts),
// so tests swap in a mock provider and never make a network call.
import Anthropic from "@anthropic-ai/sdk";
import { KanakkuError } from "../errors";

export type LlmRequest = {
  model: string;
  system: string;
  content: Anthropic.ContentBlockParam[]; // one user turn: documents/images first, then the text
  maxTokens: number;
  timeoutMs: number;
};
export type LlmResponse = { text: string; inputTokens: number; outputTokens: number; stopReason: string | null };
export interface LlmProvider {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export class AnthropicProvider implements LlmProvider {
  private client: Anthropic;
  constructor(apiKey: string) {
    // One SDK-level retry for transient 429/5xx/connection errors. Our own retry (call.ts) is only for
    // invalid model output, so the worst case is 2 x 2 attempts per stage, each counted by the spend guard.
    this.client = new Anthropic({ apiKey, maxRetries: 1 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    let msg: Anthropic.Message;
    try {
      msg = await this.client.messages.create(
        { model: req.model, max_tokens: req.maxTokens, system: req.system, messages: [{ role: "user", content: req.content }] },
        { timeout: req.timeoutMs },
      );
    } catch (e) {
      throw mapProviderError(e);
    }
    if (msg.stop_reason === "refusal")
      throw new KanakkuError("PROVIDER_ERROR", "The AI model declined to process this document. No result was produced.", "stop_reason=refusal");
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { text, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, stopReason: msg.stop_reason };
  }
}

/** Typed SDK errors -> user-safe KanakkuError. Most specific classes first. Never echoes the key or the document. */
export function mapProviderError(e: unknown): KanakkuError {
  if (e instanceof KanakkuError) return e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError)
    return new KanakkuError("MISSING_CONFIG", "The AI provider rejected the server's API key. The site owner needs to check ANTHROPIC_API_KEY.", `status=${e.status}`);
  if (e instanceof Anthropic.NotFoundError)
    return new KanakkuError("MISSING_CONFIG", "The configured AI model id is not available to this API key. The site owner needs to check MODEL_EXTRACT / MODEL_REASON.", "status=404");
  if (e instanceof Anthropic.RateLimitError)
    return new KanakkuError("RATE_LIMITED", "The AI provider is rate-limiting requests right now. Please try again in a minute.", "status=429");
  if (e instanceof Anthropic.APIConnectionTimeoutError)
    return new KanakkuError("PROVIDER_ERROR", "The AI provider took too long to respond. Please try again.", "timeout");
  if (e instanceof Anthropic.APIConnectionError)
    return new KanakkuError("PROVIDER_ERROR", "Could not reach the AI provider. Please check the connection and try again.", "connection");
  if (e instanceof Anthropic.APIError) {
    if (e.status === 402)
      return new KanakkuError("PROVIDER_ERROR", "The AI provider account has a billing or credit problem. The site owner needs to check the Anthropic Console.", "status=402");
    if (e.status === 413)
      return new KanakkuError("UNSUPPORTED_FILE", "This document is too large for the AI provider. Try a smaller PDF or a clearer photo.", "status=413");
    if (e instanceof Anthropic.BadRequestError)
      return new KanakkuError("PROVIDER_ERROR", "The AI provider rejected the request (for example, low credit balance or an unsupported model setting).", "status=400");
    return new KanakkuError("PROVIDER_ERROR", "The AI provider had a temporary problem. Please try again.", `status=${e.status}`);
  }
  return new KanakkuError("PROVIDER_ERROR", "The AI provider call failed unexpectedly.", e instanceof Error ? e.name : "unknown");
}
