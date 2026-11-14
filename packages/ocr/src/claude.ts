import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { ReceiptExtractionSchema } from "@billsplit/contracts";
import { summarizeBetaUsage } from "./pricing.js";
import {
  OcrParseError,
  OcrRefusalError,
  type OcrExtractInput,
  type OcrProvider,
  type OcrResult,
} from "./types.js";

export const DEFAULT_CLAUDE_OCR_MODEL = "claude-opus-5-5" as const;
export const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01" as const;

const SYSTEM_PROMPT = [
  "You extract structured data from receipt and bill images.",
  "Report all money values as integers in minor currency units (cents for USD, EUR, etc.).",
  "For each line item, totalPriceCents is the line total as printed; unitPriceCents is null unless explicitly printed.",
  "Report discountCents as a positive magnitude if a discount is subtracted from the subtotal.",
  "Set confidence to low for blurry, cut-off, or ambiguous rows; medium if partially guessed; high when crisp.",
  "Never invent illegible or missing totals: return null for any field not clearly readable.",
].join(" ");

export type BetaMessagesParser = Pick<Anthropic["beta"]["messages"], "parse">;

export interface ClaudeOcrOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** Override for tests or custom client instances (proxies, custom timeouts). */
  client?: { beta: { messages: BetaMessagesParser } };
}

/**
 * Vision OCR provider backed by Anthropic's Messages API with structured Zod outputs and
 * server-side fallback routing.
 */
export class ClaudeOcrProvider implements OcrProvider {
  readonly name = "claude" as const;
  private readonly client: { beta: { messages: BetaMessagesParser } };
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options: ClaudeOcrOptions = {}) {
    if (!options.client && !options.apiKey) {
      throw new Error("ClaudeOcrProvider requires either an apiKey or a preconfigured client");
    }
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey });
    this.model = options.model ?? DEFAULT_CLAUDE_OCR_MODEL;
    this.maxTokens = options.maxTokens ?? 4096;
  }

  async extract(input: OcrExtractInput): Promise<OcrResult> {
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: this.maxTokens,
      betas: [SERVER_FALLBACK_BETA],
      fallbacks: "default",
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: input.mediaType,
                data: input.image.toString("base64"),
              },
            },
            {
              type: "text",
              text: "Extract the structured receipt data from this image.",
            },
          ],
        },
      ],
      output_config: {
        format: betaZodOutputFormat(ReceiptExtractionSchema),
      },
    });

    if (response.stop_reason === "refusal") {
      throw new OcrRefusalError("The model refused to process this image", {
        category: response.stop_details?.category ?? null,
        explanation: response.stop_details?.explanation ?? null,
      });
    }

    if (!response.parsed_output) {
      throw new OcrParseError(
        `OCR response ended (${response.stop_reason ?? "unknown"}) without a structured receipt`,
      );
    }

    const { servingModel, usage } = summarizeBetaUsage(this.model, response.model, response.usage);
    return {
      extraction: response.parsed_output,
      model: servingModel,
      provider: this.name,
      usage,
    };
  }
}
