import { ClaudeOcrProvider, type ClaudeOcrOptions } from "./claude.js";
import { FixtureOcrProvider, type FixtureOcrOptions } from "./fixture.js";
import type { OcrProvider } from "./types.js";

export {
  ClaudeOcrProvider,
  DEFAULT_CLAUDE_OCR_MODEL,
  SERVER_FALLBACK_BETA,
  type BetaMessagesParser,
  type ClaudeOcrOptions,
} from "./claude.js";
export { FixtureOcrProvider, type FixtureOcrOptions } from "./fixture.js";
export { ratesForModel, summarizeBetaUsage } from "./pricing.js";
export {
  GoldenReceiptCaseSchema,
  aggregateEvalResults,
  labelSimilarity,
  normalizeItemLabel,
  scoreReceiptExtraction,
  type EvalSummary,
  type GoldenReceiptCase,
  type ReceiptEvalCaseResult,
  type ReceiptEvalScore,
} from "./eval.js";
export { reconcileReceiptExtraction } from "./reconcile.js";
export { RECEIPT_SAMPLE_EXTRACTIONS, getReceiptSample, renderSampleReceiptSvg } from "./samples.js";
export {
  OcrParseError,
  OcrRefusalError,
  type OcrExtractInput,
  type OcrImageMediaType,
  type OcrProvider,
  type OcrResult,
  type OcrUsage,
} from "./types.js";

export interface CreateOcrProviderOptions {
  /** Explicitly choose a backend; defaults to `"claude"` when `apiKey` is present, else `"fixture"`. */
  provider?: "claude" | "fixture";
  apiKey?: string;
  claude?: Omit<ClaudeOcrOptions, "apiKey">;
  fixture?: FixtureOcrOptions;
}

export function createOcrProvider(options: CreateOcrProviderOptions = {}): OcrProvider {
  const kind = options.provider ?? (options.apiKey ? "claude" : "fixture");
  if (kind === "fixture") {
    return new FixtureOcrProvider(options.fixture);
  }
  return new ClaudeOcrProvider({
    ...options.claude,
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
  });
}
