/**
 * Acceptance tests — one `describe` per criterion in spec/acceptance.md.
 * Test names quote the AC id so a failure points straight at the spec line.
 *
 * Run: npm test
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { categorise } from "../src/categoriser/index.ts";
import { CategoriserError } from "../src/categoriser/types.ts";
import { SUGGESTED_EVENT, SUGGESTED_EVENT_PROPERTIES } from "../src/categoriser/telemetry.ts";
import { harness, receipt } from "./fixtures/index.ts";

async function expectError(fn: () => Promise<unknown>): Promise<CategoriserError> {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof CategoriserError, `expected CategoriserError, got ${err}`);
    return err;
  }
  throw new Error("expected the call to reject, but it resolved");
}

describe("AC-01 happy path: clear meal receipt", () => {
  test("returns Meals from the llm with confidence >= 0.7 and no review flag", async () => {
    const h = harness();
    const result = await categorise(receipt("meal-receipt.png"), h.deps);

    assert.equal(result.category, "Meals");
    assert.ok(result.confidence >= 0.7, `confidence was ${result.confidence}`);
    assert.equal(result.source, "llm");
    assert.equal(result.needsReview, false);
    assert.equal(result.message, null);
  });

  test("emits categoriser.suggested carrying the same suggestionId", async () => {
    const h = harness();
    const result = await categorise(receipt("meal-receipt.png"), h.deps);

    const emitted = h.events.filter((e) => e.name === SUGGESTED_EVENT);
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].properties.suggestionId, result.suggestionId);
    assert.equal(emitted[0].properties.source, "llm");
  });
});

describe("AC-02 ambiguous receipt is flagged, not silently guessed", () => {
  test("returns exactly one category and holds needsReview === (confidence < threshold)", async () => {
    const h = harness({ threshold: 0.6 });
    const result = await categorise(receipt("mixed-receipt.png"), h.deps);

    assert.equal(typeof result.category, "string");
    assert.ok(["Meals", "Travel", "Lodging", "Office Supplies", "Other"].includes(result.category));
    assert.equal(result.needsReview, result.confidence < 0.6);
    assert.equal(result.needsReview, true, "this fixture scores below the threshold");
  });

  test("the invariant still holds when the threshold is retuned (spec §7 Q1)", async () => {
    const h = harness({ threshold: 0.4 });
    const result = await categorise(receipt("mixed-receipt.png"), h.deps);
    assert.equal(result.needsReview, result.confidence < 0.4);
    assert.equal(result.needsReview, false);
  });
});

describe("AC-03 LLM unavailable: degrade to rule-based, never fail", () => {
  test("returns 200-shaped success with source rule-based and confidence <= 0.5", async () => {
    const h = harness({ llm: "down" });
    const result = await categorise(receipt("meal-receipt.png"), h.deps);

    assert.equal(result.source, "rule-based");
    assert.ok(result.confidence <= 0.5, `confidence was ${result.confidence}`);
    assert.equal(result.needsReview, true);
    assert.ok(result.message && result.message.length > 0);
    assert.equal(result.category, "Meals", "keywords should still find the right category");
  });

  test("the event records the degraded source", async () => {
    const h = harness({ llm: "down" });
    await categorise(receipt("meal-receipt.png"), h.deps);
    assert.equal(h.events[0].properties.source, "rule-based");
  });
});

describe("AC-04 OCR readable but not a receipt / OCR service down", () => {
  test("unparseable image returns Other with a plain-language message", async () => {
    const h = harness();
    const result = await categorise(receipt("unreadable.png"), h.deps);

    assert.equal(result.category, "Other");
    assert.ok(result.confidence <= 0.2);
    assert.equal(result.needsReview, true);
    assert.ok(result.message);
    assert.doesNotMatch(result.message!, /OCR|Azure|stack|error/i,
      "message must not leak internals to the claimant");
    assert.equal(h.llmCalls, 0, "no token should be spent on a non-receipt");
  });

  test("OCR service unreachable returns 502 ocr_unavailable", async () => {
    const h = harness({ ocr: "down" });
    const err = await expectError(() => categorise(receipt("meal-receipt.png"), h.deps));

    assert.equal(err.status, 502);
    assert.equal(err.code, "ocr_unavailable");
    assert.equal(h.events.length, 0);
  });
});

describe("AC-05 oversized payload rejected before any upstream call", () => {
  test("14 MB image returns 413 with maxBytes and touches no upstream", async () => {
    const h = harness();
    const err = await expectError(() => categorise(receipt("oversized.png"), h.deps));

    assert.equal(err.status, 413);
    assert.equal(err.code, "payload_too_large");
    assert.equal(err.extra.maxBytes, 10_485_760);
    assert.equal(h.ocrCalls, 0);
    assert.equal(h.llmCalls, 0);
    assert.equal(h.events.length, 0);
  });

  test("PDF returns 415 unsupported_media_type", async () => {
    const h = harness();
    const err = await expectError(() =>
      categorise(receipt("meal-receipt.png", { contentType: "application/pdf" }), h.deps));
    assert.equal(err.status, 415);
    assert.equal(err.code, "unsupported_media_type");
  });

  test("missing receipt part returns 400 invalid_request", async () => {
    const h = harness();
    const input = { ...receipt("meal-receipt.png"), file: null };
    const err = await expectError(() => categorise(input, h.deps));
    assert.equal(err.status, 400);
    assert.equal(err.code, "invalid_request");
  });
});

describe("AC-06 kill switch", () => {
  test("flag off makes the endpoint behave as 404 feature_disabled", async () => {
    const h = harness({ enabled: false });
    const err = await expectError(() => categorise(receipt("meal-receipt.png"), h.deps));

    assert.equal(err.status, 404);
    assert.equal(err.code, "feature_disabled");
    assert.equal(h.ocrCalls, 0);
    assert.equal(h.llmCalls, 0);
  });
});

describe("AC-07 PII never reaches the response or telemetry", () => {
  test("response body contains no name, card digits or OCR text", async () => {
    const h = harness();
    const result = await categorise(receipt("pii-receipt.png"), h.deps);
    const body = JSON.stringify(result);

    for (const needle of ["Nadeeka", "Perera", "4821", "Barista"]) {
      assert.ok(!body.includes(needle), `response leaked "${needle}"`);
    }
  });

  test("event properties are exactly the allowlist — a new property fails this test", async () => {
    const h = harness();
    await categorise(receipt("pii-receipt.png"), h.deps);

    const keys = Object.keys(h.events[0].properties).sort();
    assert.deepEqual(keys, [...SUGGESTED_EVENT_PROPERTIES].sort());
  });

  test("full-text scan of the emitted event finds zero PII matches", async () => {
    const h = harness();
    await categorise(receipt("pii-receipt.png"), h.deps);
    const json = JSON.stringify(h.events);

    for (const needle of ["Nadeeka", "Perera", "4821"]) {
      assert.ok(!json.includes(needle), `telemetry leaked "${needle}"`);
    }
  });
});

// AC-08 (latency p95) and AC-09 (cost ceiling) are environment-level criteria.
// They are verified by tests/load/categoriser.k6.js against staging and by the
// Application Insights cost query in README.md — not by this unit suite.
// Recording that honestly here is part of the deliverable.
