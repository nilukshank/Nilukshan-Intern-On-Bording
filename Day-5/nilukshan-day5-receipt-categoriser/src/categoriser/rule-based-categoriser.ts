/**
 * Rule-based categoriser — the degraded path (spec.md §2 in-scope item 2, AC-03, AC-04).
 *
 * Deliberately dumb and dependency-free: it must work when Azure OpenAI does not.
 * Confidence is hard-capped at 0.5 so that the contract invariant
 * `source === "rule-based" ⇒ confidence <= 0.5` (spec.md §3.2) cannot be violated
 * by tuning the keyword weights later.
 *
 * OPEN QUESTION (spec.md §7 Q5): nobody owns this keyword list yet.
 */
import type { Category, OcrResult } from "./types.ts";

const RULE_CONFIDENCE_CEILING = 0.5;

/** Keyword → category. Lowercase, matched against OCR text and line items. */
const KEYWORDS: Record<Exclude<Category, "Other">, string[]> = {
  Meals: ["restaurant", "cafe", "kottu", "rice", "curry", "lunch", "dinner", "breakfast",
          "coffee", "tea", "bakery", "food", "beverage", "sandwich", "soda", "service charge"],
  Travel: ["taxi", "pickme", "uber", "fuel", "petrol", "diesel", "bus", "train", "railway",
           "airline", "airport", "boarding", "toll", "parking", "mileage"],
  Lodging: ["hotel", "guest house", "resort", "room charge", "night", "check-in", "check-out",
            "accommodation", "villa", "folio"],
  "Office Supplies": ["a4", "paper", "pen", "ballpoint", "stapler", "printer", "toner", "ink",
                      "cartridge", "notebook", "file", "stationery", "envelope", "marker"],
};

export interface RuleVerdict {
  category: Category;
  confidence: number;
  /** Which keywords fired — used for local debugging only, never emitted (spec.md §3.4). */
  matched: string[];
}

/**
 * @param ocr text extracted from the receipt
 * @returns a category and a confidence in [0, 0.5]
 */
export function categoriseByRules(ocr: OcrResult): RuleVerdict {
  const haystack = [ocr.text, ocr.merchant ?? "", ...ocr.lineItems].join(" ").toLowerCase();

  // AC-04: OCR read something, but it is not a receipt.
  const looksLikeReceipt = ocr.total !== null || ocr.lineItems.length > 0;
  if (!looksLikeReceipt) {
    return { category: "Other", confidence: 0.1, matched: [] };
  }

  const scores = new Map<Category, string[]>();
  for (const [category, words] of Object.entries(KEYWORDS)) {
    const hits = words.filter((w) => haystack.includes(w));
    if (hits.length > 0) scores.set(category as Category, hits);
  }

  if (scores.size === 0) {
    return { category: "Other", confidence: 0.2, matched: [] };
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].length - a[1].length);
  const [topCategory, topHits] = ranked[0];
  const runnerUpHits = ranked[1]?.[1].length ?? 0;

  // More distinct hits ⇒ more confidence; a close runner-up pulls it back down.
  const margin = topHits.length - runnerUpHits;
  const raw = 0.2 + 0.1 * Math.min(topHits.length, 2) + 0.05 * Math.min(margin, 2);

  return {
    category: topCategory,
    confidence: Math.min(Number(raw.toFixed(2)), RULE_CONFIDENCE_CEILING),
    matched: topHits,
  };
}
