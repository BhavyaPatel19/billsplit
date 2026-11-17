import { Worker } from "bullmq";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
  bullConnection,
  createRedis,
  createReceiptsQueue,
  RECEIPTS_QUEUE,
  type ReceiptJobData,
  type ReceiptJobName,
} from "@billsplit/queue";

let valkey: StartedTestContainer;
let url = "";

beforeAll(async () => {
  valkey = await new GenericContainer("valkey/valkey:8-alpine")
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();
  url = `redis://${valkey.getHost()}:${valkey.getMappedPort(6379)}`;
});

afterAll(async () => {
  await valkey?.stop();
});

it("delivers a queued receipt to a worker once, even when it is added twice", async () => {
  const producerRedis = createRedis(url);
  const queue = createReceiptsQueue(producerRedis);
  const consumerRedis = createRedis(url);
  const seen: string[] = [];
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));

  const worker = new Worker<ReceiptJobData, void, ReceiptJobName>(
    RECEIPTS_QUEUE,
    (job) => {
      seen.push(job.data.receiptId);
      resolveDone();
      return Promise.resolve();
    },
    { connection: bullConnection(consumerRedis) },
  );

  try {
    const receiptId = crypto.randomUUID();
    // The API uses the receipt id as the job id, so a repeated confirm is a no-op here.
    await queue.add("process", { receiptId }, { jobId: receiptId });
    await queue.add("process", { receiptId }, { jobId: receiptId });
    await done;
    await new Promise((r) => setTimeout(r, 300));
    expect(seen).toEqual([receiptId]);
    expect(await queue.getJobCounts("waiting", "active", "failed")).toEqual({
      waiting: 0,
      active: 0,
      failed: 0,
    });
  } finally {
    await worker.close();
    await queue.close();
    await consumerRedis.quit();
    await producerRedis.quit();
  }
});
