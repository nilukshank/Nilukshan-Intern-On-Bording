/**
 * Telemetry event construction (spec.md §3.4, AC-07).
 *
 * The event object is built by an EXPLICIT ALLOWLIST. There is deliberately no
 * "spread the rest of the context" path and no PII-stripping regex — if a field
 * is not named here it cannot be emitted, so a future careless change fails
 * AC-07's set-equality assertion instead of leaking a customer name.
 */
import type { Category, Source } from "./types.ts";

export const SUGGESTED_EVENT = "categoriser.suggested";
export const DECIDED_EVENT = "categoriser.decided";

export const SUGGESTED_EVENT_PROPERTIES = [
  "suggestionId", "claimId", "category", "confidence", "source", "needsReview",
  "latencyMs", "ocrLatencyMs", "modelVersion", "promptTokens", "completionTokens",
  "estimatedCostLkr",
] as const;

export interface SuggestedEventInput {
  suggestionId: string;
  claimId: string;
  category: Category;
  confidence: number;
  source: Source;
  needsReview: boolean;
  latencyMs: number;
  ocrLatencyMs: number;
  modelVersion: string | null;
  promptTokens: number;
  completionTokens: number;
  estimatedCostLkr: number;
}

export function buildSuggestedEvent(i: SuggestedEventInput): Record<string, unknown> {
  return {
    suggestionId: i.suggestionId,
    claimId: i.claimId,
    category: i.category,
    confidence: i.confidence,
    source: i.source,
    needsReview: i.needsReview,
    latencyMs: i.latencyMs,
    ocrLatencyMs: i.ocrLatencyMs,
    modelVersion: i.modelVersion,
    promptTokens: i.promptTokens,
    completionTokens: i.completionTokens,
    estimatedCostLkr: i.estimatedCostLkr,
  };
}
