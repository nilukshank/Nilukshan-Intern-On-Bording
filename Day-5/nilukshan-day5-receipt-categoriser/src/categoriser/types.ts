/**
 * Shared types for the Receipt Categoriser.
 * Every shape here maps directly to a line in spec.md §3 (Contract).
 */

/** spec.md §3.2 — the closed set of categories. Never extend without a spec change. */
export const CATEGORIES = ["Meals", "Travel", "Lodging", "Office Supplies", "Other"] as const;
export type Category = (typeof CATEGORIES)[number];

export type Source = "llm" | "rule-based";

/** spec.md §3.1 — inputs */
export interface ReceiptInput {
  claimId: string;
  /** null when the multipart `receipt` part is absent */
  file: { contentType: string; byteLength: number; bytes: Uint8Array } | null;
  idempotencyKey?: string;
}

/** spec.md §3.2 — the 200 OK response body */
export interface Suggestion {
  suggestionId: string;
  category: Category;
  confidence: number;
  source: Source;
  needsReview: boolean;
  message: string | null;
}

/** spec.md §3.3 — problem+json errors */
export class CategoriserError extends Error {
  status: number;
  code: string;
  detail: string;
  extra: Record<string, unknown>;

  constructor(status: number, code: string, detail: string, extra: Record<string, unknown> = {}) {
    super(detail);
    this.name = "CategoriserError";
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.extra = extra;
  }
}

/** Raised by the OCR adapter when Document Intelligence itself is unreachable. */
export class OcrUnavailableError extends Error {}
/** Raised by the LLM adapter when Azure OpenAI is unreachable — triggers fallback, never a 5xx. */
export class LlmUnavailableError extends Error {}

/** What the OCR port returns. `total === null` && no line items ⇒ "not a receipt" (AC-04). */
export interface OcrResult {
  text: string;
  lineItems: string[];
  total: number | null;
  currency: string | null;
  merchant: string | null;
  latencyMs: number;
}

export interface LlmVerdict {
  category: Category;
  confidence: number;
  modelVersion: string;
  promptTokens: number;
  completionTokens: number;
  estimatedCostLkr: number;
}

/** Ports the orchestrator depends on. Tests inject fakes; production injects Azure adapters. */
export interface Deps {
  ocr: { read(input: ReceiptInput): Promise<OcrResult> };
  llm: { categorise(ocr: OcrResult): Promise<LlmVerdict> };
  config: {
    /** Azure App Configuration — spec.md §3.5 kill switch */
    isEnabled(): Promise<boolean>;
    /** spec.md §7 Q1 — a config value, deliberately not a constant */
    reviewThreshold(): Promise<number>;
  };
  telemetry: { track(name: string, properties: Record<string, unknown>): void };
  newId: () => string;
  now: () => number;
}

export const MAX_BYTES = 10 * 1024 * 1024; // 10,485,760 — spec.md §3.1
export const ALLOWED_TYPES = ["image/jpeg", "image/png"];
