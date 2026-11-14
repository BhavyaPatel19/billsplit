import { eq } from "drizzle-orm";
import pino from "pino";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "@billsplit/db";
import { receiptKeys } from "@billsplit/storage";
import {
  AcceptInviteResponseSchema,
  CreateReceiptResponseSchema,
  GroupDetailSchema,
  InviteSchema,
  ReceiptListResponseSchema,
  ReceiptSchema,
  RECEIPT_MAX_BYTES,
  type CreateReceiptResponse,
} from "@billsplit/contracts";
import { createApp } from "../src/app.js";
import { createAuth } from "../src/auth.js";
import { InMemoryMailer } from "../src/email.js";
import { request, signUpVerified, startTestContext, type TestContext } from "./helpers.js";

let ctx: TestContext;
let ana = "";
let bo = "";
let outsider = "";
let groupId = "";
let otherGroupId = "";

const api = (path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) =>
  request(ctx.app, path, init);

const jpeg = (n: number) => new Uint8Array(n).fill(0xff);

async function start(
  cookie = ana,
  body: unknown = { contentType: "image/jpeg", sizeBytes: 2048 },
  group = groupId,
): Promise<CreateReceiptResponse> {
  const res = await api(`/api/groups/${group}/receipts`, { cookie, body });
  expect(res.status).toBe(201);
  return CreateReceiptResponseSchema.parse(await res.json());
}

const complete = (id: string, cookie = ana, group = groupId) =>
  api(`/api/groups/${group}/receipts/${id}/complete`, { cookie, method: "POST" });

const keyOf = (id: string, group = groupId) => receiptKeys(group, id).original;

beforeAll(async () => {
  ctx = await startTestContext();
  [ana, bo, outsider] = await Promise.all([
    signUpVerified(ctx, "Ana", "ana@example.com"),
    signUpVerified(ctx, "Bo", "bo@example.com"),
    signUpVerified(ctx, "Out", "out@example.com"),
  ]);
  groupId = GroupDetailSchema.parse(
    await (await api("/api/groups", { cookie: ana, body: { name: "Flat 4B" } })).json(),
  ).id;
  otherGroupId = GroupDetailSchema.parse(
    await (await api("/api/groups", { cookie: outsider, body: { name: "Elsewhere" } })).json(),
  ).id;
  const invite = InviteSchema.parse(
    await (await api(`/api/groups/${groupId}/invites`, { cookie: ana, body: {} })).json(),
  );
  AcceptInviteResponseSchema.parse(
    await (await api(`/api/invites/${invite.code}/accept`, { cookie: bo, body: {} })).json(),
  );
});

afterAll(async () => {
  await ctx?.stop();
});

