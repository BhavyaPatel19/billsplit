import { createIORedisClient, Queue, type ConnectionOptions, type JobsOptions } from "bullmq";
import { Redis, type RedisOptions } from "ioredis";

/** One queue for receipt work; the job name says what to do with the receipt. */
export const RECEIPTS_QUEUE = "receipts";

export interface ReceiptJobData {
  receiptId: string;
}

export type ReceiptJobName = "process";

/** Three tries with growing waits, so a brief S3 or database blip does not fail a receipt. */
export const RECEIPT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/**
 * An ioredis client set up the way BullMQ needs it. BullMQ wants `maxRetriesPerRequest: null`
 * so blocking commands wait through a reconnect instead of throwing.
 */
export function createRedis(url: string, options: Omit<RedisOptions, "replyMapping"> = {}): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: false, ...options });
}

/** BullMQ connection from an ioredis client. Each Queue/Worker should get its own client. */
export function bullConnection(redis: Redis): ConnectionOptions {
  return createIORedisClient(redis);
}

export function createReceiptsQueue(redis: Redis): Queue<ReceiptJobData, void, ReceiptJobName> {
  return new Queue<ReceiptJobData, void, ReceiptJobName>(RECEIPTS_QUEUE, {
    connection: bullConnection(redis),
    defaultJobOptions: RECEIPT_JOB_OPTIONS,
  });
}
