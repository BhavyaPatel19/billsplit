import type { ReceiptExtraction } from "@billsplit/contracts";
import type { OcrExtractInput, OcrProvider, OcrResult } from "./types.js";

const DEFAULT_EXTRACTION: ReceiptExtraction = {
  merchant: "Corner Bistro",
  date: "2026-11-10",
  currency: "USD",
  items: [
    {
      description: "Margherita Pizza",
      quantity: 1,
      unitPriceCents: 1800,
      totalPriceCents: 1800,
      confidence: "high",
    },
    {
      description: "Pasta Carbonara",
      quantity: 2,
      unitPriceCents: 1650,
      totalPriceCents: 3300,
      confidence: "high",
    },
    {
      description: "Sparkling Water",
      quantity: 2,
      unitPriceCents: 450,
      totalPriceCents: 900,
      confidence: "medium",
    },
  ],
  subtotalCents: 6000,
  taxCents: 540,
  tipCents: 1080,
  feeCents: null,
  discountCents: null,
  totalCents: 7620,
};

export interface FixtureOcrOptions {
  extraction?:
    | ReceiptExtraction
    | ((input: OcrExtractInput) => ReceiptExtraction | Promise<ReceiptExtraction>);
  model?: string;
  costMicroUsd?: number;
}

/**
 * Deterministic OCR provider for unit tests and offline/demo development without an Anthropic key.
 */
export class FixtureOcrProvider implements OcrProvider {
  readonly name = "fixture" as const;
  private readonly extractionOption: FixtureOcrOptions["extraction"];
  private readonly model: string;
  private readonly costMicroUsd: number;

  constructor(options: FixtureOcrOptions = {}) {
    this.extractionOption = options.extraction;
    this.model = options.model ?? "fixture-v1";
    this.costMicroUsd = options.costMicroUsd ?? 0;
  }

  async extract(input: OcrExtractInput): Promise<OcrResult> {
    const extraction =
      typeof this.extractionOption === "function"
        ? await this.extractionOption(input)
        : (this.extractionOption ?? DEFAULT_EXTRACTION);

    return {
      extraction,
      model: this.model,
      provider: this.name,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        costMicroUsd: this.costMicroUsd,
      },
    };
  }
}
