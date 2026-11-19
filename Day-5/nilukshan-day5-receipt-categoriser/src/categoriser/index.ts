/**
 * Receipt Categoriser orchestrator.
 *
 * Order of operations follows spec.md §3.3 exactly:
 *   feature flag → input validation → OCR → LLM → (fallback) → threshold → telemetry
 * Validation happens BEFORE any upstream call so that AC-05 can assert zero
 * Document Intelligence / Azure OpenAI requests for an oversized payload.
 */
import {
  ALLOWED_TYPES, CategoriserError, LlmUnavailableError, MAX_BYTES, OcrUnavailableError,
} from "./types.ts";
import type { Category, Deps, ReceiptInput, Suggestion } from "./types.ts";
import { categoriseByRules } from "./rule-based-categoriser.ts";
import { SUGGESTED_EVENT, buildSuggestedEvent } from "./telemetry.ts";

const FALLBACK_MESSAGE =
  "Suggested from keywords only — please confirm the category.";
const UNREADABLE_MESSAGE =
  "We couldn't read this as a receipt. Please pick a category, or re-upload a clearer photo.";

export async function categorise(input: ReceiptInput, deps: Deps): Promise<Suggestion> {
  const startedAt = deps.now();

  // --- Kill switch (AC-06). Behaves as if the endpoint does not exist. ---
  if (!(await deps.config.isEnabled())) {
    throw new CategoriserError(404, "feature_disabled", "This feature is not available.");
  }

  validate(input); // AC-05 and companions — throws 400 / 413 / 415

  // --- OCR. Unreachable ⇒ 502; readable-but-not-a-receipt is handled downstream. ---
  let ocr;
  try {
    ocr = await deps.ocr.read(input);
  } catch (err) {
    if (err instanceof OcrUnavailableError) {
      throw new CategoriserError(502, "ocr_unavailable",
        "We couldn't process this receipt right now. Please try again shortly.");
    }
    throw err;
  }

  const isReceipt = ocr.total !== null || ocr.lineItems.length > 0;

  let category: Category;
  let confidence: number;
  let source: "llm" | "rule-based";
  let message: string | null = null;
  let modelVersion: string | null = null;
  let promptTokens = 0;
  let completionTokens = 0;
  let estimatedCostLkr = 0;

  if (!isReceipt) {
    // AC-04 — do not spend a token on an image that has no receipt in it.
    const rule = categoriseByRules(ocr);
    ({ category, confidence } = rule);
    source = "rule-based";
    message = UNREADABLE_MESSAGE;
  } else {
    try {
      const verdict = await deps.llm.categorise(ocr);
      category = verdict.category;
      confidence = verdict.confidence;
      source = "llm";
      modelVersion = verdict.modelVersion;
      promptTokens = verdict.promptTokens;
      completionTokens = verdict.completionTokens;
      estimatedCostLkr = verdict.estimatedCostLkr;
    } catch (err) {
      if (!(err instanceof LlmUnavailableError)) throw err;
      // AC-03 — degrade, do not fail.
      const rule = categoriseByRules(ocr);
      ({ category, confidence } = rule);
      source = "rule-based";
      message = FALLBACK_MESSAGE;
    }
  }

  const threshold = await deps.config.reviewThreshold();
  const needsReview = confidence < threshold; // spec.md §3.2 invariant

  const suggestion: Suggestion = {
    suggestionId: deps.newId(),
    category,
    confidence,
    source,
    needsReview,
    message,
  };

  deps.telemetry.track(SUGGESTED_EVENT, buildSuggestedEvent({
    suggestionId: suggestion.suggestionId,
    claimId: input.claimId,
    category, confidence, source, needsReview,
    latencyMs: deps.now() - startedAt,
    ocrLatencyMs: ocr.latencyMs,
    modelVersion, promptTokens, completionTokens, estimatedCostLkr,
  }));

  return suggestion;
}

function validate(input: ReceiptInput): void {
  if (!input.claimId) {
    throw new CategoriserError(400, "invalid_request", "claimId is required.");
  }
  if (!input.file || input.file.byteLength === 0) {
    throw new CategoriserError(400, "invalid_request", "A `receipt` file part is required.");
  }
  if (!ALLOWED_TYPES.includes(input.file.contentType)) {
    throw new CategoriserError(415, "unsupported_media_type",
      "Receipts must be JPEG or PNG.", { allowed: ALLOWED_TYPES });
  }
  if (input.file.byteLength > MAX_BYTES) {
    throw new CategoriserError(413, "payload_too_large",
      "Maximum receipt size is 10 MB.", { maxBytes: MAX_BYTES });
  }
}

export { categoriseByRules } from "./rule-based-categoriser.ts";
export * from "./types.ts";
