import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  ClaudeOcrProvider,
  FixtureOcrProvider,
  GoldenReceiptCaseSchema,
  aggregateEvalResults,
  scoreReceiptExtraction,
  type GoldenReceiptCase,
  type OcrProvider,
  type ReceiptEvalCaseResult,
} from "../src/index.js";

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_GOLDEN_DIR = path.join(EVAL_DIR, "golden");
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".svg"] as const;

interface CliOptions {
  goldenDir: string;
  provider?: "claude" | "fixture";
  requireLive: boolean;
  concurrency: number;
  limit?: number;
  minItemPrecision: number;
  minItemRecall: number;
  minTotalRate: number;
  outPath?: string;
  json: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    goldenDir: DEFAULT_GOLDEN_DIR,
    requireLive: false,
    concurrency: 3,
    minItemPrecision: 0,
    minItemRecall: 0,
    minTotalRate: 0,
    json: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    const next = () => {
      const val = argv[++i];
      if (!val) throw new Error(`Missing value for ${arg}`);
      return val;
    };

    if (arg === "--provider") {
      const val = next();
      if (val !== "claude" && val !== "fixture") throw new Error(`Invalid provider: ${val}`);
      opts.provider = val;
    } else if (arg === "--golden-dir") {
      opts.goldenDir = path.resolve(next());
    } else if (arg === "--require-live") {
      opts.requireLive = true;
    } else if (arg === "--concurrency") {
      opts.concurrency = Math.max(1, Number.parseInt(next(), 10));
    } else if (arg === "--limit") {
      opts.limit = Math.max(1, Number.parseInt(next(), 10));
    } else if (arg === "--min-item-precision") {
      opts.minItemPrecision = Number.parseFloat(next());
    } else if (arg === "--min-item-recall") {
      opts.minItemRecall = Number.parseFloat(next());
    } else if (arg === "--min-total-rate") {
      opts.minTotalRate = Number.parseFloat(next());
    } else if (arg === "--out") {
      opts.outPath = path.resolve(next());
    } else if (arg === "--json") {
      opts.json = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return opts;
}

async function loadGoldenCases(
  dir: string,
): Promise<Array<{ spec: GoldenReceiptCase; imagePath: string }>> {
  const entries = (await readdir(dir)).filter((f) => f.endsWith(".expected.json")).sort();
  const cases: Array<{ spec: GoldenReceiptCase; imagePath: string }> = [];

  for (const file of entries) {
    const base = file.slice(0, -".expected.json".length);
    const raw = JSON.parse(await readFile(path.join(dir, file), "utf8")) as unknown;
    const spec = GoldenReceiptCaseSchema.parse(raw);

    let imagePath: string | null = null;
    for (const ext of IMAGE_EXTENSIONS) {
      const candidate = path.join(dir, `${base}${ext}`);
      if (existsSync(candidate)) {
        imagePath = candidate;
        break;
      }
    }
    if (!imagePath) {
      throw new Error(`Missing image file for golden case "${file}" in ${dir}`);
    }
    cases.push({ spec, imagePath });
  }
  return cases;
}

/**
 * Normalizes any golden image (`.svg`, `.jpg`, `.png`, `.webp`) through the same JPEG encoding
 * settings used by the worker so evaluations match production inputs.
 */
async function loadNormalizedJpeg(imagePath: string): Promise<Buffer> {
  const raw = await readFile(imagePath);
  return sharp(raw, { failOn: "error" })
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
}

async function mapConcurrent<T, R>(
  items: ReadonlyArray<T>,
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || undefined;
  const providerKind = opts.provider ?? (apiKey ? "claude" : "fixture");

  if (opts.requireLive && providerKind !== "claude") {
    throw new Error("--require-live passed, but --provider fixture was chosen");
  }
  if (providerKind === "claude" && !apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required when running OCR eval with Claude");
  }

  let cases = await loadGoldenCases(opts.goldenDir);
  if (opts.limit !== undefined) cases = cases.slice(0, opts.limit);
  if (cases.length === 0) throw new Error(`No golden cases found in ${opts.goldenDir}`);

  const byId = new Map(cases.map((c) => [c.spec.id, c.spec.expected]));
  const imageIdMap = new WeakMap<Buffer, string>();

  const provider: OcrProvider =
    providerKind === "claude" && apiKey
      ? new ClaudeOcrProvider({ apiKey })
      : new FixtureOcrProvider({
          model: "fixture-golden",
          extraction: (input) => {
            const id = imageIdMap.get(input.image);
            const match = id ? byId.get(id) : undefined;
            if (!match) throw new Error("Unexpected image passed to fixture eval provider");
            return match;
          },
        });

  if (!opts.json) {
    console.log(
      `Running OCR eval on ${cases.length} golden receipts using "${providerKind}"` +
        (providerKind === "fixture" ? " (dry-run mode; set ANTHROPIC_API_KEY for live eval)" : ""),
    );
  }

  const concurrency = providerKind === "fixture" ? Math.max(opts.concurrency, 8) : opts.concurrency;

  const results = await mapConcurrent(cases, concurrency, async ({ spec, imagePath }) => {
    const start = performance.now();
    try {
      const jpeg = await loadNormalizedJpeg(imagePath);
      imageIdMap.set(jpeg, spec.id);
      const res = await provider.extract({ image: jpeg, mediaType: "image/jpeg" });
      const latencyMs = Math.round(performance.now() - start);
      const score = scoreReceiptExtraction(spec.expected, res.extraction);
      return {
        id: spec.id,
        category: spec.category,
        score,
        costMicroUsd: res.usage.costMicroUsd,
        latencyMs,
        model: res.model,
      } satisfies ReceiptEvalCaseResult;
    } catch (err) {
      return {
        id: spec.id,
        category: spec.category,
        score: scoreReceiptExtraction(spec.expected, {
          merchant: null,
          date: null,
          currency: null,
          items: [],
          subtotalCents: null,
          taxCents: null,
          tipCents: null,
          feeCents: null,
          discountCents: null,
          totalCents: null,
        }),
        costMicroUsd: 0,
        latencyMs: Math.round(performance.now() - start),
        model: providerKind,
        error: err instanceof Error ? err.message : String(err),
      } satisfies ReceiptEvalCaseResult;
    }
  });

  const summary = aggregateEvalResults(results);
  const report = {
    provider: providerKind,
    generatedAt: new Date().toISOString(),
    summary,
    results,
  };

  if (opts.outPath) {
    await mkdir(path.dirname(opts.outPath), { recursive: true });
    await writeFile(opts.outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("\n=== Golden Eval Summary ===");
    console.log(`Cases:          ${summary.succeededCases}/${summary.totalCases} succeeded`);
    console.log(`Item Precision: ${pct(summary.itemPrecision)}`);
    console.log(`Item Recall:    ${pct(summary.itemRecall)}`);
    console.log(`Item F1:        ${pct(summary.itemF1)}`);
    console.log(`Total Match:    ${pct(summary.totalMatchRate)}`);
    console.log(`Tax Match:      ${pct(summary.taxMatchRate)}`);
    console.log(`Tip Match:      ${pct(summary.tipMatchRate)}`);
    console.log(`Reconciliation: ${pct(summary.reconciliationRate)}`);
    console.log(`Total Cost:     $${(summary.totalCostMicroUsd / 1_000_000).toFixed(4)}`);
    console.log(`Avg Latency:    ${summary.avgLatencyMs} ms`);

    const misses = results.filter((r) => r.error || !r.score.totalMatch || r.score.itemF1 < 1);
    if (misses.length > 0) {
      console.log("\nCases with misses/errors:");
      for (const m of misses) {
        console.log(
          `- ${m.id} (${m.category}): precision=${pct(m.score.itemPrecision)}, recall=${pct(
            m.score.itemRecall,
          )}, total=${m.score.totalMatch ? "ok" : "MISS"}${m.error ? `, error=${m.error}` : ""}`,
        );
      }
    }
  }

  const failedThresholds: string[] = [];
  if (summary.failedCases > 0) failedThresholds.push(`${summary.failedCases} case(s) errored`);
  if (summary.itemPrecision < opts.minItemPrecision) {
    failedThresholds.push(
      `itemPrecision ${pct(summary.itemPrecision)} < ${pct(opts.minItemPrecision)}`,
    );
  }
  if (summary.itemRecall < opts.minItemRecall) {
    failedThresholds.push(`itemRecall ${pct(summary.itemRecall)} < ${pct(opts.minItemRecall)}`);
  }
  if (summary.totalMatchRate < opts.minTotalRate) {
    failedThresholds.push(
      `totalMatchRate ${pct(summary.totalMatchRate)} < ${pct(opts.minTotalRate)}`,
    );
  }

  if (failedThresholds.length > 0) {
    console.error(`\nEval thresholds failed: ${failedThresholds.join("; ")}`);
    process.exitCode = 1;
  }
}

void main();
