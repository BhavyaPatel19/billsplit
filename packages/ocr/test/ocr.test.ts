import { describe, expect, it, vi } from "vitest";
import type { BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ReceiptExtraction } from "@billsplit/contracts";
import {
  ClaudeOcrProvider,
  DEFAULT_CLAUDE_OCR_MODEL,
  FixtureOcrProvider,
  OcrParseError,
  OcrRefusalError,
  SERVER_FALLBACK_BETA,
  createOcrProvider,
  reconcileReceiptExtraction,
  type BetaMessagesParser,
} from "../src/index.js";

const SAMPLE_EXTRACTION: ReceiptExtraction = {
  merchant: "Sunset Tacos",
  date: "2026-11-12",
  currency: "USD",
  items: [
    {
      description: "Al Pastor Tacos",
      quantity: 3,
      unitPriceCents: 450,
      totalPriceCents: 1350,
      confidence: "high",
    },
    {
      description: "Horchata",
      quantity: 1,
      unitPriceCents: 400,
      totalPriceCents: 400,
      confidence: "medium",
    },
  ],
  subtotalCents: 1750,
  taxCents: 158,
  tipCents: 350,
  feeCents: 100,
  discountCents: 200,
  totalCents: 2158,
};

function makeBetaUsage(overrides: Partial<BetaUsage> = {}): BetaUsage {
  return {
    cache_creation: null,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    fallback_credit: null,
    inference_geo: null,
    input_tokens: 1000,
    iterations: null,
    output_tokens: 200,
    output_tokens_details: null,
    server_tool_use: null,
    service_tier: "standard",
    speed: null,
    ...overrides,
  };
}

function makeFakeResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: DEFAULT_CLAUDE_OCR_MODEL,
    content: [],
    container: null,
    context_management: null,
    diagnostics: null,
    stop_details: null,
    stop_reason: "end_turn",
    stop_sequence: null,
    parsed_output: SAMPLE_EXTRACTION,
    usage: makeBetaUsage(),
    ...overrides,
  };
}

type ParseBody = Parameters<BetaMessagesParser["parse"]>[0];

function makeFakeClient(fn: (body: ParseBody) => Promise<Record<string, unknown>>): {
  beta: { messages: BetaMessagesParser };
} {
  return {
    beta: {
      messages: {
        parse: vi.fn(fn) as unknown as BetaMessagesParser["parse"],
      },
    },
  };
}

describe("reconcileReceiptExtraction", () => {
  it("matches when items + tax + tip + fees - discounts equal total", () => {
    const result = reconcileReceiptExtraction(SAMPLE_EXTRACTION);
    expect(result).toEqual({
      matches: true,
      itemsSumCents: 1750,
      computedTotalCents: 2158,
      discrepancyCents: 0,
      reason: null,
    });
  });

  it("flags discrepancies when printed total differs", () => {
    const result = reconcileReceiptExtraction({ ...SAMPLE_EXTRACTION, totalCents: 2200 });
    expect(result.matches).toBe(false);
    expect(result.computedTotalCents).toBe(2158);
    expect(result.discrepancyCents).toBe(42);
    expect(result.reason).toContain("2158");
    expect(result.reason).toContain("2200");
  });

  it("supports an explicit rounding tolerance", () => {
    const result = reconcileReceiptExtraction({ ...SAMPLE_EXTRACTION, totalCents: 2159 }, 1);
    expect(result.matches).toBe(true);
    expect(result.discrepancyCents).toBe(1);
  });

  it("requires review when total is missing or no items were found", () => {
    const missingTotal = reconcileReceiptExtraction({ ...SAMPLE_EXTRACTION, totalCents: null });
    expect(missingTotal.matches).toBe(false);
    expect(missingTotal.discrepancyCents).toBeNull();
    expect(missingTotal.reason).toBe("Receipt total could not be read");

    const emptyItems = reconcileReceiptExtraction({
      ...SAMPLE_EXTRACTION,
      items: [],
      totalCents: 500,
    });
    expect(emptyItems.matches).toBe(false);
    expect(emptyItems.reason).toBe("No line items were extracted");
  });
});

describe("FixtureOcrProvider", () => {
  it("returns deterministic structured data that reconciles", async () => {
    const provider = new FixtureOcrProvider();
    const res = await provider.extract({
      image: Buffer.from("jpeg-bytes"),
      mediaType: "image/jpeg",
    });
    expect(res.provider).toBe("fixture");
    expect(res.model).toBe("fixture-v1");
    expect(res.usage.costMicroUsd).toBe(0);
    expect(reconcileReceiptExtraction(res.extraction).matches).toBe(true);
  });

  it("supports custom extraction functions for tests", async () => {
    const provider = new FixtureOcrProvider({
      extraction: () => ({ ...SAMPLE_EXTRACTION, totalCents: 9999 }),
    });
    const res = await provider.extract({
      image: Buffer.from("x"),
      mediaType: "image/jpeg",
    });
    expect(reconcileReceiptExtraction(res.extraction).matches).toBe(false);
  });
});