describe("starting an upload", () => {
  it("creates the receipt and a PUT signed for the declared type and size", async () => {
    const { receipt, upload } = await start();
    expect(receipt.status).toBe("awaiting_upload");
    expect(receipt.groupId).toBe(groupId);
    expect(receipt.imageUrl).toBeNull();
    expect(upload.method).toBe("PUT");
    expect(upload.url).toContain(`receipts/${groupId}/${receipt.id}/original`);
    expect(upload.headers).toEqual({ "content-type": "image/jpeg", "content-length": "2048" });
    const ttl = Date.parse(upload.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(10 * 60_000);
  });

  it("refuses files over 10 MB and types that are not images", async () => {
    for (const body of [
      { contentType: "image/jpeg", sizeBytes: RECEIPT_MAX_BYTES + 1 },
      { contentType: "application/pdf", sizeBytes: 1000 },
      { contentType: "image/jpeg", sizeBytes: 0 },
    ]) {
      const res = await api(`/api/groups/${groupId}/receipts`, { cookie: ana, body });
      expect(res.status).toBe(400);
    }
  });

  it("is not available to people outside the group", async () => {
    const res = await api(`/api/groups/${groupId}/receipts`, {
      cookie: outsider,
      body: { contentType: "image/jpeg", sizeBytes: 10 },
    });
    expect(res.status).toBe(404);
    expect((await api(`/api/groups/${groupId}/receipts`, { cookie: outsider })).status).toBe(404);
  });

  it("requires a session", async () => {
    const res = await api(`/api/groups/${groupId}/receipts`, {
      body: { contentType: "image/jpeg", sizeBytes: 10 },
    });
    expect(res.status).toBe(401);
  });
});

describe("confirming an upload", () => {
  it("is a conflict until the file is in storage", async () => {
    const { receipt } = await start();
    expect((await complete(receipt.id)).status).toBe(409);
    expect(ctx.jobs.queued).not.toContain(receipt.id);
  });

  it("checks the object, marks it uploaded and queues processing exactly once", async () => {
    const { receipt } = await start();
    await ctx.storage.put(keyOf(receipt.id), jpeg(2048), "image/jpeg");

    const first = await complete(receipt.id);
    expect(first.status).toBe(200);
    expect(ReceiptSchema.parse(await first.json()).status).toBe("uploaded");

    const again = await complete(receipt.id);
    expect(again.status).toBe(200);
    expect(ctx.jobs.queued.filter((id) => id === receipt.id)).toHaveLength(1);
  });

  it("fails a file whose size differs from the declaration and deletes it", async () => {
    const { receipt } = await start();
    await ctx.storage.put(keyOf(receipt.id), jpeg(4096), "image/jpeg");
    const res = await complete(receipt.id);
    expect(res.status).toBe(400);
    expect(ctx.storage.objects.has(keyOf(receipt.id))).toBe(false);
    const after = ReceiptSchema.parse(
      await (await api(`/api/groups/${groupId}/receipts/${receipt.id}`, { cookie: ana })).json(),
    );
    expect(after.status).toBe("failed");
    expect(after.error).toMatch(/size/);
    expect(ctx.jobs.queued).not.toContain(receipt.id);
  });

  it("fails a file whose type differs from the declaration", async () => {
    const { receipt } = await start();
    await ctx.storage.put(keyOf(receipt.id), jpeg(2048), "text/html");
    expect((await complete(receipt.id)).status).toBe(400);
  });

  it("can only be done by the uploader", async () => {
    const { receipt } = await start();
    await ctx.storage.put(keyOf(receipt.id), jpeg(2048), "image/jpeg");
    expect((await complete(receipt.id, bo)).status).toBe(403);
    expect((await complete(receipt.id, outsider)).status).toBe(404);
  });
});

describe("reading receipts", () => {
  it("lists the group's receipts newest first, members only", async () => {
    const { receipt } = await start(bo);
    const res = await api(`/api/groups/${groupId}/receipts`, { cookie: ana });
    expect(res.status).toBe(200);
    const { receipts } = ReceiptListResponseSchema.parse(await res.json());
    expect(receipts[0]!.id).toBe(receipt.id);
    expect(receipts.every((r) => r.groupId === groupId)).toBe(true);
  });

  it("signs short-lived image links once the worker has produced them", async () => {
    const { receipt } = await start();
    const keys = receiptKeys(groupId, receipt.id);
    await ctx.db.db
      .update(schema.receipts)
      .set({ status: "ready", imageKey: keys.image, thumbnailKey: keys.thumbnail })
      .where(eq(schema.receipts.id, receipt.id));
    const got = ReceiptSchema.parse(
      await (await api(`/api/groups/${groupId}/receipts/${receipt.id}`, { cookie: bo })).json(),
    );
    expect(got.imageUrl).toContain(keys.image);
    expect(got.thumbnailUrl).toContain(keys.thumbnail);
  });

  it("does not find a receipt through another group, or by a malformed id", async () => {
    const { receipt } = await start(outsider, undefined, otherGroupId);
    for (const path of [
      `/api/groups/${groupId}/receipts/${receipt.id}`,
      `/api/groups/${groupId}/receipts/not-a-uuid`,
    ]) {
      expect((await api(path, { cookie: ana })).status).toBe(404);
    }
    expect((await complete(receipt.id, ana)).status).toBe(404);
  });
});

it("answers 503 when no bucket is configured", async () => {
  const logger = pino({ enabled: false });
  const auth = createAuth({ env: ctx.env, db: ctx.db.db, mailer: new InMemoryMailer(), logger });
  const app = createApp({
    env: ctx.env,
    logger,
    db: ctx.db.db,
    auth,
    storage: null,
    jobs: ctx.jobs,
  });
  const res = await request(app, `/api/groups/${groupId}/receipts`, {
    cookie: ana,
    body: { contentType: "image/jpeg", sizeBytes: 10 },
  });
  expect(res.status).toBe(503);
});
