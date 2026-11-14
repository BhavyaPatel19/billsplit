import {
  createRedis,
  createReceiptsQueue,
  type ReceiptJobData,
  type ReceiptJobName,
} from "@billsplit/queue";
import type { Queue } from "bullmq";
import type { Env } from "./env.js";
import type { Logger } from "./logger.js";

/** Background work the API hands off; the worker app consumes it. */
export interface ReceiptJobs {
  /** Queue a confirmed upload for re-encoding and OCR. */
  enqueueProcess(receiptId: string): Promise<void>;
  close(): Promise<void>;
}

/** Records jobs instead of running them; tests read them back. */
export class InMemoryReceiptJobs implements ReceiptJobs {
  readonly queued: string[] = [];
  enqueueProcess(receiptId: string): Promise<void> {
    this.queued.push(receiptId);
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** Without a queue, a confirmed receipt stays `uploaded`; say so in the log. */
export class LogReceiptJobs implements ReceiptJobs {
  constructor(private readonly logger: Logger) {}
  enqueueProcess(receiptId: string): Promise<void> {
    this.logger.info({ receiptId }, "receipt.process not queued (REDIS_URL unset)");
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** BullMQ on Valkey. The job id is the receipt id, so a double confirm cannot queue it twice. */
export class BullMqReceiptJobs implements ReceiptJobs {
  private readonly redis;
  private readonly queue: Queue<ReceiptJobData, void, ReceiptJobName>;

  constructor(redisUrl: string) {
    this.redis = createRedis(redisUrl);
    this.queue = createReceiptsQueue(this.redis);
  }

  async enqueueProcess(receiptId: string): Promise<void> {
    await this.queue.add("process", { receiptId }, { jobId: receiptId });
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.redis.quit();
  }
}

export function createReceiptJobs(env: Env, logger: Logger): ReceiptJobs {
  return env.REDIS_URL ? new BullMqReceiptJobs(env.REDIS_URL) : new LogReceiptJobs(logger);
}