describe("ClaudeOcrProvider", () => {
  it("sends structured output schema + server-side fallback beta and tracks token cost", async () => {
    const client = makeFakeClient((body) => {
      expect(body.model).toBe(DEFAULT_CLAUDE_OCR_MODEL);
      expect(body.betas).toContain(SERVER_FALLBACK_BETA);
      expect(body.fallbacks).toBe("default");
      expect(body.output_config?.format?.type).toBe("json_schema");
      // Verify the runtime parser attached by betaZodOutputFormat actually validates JSON.
      const format = body.output_config?.format as { parse?: (raw: string) => unknown } | undefined;
      expect(format?.parse?.(JSON.stringify(SAMPLE_EXTRACTION))).toEqual(SAMPLE_EXTRACTION);

      return Promise.resolve(
        makeFakeResponse({
          usage: makeBetaUsage({
            input_tokens: 1500,
            output_tokens: 300,
            cache_read_input_tokens: 1000,
          }),
        }),
      );
    });

    const provider = new ClaudeOcrProvider({ client });
    const res = await provider.extract({
      image: Buffer.from("fake-image"),
      mediaType: "image/jpeg",
    });

    expect(res.provider).toBe("claude");
    expect(res.model).toBe(DEFAULT_CLAUDE_OCR_MODEL);
    expect(res.extraction).toEqual(SAMPLE_EXTRACTION);
    // Opus 5.5 rates: 1500 * 5 + 300 * 25 + 1000 * 5 * 0.1 = 7500 + 7500 + 500 = 15500 micro-USD
    expect(res.usage).toEqual({
      inputTokens: 1500,
      outputTokens: 300,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1000,
      costMicroUsd: 15500,
    });
  });

  it("attributes fallback model pricing when a server-side fallback serves the request", async () => {
    const client = makeFakeClient(() =>
      Promise.resolve(
        makeFakeResponse({
          usage: makeBetaUsage({
            iterations: [
              {
                type: "fallback_message",
                model: "claude-sonnet-5-5",
                input_tokens: 1000,
                output_tokens: 200,
                cache_creation: null,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            ],
          }),
        }),
      ),
    );

    const provider = new ClaudeOcrProvider({ client });
    const res = await provider.extract({
      image: Buffer.from("fake-image"),
      mediaType: "image/jpeg",
    });

    expect(res.model).toBe("claude-sonnet-5-5");
    // Sonnet rates: 1000 * 3 + 200 * 15 = 6000 micro-USD
    expect(res.usage.costMicroUsd).toBe(6000);
  });

  it("throws OcrRefusalError when stop_reason is refusal", async () => {
    const client = makeFakeClient(() =>
      Promise.resolve(
        makeFakeResponse({
          id: "msg_refused",
          stop_details: {
            type: "refusal",
            category: "cyber",
            explanation: "Cannot inspect sensitive image",
          },
          stop_reason: "refusal",
          parsed_output: null,
        }),
      ),
    );

    const provider = new ClaudeOcrProvider({ client });
    await expect(
      provider.extract({ image: Buffer.from("img"), mediaType: "image/jpeg" }),
    ).rejects.toMatchObject({
      name: "OcrRefusalError",
      category: "cyber",
      explanation: "Cannot inspect sensitive image",
    });
    await expect(
      provider.extract({ image: Buffer.from("img"), mediaType: "image/jpeg" }),
    ).rejects.toBeInstanceOf(OcrRefusalError);
  });

  it("throws OcrParseError when structured output is missing", async () => {
    const client = makeFakeClient(() =>
      Promise.resolve(
        makeFakeResponse({
          id: "msg_trunc",
          stop_reason: "max_tokens",
          parsed_output: null,
        }),
      ),
    );

    const provider = new ClaudeOcrProvider({ client });
    await expect(
      provider.extract({ image: Buffer.from("img"), mediaType: "image/jpeg" }),
    ).rejects.toBeInstanceOf(OcrParseError);
  });
});

describe("createOcrProvider", () => {
  it("defaults to fixture when no API key is configured, and claude when apiKey is given", () => {
    expect(createOcrProvider().name).toBe("fixture");
    expect(createOcrProvider({ apiKey: "sk-ant-test" }).name).toBe("claude");
    expect(createOcrProvider({ provider: "fixture", apiKey: "sk-ant-test" }).name).toBe("fixture");
  });
});
