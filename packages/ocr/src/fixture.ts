import type { ReceiptExtraction } from "@billsplit/contracts";
import { RECEIPT_SAMPLE_EXTRACTIONS } from "./samples.js";
import type { OcrExtractInput, OcrProvider, OcrResult } from "./types.js";

/** Real uploads without an API key get the bistro sample, which reconciles. */
const DEFAULT_EXTRACTION: ReceiptExtraction = RECEIPT_SAMPLE_EXTRACTIONS["bistro-dinner"];

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
