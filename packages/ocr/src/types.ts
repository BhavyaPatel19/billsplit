import type { ReceiptExtraction } from "@billsplit/contracts";

export type OcrImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

export interface OcrExtractInput {
  image: Buffer;
  mediaType: OcrImageMediaType;
}

export interface OcrUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costMicroUsd: number;
}

export interface OcrResult {
  extraction: ReceiptExtraction;
  /** Model that actually served the response (differs from requested model on server fallback). */
  model: string;
  provider: "claude" | "fixture";
  usage: OcrUsage;
}

export interface OcrProvider {
  readonly name: "claude" | "fixture";
  extract(input: OcrExtractInput): Promise<OcrResult>;
}

/**
 * Thrown when Claude declines to process the image (`stop_reason === "refusal"`).
 * Retrying with the same image will produce the same refusal, so callers should mark the
 * receipt failed rather than retrying.
 */
export class OcrRefusalError extends Error {
  readonly category: string | null;
  readonly explanation: string | null;

  constructor(
    message: string,
    details?: { category?: string | null; explanation?: string | null },
  ) {
    super(message);
    this.name = "OcrRefusalError";
    this.category = details?.category ?? null;
    this.explanation = details?.explanation ?? null;
  }
}

/** Thrown when the model returned without producing a valid parsed receipt payload. */
export class OcrParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OcrParseError";
  }
}
