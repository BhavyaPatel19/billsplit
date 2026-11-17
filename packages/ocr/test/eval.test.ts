import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ReceiptExtraction } from "@billsplit/contracts";
import {
  GoldenReceiptCaseSchema,
  aggregateEvalResults,
  reconcileReceiptExtraction,
  scoreReceiptExtraction,
} from "../src/index.js";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.resolve(TEST_DIR, "../eval/golden");

const BASE_RECEIPT: ReceiptExtraction = {
  merchant: "Hop House",
  date: "2026-11-01",
  currency: "USD",
  items: [
    {
      description: "IPA Draft",
      quantity: 1,
      unitPriceCents: null,
      totalPriceCents: 800,
      confidence: "high",
    },
    {
      description: "IPA Draft",
      quantity: 1,
      unitPriceCents: null,
      totalPriceCents: 800,
      confidence: "high",
    },
    {
      description: "Pretzel Bites!",
      quantity: 1,
      unitPriceCents: null,
      totalPriceCents: 1100,
      confidence: "high",
    },
  ],
  subtotalCents: 2700,
  taxCents: 243,
  tipCents: 540,
  feeCents: null,
  discountCents: null,
  totalCents: 3483,
};

describe("scoreReceiptExtraction", () => {
  it("scores normalized labels and one-to-one duplicate line items accurately", () => {
    const score = scoreReceiptExtraction(BASE_RECEIPT, {
      ...BASE_RECEIPT,
      items: [
        {
          description: "ipa draft",
          quantity: 1,
          unitPriceCents: null,
          totalPriceCents: 800,
          confidence: "high",
        },
        {
          description: "Pretzel Bites",
          quantity: 1,
          unitPriceCents: null,
          totalPriceCents: 1100,
          confidence: "high",
        },
      ],
    });

    expect(score.matchedItems).toBe(2);
    expect(score.expectedItems).toBe(3);
    expect(score.predictedItems).toBe(2);
    expect(score.itemPrecision).toBe(1);
    expect(score.itemRecall).toBeCloseTo(2 / 3);
    expect(score.totalMatch).toBe(true);
    expect(score.reconciles).toBe(false);
  });

  it("rejects line items whose price differs even if description matches", () => {
    const score = scoreReceiptExtraction(BASE_RECEIPT, {
      ...BASE_RECEIPT,
      taxCents: 200,
      totalCents: 3500,
      items: [
        ...BASE_RECEIPT.items.slice(0, 2),
        {
          description: "Pretzel Bites",
          quantity: 1,
          unitPriceCents: null,
          totalPriceCents: 1150,
          confidence: "medium",
        },
      ],
    });

    expect(score.matchedItems).toBe(2);
    expect(score.totalMatch).toBe(false);
    expect(score.taxMatch).toBe(false);
    expect(score.tipMatch).toBe(true);
  });
});

describe("aggregateEvalResults", () => {
  it("aggregates micro-averaged precision/recall, rates, costs, and failures", () => {
    const s1 = scoreReceiptExtraction(BASE_RECEIPT, BASE_RECEIPT);
    const s2 = scoreReceiptExtraction(BASE_RECEIPT, {
      ...BASE_RECEIPT,
      items: BASE_RECEIPT.items.slice(0, 1),
      totalCents: 9999,
    });

    const summary = aggregateEvalResults([
      {
        id: "r1",
        category: "bar",
        score: s1,
        costMicroUsd: 12000,
        latencyMs: 800,
        model: "claude-opus-5-5",
      },
      {
        id: "r2",
        category: "bar",
        score: s2,
        costMicroUsd: 8000,
        latencyMs: 1200,
        model: "claude-opus-5-5",
        error: "timeout",
      },
    ]);

    expect(summary.totalCases).toBe(2);
    expect(summary.succeededCases).toBe(1);
    expect(summary.failedCases).toBe(1);
    // matched: 3 + 1 = 4; predicted: 3 + 1 = 4; expected: 3 + 3 = 6
    expect(summary.itemPrecision).toBe(1);
    expect(summary.itemRecall).toBeCloseTo(4 / 6);
    expect(summary.totalMatchRate).toBe(0.5);
    expect(summary.totalCostMicroUsd).toBe(20000);
    expect(summary.avgLatencyMs).toBe(1000);
  });
});

describe("golden receipt dataset", () => {
  it("contains at least 30 valid, self-reconciling golden receipt cases with paired images", async () => {
    const files = (await readdir(GOLDEN_DIR)).filter((f) => f.endsWith(".expected.json")).sort();
    expect(files.length).toBeGreaterThanOrEqual(30);

    for (const file of files) {
      const base = file.slice(0, -".expected.json".length);
      const raw = JSON.parse(await readFile(path.join(GOLDEN_DIR, file), "utf8")) as unknown;
      const spec = GoldenReceiptCaseSchema.parse(raw);
      expect(spec.id).toBe(base);
      expect(reconcileReceiptExtraction(spec.expected).matches).toBe(true);

      const hasImage = [".jpg", ".jpeg", ".png", ".webp", ".svg"].some((ext) =>
        existsSync(path.join(GOLDEN_DIR, `${base}${ext}`)),
      );
      expect(hasImage, `missing image for ${base}`).toBe(true);
    }
  });
});
