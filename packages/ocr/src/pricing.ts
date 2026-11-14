import type { BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { OcrUsage } from "./types.js";

/** Price per 1M tokens in USD — equals micro-USD per single token (1 USD = 1e6 micro-USD). */
interface ModelRates {
  inputMicroUsdPerToken: number;
  outputMicroUsdPerToken: number;
}

const DEFAULT_RATES: ModelRates = {
  inputMicroUsdPerToken: 5,
  outputMicroUsdPerToken: 25,
};

const MODEL_RATE_PREFIXES: ReadonlyArray<readonly [string, ModelRates]> = [
  ["claude-opus-5", { inputMicroUsdPerToken: 5, outputMicroUsdPerToken: 25 }],
  ["claude-opus-4-8", { inputMicroUsdPerToken: 5, outputMicroUsdPerToken: 25 }],
  ["claude-opus-4-7", { inputMicroUsdPerToken: 5, outputMicroUsdPerToken: 25 }],
  ["claude-opus-4-6", { inputMicroUsdPerToken: 5, outputMicroUsdPerToken: 25 }],
  ["claude-opus-4-5", { inputMicroUsdPerToken: 5, outputMicroUsdPerToken: 25 }],
  ["claude-sonnet-5", { inputMicroUsdPerToken: 3, outputMicroUsdPerToken: 15 }],
  ["claude-sonnet-4", { inputMicroUsdPerToken: 3, outputMicroUsdPerToken: 15 }],
  ["claude-haiku-5", { inputMicroUsdPerToken: 1, outputMicroUsdPerToken: 5 }],
  ["claude-haiku-4-5", { inputMicroUsdPerToken: 1, outputMicroUsdPerToken: 5 }],
];

export function ratesForModel(model: string): ModelRates {
  for (const [prefix, rates] of MODEL_RATE_PREFIXES) {
    if (model.startsWith(prefix)) return rates;
  }
  return DEFAULT_RATES;
}

/**
 * Picks the serving model and computes integer micro-USD cost from Anthropic usage metadata,
 * accounting for server-side fallback iterations and prompt-cache reads/writes.
 */
export function summarizeBetaUsage(
  requestedModel: string,
  responseModel: string,
  usage: BetaUsage,
): { servingModel: string; usage: OcrUsage } {
  const fallbackIter = usage.iterations?.find((iter) => iter.type === "fallback_message");
  const servingModel = fallbackIter?.model ?? (responseModel || requestedModel);

  const inputTokens = fallbackIter?.input_tokens ?? usage.input_tokens;
  const outputTokens = fallbackIter?.output_tokens ?? usage.output_tokens;
  const cacheCreationInputTokens =
    fallbackIter?.cache_creation_input_tokens ?? usage.cache_creation_input_tokens ?? 0;
  const cacheReadInputTokens =
    fallbackIter?.cache_read_input_tokens ?? usage.cache_read_input_tokens ?? 0;
  const cacheCreation = fallbackIter ? fallbackIter.cache_creation : usage.cache_creation;

  const rates = ratesForModel(servingModel);
  const ephemeral1h = cacheCreation?.ephemeral_1h_input_tokens ?? 0;
  const ephemeral5m =
    cacheCreation?.ephemeral_5m_input_tokens ?? Math.max(0, cacheCreationInputTokens - ephemeral1h);

  const rawCostMicroUsd =
    inputTokens * rates.inputMicroUsdPerToken +
    outputTokens * rates.outputMicroUsdPerToken +
    ephemeral5m * rates.inputMicroUsdPerToken * 1.25 +
    ephemeral1h * rates.inputMicroUsdPerToken * 2 +
    cacheReadInputTokens * rates.inputMicroUsdPerToken * 0.1;

  return {
    servingModel,
    usage: {
      inputTokens,
      outputTokens,
      cacheCreationInputTokens,
      cacheReadInputTokens,
      costMicroUsd: Math.round(rawCostMicroUsd),
    },
  };
}
