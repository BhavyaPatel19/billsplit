import { UnrecoverableError, Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { createDb, schema } from "@billsplit/db";
import {
  bullConnection,
  createRedis,
  RECEIPTS_QUEUE,
  type ReceiptJobData,
  type ReceiptJobName,
} from "@billsplit/queue";
import { createReceiptStorage } from "@billsplit/storage";
import { loadEnv } from "./env.js";
import { createLogger } from "./logger.js";
import { processReceipt } from "./process.js";

const env = loadEnv();
const logger = createLogger(env);
const dbHandle = createDb({ connectionString: env.DATABASE_URL, max: 2 });
const storage = createReceiptStorage({
  bucket: env.RECEIPTS_BUCKET,
  region: env.AWS_REGION,
  endpoint: env.S3_ENDPOINT,
  publicEndpoint: env.S3_PUBLIC_ENDPOINT,
  accessKey: env.S3_ACCESS_KEY,
  secretKey: env.S3_SECRET_KEY,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
});
const redis = createRedis(env.REDIS_URL);
const deps = { db: dbHandle.db, storage, logger };

const worker = new Worker<ReceiptJobData, void, ReceiptJobName>(
  RECEIPTS_QUEUE,
  async (job) => {
    if (job.name !== "process") throw new UnrecoverableError(`unknown job ${String(job.name)}`);
    const outcome = await processReceipt(deps, job.data.receiptId);
    logger.info({ jobId: job.id, outcome, attempt: job.attemptsMade + 1 }, "receipt.process");
  },
  { connection: bullConnection(redis), concurrency: env.WORKER_CONCURRENCY },
);

worker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err, attempt: job?.attemptsMade }, "receipt.process failed");
  // Out of retries (or unrecoverable): tell the uploader, so the receipt does not sit in
  // `processing` for ever.
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    void dbHandle.db
      .update(schema.receipts)
      .set({ status: "failed", error: "Processing failed; please try uploading again" })
      .where(eq(schema.receipts.id, job.data.receiptId))
      .catch((e: unknown) => logger.error({ err: e }, "could not mark receipt failed"));
  }
});
worker.on("error", (err) => logger.error({ err }, "worker error"));
worker.on("ready", () =>
  logger.info(
    { queue: RECEIPTS_QUEUE, concurrency: env.WORKER_CONCURRENCY, bucket: env.RECEIPTS_BUCKET },
    "worker listening",
  ),
);

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  setTimeout(() => process.exit(1), 30_000).unref();
  try {
    await worker.close(); // finishes in-flight jobs first
    await redis.quit();
    await dbHandle.close();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
