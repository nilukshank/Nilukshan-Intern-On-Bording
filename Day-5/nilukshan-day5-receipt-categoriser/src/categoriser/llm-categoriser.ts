/**
 * LLM categoriser — the primary path (spec.md §3.4, AC-01).
 *
 * Talks to Azure OpenAI *inside the BISTEC tenant only* (spec.md §3.5 PII row).
 * One retry, then it gives up and raises LlmUnavailableError so the orchestrator
 * can degrade to rule-based. It never throws an HTTP error upward — AC-03 requires
 * an LLM outage to be invisible to the claimant apart from a lower confidence.
 */
import { CATEGORIES, LlmUnavailableError } from "./types.ts";
import type { Category, LlmVerdict, OcrResult } from "./types.ts";

export interface AzureOpenAIClient {
  complete(prompt: string): Promise<{
    content: string;
    modelVersion: string;
    promptTokens: number;
    completionTokens: number;
  }>;
}

/** spec.md §3.5 cost row — LKR per 1k tokens, from the tenant price sheet. */
const LKR_PER_1K_PROMPT = 0.9;
const LKR_PER_1K_COMPLETION = 3.6;

const SYSTEM_RULES = `You classify a Sri Lankan expense receipt into exactly one category.
Allowed categories: ${CATEGORIES.join(", ")}.
Reply with JSON only: {"category": "<one allowed value>", "confidence": <0.0-1.0>}
Do not invent fields. If unsure, use "Other" with a low confidence.`;

export function buildPrompt(ocr: OcrResult): string {
  return [
    SYSTEM_RULES,
    "",
    `Merchant: ${ocr.merchant ?? "unknown"}`,
    `Total: ${ocr.total ?? "unknown"} ${ocr.currency ?? ""}`.trim(),
    "Line items:",
    ...ocr.lineItems.map((i) => `- ${i}`),
  ].join("\n");
}

export function makeLlmCategoriser(client: AzureOpenAIClient, attempts = 2) {
  return {
    async categorise(ocr: OcrResult): Promise<LlmVerdict> {
      let lastError: unknown;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          const res = await client.complete(buildPrompt(ocr));
          return toVerdict(res);
        } catch (err) {
          lastError = err;
        }
      }
      throw new LlmUnavailableError(`Azure OpenAI unavailable after ${attempts} attempts: ${String(lastError)}`);
    },
  };
}

function toVerdict(res: {
  content: string;
  modelVersion: string;
  promptTokens: number;
  completionTokens: number;
}): LlmVerdict {
  let parsed: { category?: string; confidence?: number };
  try {
    parsed = JSON.parse(res.content);
  } catch {
    // A model that cannot follow the output contract is treated as unavailable,
    // not as a 5xx — the claimant still gets a suggestion via the fallback.
    throw new LlmUnavailableError("Model returned non-JSON content");
  }

  // Guard the enum at the boundary: the contract says `category` is always one of five.
  const category = (CATEGORIES as readonly string[]).includes(parsed.category ?? "")
    ? (parsed.category as Category)
    : "Other";

  const confidence = clamp01(typeof parsed.confidence === "number" ? parsed.confidence : 0);

  return {
    category,
    confidence: Number(confidence.toFixed(2)),
    modelVersion: res.modelVersion,
    promptTokens: res.promptTokens,
    completionTokens: res.completionTokens,
    estimatedCostLkr: Number(
      ((res.promptTokens / 1000) * LKR_PER_1K_PROMPT +
        (res.completionTokens / 1000) * LKR_PER_1K_COMPLETION).toFixed(3),
    ),
  };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
