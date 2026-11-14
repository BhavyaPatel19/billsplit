import { randomUUID } from "node:crypto";
import { and, count, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { schema, type Db } from "@billsplit/db";
import {
  CreateReceiptBodySchema,
  CreateReceiptResponseSchema,
  CreateSampleReceiptBodySchema,
  RECEIPT_MAX_BYTES,
  ReceiptListResponseSchema,
  ReceiptOcrSchema,
  ReceiptSampleIdSchema,
  ReceiptSchema,
  UpdateReceiptOcrBodySchema,
  reconcileReceiptExtraction,
  type Receipt,
  type ReceiptContentType,
  type ReceiptOcr,
} from "@billsplit/contracts";
import { receiptKeys, type ReceiptStorage } from "@billsplit/storage";
import type { Env } from "../env.js";
import type { ReceiptJobs } from "../jobs.js";
import { requireMembership } from "../lib/authorize.js";
import { ApiError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { validate } from "../lib/validate.js";
import { requireSession, type SessionVariables } from "../middleware/session.js";

const json = (s: Parameters<typeof resolver>[0]) => ({
  "application/json": { schema: resolver(s) },
});

/** Long enough for a slow phone upload, short enough that a leaked URL is soon useless. */
const PUT_TTL_SECONDS = 10 * 60;
/** Viewing links are re-signed on every read. */
const GET_TTL_SECONDS = 5 * 60;
const LIST_LIMIT = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Row = typeof schema.receipts.$inferSelect;
type NewRow = typeof schema.receipts.$inferInsert;
type Limits = Pick<
  Env,
  "RECEIPTS_DEMO_MODE" | "RECEIPT_DAILY_SCAN_LIMIT" | "RECEIPT_DAILY_SAMPLE_LIMIT"
>;

export function receiptRoutes(
  db: Db,
  storage: ReceiptStorage | null,
  jobs: ReceiptJobs,
  limits: Limits,
) {
  const router = new Hono<{ Variables: SessionVariables }>();
  router.use("/groups/:id/receipts", requireSession);
  router.use("/groups/:id/receipts/*", requireSession);

  const store = (): ReceiptStorage => {
    if (!storage) throw new ApiError(503, "Receipt uploads are not configured on this server");
    return storage;
  };

  const toReceipt = async (r: Row): Promise<Receipt> => {
    const sign = (key: string | null) =>
      key && storage ? storage.presignGet(key, GET_TTL_SECONDS) : Promise.resolve(null);
    const [imageUrl, thumbnailUrl] = await Promise.all([sign(r.imageKey), sign(r.thumbnailKey)]);
    return {
      id: r.id,
      groupId: r.groupId,
      status: r.status,
      contentType: r.contentType as ReceiptContentType,
      sizeBytes: r.sizeBytes,
      uploadedBy: r.uploadedBy,
      imageUrl,
      thumbnailUrl,
      sampleId: ReceiptSampleIdSchema.nullable().parse(r.sampleId),
      ocr: r.ocr === null || r.ocr === undefined ? null : ReceiptOcrSchema.parse(r.ocr),
      error: r.error,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  };

  /** The receipt if it belongs to this group; a malformed id is simply not found. */
  const findInGroup = async (groupId: string, receiptId: string): Promise<Row> => {
    if (!UUID.test(receiptId)) throw notFound("Receipt not found");
    const [row] = await db
      .select()
      .from(schema.receipts)
      .where(and(eq(schema.receipts.id, receiptId), eq(schema.receipts.groupId, groupId)))
      .limit(1);
    if (!row) throw notFound("Receipt not found");
    return row;
  };

  /**
   * Inserts the receipt only while the user is under their rolling 24-hour cap. Photo uploads
   * and samples are counted separately. The advisory lock serialises one user's concurrent
   * requests, so two tabs cannot both take the last slot.
   */
  const insertWithinCap = (userId: string, values: NewRow): Promise<Row> => {
    const isSample = values.sampleId != null;
    const limit = isSample ? limits.RECEIPT_DAILY_SAMPLE_LIMIT : limits.RECEIPT_DAILY_SCAN_LIMIT;
    return db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`receipts:${userId}`}))`);
      const [usage] = await tx
        .select({ used: count() })
        .from(schema.receipts)
        .where(
          and(
            eq(schema.receipts.requestedByUserId, userId),
            gte(schema.receipts.createdAt, new Date(Date.now() - DAY_MS)),
            isSample ? isNotNull(schema.receipts.sampleId) : isNull(schema.receipts.sampleId),
          ),
        );
      if ((usage?.used ?? 0) >= limit) {
        throw new ApiError(
          429,
          isSample
            ? `You can add ${limit} sample receipts per day. Try again tomorrow.`
            : `You can scan ${limit} receipts per day. Try again tomorrow, or try a sample receipt.`,
        );
      }
      const [row] = await tx.insert(schema.receipts).values(values).returning();
      return row!;
    });
  };

  router.post(
    "/groups/:id/receipts",
    describeRoute({
      tags: ["receipts"],
      summary: "Start a receipt upload",
      description:
        "Creates the receipt and returns a presigned PUT, valid for 10 minutes and signed for " +
        "the declared content type and exact size. PUT the file there, then call `complete`.",
      responses: {
        201: { description: "Created", content: json(CreateReceiptResponseSchema) },
        403: { description: "Photo uploads are turned off (demo mode)" },
        429: { description: "Daily scan limit reached" },
        503: { description: "Uploads are not configured" },
      },
    }),
    validate("json", CreateReceiptBodySchema),
    async (c) => {
      const s = store();
      const userId = c.get("session")!.user.id;
      const { group, me } = await requireMembership(db, userId, c.req.param("id"));
      if (limits.RECEIPTS_DEMO_MODE) {
        throw forbidden("Photo uploads are turned off in this demo. Try a sample receipt instead.");
      }
      const body = c.req.valid("json");
      const id = randomUUID();
      const keys = receiptKeys(group.id, id);
      const row = await insertWithinCap(userId, {
        id,
        groupId: group.id,
        uploadedBy: me.id,
        requestedByUserId: userId,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        originalKey: keys.original,
      });
      // Signed only once a slot is taken, so a refused request never gets a usable URL.
      const upload = await s.presignPut(keys.original, body, PUT_TTL_SECONDS);
      return c.json(
        {
          receipt: await toReceipt(row),
          upload: {
            ...upload,
            method: "PUT" as const,
            expiresAt: new Date(Date.now() + PUT_TTL_SECONDS * 1000).toISOString(),
          },
        },
        201,
      );
    },
  );

  router.post(
    "/groups/:id/receipts/samples",
    describeRoute({
      tags: ["receipts"],
      summary: "Add a built-in sample receipt",
      description:
        "Queues one of the sample receipts for processing. The worker renders the image and " +
        "extracts it with a fixture, so no paid OCR call is made. Works in demo mode.",
      responses: {
        201: { description: "Created", content: json(ReceiptSchema) },
        429: { description: "Daily sample limit reached" },
        503: { description: "Receipts are not configured" },
      },
    }),
    validate("json", CreateSampleReceiptBodySchema),
    async (c) => {
      store();
      const userId = c.get("session")!.user.id;
      const { group, me } = await requireMembership(db, userId, c.req.param("id"));
      const { sampleId } = c.req.valid("json");
      const id = randomUUID();
      const row = await insertWithinCap(userId, {
        id,
        groupId: group.id,
        uploadedBy: me.id,
        requestedByUserId: userId,
        sampleId,
        status: "uploaded",
        contentType: "image/jpeg",
        // Placeholder until the worker renders the image and records its real size.
        sizeBytes: 1,
        originalKey: receiptKeys(group.id, id).original,
      });
      await jobs.enqueueProcess(row.id);
      return c.json(await toReceipt(row), 201);
    },
  );

  router.post(
    "/groups/:id/receipts/:receiptId/complete",
    describeRoute({
      tags: ["receipts"],
      summary: "Confirm an upload and queue it for processing",
      description:
        "Checks the stored object against the declared size and type, then queues OCR. " +
        "Calling it again after success returns the receipt unchanged.",
      responses: {
        200: { description: "OK", content: json(ReceiptSchema) },
        400: { description: "The stored file does not match what was declared" },
        409: { description: "Nothing has been uploaded yet" },
      },
    }),
    async (c) => {
      const s = store();
      const { group, me } = await requireMembership(
        db,
        c.get("session")!.user.id,
        c.req.param("id"),
      );
      const row = await findInGroup(group.id, c.req.param("receiptId"));
      if (row.uploadedBy !== me.id) throw forbidden("Only the uploader can confirm this receipt");
      if (row.status !== "awaiting_upload") return c.json(await toReceipt(row), 200);

      const stored = await s.head(row.originalKey);
      if (!stored) throw conflict("Nothing has been uploaded for this receipt yet");
      const problem =
        stored.sizeBytes > RECEIPT_MAX_BYTES
          ? "The file is larger than 10 MB"
          : stored.sizeBytes !== row.sizeBytes
            ? "The uploaded file is not the size that was declared"
            : stored.contentType !== row.contentType
              ? "The uploaded file is not the type that was declared"
              : null;
      if (problem) {
        await s.delete(row.originalKey);
        await db
          .update(schema.receipts)
          .set({ status: "failed", error: problem })
          .where(eq(schema.receipts.id, row.id));
        throw badRequest(problem);
      }

      // Conditional on the old status, so two concurrent confirms queue the job once.
      const [updated] = await db
        .update(schema.receipts)
        .set({ status: "uploaded" })
        .where(and(eq(schema.receipts.id, row.id), eq(schema.receipts.status, "awaiting_upload")))
        .returning();
      if (updated) await jobs.enqueueProcess(updated.id);
      return c.json(await toReceipt(updated ?? (await findInGroup(group.id, row.id))), 200);
    },
  );

  router.get(
    "/groups/:id/receipts",
    describeRoute({
      tags: ["receipts"],
      summary: `Receipts in a group, newest first (at most ${LIST_LIMIT})`,
      responses: { 200: { description: "OK", content: json(ReceiptListResponseSchema) } },
    }),
    async (c) => {
      const { group } = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      const rows = await db
        .select()
        .from(schema.receipts)
        .where(eq(schema.receipts.groupId, group.id))
        .orderBy(desc(schema.receipts.createdAt))
        .limit(LIST_LIMIT);
      return c.json({ receipts: await Promise.all(rows.map(toReceipt)) }, 200);
    },
  );

  router.get(
    "/groups/:id/receipts/:receiptId",
    describeRoute({
      tags: ["receipts"],
      summary: "One receipt, with short-lived image links once processed",
      responses: { 200: { description: "OK", content: json(ReceiptSchema) } },
    }),
    async (c) => {
      const { group } = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      return c.json(await toReceipt(await findInGroup(group.id, c.req.param("receiptId"))), 200);
    },
  );

  router.patch(
    "/groups/:id/receipts/:receiptId",
    describeRoute({
      tags: ["receipts"],
      summary: "Update reviewed OCR lines and recompute totals reconciliation",
      responses: {
        200: { description: "Updated", content: json(ReceiptSchema) },
        409: { description: "Receipt has not finished OCR processing yet" },
      },
    }),
    validate("json", UpdateReceiptOcrBodySchema),
    async (c) => {
      const { group } = await requireMembership(db, c.get("session")!.user.id, c.req.param("id"));
      const row = await findInGroup(group.id, c.req.param("receiptId"));
      if ((row.status !== "ready" && row.status !== "needs_review") || !row.ocr) {
        throw conflict("Wait until processing finishes before reviewing this receipt");
      }

      const existing = ReceiptOcrSchema.parse(row.ocr);
      const extraction = c.req.valid("json");
      const reconciliation = reconcileReceiptExtraction(extraction);
      const nextOcr: ReceiptOcr = {
        ...extraction,
        reconciliation,
        model: existing.model,
        provider: existing.provider,
      };
      const nextStatus = reconciliation.matches ? "ready" : "needs_review";

      const [updated] = await db
        .update(schema.receipts)
        .set({ ocr: nextOcr, status: nextStatus })
        .where(eq(schema.receipts.id, row.id))
        .returning();
      return c.json(await toReceipt(updated!), 200);
    },
  );

  return router;
}
