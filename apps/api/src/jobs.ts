import type { Logger } from "./logger.js";

/** Background work the API hands off. The BullMQ implementation lives with the worker. */
export interface ReceiptJobs {
  /** Queue a confirmed upload for re-encoding and OCR. */
  enqueueProcess(receiptId: string): Promise<void>;
}

/** Records jobs instead of running them; tests read them back. */
export class InMemoryReceiptJobs implements ReceiptJobs {
  readonly queued: string[] = [];
  enqueueProcess(receiptId: string): Promise<void> {
    this.queued.push(receiptId);
    return Promise.resolve();
  }
}

/** Until the worker exists, a confirmed receipt stays `uploaded`; say so in the log. */
export class LogReceiptJobs implements ReceiptJobs {
  constructor(private readonly logger: Logger) {}
  enqueueProcess(receiptId: string): Promise<void> {
    this.logger.info({ receiptId }, "receipt.process not queued (no worker configured)");
    return Promise.resolve();
  }
}
