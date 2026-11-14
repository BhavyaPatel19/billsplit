import { z } from "zod";
import { ReceiptExtractionSchema, type ReceiptExtraction } from "@billsplit/contracts";
import { reconcileReceiptExtraction } from "./reconcile.js";

export const GoldenReceiptCaseSchema = z.object({
  id: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  expected: ReceiptExtractionSchema,
});
export type GoldenReceiptCase = z.infer<typeof GoldenReceiptCaseSchema>;

export interface ReceiptEvalScore {
  expectedItems: number;
  predictedItems: number;
  matchedItems: number;
  itemPrecision: number;
  itemRecall: number;
  itemF1: number;
  totalMatch: boolean;
  taxMatch: boolean;
  tipMatch: boolean;
  currencyMatch: boolean;
  reconciles: boolean;
}

export interface ReceiptEvalCaseResult {
  id: string;
  category: string;
  score: ReceiptEvalScore;
  costMicroUsd: number;
  latencyMs: number;
  model: string;
  error?: string;
}

export interface EvalSummary {
  totalCases: number;
  succeededCases: number;
  failedCases: number;
  itemPrecision: number;
  itemRecall: number;
  itemF1: number;
  totalMatchRate: number;
  taxMatchRate: number;
  tipMatchRate: number;
  currencyMatchRate: number;
  reconciliationRate: number;
  totalCostMicroUsd: number;
  avgLatencyMs: number;
}

const ITEM_SIMILARITY_THRESHOLD = 0.6;

export function normalizeItemLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bigrams(text: string): string[] {
  if (text.length < 2) return text ? [text] : [];
  const out: string[] = [];
  for (let i = 0; i < text.length - 1; i++) {
    out.push(text.slice(i, i + 2));
  }
  return out;
}

/** Similarity score in `[0, 1]` between two line-item labels after punctuation/case folding. */
export function labelSimilarity(aRaw: string, bRaw: string): number {
  const a = normalizeItemLabel(aRaw);
  const b = normalizeItemLabel(bRaw);
  if (!a || !b) return a === b ? 1 : 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    const minLen = Math.min(a.length, b.length);
    const maxLen = Math.max(a.length, b.length);
    return Math.max(0.8, minLen / maxLen);
  }
  const aBigrams = bigrams(a);
  const bCounts = new Map<string, number>();
  for (const bg of bigrams(b)) {
    bCounts.set(bg, (bCounts.get(bg) ?? 0) + 1);
  }
  let overlap = 0;
  for (const bg of aBigrams) {
    const count = bCounts.get(bg) ?? 0;
    if (count > 0) {
      overlap += 1;
      bCounts.set(bg, count - 1);
    }
  }
  const total = aBigrams.length + bigrams(b).length;
  return total === 0 ? 0 : (2 * overlap) / total;
}

/**
 * Compares predicted receipt extraction against a golden expectation using greedy one-to-one
 * matching on exact line-item total price + fuzzy description similarity, plus header totals.
 */
export function scoreReceiptExtraction(
  expected: ReceiptExtraction,
  actual: ReceiptExtraction,
): ReceiptEvalScore {
  const candidates: Array<{ expIdx: number; actIdx: number; similarity: number }> = [];
  for (let expIdx = 0; expIdx < expected.items.length; expIdx++) {
    const expItem = expected.items[expIdx]!;
    for (let actIdx = 0; actIdx < actual.items.length; actIdx++) {
      const actItem = actual.items[actIdx]!;
      if (expItem.totalPriceCents !== actItem.totalPriceCents) continue;
      const similarity = labelSimilarity(expItem.description, actItem.description);
      if (similarity >= ITEM_SIMILARITY_THRESHOLD) {
        candidates.push({ expIdx, actIdx, similarity });
      }
    }
  }
  candidates.sort((x, y) => y.similarity - x.similarity);

  const usedExp = new Set<number>();
  const usedAct = new Set<number>();
  for (const candidate of candidates) {
    if (usedExp.has(candidate.expIdx) || usedAct.has(candidate.actIdx)) continue;
    usedExp.add(candidate.expIdx);
    usedAct.add(candidate.actIdx);
  }

  const matchedItems = usedExp.size;
  const expectedItems = expected.items.length;
  const predictedItems = actual.items.length;
  const itemPrecision =
    predictedItems === 0 ? (expectedItems === 0 ? 1 : 0) : matchedItems / predictedItems;
  const itemRecall = expectedItems === 0 ? 1 : matchedItems / expectedItems;
  const itemF1 =
    itemPrecision + itemRecall === 0
      ? 0
      : (2 * itemPrecision * itemRecall) / (itemPrecision + itemRecall);

  return {
    expectedItems,
    predictedItems,
    matchedItems,
    itemPrecision,
    itemRecall,
    itemF1,
    totalMatch: expected.totalCents === actual.totalCents,
    taxMatch: expected.taxCents === actual.taxCents,
    tipMatch: expected.tipCents === actual.tipCents,
    currencyMatch: (expected.currency ?? null) === (actual.currency ?? null),
    reconciles: reconcileReceiptExtraction(actual).matches,
  };
}

export function aggregateEvalResults(results: ReadonlyArray<ReceiptEvalCaseResult>): EvalSummary {
  const totalCases = results.length;
  if (totalCases === 0) {
    return {
      totalCases: 0,
      succeededCases: 0,
      failedCases: 0,
      itemPrecision: 0,
      itemRecall: 0,
      itemF1: 0,
      totalMatchRate: 0,
      taxMatchRate: 0,
      tipMatchRate: 0,
      currencyMatchRate: 0,
      reconciliationRate: 0,
      totalCostMicroUsd: 0,
      avgLatencyMs: 0,
    };
  }

  let matchedSum = 0;
  let predictedSum = 0;
  let expectedSum = 0;
  let totalMatches = 0;
  let taxMatches = 0;
  let tipMatches = 0;
  let currencyMatches = 0;
  let reconciled = 0;
  let totalCostMicroUsd = 0;
  let latencySum = 0;
  let failedCases = 0;

  for (const r of results) {
    if (r.error) failedCases += 1;
    matchedSum += r.score.matchedItems;
    predictedSum += r.score.predictedItems;
    expectedSum += r.score.expectedItems;
    if (r.score.totalMatch) totalMatches += 1;
    if (r.score.taxMatch) taxMatches += 1;
    if (r.score.tipMatch) tipMatches += 1;
    if (r.score.currencyMatch) currencyMatches += 1;
    if (r.score.reconciles) reconciled += 1;
    totalCostMicroUsd += r.costMicroUsd;
    latencySum += r.latencyMs;
  }

  const itemPrecision = predictedSum === 0 ? 0 : matchedSum / predictedSum;
  const itemRecall = expectedSum === 0 ? 0 : matchedSum / expectedSum;
  const itemF1 =
    itemPrecision + itemRecall === 0
      ? 0
      : (2 * itemPrecision * itemRecall) / (itemPrecision + itemRecall);

  return {
    totalCases,
    succeededCases: totalCases - failedCases,
    failedCases,
    itemPrecision,
    itemRecall,
    itemF1,
    totalMatchRate: totalMatches / totalCases,
    taxMatchRate: taxMatches / totalCases,
    tipMatchRate: tipMatches / totalCases,
    currencyMatchRate: currencyMatches / totalCases,
    reconciliationRate: reconciled / totalCases,
    totalCostMicroUsd,
    avgLatencyMs: Math.round(latencySum / totalCases),
  };
}
