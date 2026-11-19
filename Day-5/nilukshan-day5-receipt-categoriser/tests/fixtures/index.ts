/**
 * Fixtures + fakes. The fakes stand in for Azure Document Intelligence, Azure OpenAI
 * and Application Insights so the acceptance criteria can run offline and
 * deterministically. Each fake RECORDS its calls, which is what lets AC-05 assert
 * "no upstream call was made".
 */
import type { Deps, LlmVerdict, OcrResult, ReceiptInput } from "../../src/categoriser/types.ts";
import { LlmUnavailableError, OcrUnavailableError } from "../../src/categoriser/types.ts";

type FixtureName =
  | "meal-receipt.png" | "mixed-receipt.png" | "hotel-receipt.png"
  | "unreadable.png" | "pii-receipt.png" | "oversized.png";

export const OCR_FIXTURES: Record<FixtureName, OcrResult> = {
  "meal-receipt.png": {
    merchant: "Green Cabin", total: 2400, currency: "LKR",
    lineItems: ["Chicken Kottu x2  1,600.00", "Lime Soda x2  600.00", "Service charge  200.00"],
    text: "GREEN CABIN RESTAURANT\nChicken Kottu x2\nLime Soda x2\nService charge\nTOTAL LKR 2,400.00",
    latencyMs: 610,
  },
  "mixed-receipt.png": {
    merchant: "Keells Super", total: 2870, currency: "LKR",
    lineItems: ["A4 Paper 500 sheets  1,850.00", "Ballpoint pen x10  600.00", "Sandwich  420.00"],
    text: "KEELLS SUPER\nA4 Paper 500 sheets\nBallpoint pen x10\nSandwich\nTOTAL LKR 2,870.00",
    latencyMs: 700,
  },
  "hotel-receipt.png": {
    merchant: "Cinnamon Lodge", total: 48000, currency: "LKR",
    lineItems: ["Room charge 2 nights  44,000.00", "Check-out settlement  4,000.00"],
    text: "CINNAMON LODGE FOLIO\nRoom charge 2 nights\nCheck-out\nTOTAL LKR 48,000.00",
    latencyMs: 655,
  },
  // AC-04: OCR succeeded, but there is no receipt in the image.
  "unreadable.png": {
    merchant: null, total: null, currency: null, lineItems: [],
    text: "IMG_2841 desk keyboard", latencyMs: 540,
  },
  // AC-07: contains a customer name and card digits.
  "pii-receipt.png": {
    merchant: "Barista Colombo", total: 1750, currency: "LKR",
    lineItems: ["Cappuccino x2  1,300.00", "Bakery item  450.00"],
    text: "BARISTA COLOMBO\nCard holder: Ms. Nadeeka Perera\nVISA ****4821\nCappuccino x2\nBakery item\nTOTAL LKR 1,750.00",
    latencyMs: 690,
  },
  "oversized.png": {
    merchant: null, total: null, currency: null, lineItems: [], text: "", latencyMs: 0,
  },
};

export function receipt(
  name: FixtureName,
  over: Partial<{ contentType: string; byteLength: number; claimId: string }> = {},
): ReceiptInput & { fixture: FixtureName } {
  return {
    claimId: over.claimId ?? "C-1001",
    fixture: name,
    file: {
      contentType: over.contentType ?? "image/png",
      byteLength: over.byteLength ?? (name === "oversized.png" ? 14_680_064 : 1_048_576),
      bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    },
  };
}

export interface Harness {
  deps: Deps;
  ocrCalls: number;
  llmCalls: number;
  events: Array<{ name: string; properties: Record<string, unknown> }>;
}

export function harness(opts: {
  llm?: "ok" | "down";
  llmVerdict?: Partial<LlmVerdict>;
  ocr?: "ok" | "down";
  enabled?: boolean;
  threshold?: number;
} = {}): Harness {
  const h = { ocrCalls: 0, llmCalls: 0, events: [] as Harness["events"] } as Harness;
  let clock = 1_000;

  h.deps = {
    ocr: {
      async read(input) {
        h.ocrCalls++;
        if (opts.ocr === "down") throw new OcrUnavailableError("connect ECONNREFUSED");
        clock += 700;
        const fixture = (input as unknown as { fixture: FixtureName }).fixture;
        return OCR_FIXTURES[fixture];
      },
    },
    llm: {
      async categorise(ocr): Promise<LlmVerdict> {
        h.llmCalls++;
        if (opts.llm === "down") throw new LlmUnavailableError("503 from Azure OpenAI");
        clock += 900;
        const guess = ocr.lineItems.some((i) => /paper|pen/i.test(i))
          ? { category: "Office Supplies" as const, confidence: 0.54 }
          : ocr.lineItems.some((i) => /room|night/i.test(i))
            ? { category: "Lodging" as const, confidence: 0.88 }
            : { category: "Meals" as const, confidence: 0.91 };
        return {
          ...guess, modelVersion: "gpt-4.1-2025-04-14",
          promptTokens: 240, completionTokens: 18, estimatedCostLkr: 0.281,
          ...opts.llmVerdict,
        };
      },
    },
    config: {
      async isEnabled() { return opts.enabled ?? true; },
      async reviewThreshold() { return opts.threshold ?? 0.6; },
    },
    telemetry: {
      track(name, properties) { h.events.push({ name, properties }); },
    },
    newId: () => "b3f1-0000-4000-8000-000000000001",
    now: () => clock,
  };
  return h;
}
